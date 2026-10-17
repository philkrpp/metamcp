/**
 * PREWARM_IDLE_SERVERS=false must keep the pool from creating idle spares at
 * all, not only skip the startup prewarm. Before this, only startup.ts read
 * the flag: every getSession that consumed or bypassed an idle connection
 * refilled one in the background, and so did the health sweep, so a "lazy"
 * deployment still held one extra connection (a child process for STDIO) per
 * used server, and the connection cap filled up exactly as with prewarm on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  connectMetaMcpClient: vi.fn(),
}));
vi.mock("../config.service", () => ({
  configService: {
    getSessionLifetime: vi.fn().mockResolvedValue(null),
    getMcpTimeout: vi.fn().mockResolvedValue(60000),
    getMcpMaxTotalTimeout: vi.fn().mockResolvedValue(60000),
    getMcpResetTimeoutOnProgress: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock("../../db/repositories/mcp-servers.repo", () => ({
  mcpServersRepository: {},
}));
vi.mock("./server-error-tracker", () => ({
  serverErrorTracker: {
    recordServerCrash: vi.fn(),
    resetServerAttempts: vi.fn(),
    markSuccess: vi.fn(),
    getServerAttempts: vi.fn().mockReturnValue(0),
    isServerInErrorState: vi.fn().mockResolvedValue(false),
    resetServerErrorState: vi.fn(),
  },
}));

import { connectMetaMcpClient } from "./client";
import { McpServerPool } from "./mcp-server-pool";

const connectMock = connectMetaMcpClient as unknown as ReturnType<
  typeof vi.fn
>;

const params = (uuid: string) =>
  ({
    uuid,
    name: `srv-${uuid}`,
    type: "STREAMABLE_HTTP",
    url: "http://backend.invalid/mcp",
  }) as never;

const fakeClient = () => ({
  cleanup: vi.fn(async () => undefined),
  listChangedSubscribers: new Set(),
});

type Internals = { idleSessions: Record<string, unknown> };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("McpServerPool honours PREWARM_IDLE_SERVERS", () => {
  const saved = process.env.PREWARM_IDLE_SERVERS;
  const pools: McpServerPool[] = [];

  const makePool = (): McpServerPool => {
    const pool = new (McpServerPool as unknown as new () => McpServerPool)();
    pools.push(pool);
    return pool;
  };

  beforeEach(() => {
    connectMock.mockReset();
    connectMock.mockImplementation(async () => fakeClient());
  });

  afterEach(async () => {
    for (const pool of pools.splice(0)) {
      await pool.cleanupAll();
    }
    if (saved === undefined) {
      delete process.env.PREWARM_IDLE_SERVERS;
    } else {
      process.env.PREWARM_IDLE_SERVERS = saved;
    }
  });

  it("refills an idle spare after getSession by default", async () => {
    delete process.env.PREWARM_IDLE_SERVERS;
    const pool = makePool();

    await pool.getSession("s1", "A", params("A"));
    await settle();

    expect(connectMock).toHaveBeenCalledTimes(2);
    expect((pool as unknown as Internals).idleSessions["A"]).toBeDefined();
  });

  it.each(["false", "0", "off"])(
    "creates no idle spare after getSession when PREWARM_IDLE_SERVERS=%s",
    async (value) => {
      process.env.PREWARM_IDLE_SERVERS = value;
      const pool = makePool();

      const client = await pool.getSession("s1", "A", params("A"));
      await settle();

      expect(client).toBeDefined();
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect((pool as unknown as Internals).idleSessions["A"]).toBeUndefined();
    },
  );

  it("ensureIdleSessions creates nothing when prewarm is off", async () => {
    process.env.PREWARM_IDLE_SERVERS = "false";
    const pool = makePool();

    await pool.ensureIdleSessions({ A: params("A"), B: params("B") });
    await settle();

    expect(connectMock).not.toHaveBeenCalled();
    expect((pool as unknown as Internals).idleSessions).toEqual({});
  });
});
