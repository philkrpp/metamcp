/**
 * The endpoint toggle `enable_metamcp_admin_tools` is bound into a session's
 * admin-tools context once, when the session is created. Turning the toggle
 * off must take effect for sessions that already exist: their next
 * tools/list must stop advertising the admin tools and their next admin
 * tools/call must be refused, without waiting for the session to end.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectedClient } from "./client";

const { getSessionMock, findEndpointMock, executeAdminToolMock } = vi.hoisted(
  () => ({
    getSessionMock: vi.fn(),
    findEndpointMock: vi.fn(),
    executeAdminToolMock: vi.fn(),
  }),
);

vi.mock("@/utils/logger", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../../db/schema", () => ({}));
vi.mock("../../db/repositories/namespaces.repo", () => ({
  namespacesRepository: { findServersForNamespaceToolName: vi.fn() },
}));
vi.mock("../../db/repositories/oauth-sessions.repo", () => ({
  oauthSessionsRepository: {},
}));
vi.mock("../../db/repositories/endpoints.repo", () => ({
  endpointsRepository: { findByUuid: findEndpointMock },
}));
vi.mock("../../db/repositories", () => ({
  toolsRepository: {
    syncTools: vi.fn(async (input: { tools: unknown[] }) => ({
      upserted: input.tools,
      deleted: [],
    })),
  },
  mcpServersRepository: {},
  endpointsRepository: { findByUuid: findEndpointMock },
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
  getMcpServers: vi.fn(async () => ({ "server-ninja": { name: "ninja" } })),
}));

vi.mock("./mcp-server-pool", () => ({
  mcpServerPool: {
    getSession: getSessionMock,
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
  mapOverrideNameToOriginal: async (name: string) => name,
}));
vi.mock("./cold-connect-broker-fallback", () => ({
  resolveColdConnectBrokerFallback: () => undefined,
}));
vi.mock("./tool-call-warmup", () => ({
  acquireSessionWithBoundedWarmup: vi.fn(async () => undefined),
}));

// The real registry pulls in every tRPC implementation; one stand-in tool is
// enough to see whether the proxy advertises and dispatches admin tools.
vi.mock("../admin-mcp/tools-registry", () => ({
  getAdminToolsForMcp: () => [
    {
      name: "metamcp-admin__list_endpoints",
      description: "list endpoints",
      inputSchema: { type: "object", properties: {} },
    },
  ],
  executeAdminTool: executeAdminToolMock,
}));

import {
  clearAdminToolsContext,
  setAdminToolsContext,
} from "../admin-mcp/admin-session-context";
import { createServer } from "./metamcp-proxy";

const SESSION_ID = "sess-admin";
const ENDPOINT_UUID = "endpoint-1";
const ADMIN_TOOL = "metamcp-admin__list_endpoints";

const cleanups: Array<() => Promise<unknown>> = [];

async function backend(): Promise<ConnectedClient> {
  const server = new Server(
    { name: "ninja", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "kick", inputSchema: { type: "object", properties: {} } },
    ],
  }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "metamcp", version: "1.0.0" });
  await client.connect(clientSide);
  cleanups.push(() => client.close());
  return {
    client,
    cleanup: () => client.close(),
    listChangedSubscribers: new Set(),
  } as unknown as ConnectedClient;
}

async function connectConsumer(): Promise<Client> {
  const { server } = await createServer("ns-1", SESSION_ID);
  const [consumerSide, gatewaySide] = InMemoryTransport.createLinkedPair();
  await server.connect(gatewaySide);
  const consumer = new Client({ name: "consumer", version: "1.0.0" });
  await consumer.connect(consumerSide);
  cleanups.push(() => consumer.close());
  return consumer;
}

const endpointRow = (enableAdminTools: boolean) => ({
  uuid: ENDPOINT_UUID,
  enable_metamcp_admin_tools: enableAdminTools,
  enable_api_key_auth: true,
  enable_oauth: false,
});

const toolNames = async (consumer: Client) =>
  (
    await consumer.request(
      { method: "tools/list", params: {} },
      ListToolsResultSchema,
    )
  ).tools.map((t) => t.name);

beforeEach(async () => {
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue(await backend());
  findEndpointMock.mockReset();
  executeAdminToolMock.mockReset();
  executeAdminToolMock.mockResolvedValue({
    content: [{ type: "text", text: "ok" }],
  });
  // The binding a session gets at creation (buildAdminToolsOptions).
  setAdminToolsContext(SESSION_ID, {
    enabled: true,
    userId: "user-1",
    isAdmin: true,
    endpointUuid: ENDPOINT_UUID,
  });
});

afterEach(async () => {
  clearAdminToolsContext(SESSION_ID);
  while (cleanups.length > 0) {
    await cleanups
      .pop()?.()
      .catch(() => undefined);
  }
});

describe("endpoint admin-tools toggle on an existing session", () => {
  it("advertises and dispatches admin tools while the toggle is on", async () => {
    findEndpointMock.mockResolvedValue(endpointRow(true));
    const consumer = await connectConsumer();

    expect(await toolNames(consumer)).toContain(ADMIN_TOOL);

    const result = await consumer.request(
      { method: "tools/call", params: { name: ADMIN_TOOL, arguments: {} } },
      CallToolResultSchema,
    );
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    expect(executeAdminToolMock).toHaveBeenCalledTimes(1);
  });

  it("stops advertising admin tools once the toggle is turned off", async () => {
    findEndpointMock.mockResolvedValue(endpointRow(true));
    const consumer = await connectConsumer();
    expect(await toolNames(consumer)).toContain(ADMIN_TOOL);

    findEndpointMock.mockResolvedValue(endpointRow(false));
    const names = await toolNames(consumer);
    expect(names).not.toContain(ADMIN_TOOL);
    expect(names).toContain("ninja__kick");
  });

  it("refuses admin tool calls once the toggle is turned off", async () => {
    findEndpointMock.mockResolvedValue(endpointRow(false));
    const consumer = await connectConsumer();

    await expect(
      consumer.request(
        { method: "tools/call", params: { name: ADMIN_TOOL, arguments: {} } },
        CallToolResultSchema,
      ),
    ).rejects.toThrow(/Access denied to MetaMCP admin tool/);
    expect(executeAdminToolMock).not.toHaveBeenCalled();
  });

  it("refuses admin tool calls once the endpoint is gone", async () => {
    findEndpointMock.mockResolvedValue(undefined);
    const consumer = await connectConsumer();

    expect(await toolNames(consumer)).not.toContain(ADMIN_TOOL);
    await expect(
      consumer.request(
        { method: "tools/call", params: { name: ADMIN_TOOL, arguments: {} } },
        CallToolResultSchema,
      ),
    ).rejects.toThrow(/Access denied to MetaMCP admin tool/);
    expect(executeAdminToolMock).not.toHaveBeenCalled();
  });
});
