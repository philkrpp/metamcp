/**
 * getMcpServers runs on every tools/list and tools/call. It used to look up
 * each server's OAuth session with its own query inside the per-server loop
 * (N+1); it now loads the sessions for all of the namespace's servers in one
 * batched query and attaches each server's tokens from that result.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { serverRows, oauthRepo } = vi.hoisted(() => ({
  serverRows: [] as Array<Record<string, unknown>>,
  oauthRepo: {
    findByMcpServerUuid: vi.fn(),
    findByMcpServerUuids: vi.fn(),
  },
}));

vi.mock("../../db/index", () => {
  const query = {
    from: () => query,
    innerJoin: () => query,
    where: async () => serverRows,
  };
  return { db: { select: () => query } };
});
vi.mock("../../db/repositories/index", () => ({
  oauthSessionsRepository: oauthRepo,
}));
vi.mock("./utils", () => ({ getDefaultEnvironment: () => ({}) }));
vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { getMcpServers } = await import("./fetch-metamcp");

const serverRow = (uuid: string) => ({
  uuid,
  name: `name-${uuid}`,
  description: null,
  type: "STDIO",
  command: "node",
  args: [],
  env: {},
  url: null,
  created_at: new Date("2026-01-01T00:00:00Z"),
  bearerToken: null,
  headers: {},
  forward_headers: {},
  status: "ACTIVE",
  error_status: "NONE",
});

const tokensFor = (uuid: string) => ({
  access_token: `at-${uuid}`,
  token_type: "Bearer",
  expires_in: 3600,
  scope: "read",
  refresh_token: `rt-${uuid}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  serverRows.length = 0;
});

describe("getMcpServers: OAuth sessions are loaded in one batched query", () => {
  it("issues one session query for N servers and attaches each server's own tokens", async () => {
    serverRows.push(serverRow("s1"), serverRow("s2"), serverRow("s3"));
    oauthRepo.findByMcpServerUuids.mockResolvedValue([
      { mcp_server_uuid: "s3", tokens: tokensFor("s3") },
      { mcp_server_uuid: "s1", tokens: tokensFor("s1") },
    ]);

    const servers = await getMcpServers("ns-1");

    expect(oauthRepo.findByMcpServerUuids).toHaveBeenCalledTimes(1);
    expect(oauthRepo.findByMcpServerUuids).toHaveBeenCalledWith([
      "s1",
      "s2",
      "s3",
    ]);
    expect(oauthRepo.findByMcpServerUuid).not.toHaveBeenCalled();

    expect(servers.s1.oauth_tokens).toEqual(tokensFor("s1"));
    expect(servers.s2.oauth_tokens).toBeNull();
    expect(servers.s3.oauth_tokens).toEqual(tokensFor("s3"));
  });

  it("a session row without tokens yields null tokens, as before", async () => {
    serverRows.push(serverRow("s1"));
    oauthRepo.findByMcpServerUuids.mockResolvedValue([
      { mcp_server_uuid: "s1", tokens: null },
    ]);

    const servers = await getMcpServers("ns-1");

    expect(servers.s1.oauth_tokens).toBeNull();
  });

  it("returns {} when the batched session query fails, as a per-server failure did", async () => {
    serverRows.push(serverRow("s1"));
    oauthRepo.findByMcpServerUuids.mockRejectedValue(new Error("db down"));

    expect(await getMcpServers("ns-1")).toEqual({});
  });
});
