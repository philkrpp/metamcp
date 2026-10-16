import express from "express";

import { AUDIT_IP_MAX, clampAuditText } from "@/lib/audit/audit-emitter";

/**
 * Naming the caller of a request, for everything that needs to.
 *
 * WHY THIS SITS IN `lib/` RATHER THAN BESIDE THE MIDDLEWARE THAT INTRODUCED IT.
 * It was defined in `middleware/audit-context.middleware`, which is still where
 * the trust assumption and the `trust proxy` decision are written down at
 * length — read that first. It moved here because it stopped being an audit
 * concern: the rate limiters key on it too, and `lib/auth-rate-limiter` is a
 * `lib/` module. `middleware/` imports `lib/` throughout this codebase and
 * `lib/` imports `middleware/` nowhere, so importing upward would have made
 * those two directories mutually dependent — the shape that turns into a real
 * import cycle the first time anything else is added. `audit-context.middleware`
 * re-exports both names, so existing importers are unaffected.
 */

/** Cloudflare's single-value, edge-overwritten client IP header. */
export const CLIENT_IP_HEADER = "cf-connecting-ip";

/**
 * Pull the caller IP out of a header bag.
 *
 * Exported for tests. Returns undefined rather than a placeholder when the
 * header is absent (direct-to-origin calls, local development): a NULL
 * `actor_ip` is an honest "not known", while a fabricated one would be read
 * as evidence. Callers that need a key rather than a record — the rate
 * limiters — supply their own fallback instead.
 *
 * CLAMPED HERE, at the stamping site, rather than at each emitter. Every audit
 * row's `actor_ip` and every `x-audit-client-ip` the `/api/auth` relay stamps
 * are read from `auditClientIp`, so bounding it once here bounds all of them,
 * and a future emitter cannot forget to. See AUDIT_IP_MAX in
 * `lib/audit/audit-emitter` for why 64 loses no evidence.
 *
 * WHAT THE CLAMP DOES AND DOES NOT BUY THE LIMITERS THAT KEY ON THIS. It
 * bounds per-key SIZE, not key COUNT. A caller rotating the header still mints
 * one map entry per distinct value -- measured at 200k entries for 200k values.
 * Each limiter reclaims its own entries on a ten-minute sweep: the auth
 * limiters through the timer in `lib/auth-rate-limiter` (which iterates
 * AuthRateLimiter instances ONLY, so it does not touch any other map), and the
 * data-plane sliding-window map through `SlidingWindowRateLimiting.cleanup`,
 * wired to its own timer in `middleware/rate-limit.middleware`. What bounds the
 * count is the edge overwriting the header, plus the relevant sweep; it is not
 * this line.
 */
export function resolveClientIp(
  headers: express.Request["headers"],
): string | undefined {
  const raw = headers[CLIENT_IP_HEADER];
  // Express lower-cases header names but an array is still possible if a
  // caller sends the header twice. Take the first value; a duplicated
  // CF-Connecting-IP is not something Cloudflare produces, so anything here
  // is malformed input and picking deterministically beats throwing.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : clampAuditText(trimmed, AUDIT_IP_MAX);
}

/**
 * WHERE THE CALLER IP COMES FROM, per deployment: env `CLIENT_IP_SOURCE`.
 *
 * - `cf`     — `CF-Connecting-IP` (the umbrella fork's original behaviour).
 *              Only trustworthy while a Cloudflare edge/tunnel is the SOLE
 *              ingress; see `middleware/audit-context.middleware`.
 * - `xff`    — Express `req.ip` with `app.set("trust proxy", 1)`, i.e. the
 *              last `X-Forwarded-For` hop appended by exactly ONE trusted
 *              reverse proxy in front of the backend (nginx, Traefik, ingress).
 * - `socket` — the TCP peer address. DEFAULT: the only source a client cannot
 *              forge, correct when the backend is reached directly.
 *
 * Every existing `resolveClientIp(req.headers)` call site keeps working for
 * every source because `normalizeClientIpHeader` (run by the FIRST middleware,
 * `auditContextMiddleware`) rewrites `CF-Connecting-IP` to the resolved value
 * for the non-`cf` sources — which also means a client-sent `CF-Connecting-IP`
 * can never be trusted when no Cloudflare edge overwrites it.
 *
 * An unknown value THROWS: a typo silently degrading to another source would
 * either collapse every caller into one rate-limit bucket or make the key
 * caller-forgeable. `applyClientIpTrustProxy` runs at boot, so a bad value
 * stops the process there instead of surfacing per request.
 */
export const CLIENT_IP_SOURCES = ["xff", "cf", "socket"] as const;
export type ClientIpSource = (typeof CLIENT_IP_SOURCES)[number];
export const DEFAULT_CLIENT_IP_SOURCE: ClientIpSource = "socket";

export function getClientIpSource(
  env: NodeJS.ProcessEnv = process.env,
): ClientIpSource {
  const raw = env.CLIENT_IP_SOURCE?.trim().toLowerCase();
  if (!raw) return DEFAULT_CLIENT_IP_SOURCE;
  if ((CLIENT_IP_SOURCES as readonly string[]).includes(raw)) {
    return raw as ClientIpSource;
  }
  throw new Error(
    `Invalid CLIENT_IP_SOURCE=${JSON.stringify(env.CLIENT_IP_SOURCE)}; expected one of ${CLIENT_IP_SOURCES.join(", ")}`,
  );
}

/** The request fields the resolver reads; a structural subset of express.Request. */
export type ClientIpRequest = {
  headers: express.Request["headers"];
  ip?: string;
  socket?: { remoteAddress?: string };
};

function clampIp(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : clampAuditText(trimmed, AUDIT_IP_MAX);
}

/** Resolve the caller IP of a request from the configured source. */
export function resolveRequestClientIp(
  req: ClientIpRequest,
  source: ClientIpSource = getClientIpSource(),
): string | undefined {
  switch (source) {
    case "cf":
      return resolveClientIp(req.headers);
    case "xff":
      // `req.ip` honours `trust proxy` (set by applyClientIpTrustProxy).
      return clampIp(req.ip);
    case "socket":
      return clampIp(req.socket?.remoteAddress);
  }
}

/**
 * Make `CF-Connecting-IP` carry the configured source's value, so header-only
 * readers (`resolveClientIp(req.headers)`) agree with it. For `cf` the header
 * is left untouched. For `xff` / `socket` any client-sent value is DROPPED
 * first (it is caller-controlled there) and replaced by the resolved address.
 * Returns the resolved caller IP.
 */
export function normalizeClientIpHeader(
  req: ClientIpRequest,
  source: ClientIpSource = getClientIpSource(),
): string | undefined {
  if (source === "cf") return resolveClientIp(req.headers);
  delete req.headers[CLIENT_IP_HEADER];
  const ip = resolveRequestClientIp(req, source);
  if (ip !== undefined) req.headers[CLIENT_IP_HEADER] = ip;
  return ip;
}

/**
 * Boot-time wiring: `trust proxy = 1` only for `xff` (exactly one trusted hop),
 * so `req.ip` stays the socket address for the other sources. Also validates
 * CLIENT_IP_SOURCE at startup. Returns the effective source.
 */
export function applyClientIpTrustProxy(
  app: Pick<express.Application, "set">,
  env: NodeJS.ProcessEnv = process.env,
): ClientIpSource {
  const source = getClientIpSource(env);
  if (source === "xff") app.set("trust proxy", 1);
  return source;
}
