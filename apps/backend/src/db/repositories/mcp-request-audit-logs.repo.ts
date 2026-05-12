import { and, desc, eq, isNull, or } from "drizzle-orm";

import logger from "@/utils/logger";

import { db } from "../index";
import {
  apiKeysTable,
  mcpRequestAuditLogsTable,
  mcpServersTable,
  namespacesTable,
} from "../schema";

export interface McpRequestAuditLogCreateInput {
  endpointName: string;
  namespaceUuid: string;
  sessionId: string;
  authMethod: "api_key" | "oauth" | "none";
  apiKeyUuid?: string;
  apiKeyUserId?: string;
  oauthUserId?: string;
  mcpServerUuid?: string;
  mcpServerName?: string;
  toolName: string;
  status: "SUCCESS" | "ERROR";
  durationMs: number;
  errorMessage?: string;
}

export interface McpRequestAuditLogListInput {
  userId: string;
  limit?: number;
  offset?: number;
  endpointName?: string;
  apiKeyUuid?: string;
  status?: "SUCCESS" | "ERROR";
}

export class McpRequestAuditLogsRepository {
  async create(input: McpRequestAuditLogCreateInput): Promise<void> {
    try {
      await db.insert(mcpRequestAuditLogsTable).values({
        endpoint_name: input.endpointName,
        namespace_uuid: input.namespaceUuid,
        session_id: input.sessionId,
        auth_method: input.authMethod,
        api_key_uuid: input.apiKeyUuid,
        api_key_user_id: input.apiKeyUserId,
        oauth_user_id: input.oauthUserId,
        mcp_server_uuid: input.mcpServerUuid,
        mcp_server_name: input.mcpServerName,
        tool_name: input.toolName,
        status: input.status,
        duration_ms: input.durationMs,
        error_message: input.errorMessage,
      });
    } catch (error) {
      logger.error("Failed to persist MCP request audit log:", error);
    }
  }

  async list(input: McpRequestAuditLogListInput) {
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;
    const whereConditions = [
      or(
        eq(mcpRequestAuditLogsTable.api_key_user_id, input.userId),
        eq(mcpRequestAuditLogsTable.oauth_user_id, input.userId),
        isNull(mcpRequestAuditLogsTable.api_key_user_id),
      ),
    ];

    if (input.endpointName) {
      whereConditions.push(
        eq(mcpRequestAuditLogsTable.endpoint_name, input.endpointName),
      );
    }

    if (input.apiKeyUuid) {
      whereConditions.push(
        eq(mcpRequestAuditLogsTable.api_key_uuid, input.apiKeyUuid),
      );
    }

    if (input.status) {
      whereConditions.push(eq(mcpRequestAuditLogsTable.status, input.status));
    }

    const whereClause = and(...whereConditions);

    const rows = await db
      .select({
        uuid: mcpRequestAuditLogsTable.uuid,
        created_at: mcpRequestAuditLogsTable.created_at,
        endpoint_name: mcpRequestAuditLogsTable.endpoint_name,
        namespace_uuid: mcpRequestAuditLogsTable.namespace_uuid,
        namespace_name: namespacesTable.name,
        session_id: mcpRequestAuditLogsTable.session_id,
        auth_method: mcpRequestAuditLogsTable.auth_method,
        api_key_uuid: mcpRequestAuditLogsTable.api_key_uuid,
        api_key_name: apiKeysTable.name,
        api_key_user_id: mcpRequestAuditLogsTable.api_key_user_id,
        oauth_user_id: mcpRequestAuditLogsTable.oauth_user_id,
        mcp_server_uuid: mcpRequestAuditLogsTable.mcp_server_uuid,
        mcp_server_name: mcpRequestAuditLogsTable.mcp_server_name,
        registered_mcp_server_name: mcpServersTable.name,
        tool_name: mcpRequestAuditLogsTable.tool_name,
        status: mcpRequestAuditLogsTable.status,
        duration_ms: mcpRequestAuditLogsTable.duration_ms,
        error_message: mcpRequestAuditLogsTable.error_message,
      })
      .from(mcpRequestAuditLogsTable)
      .leftJoin(
        apiKeysTable,
        eq(apiKeysTable.uuid, mcpRequestAuditLogsTable.api_key_uuid),
      )
      .leftJoin(
        namespacesTable,
        eq(namespacesTable.uuid, mcpRequestAuditLogsTable.namespace_uuid),
      )
      .leftJoin(
        mcpServersTable,
        eq(mcpServersTable.uuid, mcpRequestAuditLogsTable.mcp_server_uuid),
      )
      .where(whereClause)
      .orderBy(desc(mcpRequestAuditLogsTable.created_at))
      .limit(limit)
      .offset(offset);

    return rows.map((row) => ({
      ...row,
      mcp_server_name: row.mcp_server_name ?? row.registered_mcp_server_name,
    }));
  }
}

export const mcpRequestAuditLogsRepository =
  new McpRequestAuditLogsRepository();
