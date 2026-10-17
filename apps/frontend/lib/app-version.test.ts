import { describe, expect, it } from "vitest";

import { formatAppVersion, UMBRELLA_BASE_COMMIT } from "./app-version";

describe("formatAppVersion", () => {
  it("labels the umbrella commit this fork is based on", () => {
    expect(formatAppVersion(undefined)).toEqual({
      label: `umbrella@${UMBRELLA_BASE_COMMIT}`,
      title: `Based on umbrella ${UMBRELLA_BASE_COMMIT}`,
    });
  });

  it("adds the short build commit to the tooltip when known", () => {
    expect(
      formatAppVersion("5160940fd2a8c1b9e0e6f1a2b3c4d5e6f7a8b9c0").title,
    ).toBe(`Based on umbrella ${UMBRELLA_BASE_COMMIT} · build 5160940`);
  });

  it("ignores an empty or non-hex build commit", () => {
    expect(formatAppVersion("  ").title).toBe(
      `Based on umbrella ${UMBRELLA_BASE_COMMIT}`,
    );
    expect(formatAppVersion("unknown").title).toBe(
      `Based on umbrella ${UMBRELLA_BASE_COMMIT}`,
    );
  });
});
