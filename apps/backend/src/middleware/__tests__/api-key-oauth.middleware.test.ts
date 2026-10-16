// TEMP(api-key-legacy-scope): remove once legacy multi-endpoint keys are replaced
//
// Unit tests for checkApiKeyAccessWithLegacyScope — the shim that keeps keys
// minted under our pre-umbrella n:m model (rows in `api_key_endpoint_access`,
// `endpoint_uuid IS NULL`) confined to their listed endpoints, while keys
// without legacy rows behave exactly as umbrella's checkApiKeyAccess.
import { DatabaseEndpoint } from "@repo/zod-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetLegacyEndpointScope =
  vi.fn<(a: string) => Promise<string[] | null>>();

vi.mock("@/utils/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the ApiKeysRepository module BEFORE importing the unit under test.
vi.mock("../../db/repositories/api-keys.repo", () => {
  return {
    // Must use a real function/class so `new ApiKeysRepository()` works.
    ApiKeysRepository: vi.fn(function (this: Record<string, unknown>) {
      this.validateApiKey = vi.fn();
      this.getLegacyEndpointScope = mockGetLegacyEndpointScope;
    }),
  };
});

// The middleware's module-load import chain reaches db/index through these
// repositories; none of them is exercised by the functions under test.
vi.mock("../../db/repositories/users.repo", () => ({
  usersRepository: { isDisabled: vi.fn() },
}));
vi.mock("../../db/repositories/oauth.repo", () => ({
  oauthRepository: { getAccessToken: vi.fn() },
}));
vi.mock("../../db/repositories/access-groups.repo", () => ({
  accessGroupsRepository: {
    hasEndpointGrant: vi.fn().mockResolvedValue(false),
  },
}));

// Import AFTER vi.mock so the singleton in the middleware binds to the fake.
const { checkApiKeyAccessWithLegacyScope } = await import(
  "../api-key-oauth.middleware"
);

const ENDPOINT_A = "11111111-1111-4111-8111-111111111111";
const ENDPOINT_B = "22222222-2222-4222-8222-222222222222";
const ENDPOINT_C = "33333333-3333-4333-8333-333333333333";

function makeEndpoint(
  overrides: Partial<DatabaseEndpoint> = {},
): DatabaseEndpoint {
  return {
    uuid: ENDPOINT_A,
    name: "test-endpoint",
    description: null,
    namespace_uuid: "44444444-4444-4444-8444-444444444444",
    enable_api_key_auth: true,
    require_scoped_api_key: false,
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
    restricted: false,
    created_at: new Date("2026-07-01T00:00:00Z"),
    updated_at: new Date("2026-07-01T00:00:00Z"),
    user_id: null,
    ...overrides,
  };
}

describe("checkApiKeyAccessWithLegacyScope", () => {
  beforeEach(() => {
    mockGetLegacyEndpointScope.mockReset();
  });

  describe("unscoped key (endpoint_uuid NULL) with legacy n:m rows", () => {
    it("allows access on an endpoint listed in the legacy rows", async () => {
      mockGetLegacyEndpointScope.mockResolvedValue([ENDPOINT_A, ENDPOINT_B]);

      const result = await checkApiKeyAccessWithLegacyScope(
        { user_id: null, endpoint_uuid: null, key_uuid: "key-legacy" },
        makeEndpoint({ uuid: ENDPOINT_B }),
      );

      expect(result).toEqual({ allowed: true });
      expect(mockGetLegacyEndpointScope).toHaveBeenCalledWith("key-legacy");
    });

    it("denies access on an endpoint NOT listed in the legacy rows", async () => {
      mockGetLegacyEndpointScope.mockResolvedValue([ENDPOINT_A, ENDPOINT_B]);

      const result = await checkApiKeyAccessWithLegacyScope(
        { user_id: null, endpoint_uuid: null, key_uuid: "key-legacy" },
        makeEndpoint({ uuid: ENDPOINT_C }),
      );

      expect(result).toEqual({
        allowed: false,
        message: "This API key is not permitted to access this endpoint.",
      });
    });

    it("treats an undefined endpoint_uuid like NULL", async () => {
      mockGetLegacyEndpointScope.mockResolvedValue([ENDPOINT_A]);

      const result = await checkApiKeyAccessWithLegacyScope(
        { user_id: null, key_uuid: "key-legacy" },
        makeEndpoint({ uuid: ENDPOINT_C }),
      );

      expect(result.allowed).toBe(false);
    });

    it("fails closed when the legacy lookup throws", async () => {
      mockGetLegacyEndpointScope.mockRejectedValue(new Error("db down"));

      const result = await checkApiKeyAccessWithLegacyScope(
        { user_id: null, endpoint_uuid: null, key_uuid: "key-legacy" },
        makeEndpoint({ uuid: ENDPOINT_A }),
      );

      expect(result.allowed).toBe(false);
    });

    it("denies everywhere once a restricted key has no endpoints left", async () => {
      // restrict_endpoints = true with zero rows: e.g. every listed endpoint
      // was deleted (ON DELETE CASCADE). Must not widen to gateway-wide.
      mockGetLegacyEndpointScope.mockResolvedValue([]);

      const result = await checkApiKeyAccessWithLegacyScope(
        { user_id: null, endpoint_uuid: null, key_uuid: "key-legacy" },
        makeEndpoint({ uuid: ENDPOINT_A }),
      );

      expect(result.allowed).toBe(false);
    });
  });

  describe("unscoped key not legacy-restricted → umbrella behaviour", () => {
    it("allows access gateway-wide (any endpoint)", async () => {
      mockGetLegacyEndpointScope.mockResolvedValue(null);

      const result = await checkApiKeyAccessWithLegacyScope(
        { user_id: null, endpoint_uuid: null, key_uuid: "key-unscoped" },
        makeEndpoint({ uuid: ENDPOINT_C }),
      );

      expect(result).toEqual({ allowed: true });
    });

    it("is still refused by require_scoped_api_key, without a legacy lookup", async () => {
      const result = await checkApiKeyAccessWithLegacyScope(
        { user_id: null, endpoint_uuid: null, key_uuid: "key-unscoped" },
        makeEndpoint({ require_scoped_api_key: true }),
      );

      expect(result.allowed).toBe(false);
      expect(result.message).toMatch(/requires an endpoint-scoped API key/i);
      expect(mockGetLegacyEndpointScope).not.toHaveBeenCalled();
    });

    it("keeps umbrella's ownership denial, without a legacy lookup", async () => {
      const result = await checkApiKeyAccessWithLegacyScope(
        { user_id: null, endpoint_uuid: null, key_uuid: "key-public" },
        makeEndpoint({ user_id: "owner-user-id" }),
      );

      expect(result.allowed).toBe(false);
      expect(result.message).toMatch(/Public API keys cannot access private/);
      expect(mockGetLegacyEndpointScope).not.toHaveBeenCalled();
    });
  });

  describe("scoped key (endpoint_uuid set) → umbrella behaviour, no lookup", () => {
    it("allows on its bound endpoint without reading legacy rows", async () => {
      const result = await checkApiKeyAccessWithLegacyScope(
        { user_id: null, endpoint_uuid: ENDPOINT_A, key_uuid: "key-scoped" },
        makeEndpoint({ uuid: ENDPOINT_A }),
      );

      expect(result).toEqual({ allowed: true });
      expect(mockGetLegacyEndpointScope).not.toHaveBeenCalled();
    });

    it("denies on any other endpoint without reading legacy rows", async () => {
      const result = await checkApiKeyAccessWithLegacyScope(
        { user_id: null, endpoint_uuid: ENDPOINT_A, key_uuid: "key-scoped" },
        makeEndpoint({ uuid: ENDPOINT_B }),
      );

      expect(result.allowed).toBe(false);
      expect(result.message).toMatch(/scoped to a different endpoint/i);
      expect(mockGetLegacyEndpointScope).not.toHaveBeenCalled();
    });
  });
});
