import { describe, expect, it, vi } from "vitest";

const setSignupDisabled = vi.fn().mockResolvedValue(true);
const listMcpServers = vi.fn().mockResolvedValue({ success: true, data: [] });
const createApiKey = vi.fn().mockResolvedValue({ success: true });
const getUserRole = vi.fn();
vi.mock("./user-role", () => ({ getUserRole }));

vi.mock("../../trpc/api-keys.impl", () => ({
  apiKeysImplementations: { create: createApiKey },
}));
vi.mock("../../trpc/config.impl", () => ({
  configImplementations: { setSignupDisabled },
}));
vi.mock("../../trpc/endpoints.impl", () => ({ endpointsImplementations: {} }));
vi.mock("../../trpc/logs.impl", () => ({ logsImplementations: {} }));
vi.mock("../../trpc/mcp-servers.impl", () => ({
  mcpServersImplementations: { list: listMcpServers },
}));
vi.mock("../../trpc/namespaces.impl", () => ({
  namespacesImplementations: {},
}));
vi.mock("../../trpc/oauth.impl", () => ({ oauthImplementations: {} }));
vi.mock("../../trpc/tools.impl", () => ({ toolsImplementations: {} }));

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
