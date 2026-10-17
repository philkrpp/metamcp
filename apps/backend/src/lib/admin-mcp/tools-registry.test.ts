import { describe, expect, it, vi } from "vitest";

const setSignupDisabled = vi.fn().mockResolvedValue(true);
const listMcpServers = vi.fn().mockResolvedValue({ success: true, data: [] });
const createApiKey = vi.fn().mockResolvedValue({ success: true });
const getUserRole = vi.fn();
vi.mock("./user-role", () => ({ getUserRole }));

const ok = () => vi.fn().mockResolvedValue({ success: true });
// Write implementations that take an `actor?: AuditActor` for their audit row.
const impl = {
  mcpServers: {
    create: ok(),
    update: ok(),
    delete: ok(),
    bulkImport: ok(),
  },
  namespaces: {
    create: ok(),
    update: ok(),
    delete: ok(),
    updateServerStatus: ok(),
    updateToolStatus: ok(),
    updateToolOverrides: ok(),
  },
  endpoints: { create: ok(), update: ok(), delete: ok() },
  apiKeys: { update: ok(), delete: ok() },
  config: {
    setSsoSignupDisabled: ok(),
    setBasicAuthDisabled: ok(),
    setSessionLifetime: ok(),
    setConfig: ok(),
  },
  tools: { create: ok(), sync: ok() },
};

vi.mock("../../trpc/api-keys.impl", () => ({
  apiKeysImplementations: { create: createApiKey, ...impl.apiKeys },
}));
vi.mock("../../trpc/config.impl", () => ({
  configImplementations: { setSignupDisabled, ...impl.config },
}));
vi.mock("../../trpc/endpoints.impl", () => ({
  endpointsImplementations: impl.endpoints,
}));
vi.mock("../../trpc/logs.impl", () => ({ logsImplementations: {} }));
vi.mock("../../trpc/mcp-servers.impl", () => ({
  mcpServersImplementations: { list: listMcpServers, ...impl.mcpServers },
}));
vi.mock("../../trpc/namespaces.impl", () => ({
  namespacesImplementations: impl.namespaces,
}));
vi.mock("../../trpc/oauth.impl", () => ({ oauthImplementations: {} }));
vi.mock("../../trpc/tools.impl", () => ({
  toolsImplementations: impl.tools,
}));

const { beforeEach } = await import("vitest");
const { ADMIN_TOOLS, executeAdminTool, getAdminToolsForMcp } = await import(
  "./tools-registry"
);

const member = { userId: "u-member", isAdmin: false };
const admin = { userId: "u-admin", isAdmin: true };

function exposed(name: string): string {
  const tool = getAdminToolsForMcp(admin).find((t) => t.name.endsWith(name));
  if (!tool) throw new Error(`missing admin tool ${name}`);
  return tool.name;
}

describe("admin tools registry — role gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserRole.mockImplementation(async (id: string) =>
      id === "u-admin" ? "admin" : "member",
    );
  });

  it("hides admin-only tools from members", () => {
    const names = getAdminToolsForMcp(member).map((t) => t.name);
    expect(names.some((n) => n.endsWith("metamcp_set_signup_disabled"))).toBe(
      false,
    );
    expect(names.some((n) => n.endsWith("metamcp_list_mcp_servers"))).toBe(
      true,
    );
  });

  it("shows every tool to admins", () => {
    expect(getAdminToolsForMcp(admin)).toHaveLength(ADMIN_TOOLS.length);
  });

  it("refuses an admin-only tool called by a member", async () => {
    const result = await executeAdminTool(
      exposed("metamcp_set_signup_disabled"),
      member,
      { disabled: false },
    );
    expect(result.isError).toBe(true);
    expect(setSignupDisabled).not.toHaveBeenCalled();

    const asAdmin = await executeAdminTool(
      exposed("metamcp_set_signup_disabled"),
      admin,
      { disabled: false },
    );
    expect(asAdmin.isError).toBeUndefined();
    expect(setSignupDisabled).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's role to role-aware implementations", async () => {
    await executeAdminTool(exposed("metamcp_list_mcp_servers"), member, {});
    expect(listMcpServers).toHaveBeenCalledWith("u-member", false);
  });

  it("re-reads the role on every call instead of trusting the session's", async () => {
    getUserRole.mockResolvedValue("member"); // demoted since session start
    const result = await executeAdminTool(
      exposed("metamcp_set_signup_disabled"),
      admin,
      { disabled: false },
    );
    expect(result.isError).toBe(true);
    expect(setSignupDisabled).not.toHaveBeenCalled();
  });

  it("refuses a caller whose account no longer exists", async () => {
    getUserRole.mockResolvedValue(undefined);
    const result = await executeAdminTool(
      exposed("metamcp_list_mcp_servers"),
      member,
      {},
    );
    expect(result.isError).toBe(true);
    expect(listMcpServers).not.toHaveBeenCalled();
  });

  it.each([
    ["admin_plane", { name: "k", admin_plane: true }],
    [
      "acts_as_user_id",
      {
        name: "k",
        endpoint_uuid: "55555555-5555-4555-8555-555555555555",
        acts_as_user_id: "u-admin",
      },
    ],
  ])(
    "never mints a control-plane key (%s) through a data-plane tool",
    async (field, input) => {
      const result = await executeAdminTool(
        exposed("metamcp_create_api_key"),
        admin,
        input,
      );
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(field);
      expect(createApiKey).not.toHaveBeenCalled();
    },
  );
});

