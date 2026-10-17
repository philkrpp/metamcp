/**
 * The aggregated prompts/list, resources/list and resources/templates/list
 * responses are complete in one page: the proxy fans out to every backend
 * and returns everything it collected. Echoing the request's cursor back as
 * `nextCursor` told paginating clients there was another page, so they asked
 * again with the same cursor and looped forever. These cases pin that the
 * aggregated lists never advertise a next page.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  ListResourcesRequestSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectedClient } from "./client";

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

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
vi.mock("../../db/repositories", () => ({
  toolsRepository: { syncTools: vi.fn() },
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

import { createServer } from "./metamcp-proxy";

const cleanups: Array<() => Promise<unknown>> = [];

async function backend(): Promise<ConnectedClient> {
  const server = new Server(
    { name: "ninja", version: "1.0.0" },
    { capabilities: { prompts: {}, resources: {} } },
  );
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: "greet" }],
  }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: "file:///a", name: "a" }],
  }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [{ uriTemplate: "file:///{x}", name: "x" }],
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
  const { server } = await createServer("ns-1", "sess-1");
  const [consumerSide, gatewaySide] = InMemoryTransport.createLinkedPair();
  await server.connect(gatewaySide);
  const consumer = new Client({ name: "consumer", version: "1.0.0" });
  await consumer.connect(consumerSide);
  cleanups.push(() => consumer.close());
  return consumer;
}

beforeEach(async () => {
  getSessionMock.mockReset();
  const session = await backend();
  getSessionMock.mockResolvedValue(session);
});

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups
      .pop()?.()
      .catch(() => undefined);
  }
});

describe("aggregated list pagination", () => {
  it("prompts/list does not echo the request cursor as nextCursor", async () => {
    const consumer = await connectConsumer();
    const result = await consumer.request(
      { method: "prompts/list", params: { cursor: "page-2" } },
      ListPromptsResultSchema,
    );
    expect(result.prompts.map((p) => p.name)).toEqual(["ninja__greet"]);
    expect(result.nextCursor).toBeUndefined();
  });

  it("resources/list does not echo the request cursor as nextCursor", async () => {
    const consumer = await connectConsumer();
    const result = await consumer.request(
      { method: "resources/list", params: { cursor: "page-2" } },
      ListResourcesResultSchema,
    );
    expect(result.resources).toHaveLength(1);
    expect(result.nextCursor).toBeUndefined();
  });

  it("resources/templates/list does not echo the request cursor as nextCursor", async () => {
    const consumer = await connectConsumer();
    const result = await consumer.request(
      { method: "resources/templates/list", params: { cursor: "page-2" } },
      ListResourceTemplatesResultSchema,
    );
    expect(result.resourceTemplates).toHaveLength(1);
    expect(result.nextCursor).toBeUndefined();
  });
});
