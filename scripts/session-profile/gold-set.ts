// Gold-set runner — the §5 development loop, made executable.
//
//   node scripts/session-profile/gold-set.ts [--gold-set <path>] [--user <username>]
//   node scripts/session-profile/gold-set.ts --dump <yyyy-mm-dd> [--source GARMIN] [--user wictor]
//
// For every facit entry it loads the raw inputs (Activity + laps + streams),
// runs `sessionProfile()` BLIND (the profiler never sees the facit), then
// compares the result with Kevin's note via `compareToGoldSet()` (§3) and
// prints the checklist.
//
// Two resolution modes per entry:
//   activityKey: { date, source? }  → real DB row (needs runloop-postgres)
//   fixture: "fixtures/x.json"      → { activity, laps, streams } on disk, no DB
//
// Exit codes: 0 = empty/pass/attention, 1 = fail, 2 = DB needed but unreachable.
//
// Plain Node + native type stripping (like scripts/import-suunto/import.ts):
// no tsx/ts-node, no new dependencies. The one wrinkle is the repo's "@/"
// tsconfig path alias inside lib/prisma.ts, which Node cannot resolve — hence
// the small resolve hook below, registered before any DB-mode import.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
// DB mode needs DATABASE_URL; fixture mode runs fine with no .env at all.
import "dotenv/config";

// These are loaded DYNAMICALLY in main(): profile.ts imports runtime values
// through the "@/" alias, so the resolve hook above must be registered first.
// `import type` is erased by Node's type stripping, so type-only imports stay
// static and harmless.
import type { GoldSetComparison, GoldSetEntry } from "../../lib/session-profile/gold-set.ts";
import type { SessionInputs } from "../../lib/session-profile/input.ts";

type ProfileModule = typeof import("../../lib/session-profile/profile.ts");
type GoldSetModule = typeof import("../../lib/session-profile/gold-set.ts");

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(SCRIPT_DIR, "../..");
const DEFAULT_GOLD_SET = join(SCRIPT_DIR, "gold-set.json");
const FIXTURES_DIR = join(SCRIPT_DIR, "fixtures");
/** Charset allowed for `--source`: it is part of a fixture filename. */
const SAFE_SOURCE = /^[A-Za-z0-9_-]+$/;

/** A missing/ambiguous DB row is a facit or setup problem, not a connection
 *  failure — it must not be reported as "DATABASE UNREACHABLE". */
class GoldSetInputError extends Error {}

// DO NOT REMOVE: this hook is what lets plain `node` run this script.
// tsconfig's "@/*" alias is understood by tsc/vitest/Next, but not by Node.
// The alias is not just in this file — it is TRANSITIVE inside the app modules
// we must reuse: lib/session-profile/profile.ts imports "@/lib/running-types"
// and "@/lib/format", lib/session-profile/input.ts and lib/prisma.ts import
// "@/lib/prisma", "@/lib/activity-detail", "@/generated/prisma/client".
// Without the hook every one of those imports throws ERR_MODULE_NOT_FOUND.
// The alternative would be a ts runner (tsx/ts-node) or duplicating profile.ts
// logic here — both worse: a new dependency / two divergent profilers. Because
// the hook only runs at module registration, the app modules are imported
// dynamically in main() (static imports are hoisted ABOVE this body and would
// be resolved before the hook exists).
// `module.registerHooks` exists at runtime from Node 22.15 but is missing from
// the pinned @types/node@20 — hence the narrow cast. Fixture mode never needs
// the hook; DB mode reports the missing requirement if it is unavailable.
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (
    specifier: string,
    context?: unknown,
  ) => { url: string; shortCircuit?: boolean },
) => { url: string; shortCircuit?: boolean };

const registerHooks = (
  nodeModule as unknown as {
    registerHooks?: (hooks: { resolve: ResolveHook }) => void;
  }
).registerHooks;

