import { ServerParameters } from "@repo/zod-types";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Shared, hoisted state for the connectMetaMcpClient mock. vi.hoisted runs
// before the vi.mock factory, so the factory can safely close over it.
const hoisted = vi.hoisted(() => ({
  connectCalls: { count: 0 },
}));

// Mock the backend client factory so getSession() never spawns a real
// process. Each call resolves on the next microtask, which is the async gap
// where concurrent getSession() calls would otherwise race the cap checks.
// config.service transitively imports the DB layer, which throws at import
// time without DATABASE_URL. The pool only calls getSessionLifetime() from a
// 5-minute timer that never fires in these tests, so a stub is sufficient.
vi.mock("../config.service", () => ({
  configService: {
    getSessionLifetime: vi.fn(async () => null),
  },
}));

// server-error-tracker imports the DB repositories index, which also throws
// without DATABASE_URL. None of its methods are exercised by these tests.
vi.mock("./server-error-tracker", () => ({
  serverErrorTracker: {
    recordServerCrash: vi.fn(async () => {}),
    isServerInErrorState: vi.fn(async () => false),
    resetServerErrorState: vi.fn(async () => {}),
  },
}));

vi.mock("./client", () => ({
  connectMetaMcpClient: vi.fn(async () => {
    hoisted.connectCalls.count++;
    await Promise.resolve();
    return {
      client: {},
      cleanup: vi.fn(async () => {}),
    };
  }),
}));

import { McpServerPool, mcpServerPool } from "./mcp-server-pool";

// Params WITH forward_headers so the pool skips the idle pool entirely
// (serverRequiresForwardedHeaders === true). This isolates the active-session
// create/reuse path under test from background idle-session creation noise.
const fwdParams = (uuid: string): ServerParameters =>
  ({
    uuid,
    name: `srv-${uuid}`,
    type: "STDIO",
    command: "node",
    forward_headers: { "x-api-key": "X-Api-Key" },
  }) as unknown as ServerParameters;

const pools: McpServerPool[] = [];
const makePool = (maxPerServer: number, maxTotal = 100): McpServerPool => {
  // Constructor is TS-private; bypass for tests. Signature:
  // (defaultIdleCount, maxTotalConnections, maxConnectionsPerServer)
  const pool = new (McpServerPool as unknown as new (
    idle: number,
    total: number,
    perServer: number,
  ) => McpServerPool)(1, maxTotal, maxPerServer);
  pools.push(pool);
  return pool;
};

afterEach(async () => {
  for (const p of pools.splice(0)) {
    await p.cleanupAll();
  }
  hoisted.connectCalls.count = 0;
});

// The module-level singleton starts interval timers at import time; clear them
// so the test process can exit cleanly.
afterAll(async () => {
  await mcpServerPool.cleanupAll();
});

describe("McpServerPool connection accounting", () => {
  it("counts distinct backend connections per server, not slot references", async () => {
    const pool = makePool(2);
    const uuid = "A";
    const p = fwdParams(uuid);

    // Two distinct sessions reach the per-server cap of 2.
    await pool.getSession("s1", uuid, p);
    await pool.getSession("s2", uuid, p);
    // Four more sessions must REUSE the two existing connections.
    await pool.getSession("s3", uuid, p);
    await pool.getSession("s4", uuid, p);
    await pool.getSession("s5", uuid, p);
    await pool.getSession("s6", uuid, p);

    // Only two real backend connections were ever created.
    expect(hoisted.connectCalls.count).toBe(2);

    // The reported per-server count must reflect the 2 distinct connections,
    // not the 6 slot references. The bug counts slots and reports 6/2.
    const status = pool.getPoolStatus();
    expect(status.perServerCounts?.[uuid]).toBe(2);
  });

  it("does not exceed the per-server limit when sessions connect concurrently", async () => {
    const pool = makePool(5);
    const uuid = "B";
    const p = fwdParams(uuid);

    // Establish 4 distinct connections, one below the cap of 5.
    for (const s of ["s1", "s2", "s3", "s4"]) {
      await pool.getSession(s, uuid, p);
    }
    expect(hoisted.connectCalls.count).toBe(4);
    hoisted.connectCalls.count = 0;

    // Three sessions connect concurrently. Only ONE new real connection may be
    // created (to reach the cap of 5); the other two must reuse. Without slot
    // reservation, all three pass the cap check and create -> 3 connections.
    const results = await Promise.all([
      pool.getSession("s5", uuid, p),
      pool.getSession("s6", uuid, p),
      pool.getSession("s7", uuid, p),
    ]);

    expect(results.every(Boolean)).toBe(true);
    expect(hoisted.connectCalls.count).toBe(1);
  });

  it("reuse does not consume global capacity, so other servers can still connect", async () => {
    // Per-server cap 2, global cap 4.
    const pool = makePool(2, 4);
    const a = fwdParams("A");
    const b = fwdParams("B");

    // Two distinct connections on server A (reaches its per-server cap).
    await pool.getSession("s1", "A", a);
    await pool.getSession("s2", "A", a);
    // Three more sessions reuse A: 5 slots referencing only 2 connections.
    await pool.getSession("s3", "A", a);
    await pool.getSession("s4", "A", a);
    await pool.getSession("s5", "A", a);

    // Server B must still connect: only 2 distinct connections exist globally,
    // well under the global cap of 4. The bug counts 5 slots >= 4 and refuses,
    // returning undefined — the same false saturation that broke recovery.
    const clientB = await pool.getSession("s6", "B", b);
    expect(clientB).toBeTruthy();
  });
});
