# MCP troubleshooting

Read for backend-server startup failures or endpoints returning no tools. Inspect current source and the actual installed server dependency graph before changing versions or runtime configuration.

## Startup schema incompatibility

A server can fail during tool registration when its MCP SDK and schema library disagree. Earlier PrimeNG incidents were diagnosed this way; the old instructions' SDK version range was an incident snapshot, not evidence that all newer SDK versions fail.

1. Identify the failing server and registration error in its logs. Inspect that server's package manifest, lockfile and resolved SDK/schema versions; MetaMCP and a child server can use different dependencies.
2. Reproduce in an isolated installation with a tested dependency override. Keep a proven pin in the server's installation/image configuration, not only an ephemeral package-runner command. Verify the server starts and lists tools with that exact graph.
3. Preserve the package's public entry point: wrappers can supply embedded schemas/data to their inner MCP library. Starting only the inner library can omit required data.

Do not copy the former PrimeNG/SDK pins as a universal fix. The former version examples do not establish the currently deployed server installation.

## Connected endpoint, empty tool list

Endpoint connectivity and backend-server connectivity are separate. Check the affected request's logs before choosing a fix:

- Namespace mappings and ACTIVE/error status: `apps/backend/src/lib/metamcp/fetch-metamcp.ts`.
- Tool filtering: `apps/backend/src/lib/metamcp/metamcp-middleware/filter-tools.functional.ts`.
- Backend connection reservations, admission, eviction and cleanup: `apps/backend/src/lib/metamcp/mcp-server-pool.ts`; focused tests beside it cover prewarming, pending status, config, connection deadlines and cleanup.
- Eager idle sessions: `apps/backend/src/lib/startup.ts`. `PREWARM_IDLE_SERVERS` is also checked by the pool when replenishing spares; changing startup alone is insufficient.

`MAX_TOTAL_CONNECTIONS` and `MAX_CONNECTIONS_PER_SERVER` configure separate limits. Inspect current defaults and effective pool configuration rather than inferring saturation from an old `30/30` log. A saturated pool can reflect reservations or retirement as well as established sessions; preserve accounting invariants instead of dismissing an over-limit counter as harmless.

With authorization, tune prewarming/capacity against measured process and memory use. Environment changes require the existing runtime restart/deployment workflow; do not restart or mutate production merely to diagnose an empty result. Verify the affected endpoint actually lists its expected tools after a change.