/** `module.registerHooks` only exists from Node 22.15. Fixture mode never needs
 *  it, so this is checked in DB mode only — and reported explicitly instead of
 *  leaking through as an ERR_MODULE_NOT_FOUND ("DATABASE UNREACHABLE"). */
const HAS_REGISTER_HOOKS = typeof registerHooks === "function";

const NODE_TOO_OLD_MESSAGE =
  "Node >= 22.15 required for DB mode (`activityKey` / `--dump`); " +
  "fixture mode works on any Node. Current: " + process.version;

registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = join(REPO_ROOT, specifier.slice(2));
      const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate) && statSync(candidate).isFile())
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

/** CLI-facing entry shape: the facit plus how to find the raw data. */
interface CliEntry extends GoldSetEntry {
  activityKey?: { date: string; source?: string };
  fixture?: string;
}

async function main(): Promise<number> {
  const profileModule: ProfileModule = await import(
    "../../lib/session-profile/profile.ts"
  );
  const goldSetModule: GoldSetModule = await import(
    "../../lib/session-profile/gold-set.ts"
  );

  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };

  const user = (flag("--user") ?? "wictor").toLowerCase();
  const dumpDate = flag("--dump");
  const source = flag("--source")?.toUpperCase();

  // `--source` ends up in a fixture filename, so keep it to a safe charset.
  if (source !== undefined && !SAFE_SOURCE.test(source)) {
    console.error(
      `--source "${flag("--source")}" is not a valid provider name (allowed: letters, digits, "_" and "-").`,
    );
    return 2;
  }

  if (dumpDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dumpDate)) {
      console.error(`--dump needs a yyyy-mm-dd date, got "${dumpDate}"`);
      return 2;
    }
    if (!HAS_REGISTER_HOOKS) {
      console.error(NODE_TOO_OLD_MESSAGE);
      return 2;
    }
    return dumpFixture(user, dumpDate, source);
  }

  const goldSetPath = resolvePath(flag("--gold-set") ?? DEFAULT_GOLD_SET);
  if (!existsSync(goldSetPath)) {
    console.error(`gold set not found: ${goldSetPath}`);
    return 2;
  }

  const entries = JSON.parse(readFileSync(goldSetPath, "utf8")) as CliEntry[];
  if (!Array.isArray(entries)) {
    console.error(`${goldSetPath} must contain a JSON array of entries`);
    return 2;
  }
  if (entries.length === 0) {
    console.log(`Gold set is empty (${goldSetPath}).`);
    console.log(
      "No entries yet — nothing to compare. Add Kevin's facit entries (see scripts/session-profile/README.md).",
    );
    return 0;
  }

  const comparisons: GoldSetComparison[] = [];
  let dbFailure: string | null = null;

  // Validate the whole file before touching the DB: a typo'd facit must fail
  // with a named error and a deterministic exit code, not a mid-run crash.
  for (const entry of entries) {
    try {
      goldSetModule.assertValidGoldSetEntry(entry);
    } catch (error) {
      console.error(`${goldSetPath}: ${error instanceof Error ? error.message : String(error)}`);
      return 2;
    }
  }

  // DB mode also needs `module.registerHooks` (see NODE_TOO_OLD_MESSAGE).
  if (!HAS_REGISTER_HOOKS && entries.some((entry) => entry.activityKey !== undefined)) {
    console.error(NODE_TOO_OLD_MESSAGE);
    return 2;
  }

  for (const entry of entries) {
    let inputs: SessionInputs | null = null;
    try {
      inputs = await resolveInputs(entry, user, source);
    } catch (error) {
      // A missing user / activity / ambiguous day is a facit or setup problem:
      // report it as such and keep "DATABASE UNREACHABLE" for real failures.
      if (error instanceof GoldSetInputError) {
        console.error("");
        console.error(`Cannot resolve ${entry.id}: ${error.message}`);
        return 2;
      }
      dbFailure = error instanceof Error ? error.message : String(error);
      break;
    }
    if (inputs === null) {
      console.log(`SKIP ${entry.id} — neither activityKey nor fixture given`);
      continue;
    }
    // Blind run: the profiler receives raw inputs only, never the facit.
    const profile = profileModule.sessionProfile(
      inputs.activity,
      inputs.laps,
      inputs.streams,
    );
    const comparison = goldSetModule.compareToGoldSet(profile, entry);
    comparisons.push(comparison);
    printEntry(goldSetModule, comparison, profile.classification, profile.confidence);
  }

  if (dbFailure !== null) {
    console.error("");
    console.error("DATABASE UNREACHABLE — this gold set needs DB rows.");
    console.error(`  ${dbFailure}`);
    console.error(
      "Start Postgres (`npm run db:up`), or use fixture entries to run the harness offline.",
    );
    return 2;
  }

  // Entries that resolved to no raw inputs print SKIP and are not compared. If
  // that was ALL of them the run verified nothing: reporting PASS here would be
  // a silent pass for a gold set that never executed.
  if (comparisons.length === 0) {
    console.error("");
    console.error(
      `Nothing was compared: all ${entries.length} entr${entries.length === 1 ? "y" : "ies"} were skipped.`,
    );
    console.error("Each entry needs an \"activityKey\" or a \"fixture\".");
    return 2;
  }

  const summary = goldSetModule.summarizeGoldSet(comparisons);
  console.log("");
  console.log(
    `Summary: ${summary.total} entr${summary.total === 1 ? "y" : "ies"} — ` +
      `${summary.counts.yes} yes, ${summary.counts.partial} partial, ` +
      `${summary.counts.no} no, ${summary.counts.skipped} skipped → ` +
      `${summary.overall.toUpperCase()}`,
  );
  if (summary.actionable.length > 0) {
    console.log("Actionable (at least one 'no'):");
    for (const entry of summary.actionable)
      console.log(`  - ${entry.id} (${entry.date})`);
  } else {
    console.log("Actionable (at least one 'no'): none");
  }

  return summary.overall === "fail" ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Input resolution
