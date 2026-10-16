/**
 * The namespace description is advertised as the MCP `instructions` field of
 * the gateway's InitializeResult, so clients (Claude Desktop, Claude Code, ...)
 * can show what a namespace offers when the connector is added.
 *
 * A real SDK consumer `Client` initializes against the `Server` returned by
 * `createServer`; only the namespace repository lookup is faked.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findByUuidMock } = vi.hoisted(() => ({
  findByUuidMock: vi.fn(),
}));

vi.mock("@/utils/logger", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../../db/schema", () => ({}));
vi.mock("../../db/repositories/namespaces.repo", () => ({
  namespacesRepository: {
    findByUuid: findByUuidMock,
    findServersForNamespaceToolName: vi.fn(),
  },
}));
vi.mock("../../db/repositories/oauth-sessions.repo", () => ({
  oauthSessionsRepository: {},
}));
vi.mock("../../db/repositories", () => ({
  toolsRepository: {},
  mcpServersRepository: {},
}));
vi.mock("../audit/admin-event", () => ({ emitAdminEvent: vi.fn() }));

vi.mock("../config.service", () => ({
  configService: {
    getMcpResetTimeoutOnProgress: async () => false,
    getMcpTimeout: async () => 5_000,
    getMcpMaxTotalTimeout: async () => 60_000,
    getMcpToolCallReconnectWarmupTimeout: async () => 0,
  },
}));
vi.mock("./fetch-metamcp", () => ({
  getMcpServers: vi.fn(async () => ({})),
}));
vi.mock("./mcp-server-pool", () => ({
  mcpServerPool: {
    getSession: vi.fn(),
    invalidateServerConnection: vi.fn(),
    cleanupSession: vi.fn(),
    getPoolStatus: () => ({ idle: 1, active: 1 }),
  },
}));
vi.mock("./metamcp-middleware/filter-tools.functional", () => ({
  createFilterCallToolMiddleware: () => (next: unknown) => next,
  createFilterListToolsMiddleware: () => (next: unknown) => next,
}));
vi.mock("./metamcp-middleware/tool-overrides.functional", () => ({
  createToolOverridesCallToolMiddleware: () => (next: unknown) => next,
  createToolOverridesListToolsMiddleware: () => (next: unknown) => next,
  mapOverrideNameToOriginal: vi.fn(async (name: string) => name),
}));
vi.mock("./cold-connect-broker-fallback", () => ({
  resolveColdConnectBrokerFallback: () => undefined,
}));
vi.mock("./tool-call-warmup", () => ({
  acquireSessionWithBoundedWarmup: vi.fn(async () => undefined),
}));

import { createServer } from "./metamcp-proxy";

const cleanups: Array<() => Promise<unknown>> = [];

/** Initializes a consumer against the gateway and returns its InitializeResult. */
async function initialize() {
  const { server } = await createServer("ns-1", "sess-1");
  const [consumerSide, gatewaySide] = InMemoryTransport.createLinkedPair();
  await server.connect(gatewaySide);

  let initializeResult: Record<string, unknown> | undefined;
  const consumer = new Client({ name: "consumer", version: "1.0.0" });
  // Capture the raw InitializeResult off the wire so a missing key is
  // distinguishable from one set to undefined. The SDK installs its
  // `onmessage` before calling `start()`, so wrap it there.
  const originalStart = consumerSide.start.bind(consumerSide);
  consumerSide.start = async () => {
    const sdkHandler = consumerSide.onmessage;
    consumerSide.onmessage = (message, extra) => {
      if ("result" in message && "protocolVersion" in message.result) {
        initializeResult = message.result;
      }
      sdkHandler?.(message, extra);
    };
    return originalStart();
  };
  await consumer.connect(consumerSide);
  cleanups.push(() => consumer.close());
  return { consumer, initializeResult };
}

beforeEach(() => {
  findByUuidMock.mockReset();
});

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups
      .pop()?.()
      .catch(() => undefined);
  }
});

describe("namespace description as MCP instructions", () => {
  it("advertises the namespace description as instructions", async () => {
    findByUuidMock.mockResolvedValue({
      uuid: "ns-1",
      name: "ns",
      description: "Tools for the billing team.",
    });

    const { consumer, initializeResult } = await initialize();

    expect(findByUuidMock).toHaveBeenCalledWith("ns-1");
    expect(initializeResult?.instructions).toBe("Tools for the billing team.");
    expect(consumer.getInstructions()).toBe("Tools for the billing team.");
  });

  it("omits instructions when the namespace has no description", async () => {
    findByUuidMock.mockResolvedValue({
      uuid: "ns-1",
      name: "ns",
      description: null,
    });

    const { consumer, initializeResult } = await initialize();

    expect(initializeResult).toBeDefined();
    expect(initializeResult).not.toHaveProperty("instructions");
    expect(consumer.getInstructions()).toBeUndefined();
  });

  it("still initializes without instructions when the lookup fails", async () => {
    findByUuidMock.mockRejectedValue(new Error("db down"));

    const { consumer, initializeResult } = await initialize();

    expect(initializeResult).toBeDefined();
    expect(initializeResult).not.toHaveProperty("instructions");
    expect(consumer.getInstructions()).toBeUndefined();
  });
});
