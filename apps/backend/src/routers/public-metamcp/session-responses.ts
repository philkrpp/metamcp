// Response bodies for the public streamable-http session routes.
// Session ids are bearer-equivalent (any caller that knows one can drive
// that session), so these bodies carry counts only, never ids.

export function buildSessionHealthPayload(
  streamableCount: number,
  pool: { idle: number; active: number },
  now: Date = new Date(),
) {
  return {
    timestamp: now.toISOString(),
    streamableHttpSessions: { count: streamableCount },
    metaMcpPoolStatus: { idle: pool.idle, active: pool.active },
    totalActiveSessions: streamableCount + pool.active,
  };
}

export function buildSessionNotFoundBody(now: Date = new Date()) {
  return {
    error: "Session not found" as const,
    timestamp: now.toISOString(),
  };
}
