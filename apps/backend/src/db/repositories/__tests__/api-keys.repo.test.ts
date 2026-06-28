import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mutable state captured by the fake db — cleared in beforeEach.
// The factory closures reference these by binding, so modifications made
// in test bodies are visible when the repo calls the mock.
// ---------------------------------------------------------------------------

/**
 * Fallback rows returned by db.select() when the sequential queue is empty.
 * Used by single-query tests (isEndpointAllowed, getEndpointUuidsForKey).
 */
let mockSelectRows: unknown[] = [];

/**
 * Queue of result-sets consumed in order — one per db.select() invocation.
 * This lets a single repo method that issues multiple sequential selects
 * (e.g. findAccessibleToUser: the keys query, then the inArray mappings batch)
 * return a different result-set per call. When exhausted, the chain falls back
 * to `mockSelectRows`.
 */
let mockSelectQueue: unknown[][] = [];

/** Number of db.select() invocations — used to assert query count (no N+1). */
let selectCallCount = 0;

/** delete() calls issued INSIDE a transaction (via tx.delete). */
const txDeleteCalls: Array<{ condition: unknown }> = [];

/** values() calls issued INSIDE a transaction (via tx.insert). */
const txInsertValuesCalls: Array<unknown> = [];

// ---------------------------------------------------------------------------
// Fake db — same pattern as oauth.repo.test.ts: real drizzle condition
// builders run against real schemas; only the DB connection is stubbed.
// ---------------------------------------------------------------------------
vi.mock("../../index", () => ({
  db: {
    /** Runs the transaction callback with a fake tx object. */
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        delete: (_table: unknown) => ({
          where: (condition: unknown) => {
            txDeleteCalls.push({ condition });
            return Promise.resolve([]);
          },
        }),
        insert: (_table: unknown) => ({
          values: (vals: unknown) => {
            txInsertValuesCalls.push(vals);
            return Promise.resolve([]);
          },
        }),
      };
      return fn(tx);
    },

    /**
     * Generic select chain. Each db.select() invocation consumes the next
     * result-set from `mockSelectQueue` (captured at call time so call order
     * is preserved); if the queue is exhausted it falls back to
     * `mockSelectRows`. Supports .from().where().limit().orderBy() in any
     * order, all no-ops except the final await which resolves the result-set.
     */
    select: (_fields: unknown) => {
      const result =
        selectCallCount < mockSelectQueue.length
          ? mockSelectQueue[selectCallCount]
          : mockSelectRows;
      selectCallCount += 1;
      const chain: Record<string, unknown> & {
        then: (
          resolve: (v: unknown) => unknown,
          reject?: (e: unknown) => unknown,
        ) => Promise<unknown>;
      } = {
        from: () => chain,
        where: () => chain,
        limit: () => chain,
        orderBy: () => chain,
        then: (
          resolve: (v: unknown) => unknown,
          reject?: (e: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve as never, reject),
      };
      return chain;
    },

    /** Used by create() to insert into api_keys. */
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => ({
        returning: (_fields: unknown) =>
          Promise.resolve([
            {
              uuid: "test-key-uuid",
              name: "test-key",
              user_id: null,
              created_at: new Date("2024-01-01T00:00:00Z"),
            },
          ]),
      }),
    }),

    /** Used by update() to update api_keys. */
    update: (_table: unknown) => ({
      set: (_vals: unknown) => ({
        where: (_condition: unknown) => ({
          returning: (_fields: unknown) =>
            Promise.resolve([
              {
                uuid: "test-key-uuid",
                name: "test-key",
                key: "sk_mt_xxx",
                created_at: new Date("2024-01-01T00:00:00Z"),
                is_active: true,
              },
            ]),
        }),
      }),
    }),

    /** Used by delete(). */
    delete: (_table: unknown) => ({
      where: (_condition: unknown) =>
        Promise.resolve([{ uuid: "test-key-uuid", name: "test-key" }]),
    }),
  },
}));

