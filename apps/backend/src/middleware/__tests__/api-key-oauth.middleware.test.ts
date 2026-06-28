import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the ApiKeysRepository module BEFORE importing the unit under test.
// isEndpointAllowed is the only method exercised by checkApiKeyAccess.
const mockIsEndpointAllowed = vi.fn<[string, string], Promise<boolean>>();

vi.mock("../../db/repositories/api-keys.repo", () => {
  return {
    // Must use a real function/class so `new ApiKeysRepository()` works.
    ApiKeysRepository: vi.fn(function (this: Record<string, unknown>) {
      this.isEndpointAllowed = mockIsEndpointAllowed;
    }),
  };
});

// Import AFTER vi.mock so the singleton in the middleware binds to the fake.
const { checkApiKeyAccess } = await import("../api-key-oauth.middleware");

// Minimal DatabaseEndpoint stub — only fields used by checkApiKeyAccess.
function makeEndpoint(
  overrides: { uuid?: string; user_id?: string | null } = {},
) {
  return {
    uuid: overrides.uuid ?? "endpoint-uuid-1",
    user_id: overrides.user_id !== undefined ? overrides.user_id : null,
    // Other DatabaseEndpoint fields are not relevant to checkApiKeyAccess.
    name: "test-endpoint",
    description: null,
    namespace_uuid: "ns-uuid",
    enable_api_key_auth: true,
    enable_max_rate: false,
    enable_client_max_rate: false,
    max_rate_seconds: null,
    max_rate: null,
    client_max_rate: null,
    client_max_rate_seconds: null,
    client_max_rate_strategy: null,
    client_max_rate_strategy_key: null,
    enable_oauth: false,
    use_query_param_auth: false,
    enable_metamcp_admin_tools: false,
    created_at: new Date(),
    updated_at: new Date(),
  } as const;
}

describe("checkApiKeyAccess", () => {
  beforeEach(() => {
    mockIsEndpointAllowed.mockReset();
  });

  // -------------------------------------------------------------------------
  // (a) Unrestricted key → allowed, NO DB call (constraint #2)
  // -------------------------------------------------------------------------
  describe("(a) unrestricted key", () => {
    it("allows access to a public endpoint and does NOT call isEndpointAllowed", async () => {
      const validation = {
        user_id: "user-1",
        restrict_endpoints: false,
        key_uuid: "key-uuid-1",
      };
      const endpoint = makeEndpoint({ user_id: null });

      const result = await checkApiKeyAccess(validation, endpoint);

      expect(result).toEqual({ allowed: true });
      expect(mockIsEndpointAllowed).not.toHaveBeenCalled();
    });

    it("allows access when restrict_endpoints is undefined and does NOT call isEndpointAllowed", async () => {
      const validation = { user_id: "user-1" }; // restrict_endpoints omitted (falsy)
      const endpoint = makeEndpoint({ user_id: null });

      const result = await checkApiKeyAccess(validation, endpoint);

      expect(result).toEqual({ allowed: true });
      expect(mockIsEndpointAllowed).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // (b) Restricted key + isEndpointAllowed resolves true → allowed
  // -------------------------------------------------------------------------
  describe("(b) restricted key, endpoint in allow-list", () => {
    it("returns allowed:true when the endpoint is in the key's allow-list", async () => {
      mockIsEndpointAllowed.mockResolvedValue(true);

      const validation = {
        user_id: "user-1",
        restrict_endpoints: true,
        key_uuid: "key-uuid-1",
      };
      const endpoint = makeEndpoint({ uuid: "endpoint-uuid-1", user_id: null });

      const result = await checkApiKeyAccess(validation, endpoint);

      expect(result).toEqual({ allowed: true });
      expect(mockIsEndpointAllowed).toHaveBeenCalledOnce();
      expect(mockIsEndpointAllowed).toHaveBeenCalledWith(
        "key-uuid-1",
        "endpoint-uuid-1",
      );
    });
  });

  // -------------------------------------------------------------------------
  // (c) Restricted key + isEndpointAllowed resolves false → denied
  // -------------------------------------------------------------------------
  describe("(c) restricted key, endpoint NOT in allow-list", () => {
    it("returns allowed:false with the scope message", async () => {
      mockIsEndpointAllowed.mockResolvedValue(false);

      const validation = {
        user_id: "user-1",
        restrict_endpoints: true,
        key_uuid: "key-uuid-1",
      };
      const endpoint = makeEndpoint({ uuid: "endpoint-uuid-2", user_id: null });

      const result = await checkApiKeyAccess(validation, endpoint);

      expect(result).toEqual({
        allowed: false,
        message: "This API key is not permitted to access this endpoint.",
      });
      expect(mockIsEndpointAllowed).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // (d) Restricted key with empty mappings behaves like (c) → denied
  // -------------------------------------------------------------------------
  describe("(d) restricted key with no mappings (empty allow-list)", () => {
    it("denies access when isEndpointAllowed returns false (empty list)", async () => {
      // Empty allow-list means no junction rows → isEndpointAllowed returns false.
      mockIsEndpointAllowed.mockResolvedValue(false);

      const validation = {
        user_id: "user-1",
        restrict_endpoints: true,
        key_uuid: "key-uuid-empty",
      };
      const endpoint = makeEndpoint({ uuid: "any-endpoint", user_id: null });

      const result = await checkApiKeyAccess(validation, endpoint);

      expect(result).toEqual({
        allowed: false,
        message: "This API key is not permitted to access this endpoint.",
      });
    });
  });

  // -------------------------------------------------------------------------
  // (e) Existing ownership checks still fire BEFORE scope check
  // -------------------------------------------------------------------------
  describe("(e) ownership checks preserved", () => {
    it("denies public API key (user_id null) access to a private endpoint with the ownership message", async () => {
      const validation = {
        user_id: null, // public key
        restrict_endpoints: false,
        key_uuid: "key-uuid-public",
      };
      const endpoint = makeEndpoint({ user_id: "owner-user-id" }); // private endpoint

      const result = await checkApiKeyAccess(validation, endpoint);

      expect(result).toEqual({
        allowed: false,
        message:
          "Public API keys cannot access private endpoints. Use a private API key owned by the endpoint owner.",
      });
      // Scope check must NOT have been reached.
      expect(mockIsEndpointAllowed).not.toHaveBeenCalled();
    });

    it("denies a private key that does not own the private endpoint with the ownership message", async () => {
      const validation = {
        user_id: "user-1", // different from endpoint owner
        restrict_endpoints: true, // scope enabled, but should not be reached
        key_uuid: "key-uuid-1",
      };
      const endpoint = makeEndpoint({ user_id: "user-2" }); // owned by someone else

      const result = await checkApiKeyAccess(validation, endpoint);

      expect(result).toEqual({
        allowed: false,
        message: "You can only access endpoints you own or public endpoints.",
      });
      // Scope check must NOT have been reached.
      expect(mockIsEndpointAllowed).not.toHaveBeenCalled();
    });
  });
});
