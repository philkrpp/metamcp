/**
 * Accept-header compatibility on the public Streamable HTTP route.
 *
 * The SDK transport answers 406 unless a POST accepts both
 * `application/json` and `text/event-stream` (and a GET accepts
 * `text/event-stream`). Some clients (Codex) send only one of them, so the
 * route normalizes the header before every transport dispatch: a fresh
 * session's initialize, a request on a resident session, a request on a
 * lazily recovered session, and the standalone SSE GET.
 *
 * What is real: the router, the session manager, the SDK transports, a real
 * SDK `Server` per pooled instance and transport-recovery hydration. What is
 * faked: the DB-touching boundaries (`mcp_sessions` as an in-memory table) and
 * the express auth middlewares. Same harness shape as
 * streamable-http.body-limit.test.ts.
 */
import type { Server as HttpServer } from "node:http";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import express from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const h = vi.hoisted(() => {
  const rows = new Map<string, unknown>();
  return {
    rows,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    getServer: vi.fn(),
    persist: vi.fn(async (row: { session_id: string }) => {
      rows.set(row.session_id, {
        ...row,
        created_at: new Date(),
        last_seen_at: new Date(),
      });
    }),
    findById: vi.fn(async (sessionId: string) => rows.get(sessionId) ?? null),
    delete: vi.fn(async (sessionId: string) => {
      rows.delete(sessionId);
    }),
  };
});

vi.mock("@/utils/logger", () => ({ default: h.logger }));
vi.mock("../../lib/health-upstream", () => ({
  isAdminHealthRequest: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/db", () => ({ db: {}, pool: { on: vi.fn() } }));
vi.mock("@/middleware/api-key-oauth.middleware", () => ({
  authenticateApiKey: vi.fn(),
}));
vi.mock("@/middleware/lookup-endpoint-middleware", () => ({
  lookupEndpoint: vi.fn(),
}));
vi.mock("@/middleware/rate-limit.middleware", () => ({
  rateLimitMiddleware: vi.fn(),
}));
vi.mock("@/db/repositories/mcp-sessions.repo", () => ({
  mcpSessionsRepository: {
    persist: h.persist,
    findById: h.findById,
    touch: vi.fn().mockResolvedValue(undefined),
    delete: h.delete,
    pruneOlderThan: vi.fn().mockResolvedValue(0),
  },
}));
vi.mock("../../lib/metamcp/consumer-identity-resolver", () => ({
  resolveClientIdentity: vi.fn().mockResolvedValue({ name: "test-consumer" }),
}));
vi.mock("../../lib/metamcp/metamcp-server-pool", () => ({
  metaMcpServerPool: {
    getServer: h.getServer,
    getServerInstance: vi.fn(),
    cleanupSession: vi.fn(async () => undefined),
    getMcpServerPoolStatus: vi.fn().mockReturnValue({ idle: 0, active: 0 }),
    getPoolStatus: vi.fn().mockReturnValue({ idle: 0, active: 0 }),
  },
}));
vi.mock("../../lib/metamcp/log-store", () => ({
  metamcpLogStore: { record: vi.fn() },
}));

import { authenticateApiKey } from "@/middleware/api-key-oauth.middleware";
import { lookupEndpoint } from "@/middleware/lookup-endpoint-middleware";
import { rateLimitMiddleware } from "@/middleware/rate-limit.middleware";

import streamableHttpRouter, { reapIdleSession } from "./streamable-http";

const PROTOCOL_VERSION = "2025-06-18";

let httpServer: HttpServer;
let baseUrl = "";
let keyCounter = 0;
let rawKey = "";
let keyUuid = "";
let rpcId = 0;

const initializeBody = () =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: (rpcId += 1),
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "accept-client", version: "0.0.0" },
    },
  });

const pingBody = () =>
  JSON.stringify({ jsonrpc: "2.0", id: (rpcId += 1), method: "ping" });

function request(
  method: "GET" | "POST",
  accept: string | undefined,
  options: { body?: string; sessionId?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  return fetch(`${baseUrl}/metamcp/ep-1/mcp`, {
    method,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(accept ? { accept } : {}),
      "x-api-key": rawKey,
      ...(options.sessionId
        ? {
            "mcp-session-id": options.sessionId,
            "mcp-protocol-version": PROTOCOL_VERSION,
          }
        : {}),
    },
    body: options.body,
    signal: options.signal,
  });
}