// Import AFTER vi.mock so the repo module binds to the fake db.
const { ApiKeysRepository } = await import("../api-keys.repo");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApiKeysRepository", () => {
  let repo: InstanceType<typeof ApiKeysRepository>;

  beforeEach(() => {
    repo = new ApiKeysRepository();
    mockSelectRows = [];
    mockSelectQueue = [];
    selectCallCount = 0;
    txDeleteCalls.length = 0;
    txInsertValuesCalls.length = 0;
  });

  // -------------------------------------------------------------------------
  describe("isEndpointAllowed", () => {
    it("returns true when the junction table yields a row", async () => {
      mockSelectRows = [{ uuid: "junction-row-uuid" }];
      const result = await repo.isEndpointAllowed(
        "key-uuid-1",
        "endpoint-uuid-1",
      );
      expect(result).toBe(true);
    });

    it("returns false when the junction table yields no rows", async () => {
      mockSelectRows = [];
      const result = await repo.isEndpointAllowed(
        "key-uuid-1",
        "endpoint-uuid-X",
      );
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("validateApiKey", () => {
    it("propagates restrict_endpoints (hot-path) along with valid/user_id/key_uuid", async () => {
      mockSelectRows = [
        {
          uuid: "key-uuid-1",
          user_id: "user-1",
          is_active: true,
          restrict_endpoints: true,
        },
      ];

      const result = await repo.validateApiKey("sk_mt_xxx");

      // Single query — exactly one select on the hot path.
      expect(selectCallCount).toBe(1);
      expect(result).toEqual({
        valid: true,
        user_id: "user-1",
        key_uuid: "key-uuid-1",
        restrict_endpoints: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("getEndpointUuidsForKey", () => {
    it("returns the endpoint UUIDs mapped to the key", async () => {
      mockSelectRows = [{ endpoint_uuid: "ep-1" }, { endpoint_uuid: "ep-2" }];

      const result = await repo.getEndpointUuidsForKey("key-uuid-1");

      expect(result).toEqual(["ep-1", "ep-2"]);
    });
  });

  // -------------------------------------------------------------------------
  describe("findAccessibleToUser — no N+1", () => {
    it("attaches endpoint_uuids + restrict_endpoints using exactly 2 queries", async () => {
      // First select() => the keys query; second select() => the inArray
      // mappings batch. Consumed in order from the queue.
      mockSelectQueue = [
        // keys query
        [
          {
            uuid: "k1",
            name: "key-1",
            key: "sk_mt_1",
            created_at: new Date("2024-01-02T00:00:00Z"),
            is_active: true,
            user_id: "user-1",
            restrict_endpoints: true,
          },
          {
            uuid: "k2",
            name: "key-2",
            key: "sk_mt_2",
            created_at: new Date("2024-01-01T00:00:00Z"),
            is_active: true,
            user_id: "user-1",
            restrict_endpoints: false,
          },
        ],
        // mappings batch: k1 -> [e1, e2], nothing for k2
        [
          { api_key_uuid: "k1", endpoint_uuid: "e1" },
          { api_key_uuid: "k1", endpoint_uuid: "e2" },
        ],
      ];

      const result = await repo.findAccessibleToUser("user-1");

      // Exactly two selects — proves the mappings are batch-fetched, not N+1.
      expect(selectCallCount).toBe(2);

      expect(result).toHaveLength(2);
      const k1 = result.find((k) => k.uuid === "k1");
      const k2 = result.find((k) => k.uuid === "k2");

      expect(k1?.restrict_endpoints).toBe(true);
      expect(k1?.endpoint_uuids).toEqual(["e1", "e2"]);

      expect(k2?.restrict_endpoints).toBe(false);
      // Empty array, NOT undefined.
      expect(k2?.endpoint_uuids).toEqual([]);
    });

    it("returns [] and issues a single query when the user has no keys", async () => {
      mockSelectQueue = [[]]; // keys query returns nothing

      const result = await repo.findAccessibleToUser("user-1");

      expect(result).toEqual([]);
      // Early-return: must NOT issue the mappings batch query.
      expect(selectCallCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("create — setEndpointAccess integration", () => {
    it("runs delete + insert inside a transaction when endpoint_uuids is provided", async () => {
      await repo.create({
        name: "my-key",
        endpoint_uuids: ["ep-uuid-1", "ep-uuid-2"],
      });

      // One delete call (clear existing mappings for the created key)
      expect(txDeleteCalls).toHaveLength(1);
      expect(txDeleteCalls[0]).toBeDefined();
      expect(txDeleteCalls[0]?.condition).toBeDefined();

      // One bulk insert call with both endpoint UUIDs
      expect(txInsertValuesCalls).toHaveLength(1);
      const inserted = txInsertValuesCalls[0] as Array<{
        api_key_uuid: string;
        endpoint_uuid: string;
      }>;
      expect(inserted).toHaveLength(2);
      expect(inserted[0]).toMatchObject({
        api_key_uuid: "test-key-uuid",
        endpoint_uuid: "ep-uuid-1",
      });
      expect(inserted[1]).toMatchObject({
        api_key_uuid: "test-key-uuid",
        endpoint_uuid: "ep-uuid-2",
      });
    });

    it("runs delete but skips insert when endpoint_uuids is an empty array", async () => {
      await repo.create({
        name: "my-key",
        endpoint_uuids: [],
      });

      expect(txDeleteCalls).toHaveLength(1);
      expect(txInsertValuesCalls).toHaveLength(0);
    });

    it("does NOT call setEndpointAccess at all when endpoint_uuids is undefined", async () => {
      await repo.create({ name: "my-key" });

      expect(txDeleteCalls).toHaveLength(0);
      expect(txInsertValuesCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("update — setEndpointAccess integration", () => {
    it("runs delete + insert when endpoint_uuids is provided", async () => {
      await repo.update("key-uuid", "user-id", {
        endpoint_uuids: ["ep-uuid-1"],
      });

      expect(txDeleteCalls).toHaveLength(1);
      expect(txInsertValuesCalls).toHaveLength(1);
      const inserted = txInsertValuesCalls[0] as Array<{
        api_key_uuid: string;
        endpoint_uuid: string;
      }>;
      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({
        api_key_uuid: "key-uuid",
        endpoint_uuid: "ep-uuid-1",
      });
    });

    it("runs delete only (no insert) when endpoint_uuids is an empty array", async () => {
      await repo.update("key-uuid", "user-id", {
        endpoint_uuids: [],
      });

      expect(txDeleteCalls).toHaveLength(1);
      expect(txInsertValuesCalls).toHaveLength(0);
    });

    it("does NOT call setEndpointAccess when endpoint_uuids is undefined", async () => {
      await repo.update("key-uuid", "user-id", {
        name: "new-name",
      });

      expect(txDeleteCalls).toHaveLength(0);
      expect(txInsertValuesCalls).toHaveLength(0);
    });
  });
});
