/**
 * The namespace forms offer only the ownership the backend actually applies.
 * The create form offers "For myself" (no owner sent; the backend makes the
 * creator the owner) and "Everyone" (null, public), defaulting to private so
 * private MCP servers can be grouped into a new namespace.
 *
 * The forms render client-side React this suite cannot mount (node
 * environment, no DOM), so the decision lives in a pure helper tested here,
 * and the create page's source is pinned.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { namespaceOwnershipChoices } from "./namespace-ownership";

const FRONTEND = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("namespaceOwnershipChoices", () => {
  it("offers only 'everyone' for a public namespace", () => {
    expect(namespaceOwnershipChoices(null)).toEqual(["everyone"]);
  });

  it("offers only 'everyone' when there is no stored owner at all", () => {
    expect(namespaceOwnershipChoices(undefined)).toEqual(["everyone"]);
    expect(namespaceOwnershipChoices("")).toEqual(["everyone"]);
  });

  it("keeps both choices for an owned namespace, so its owner can publish it", () => {
    expect(namespaceOwnershipChoices("user-1")).toEqual([
      "forMyself",
      "everyone",
    ]);
  });
});

describe("the create form", () => {
  const page = readFileSync(
    path.join(FRONTEND, "app/[locale]/(sidebar)/namespaces/page.tsx"),
    "utf8",
  );

  it("offers 'For myself' and defaults to it", () => {
    expect(page).toContain('t("namespaces:forMyself")');
    expect(page).toContain('setValue("user_id", undefined)');
    expect(page).not.toContain("user_id: null, // Default to public");
  });

  it("states the ownership it applies", () => {
    expect(page).toContain('t("namespaces:everyone")');
    expect(page).toContain('t("namespaces:ownershipPublicNote")');
  });
});

describe("ownershipPublicNote is translated in every shipped locale", () => {
  it.each(["en", "ko", "zh"])("%s", (locale) => {
    const strings = JSON.parse(
      readFileSync(
        path.join(FRONTEND, "public/locales", locale, "namespaces.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(typeof strings.ownershipPublicNote).toBe("string");
    expect((strings.ownershipPublicNote as string).length).toBeGreaterThan(0);
  });
});