// ---------------------------------------------------------------------------

async function resolveInputs(
  entry: CliEntry,
  user: string,
  sourceOverride: string | undefined,
): Promise<SessionInputs | null> {
  if (entry.fixture !== undefined) {
    const path = resolvePath(SCRIPT_DIR, entry.fixture);
    if (!existsSync(path))
      throw new Error(`fixture not found for ${entry.id}: ${path}`);
    const raw = JSON.parse(readFileSync(path, "utf8")) as SessionInputs;
    return { activity: raw.activity, laps: raw.laps ?? [], streams: raw.streams ?? null };
  }

  if (entry.activityKey !== undefined) {
    const { prisma } = await import("../../lib/prisma.ts");
    const { loadSessionInputs } = await import("../../lib/session-profile/input.ts");
    const dbUser = await prisma.user.findUnique({
      where: { username: user },
      select: { id: true },
    });
    if (dbUser === null) throw new GoldSetInputError(`no user with username "${user}"`);

    const activityId = await findActivityId(
      prisma,
      dbUser.id,
      entry.activityKey.date,
      (entry.activityKey.source ?? sourceOverride ?? "GARMIN").toUpperCase(),
    );
    if (activityId === null)
      throw new GoldSetInputError(
        `no activity for user "${user}" on ${entry.activityKey.date} ` +
          `(source ${entry.activityKey.source ?? sourceOverride ?? "GARMIN"})`,
      );
    return loadSessionInputs(dbUser.id, activityId);
  }

  return null;
}

type DbClient = Awaited<ReturnType<typeof loadPrismaClient>>;

async function loadPrismaClient() {
  const mod = await import("../../lib/prisma.ts");
  return mod.prisma;
}

/** Resolves a yyyy-mm-dd + source pair to exactly one activity id (UTC day).
 *  Throws when the day is ambiguous so a wrong pairing can never slip into
 *  the gold set unnoticed. */