/** The JSON-RPC result the SDK answers on an SSE stream or as JSON. */
async function resultOf(response: Response): Promise<unknown> {
  const text = await response.text();
  const data = text.startsWith("{")
    ? text
    : text
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);
  return data ? (JSON.parse(data) as { result?: unknown }).result : undefined;
}

async function openSession(accept: string): Promise<string> {
  const response = await request("POST", accept, { body: initializeBody() });
  expect(response.status).toBe(200);
  await response.text();
  const sessionId = response.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("initialize returned no Mcp-Session-Id");
  return sessionId;
}

beforeAll(async () => {
  vi.mocked(lookupEndpoint).mockImplementation(((
    req: express.Request,
    _res: express.Response,
    next: () => void,
  ) => {
    const endpoint = String(req.params.endpoint_name);
    Object.assign(req, {
      namespaceUuid: `ns-${endpoint}`,
      endpointName: endpoint,
      endpoint: { uuid: `uuid-${endpoint}`, name: endpoint },
      authMethod: "api_key",
      apiKeyUuid: keyUuid,
      auditRequestId: "req-accept",
      auditClientIp: "203.0.113.31",
    });
    next();
  }) as never);
  vi.mocked(authenticateApiKey).mockImplementation(((
    _req: express.Request,
    _res: express.Response,
    next: () => void,
  ) => next()) as never);
  vi.mocked(rateLimitMiddleware).mockImplementation(((
    _req: express.Request,
    _res: express.Response,
    next: () => void,
  ) => next()) as never);

  const app = express();
  app.use("/metamcp", streamableHttpRouter);
  await new Promise<void>((resolve) => {
    httpServer = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = httpServer.address();
  if (typeof address === "object" && address) {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(async () => {
  httpServer.closeAllConnections();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  // A fresh credential per test keeps each one clear of the per-credential
  // session ceiling, which is module state shared by the whole file.
  keyCounter += 1;
  keyUuid = `4a7f8a1e-0000-4000-8000-${String(keyCounter).padStart(12, "0")}`;
  rawKey = `accept-key-${keyCounter}`;
  h.getServer.mockImplementation(async () => ({
    server: new Server(
      { name: "accept-gateway", version: "0.0.0" },
      { capabilities: {} },
    ),
    cleanup: vi.fn().mockResolvedValue(undefined),
    handlerContext: {} as Record<string, unknown>,
  }));
});

describe("Accept normalization on the Streamable HTTP route", () => {
  it.each([
    ["application/json only", "application/json"],
    ["text/event-stream only", "text/event-stream"],
    ["*/*", "*/*"],
  ])(
    "serves a fresh session's initialize with Accept %s",
    async (_label, accept) => {
      const response = await request("POST", accept, {
        body: initializeBody(),
      });

      expect(response.status).toBe(200);
      expect(await resultOf(response)).toMatchObject({
        serverInfo: { name: "accept-gateway" },
      });
    },
  );

  it("serves an initialize with no Accept header at all", async () => {
    const response = await request("POST", undefined, {
      body: initializeBody(),
    });

    expect(response.status).toBe(200);
  });

  it("serves a request on a resident session with Accept application/json only", async () => {
    const sessionId = await openSession("application/json");

    const response = await request("POST", "application/json", {
      body: pingBody(),
      sessionId,
    });

    expect(response.status).toBe(200);
    expect(await resultOf(response)).toEqual({});
  });

  it("serves a request on a lazily recovered session with Accept application/json only", async () => {
    const sessionId = await openSession("application/json, text/event-stream");
    await reapIdleSession(sessionId);
    h.findById.mockClear();

    const response = await request("POST", "application/json", {
      body: pingBody(),
      sessionId,
    });

    // Recovered from the row, not served by a resident transport.
    expect(h.findById).toHaveBeenCalledWith(sessionId);
    expect(response.status).toBe(200);
    expect(await resultOf(response)).toEqual({});
  });

  it("opens the standalone SSE stream for a GET with Accept application/json only", async () => {
    const sessionId = await openSession("application/json, text/event-stream");
    const abort = new AbortController();

    const response = await request("GET", "application/json", {
      sessionId,
      signal: abort.signal,
    });

    try {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
    } finally {
      abort.abort();
    }
  });

  it("leaves a header that already accepts both types untouched", async () => {
    const response = await request(
      "POST",
      "text/event-stream;q=0.9, application/json",
      { body: initializeBody() },
    );

    expect(response.status).toBe(200);
  });
});
