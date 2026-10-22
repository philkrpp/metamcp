# MetaMCP

MCP gateway with endpoint/namespace sessions and a shared backend-server pool. Use the checked-in package manifests and lockfile for dependency versions and commands.

- A connected endpoint does not prove its backend servers are healthy or have tools. Diagnose namespace mappings, server/error status, tool filters, and physical pool capacity separately.
- Pool capacity, pending connections, cleanup, and namespace fairness interact. Before changing them, read `apps/backend/src/lib/metamcp/mcp-server-pool.ts` and the focused pool tests; preserve connection accounting and bounded cleanup.
- Before troubleshooting startup schema errors or an empty tool list, read [MCP troubleshooting](docs/agent-guidance/mcp-troubleshooting.md). Historical dependency workarounds are not a current compatibility matrix.
- Root checks are `pnpm test`, `pnpm lint`, `pnpm check-types`, and `pnpm build`; scope them to the changed workspace where appropriate. Changing runtime pool settings, restarting containers, or installing server packages needs the applicable authorization.
