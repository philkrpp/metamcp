/**
 * Ownership rules of `namespaces.create`.
 *
 * A namespace created without an explicit owner belongs to its creator
 * (private), mirroring endpoints. Only an explicit `user_id: null` makes it
 * public, and public namespaces still may contain public servers only. A
 * caller may not create a namespace owned by someone else.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../db/repositories", () => ({
  mcpServersRepository: { findByUuid: vi.fn() },
  namespaceMappingsRepository: {},
  namespacesRepository: { create: vi.fn() },
  toolsRepository: {},
}));

vi.mock("../db/serializers", () => ({
  NamespacesSerializer: { serializeNamespace: vi.fn((ns) => ns) },
}));

vi.mock("../lib/audit/admin-event", () => ({ emitAdminEvent: vi.fn() }));

vi.mock("../lib/metamcp/metamcp-middleware/tool-overrides.functional", () => ({
  clearOverrideCache: vi.fn(),
  mapOverrideNameToOriginal: vi.fn(),
}));

vi.mock("../lib/metamcp/metamcp-middleware/filter-tools.functional", () => ({
  clearFilterCache: vi.fn(),
}));

vi.mock("../lib/metamcp/metamcp-server-pool", () => ({
  metaMcpServerPool: {
    ensureIdleServerForNewNamespace: vi.fn(() => Promise.resolve()),
  },
}));

import { mcpServersRepository, namespacesRepository } from "../db/repositories";
import { namespacesImplementations } from "./namespaces.impl";

const OWNER = "user-1";
const privateServer = { uuid: "s-priv", name: "priv", user_id: OWNER };

describe("namespacesImplementations.create ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(namespacesRepository.create).mockImplementation(
      async (input: { user_id?: string | null }) =>
        ({ uuid: "ns-1", name: "ns", user_id: input.user_id }) as never,
    );
    vi.mocked(mcpServersRepository.findByUuid).mockResolvedValue(
      privateServer as never,
    );
  });

  it("makes a namespace without an explicit owner private to its creator", async () => {
    const result = await namespacesImplementations.create(
      { name: "ns", mcpServerUuids: ["s-priv"] },
      OWNER,
    );

    expect(result.success).toBe(true);
    expect(namespacesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: OWNER }),
    );
  });

  it("still rejects a private server in an explicitly public namespace", async () => {
    const result = await namespacesImplementations.create(
      { name: "ns", mcpServerUuids: ["s-priv"], user_id: null },
      OWNER,
    );

    expect(result.success).toBe(false);
    expect(namespacesRepository.create).not.toHaveBeenCalled();
  });

  it("refuses to create a namespace owned by another user", async () => {
    const result = await namespacesImplementations.create(
      { name: "ns", user_id: "someone-else" },
      OWNER,
    );

    expect(result.success).toBe(false);
    expect(namespacesRepository.create).not.toHaveBeenCalled();
  });
});
