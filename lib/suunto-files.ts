// Pure helpers for Suunto export uploads (zip or folder — both normalize to
// a Map<relativePath, bytes> before parsing). No fs/DB imports so this stays
// unit-testable (see suunto-files.test.ts).

/**
 * Normalizes export entry paths: backslashes become slashes, leading "./"
 * and "/" are dropped, and a single shared root folder (e.g. the
 * `wictorsvensson/` wrapper Suunto puts around exports) is stripped when no
 * entry already starts at the expected top level (workouts/, sleep/, user/).
 */
export function normalizeExportPaths(paths: string[]): string[] {
  const cleaned = paths
    .map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, ""))
    .filter((p) => p.length > 0 && !p.endsWith("/"));
  if (
    cleaned.length > 0 &&
    !cleaned.some(
      (p) =>
        p.startsWith("workouts/") || p.startsWith("sleep/") || p.startsWith("user/"),
    )
  ) {
    const firstSegments = cleaned.map((p) => p.split("/")[0]);
    if (
      cleaned.every((p) => p.includes("/")) &&
      firstSegments.every((s) => s === firstSegments[0])
    ) {
      const prefix = `${firstSegments[0]}/`;
      return cleaned.map((p) => p.slice(prefix.length)).filter((p) => p.length > 0);
    }
  }
  return cleaned;
}

/**
 * Maps Suunto sleep `quality` (0..1) to a DailyCheckin SleepQuality value.
 * Mirrors scripts/import-suunto/import.ts — keep the thresholds in sync.
 */
export function qualityToSleepQuality(q: number | null | undefined): string | null {
  if (q == null || Number.isNaN(q)) return null;
  if (q >= 0.9) return "EXCELLENT";
  if (q >= 0.7) return "GOOD";
  if (q >= 0.5) return "OKAY";
  return "POOR";
}
