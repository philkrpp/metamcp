import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pool without background idle sessions: the PREWARM_IDLE_SERVERS=false setup.
vi.mock("./metamcp/mcp-server-pool", () => ({
  mcpServerPool: { getBackgroundIdleSessionsByNamespace: () => new Map() },
}));

import { RateLimitError, RateLimiting } from "./rate-limit";

function contextFor(endpoint: Record<string, unknown>) {
  return { req: { endpoint: { user_id: "u1", ...endpoint } } };
}

const NS1 = { namespace_uuid: "ns1", max_rate: 2, max_rate_seconds: 60 };

describe("RateLimiting (token bucket)", () => {
  let limiting: RateLimiting;
  const next = vi.fn(async () => "ok");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
    limiting = new RateLimiting();
    next.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows max_rate requests, then rejects", async () => {
    await expect(limiting.onRequest(contextFor(NS1), next)).resolves.toBe("ok");
    await expect(limiting.onRequest(contextFor(NS1), next)).resolves.toBe("ok");
    await expect(
      limiting.onRequest(contextFor(NS1), next),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("refills max_rate tokens per max_rate_seconds", async () => {
    await limiting.onRequest(contextFor(NS1), next);
    await limiting.onRequest(contextFor(NS1), next);

    vi.advanceTimersByTime(30_000);

    await expect(limiting.onRequest(contextFor(NS1), next)).resolves.toBe("ok");
    await expect(
      limiting.onRequest(contextFor(NS1), next),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("starts a fresh bucket after cleanup instead of rejecting forever", async () => {
    await limiting.onRequest(contextFor(NS1), next);
    await limiting.onRequest(contextFor(NS1), next);
    vi.advanceTimersByTime(1_000);

    limiting.cleanup(0);

    await expect(limiting.onRequest(contextFor(NS1), next)).resolves.toBe("ok");
  });

  it("does not limit when max_rate is not configured", async () => {
    const unlimited = {
      namespace_uuid: "ns1",
      max_rate: null,
      max_rate_seconds: 60,
    };
    for (let i = 0; i < 10; i++) {
      await expect(
        limiting.onRequest(contextFor(unlimited), next),
      ).resolves.toBe("ok");
    }
  });

  it("keeps separate buckets per namespace", async () => {
    const ns2 = { ...NS1, namespace_uuid: "ns2" };
    await limiting.onRequest(contextFor(NS1), next);
    await limiting.onRequest(contextFor(NS1), next);

    await expect(limiting.onRequest(contextFor(ns2), next)).resolves.toBe("ok");
  });
});