async function findActivityId(
  prisma: DbClient,
  userId: string,
  date: string,
  source: string,
): Promise<string | null> {
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new GoldSetInputError(`invalid date "${date}"`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const rows = await prisma.activity.findMany({
    where: { userId, source, startDate: { gte: start, lt: end } },
    select: { id: true, name: true, type: true, startDate: true },
    orderBy: { startDate: "asc" },
  });

  if (rows.length === 0) return null;
  if (rows.length > 1) {
    const list = rows
      .map((row) => `${row.startDate.toISOString()} ${row.type ?? "?"} "${row.name ?? ""}"`)
      .join("; ");
    throw new GoldSetInputError(
      `${rows.length} activities on ${date} (${source}) — ambiguous, refine the facit: ${list}`,
    );
  }
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// --dump: write a fixture so the harness can run offline / in CI
// ---------------------------------------------------------------------------

async function dumpFixture(
  user: string,
  date: string,
  sourceOverride: string | undefined,
): Promise<number> {
  const source = sourceOverride ?? "GARMIN";
  let prisma: DbClient;
  let activityId: string | null;
  let userId: string;
  try {
    prisma = await loadPrismaClient();
    const dbUser = await prisma.user.findUnique({
      where: { username: user },
      select: { id: true },
    });
    if (dbUser === null) {
      console.error(`No user with username "${user}".`);
      return 2;
    }
    userId = dbUser.id;
    activityId = await findActivityId(prisma, userId, date, source);
  } catch (error) {
    // A missing/ambiguous row is not a connection problem — say so plainly.
    if (error instanceof GoldSetInputError) {
      console.error(error.message);
      return 2;
    }
    console.error("DATABASE UNREACHABLE — --dump needs a live database.");
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    console.error("Start Postgres with `npm run db:up` (and check DATABASE_URL).");
    return 2;
  }

  if (activityId === null) {
    console.error(`No ${source} activity for "${user}" on ${date}.`);
    return 2;
  }

  const { loadSessionInputs } = await import("../../lib/session-profile/input.ts");
  const inputs = await loadSessionInputs(userId, activityId);
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const outPath = resolvePath(join(FIXTURES_DIR, `${date}-${source.toLowerCase()}.json`));
  // Defence in depth: whatever reached us, never write outside the fixtures dir.
  if (!outPath.startsWith(`${resolvePath(FIXTURES_DIR)}${sep}`)) {
    console.error(`Refusing to write outside ${FIXTURES_DIR}: ${outPath}`);
    return 2;
  }
  writeFileSync(outPath, `${JSON.stringify(inputs, null, 2)}\n`);
  console.log(`Wrote fixture: ${outPath}`);
  console.log(
    `Reference it from a gold-set entry as: "fixture": "fixtures/${date}-${source.toLowerCase()}.json"`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const VERDICT_LABEL: Record<string, string> = {
  yes: "JA",
  partial: "DELVIS",
  no: "NEJ",
  skipped: "—",
};

function printEntry(
  goldSetModule: GoldSetModule,
  comparison: GoldSetComparison,
  classification: string,
  confidence: string,
): void {
  const { entry } = comparison;
  console.log("");
  console.log(
    `${entry.id}  (${entry.date}${entry.source ? `, ${entry.source}` : ""})  ` +
      `→ profile: ${classification} / ${confidence}`,
  );
  console.log(`  ${"CHECK".padEnd(24)}${"VERDICT".padEnd(10)}NOTE`);
  for (const check of goldSetModule.GOLD_SET_CHECKS) {
    const verdict = comparison[check];
    console.log(
      `  ${goldSetModule.GOLD_SET_CHECK_LABELS[check].padEnd(24)}` +
        `${VERDICT_LABEL[verdict].padEnd(10)}${comparison.notes[check]}`,
    );
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  });
