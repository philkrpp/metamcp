import { describe, expect, it } from "vitest";

import { resolveApiKeyOwner } from "./api-key-owner";

describe("resolveApiKeyOwner", () => {
  it("defaults to the caller when no owner is requested", () => {
    expect(resolveApiKeyOwner(undefined, "me")).toBe("me");
  });

  it("keeps null so public keys can still be created", () => {
    expect(resolveApiKeyOwner(null, "me")).toBeNull();
  });

  it("accepts the caller's own id", () => {
    expect(resolveApiKeyOwner("me", "me")).toBe("me");
  });

  it("ignores another user's id and assigns the caller", () => {
    expect(resolveApiKeyOwner("other", "me")).toBe("me");
  });
});
