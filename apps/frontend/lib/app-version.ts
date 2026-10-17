/**
 * Version shown in the sidebar footer (fork). This fork tracks the umbrella
 * fork by merge, so the meaningful version is the umbrella commit it is based
 * on. Bump UMBRELLA_BASE_COMMIT on every umbrella sync (see UMBRELLA_SYNC.md).
 * The fork's own build commit comes from NEXT_PUBLIC_APP_COMMIT, set from the
 * Docker build arg SOURCE_COMMIT, and is shown in the tooltip when present.
 */
export const UMBRELLA_BASE_COMMIT = "dad390f";

export function formatAppVersion(buildCommit: string | null | undefined): {
  label: string;
  title: string;
} {
  const base = `Based on umbrella ${UMBRELLA_BASE_COMMIT}`;
  const commit = (buildCommit ?? "").trim();
  return {
    label: `umbrella@${UMBRELLA_BASE_COMMIT}`,
    title: /^[0-9a-f]{7,40}$/i.test(commit)
      ? `${base} · build ${commit.slice(0, 7)}`
      : base,
  };
}
