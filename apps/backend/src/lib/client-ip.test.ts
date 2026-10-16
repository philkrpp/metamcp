/**
 * CLIENT_IP_SOURCE: which part of a request names its caller.
 *
 * Pinned here: the default is `socket` (the one source a client cannot forge),
 * an unknown value throws instead of silently degrading, `trust proxy` is set
 * ONLY for `xff`, and for every non-`cf` source a client-sent CF-Connecting-IP
 * is discarded and replaced — otherwise every header-only reader
 * (`resolveClientIp(req.headers)`, used by the rate limiters) would key on a
 * caller-controlled string whenever no Cloudflare edge overwrites it.
 */

import { describe, expect, it, vi } from "vitest";

import { AUDIT_IP_MAX } from "@/lib/audit/audit-emitter";

import {
  applyClientIpTrustProxy,
  CLIENT_IP_HEADER,
  type ClientIpRequest,
  getClientIpSource,
  normalizeClientIpHeader,
  resolveClientIp,
  resolveRequestClientIp,
} from "./client-ip";

function makeReq(overrides: Partial<ClientIpRequest> = {}): ClientIpRequest {
  return {
    headers: { [CLIENT_IP_HEADER]: "198.51.100.9" },
    ip: "203.0.113.20",
    socket: { remoteAddress: "10.0.0.5" },
    ...overrides,
  };
}

describe("getClientIpSource", () => {
  it("defaults to socket when unset or blank", () => {
    expect(getClientIpSource({})).toBe("socket");
    expect(getClientIpSource({ CLIENT_IP_SOURCE: "  " })).toBe("socket");
  });

  it("accepts xff, cf and socket, case- and whitespace-insensitively", () => {
    expect(getClientIpSource({ CLIENT_IP_SOURCE: "xff" })).toBe("xff");
    expect(getClientIpSource({ CLIENT_IP_SOURCE: " CF " })).toBe("cf");
    expect(getClientIpSource({ CLIENT_IP_SOURCE: "Socket" })).toBe("socket");
  });

  it("throws on an unknown value instead of silently picking a source", () => {
    expect(() => getClientIpSource({ CLIENT_IP_SOURCE: "cloudflare" })).toThrow(
      /Invalid CLIENT_IP_SOURCE/,
    );
  });
});

describe("resolveRequestClientIp", () => {
  it("cf reads CF-Connecting-IP only", () => {
    expect(resolveRequestClientIp(makeReq(), "cf")).toBe("198.51.100.9");
    expect(resolveRequestClientIp(makeReq({ headers: {} }), "cf")).toBe(
      undefined,
    );
  });

  it("xff reads req.ip (express's trust-proxy-aware address)", () => {
    expect(resolveRequestClientIp(makeReq(), "xff")).toBe("203.0.113.20");
    expect(resolveRequestClientIp(makeReq({ ip: undefined }), "xff")).toBe(
      undefined,
    );
  });

  it("socket reads the TCP peer and ignores every header", () => {
    expect(
      resolveRequestClientIp(
        makeReq({
          headers: {
            [CLIENT_IP_HEADER]: "198.51.100.9",
            "x-forwarded-for": "1.2.3.4",
          },
        }),
        "socket",
      ),
    ).toBe("10.0.0.5");
    expect(
      resolveRequestClientIp(makeReq({ socket: undefined }), "socket"),
    ).toBe(undefined);
  });

  it("clamps an oversized value to AUDIT_IP_MAX", () => {
    const long = "9".repeat(AUDIT_IP_MAX + 50);
    expect(resolveRequestClientIp(makeReq({ ip: long }), "xff")).toHaveLength(
      AUDIT_IP_MAX,
    );
  });

  it("uses CLIENT_IP_SOURCE from the environment when no source is passed", () => {
    vi.stubEnv("CLIENT_IP_SOURCE", "socket");
    try {
      expect(resolveRequestClientIp(makeReq())).toBe("10.0.0.5");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("normalizeClientIpHeader", () => {
  it("cf leaves the header untouched", () => {
    const req = makeReq();
    expect(normalizeClientIpHeader(req, "cf")).toBe("198.51.100.9");
    expect(req.headers[CLIENT_IP_HEADER]).toBe("198.51.100.9");
  });

  it("socket replaces a client-forged CF-Connecting-IP with the peer address", () => {
    const req = makeReq();
    expect(normalizeClientIpHeader(req, "socket")).toBe("10.0.0.5");
    expect(resolveClientIp(req.headers)).toBe("10.0.0.5");
  });

  it("xff replaces the header with req.ip", () => {
    const req = makeReq();
    expect(normalizeClientIpHeader(req, "xff")).toBe("203.0.113.20");
    expect(resolveClientIp(req.headers)).toBe("203.0.113.20");
  });

  it("drops a forged header entirely when the configured source has no value", () => {
    const req = makeReq({ socket: undefined });
    expect(normalizeClientIpHeader(req, "socket")).toBeUndefined();
    expect(req.headers[CLIENT_IP_HEADER]).toBeUndefined();
  });
});

describe("applyClientIpTrustProxy", () => {
  it("sets trust proxy = 1 for xff", () => {
    const set = vi.fn();
    expect(
      applyClientIpTrustProxy({ set } as never, { CLIENT_IP_SOURCE: "xff" }),
    ).toBe("xff");
    expect(set).toHaveBeenCalledWith("trust proxy", 1);
  });

  it("does not touch trust proxy for cf or socket", () => {
    const set = vi.fn();
    expect(
      applyClientIpTrustProxy({ set } as never, { CLIENT_IP_SOURCE: "cf" }),
    ).toBe("cf");
    expect(applyClientIpTrustProxy({ set } as never, {})).toBe("socket");
    expect(set).not.toHaveBeenCalled();
  });

  it("throws at boot on an invalid value", () => {
    expect(() =>
      applyClientIpTrustProxy({ set: vi.fn() } as never, {
        CLIENT_IP_SOURCE: "bogus",
      }),
    ).toThrow(/Invalid CLIENT_IP_SOURCE/);
  });
});