describe("admin tools registry — audit actor", () => {
  const U1 = "11111111-1111-4111-8111-111111111111";
  const U2 = "22222222-2222-4222-8222-222222222222";
  const U3 = "33333333-3333-4333-8333-333333333333";
  const stdioServer = { name: "srv", type: "STDIO", command: "node" };
  const endpoint = {
    name: "ep",
    namespaceUuid: U1,
    enableClientMaxRate: false,
    enableMaxRate: false,
  };
  const tools = {
    mcpServerUuid: U1,
    tools: [{ name: "t", inputSchema: { type: "object" } }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getUserRole.mockResolvedValue("admin");
  });

  // [tool, implementation mock, valid input, index of the actor argument]
  it.each([
    ["metamcp_create_mcp_server", impl.mcpServers.create, stdioServer, 2],
    [
      "metamcp_update_mcp_server",
      impl.mcpServers.update,
      { ...stdioServer, uuid: U1 },
      2,
    ],
    ["metamcp_delete_mcp_server", impl.mcpServers.delete, { uuid: U1 }, 2],
    [
      "metamcp_bulk_import_mcp_servers",
      impl.mcpServers.bulkImport,
      { mcpServers: { srv: { command: "node" } } },
      2,
    ],
    ["metamcp_create_namespace", impl.namespaces.create, { name: "ns" }, 2],
    [
      "metamcp_update_namespace",
      impl.namespaces.update,
      { uuid: U1, name: "ns" },
      2,
    ],
    ["metamcp_delete_namespace", impl.namespaces.delete, { uuid: U1 }, 2],
    [
      "metamcp_update_namespace_server_status",
      impl.namespaces.updateServerStatus,
      { namespaceUuid: U1, serverUuid: U2, status: "ACTIVE" },
      2,
    ],
    [
      "metamcp_update_namespace_tool_status",
      impl.namespaces.updateToolStatus,
      { namespaceUuid: U1, toolUuid: U2, serverUuid: U3, status: "ACTIVE" },
      2,
    ],
    [
      "metamcp_update_namespace_tool_overrides",
      impl.namespaces.updateToolOverrides,
      { namespaceUuid: U1, toolUuid: U2, serverUuid: U3, overrideName: "x" },
      2,
    ],
    ["metamcp_create_endpoint", impl.endpoints.create, endpoint, 2],
    [
      "metamcp_update_endpoint",
      impl.endpoints.update,
      { ...endpoint, uuid: U2 },
      2,
    ],
    ["metamcp_delete_endpoint", impl.endpoints.delete, { uuid: U1 }, 2],
    [
      "metamcp_create_api_key",
      createApiKey,
      { name: "k", endpoint_uuid: U1 },
      3,
    ],
    [
      "metamcp_update_api_key",
      impl.apiKeys.update,
      { uuid: U1, is_active: false },
      3,
    ],
    ["metamcp_delete_api_key", impl.apiKeys.delete, { uuid: U1 }, 3],
    ["metamcp_set_signup_disabled", setSignupDisabled, { disabled: true }, 1],
    [
      "metamcp_set_sso_signup_disabled",
      impl.config.setSsoSignupDisabled,
      { disabled: true },
      1,
    ],
    [
      "metamcp_set_basic_auth_disabled",
      impl.config.setBasicAuthDisabled,
      { disabled: true },
      1,
    ],
    [
      "metamcp_set_session_lifetime",
      impl.config.setSessionLifetime,
      { lifetime: 600000 },
      1,
    ],
    [
      "metamcp_set_config",
      impl.config.setConfig,
      { key: "DISABLE_SIGNUP", value: "true" },
      1,
    ],
    ["metamcp_save_tools", impl.tools.create, tools, 1],
    ["metamcp_sync_tools", impl.tools.sync, tools, 1],
  ] as const)(
    "%s attributes its audit row to the calling user",
    async (name, fn, input, actorIndex) => {
      const result = await executeAdminTool(exposed(name), admin, input);
      expect(result.isError, JSON.stringify(result.content)).toBeUndefined();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[0][actorIndex]).toEqual({
        actor_id: "u-admin",
        actor_label: null,
        actor_ip: null,
        actor_user_agent: null,
        request_id: null,
      });
    },
  );
});
