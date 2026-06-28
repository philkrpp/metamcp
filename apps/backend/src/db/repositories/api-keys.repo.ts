import { ApiKeyCreateInput, ApiKeyUpdateInput } from "@repo/zod-types";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { customAlphabet } from "nanoid";

import { db } from "../index";
import { apiKeyEndpointAccessTable, apiKeysTable } from "../schema";

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  64,
);

export class ApiKeysRepository {
  /**
   * Generate a new API key with the specified format: sk_mt_{64-char-nanoid}
   */
  private generateApiKey(): string {
    const keyPart = nanoid();
    const key = `sk_mt_${keyPart}`;

    return key;
  }

  /**
   * Replace all endpoint-access mappings for `keyUuid` in a single transaction.
   * Existing rows are deleted first, then the new set is bulk-inserted.
   * If `endpointUuids` is empty the delete still runs (clears all mappings)
   * but no insert is issued.
   */
  private async setEndpointAccess(
    keyUuid: string,
    endpointUuids: string[],
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(apiKeyEndpointAccessTable)
        .where(eq(apiKeyEndpointAccessTable.api_key_uuid, keyUuid));

      if (endpointUuids.length > 0) {
        await tx.insert(apiKeyEndpointAccessTable).values(
          endpointUuids.map((endpointUuid) => ({
            api_key_uuid: keyUuid,
            endpoint_uuid: endpointUuid,
          })),
        );
      }
    });
  }

  async create(input: ApiKeyCreateInput): Promise<{
    uuid: string;
    name: string;
    key: string;
    user_id: string | null;
    created_at: Date;
  }> {
    const key = this.generateApiKey();

    const [createdApiKey] = await db
      .insert(apiKeysTable)
      .values({
        name: input.name,
        key: key,
        user_id: input.user_id,
        is_active: input.is_active ?? true,
        restrict_endpoints: input.restrict_endpoints ?? false,
      })
      .returning({
        uuid: apiKeysTable.uuid,
        name: apiKeysTable.name,
        user_id: apiKeysTable.user_id,
        created_at: apiKeysTable.created_at,
      });

    if (!createdApiKey) {
      throw new Error("Failed to create API key");
    }

    if (input.endpoint_uuids !== undefined) {
      await this.setEndpointAccess(createdApiKey.uuid, input.endpoint_uuids);
    }

    return {
      ...createdApiKey,
      key, // Return the actual key
    };
  }

  async findByUserId(userId: string) {
    return await db
      .select({
        uuid: apiKeysTable.uuid,
        name: apiKeysTable.name,
        key: apiKeysTable.key,
        created_at: apiKeysTable.created_at,
        is_active: apiKeysTable.is_active,
      })
      .from(apiKeysTable)
      .where(eq(apiKeysTable.user_id, userId))
      .orderBy(desc(apiKeysTable.created_at));
  }

  // Find all API keys (both public and user-owned)
  async findAll() {
    return await db
      .select({
        uuid: apiKeysTable.uuid,
        name: apiKeysTable.name,
        key: apiKeysTable.key,
        created_at: apiKeysTable.created_at,
        is_active: apiKeysTable.is_active,
        user_id: apiKeysTable.user_id,
      })
      .from(apiKeysTable)
      .orderBy(desc(apiKeysTable.created_at));
  }

  // Find public API keys (no user ownership)
  async findPublicApiKeys() {
    return await db
      .select({
        uuid: apiKeysTable.uuid,
        name: apiKeysTable.name,
        key: apiKeysTable.key,
        created_at: apiKeysTable.created_at,
        is_active: apiKeysTable.is_active,
        user_id: apiKeysTable.user_id,
      })
      .from(apiKeysTable)
      .where(isNull(apiKeysTable.user_id))
      .orderBy(desc(apiKeysTable.created_at));
  }

  // Find API keys accessible to a specific user (public + user's own keys)
  // Returns each key with its endpoint_uuids — fetched in ONE batch query (no N+1).
  async findAccessibleToUser(userId: string) {
    const keys = await db
      .select({
        uuid: apiKeysTable.uuid,
        name: apiKeysTable.name,
        key: apiKeysTable.key,
        created_at: apiKeysTable.created_at,
        is_active: apiKeysTable.is_active,
        user_id: apiKeysTable.user_id,
        restrict_endpoints: apiKeysTable.restrict_endpoints,
      })
      .from(apiKeysTable)
      .where(
        or(
          isNull(apiKeysTable.user_id), // Public API keys
          eq(apiKeysTable.user_id, userId), // User's own API keys
        ),
      )
      .orderBy(desc(apiKeysTable.created_at));

    if (keys.length === 0) return [];

    // Batch-fetch all endpoint mappings for the returned keys in ONE query.
    const keyUuids = keys.map((k) => k.uuid);
    const mappings = await db
      .select({
        api_key_uuid: apiKeyEndpointAccessTable.api_key_uuid,
        endpoint_uuid: apiKeyEndpointAccessTable.endpoint_uuid,
      })
      .from(apiKeyEndpointAccessTable)
      .where(inArray(apiKeyEndpointAccessTable.api_key_uuid, keyUuids));

    // Group mappings by api_key_uuid in memory.
    const endpointsByKey = new Map<string, string[]>();
    for (const mapping of mappings) {
      const existing = endpointsByKey.get(mapping.api_key_uuid) ?? [];
      existing.push(mapping.endpoint_uuid);
      endpointsByKey.set(mapping.api_key_uuid, existing);
    }

    return keys.map((k) => ({
      ...k,
      endpoint_uuids: endpointsByKey.get(k.uuid) ?? [],
    }));
  }

  async findByUuid(uuid: string, userId: string) {
    const [apiKey] = await db
      .select({
        uuid: apiKeysTable.uuid,
        name: apiKeysTable.name,
        key: apiKeysTable.key,
        created_at: apiKeysTable.created_at,
        is_active: apiKeysTable.is_active,
        user_id: apiKeysTable.user_id,
      })
      .from(apiKeysTable)
      .where(
        and(eq(apiKeysTable.uuid, uuid), eq(apiKeysTable.user_id, userId)),
      );

    return apiKey;
  }

  // Find API key by UUID with access control (user can access their own keys + public keys)
  async findByUuidWithAccess(uuid: string, userId?: string) {
    const [apiKey] = await db
      .select({
        uuid: apiKeysTable.uuid,
        name: apiKeysTable.name,
        key: apiKeysTable.key,
        created_at: apiKeysTable.created_at,
        is_active: apiKeysTable.is_active,
        user_id: apiKeysTable.user_id,
      })
      .from(apiKeysTable)
      .where(
        and(
          eq(apiKeysTable.uuid, uuid),
          userId
            ? or(
                isNull(apiKeysTable.user_id), // Public API keys
                eq(apiKeysTable.user_id, userId), // User's own API keys
              )
            : isNull(apiKeysTable.user_id), // Only public if no user context
        ),
      );

    return apiKey;
  }

  async validateApiKey(key: string): Promise<{
    valid: boolean;
    user_id?: string | null;
    key_uuid?: string;
    restrict_endpoints?: boolean;
  }> {
    const [apiKey] = await db
      .select({
        uuid: apiKeysTable.uuid,
        user_id: apiKeysTable.user_id,
        is_active: apiKeysTable.is_active,
        restrict_endpoints: apiKeysTable.restrict_endpoints,
      })
      .from(apiKeysTable)
      .where(eq(apiKeysTable.key, key));

    if (!apiKey) {
      return { valid: false };
    }

    // Check if key is active
    if (!apiKey.is_active) {
      return { valid: false };
    }

    return {
      valid: true,
      user_id: apiKey.user_id,
      key_uuid: apiKey.uuid,
      restrict_endpoints: apiKey.restrict_endpoints,
    };
  }

  async update(uuid: string, userId: string, input: ApiKeyUpdateInput) {
    const [updatedApiKey] = await db
      .update(apiKeysTable)
      .set({
        ...(input.name && { name: input.name }),
        ...(input.is_active !== undefined && { is_active: input.is_active }),
        ...(input.restrict_endpoints !== undefined && {
          restrict_endpoints: input.restrict_endpoints,
        }),
      })
      .where(
        and(
          eq(apiKeysTable.uuid, uuid),
          or(eq(apiKeysTable.user_id, userId), isNull(apiKeysTable.user_id)),
        ),
      )
      .returning({
        uuid: apiKeysTable.uuid,
        name: apiKeysTable.name,
        key: apiKeysTable.key,
        created_at: apiKeysTable.created_at,
        is_active: apiKeysTable.is_active,
      });

    if (!updatedApiKey) {
      throw new Error("Failed to update API key or API key not found");
    }

    if (input.endpoint_uuids !== undefined) {
      await this.setEndpointAccess(uuid, input.endpoint_uuids);
    }

    return updatedApiKey;
  }

  /**
   * Check whether a specific endpoint is in the access list for the given key.
   * Returns true iff a junction row exists. Minimal: SELECT 1 + LIMIT 1.
   */
  async isEndpointAllowed(
    keyUuid: string,
    endpointUuid: string,
  ): Promise<boolean> {
    const [row] = await db
      .select({ uuid: apiKeyEndpointAccessTable.uuid })
      .from(apiKeyEndpointAccessTable)
      .where(
        and(
          eq(apiKeyEndpointAccessTable.api_key_uuid, keyUuid),
          eq(apiKeyEndpointAccessTable.endpoint_uuid, endpointUuid),
        ),
      )
      .limit(1);

    return !!row;
  }

  /**
   * Return all endpoint UUIDs mapped to `keyUuid`.
   */
  async getEndpointUuidsForKey(keyUuid: string): Promise<string[]> {
    const rows = await db
      .select({ endpoint_uuid: apiKeyEndpointAccessTable.endpoint_uuid })
      .from(apiKeyEndpointAccessTable)
      .where(eq(apiKeyEndpointAccessTable.api_key_uuid, keyUuid));

    return rows.map((r) => r.endpoint_uuid);
  }

  async delete(uuid: string, userId: string) {
    const [deletedApiKey] = await db
      .delete(apiKeysTable)
      .where(
        and(
          eq(apiKeysTable.uuid, uuid),
          or(eq(apiKeysTable.user_id, userId), isNull(apiKeysTable.user_id)),
        ),
      )
      .returning({
        uuid: apiKeysTable.uuid,
        name: apiKeysTable.name,
      });

    if (!deletedApiKey) {
      throw new Error("Failed to delete API key or API key not found");
    }

    return deletedApiKey;
  }
}
