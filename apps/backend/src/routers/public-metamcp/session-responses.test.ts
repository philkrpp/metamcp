import { describe, expect, it } from "vitest";

import {
  buildSessionHealthPayload,
  buildSessionNotFoundBody,
} from "./session-responses";

const NOW = new Date("2026-10-16T12:00:00.000Z");

describe("buildSessionHealthPayload", () => {
  it("reports counts only, never session ids", () => {
    const result = buildSessionHealthPayload(2, { idle: 1, active: 3 }, NOW);

    expect(result).toEqual({
      timestamp: NOW.toISOString(),
      streamableHttpSessions: { count: 2 },
      metaMcpPoolStatus: { idle: 1, active: 3 },
      totalActiveSessions: 5,
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain("sessionIds");
    expect(json).not.toContain("activeSessionIds");
    expect(json).not.toContain("idleNamespaceUuids");
  });

  it("drops extra identifiers carried on the pool status", () => {
    const pool = {
      idle: 0,
      active: 1,
      activeSessionIds: ["secret-session-abc"],
      idleNamespaceUuids: ["ns-uuid-xyz"],
    };

    const json = JSON.stringify(buildSessionHealthPayload(0, pool, NOW));

    expect(json).not.toContain("secret-session-abc");
    expect(json).not.toContain("ns-uuid-xyz");
  });
});

describe("buildSessionNotFoundBody", () => {
  it("carries only the error and a timestamp", () => {
    const body = buildSessionNotFoundBody(NOW);

    expect(Object.keys(body).sort()).toEqual(["error", "timestamp"]);
    expect(body.error).toBe("Session not found");
    expect(body.timestamp).toBe(NOW.toISOString());
  });
});
