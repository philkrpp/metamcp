/**
 * Choosing "Private" in the MCP server edit form must send an explicit owner.
 * The update path keeps the stored owner when `user_id` is missing, so the old
 * `undefined` left public servers public without any error.
 *
 * The form renders client-side React this suite cannot mount (node
 * environment, no DOM), so the decision lives in a pure helper tested here,
 * and the edit form's source is pinned.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { privateServerOwner } from "./server-ownership";

const FRONTEND = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("privateServerOwner", () => {
  it("claims a public server for the signed-in user", () => {
    expect(privateServerOwner(null, "user-1")).toBe("user-1");
  });

  it("keeps the stored owner of an owned server", () => {
    expect(privateServerOwner("owner-1", "admin-1")).toBe("owner-1");
  });

  it("has no owner to name when the session is unknown", () => {
    expect(privateServerOwner(null, undefined)).toBeUndefined();
    expect(privateServerOwner(null, "")).toBeUndefined();
  });
});

describe("the edit form", () => {
  const form = readFileSync(
    path.join(FRONTEND, "components/edit-mcp-server.tsx"),
    "utf8",
  );

  it("never sends undefined for 'Private'", () => {
    expect(form).not.toContain('setValue("user_id", undefined)');
    expect(form).toContain("privateServerOwner(");
  });
});
