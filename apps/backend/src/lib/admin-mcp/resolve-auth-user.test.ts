import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiKeyAuthenticatedRequest } from "@/middleware/api-key-oauth.middleware";

const getUserRole = vi.fn();
vi.mock("./user-role", () => ({ getUserRole }));

const { resolveAdminActorFromRequest } = await import("./resolve-auth-user");

function req(
  fields: Partial<ApiKeyAuthenticatedRequest>,
): ApiKeyAuthenticatedRequest {
  return fields as ApiKeyAuthenticatedRequest;
}

describe("resolveAdminActorFromRequest", () => {
  beforeEach(() => {
    getUserRole.mockReset();
  });

  it("uses the OAuth user and their admin role", async () => {
    getUserRole.mockResolvedValue("admin");
    await expect(
      resolveAdminActorFromRequest(req({ oauthUserId: "u-oauth" })),
    ).resolves.toEqual({ userId: "u-oauth", isAdmin: true });
    expect(getUserRole).toHaveBeenCalledWith("u-oauth");
  });

  it("uses the API key owner as a member when their role is member", async () => {
    getUserRole.mockResolvedValue("member");
    await expect(
      resolveAdminActorFromRequest(req({ apiKeyUserId: "u-key" })),
    ).resolves.toEqual({ userId: "u-key", isAdmin: false });
  });

  it("refuses a caller with no owning user instead of borrowing another user", async () => {
    await expect(
      resolveAdminActorFromRequest(req({ apiKeyUuid: "k-public" })),
    ).resolves.toBeUndefined();
    expect(getUserRole).not.toHaveBeenCalled();
  });

  it("refuses an owner that no longer exists", async () => {
    getUserRole.mockResolvedValue(undefined);
    await expect(
      resolveAdminActorFromRequest(req({ apiKeyUserId: "u-gone" })),
    ).resolves.toBeUndefined();
  });
});
