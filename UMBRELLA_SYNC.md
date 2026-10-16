# Pulling upstream changes from Umbrella

`main` of this fork is `Umbrella-IT-Group/metamcp@umbrella` plus a small set of fork-only changes
(see README § philkrpp fork notes). New upstream commits are pulled with a normal merge, never a
rebase or cherry-pick, so git keeps tracking what is already in.

## One-time setup

```bash
git remote add community https://github.com/Umbrella-IT-Group/metamcp
git config rerere.enabled true   # replays earlier conflict resolutions
```

## Each sync

```bash
git fetch community
git switch -c sync/umbrella-$(date +%Y%m%d) main
git merge community/umbrella
```

Resolve conflicts with these rules:

| Area | Rule |
|---|---|
| `package.json` versions, `pnpm-lock.yaml` | Keep ours (newer toolchain: Next 16, TS 6, Node 24, pnpm 10); add deps umbrella introduced; then `pnpm install` to regenerate the lockfile. |
| `apps/frontend/middleware.ts` | Next 16 uses `apps/frontend/proxy.ts`. Port umbrella's middleware changes into `proxy.ts`, delete `middleware.ts`. |
| `apps/backend/drizzle/**` | Take umbrella's files and journal entries unchanged. Our own migrations live at higher indices; if umbrella adds a migration with the same index as one of ours, renumber **ours** (new file, new journal entry, `when` greater than every umbrella entry), never theirs. |
| Fork-only features | Keep ours: `forward_headers`, `lib/oauth-upstream/**`, `expected_state`, `lib/admin-mcp/**`, pt/es locales, `deploy/**`, `CLIENT_IP_SOURCE`. |
| `// TEMP(api-key-legacy-scope)` | Keep until the legacy multi-endpoint keys are replaced, then delete the shim and drop `api_key_endpoint_access`. |
| `prettier` | Pinned to the exact version umbrella's lockfile resolves (now 3.5.3). Newer prettier reformats union types, and reformatting umbrella's files would conflict on every sync. Bump it only together with umbrella. |
| Everything else | Prefer umbrella's version. |

Then:

```bash
pnpm install
pnpm --filter @repo/zod-types build && pnpm --filter @repo/trpc build
pnpm lint && pnpm check-types && pnpm --filter backend test && pnpm --filter frontend test
pnpm build
```

Drizzle applies a migration only when its journal `when` is newer than the last applied one. Before
deploying, check that every new umbrella migration has a `when` above the newest entry already applied
in production; if not, add its statements idempotently to a new fork migration.
