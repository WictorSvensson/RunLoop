# SessionProfile gold set (Kevins facit)

The development/validation harness from
`Docs/SESSIONPROFILE_FORTYDLIGANDE.md` §3 (the facit checklist) and §5 (the
loop): *build a simple SessionProfile → run it against the gold set → find
misclassifications → fix a feature/rule → run the whole set again → watch for
regressions.* This is **not** a product feature: no user will ever label a
session. It is a private test set that tells us whether `sessionProfile()`
actually understands a remembered session.

## The one rule: the algorithm never sees the facit

`sessionProfile(activity, laps, streams)` receives **raw Garmin/Suunto data
only**. The facit is a separate document that is read *after* the profile is
computed, and only by the compare step (`compareToGoldSet()` in
`lib/session-profile/gold-set.ts`). It must never be passed into the profiler,
and nothing in `lib/session-profile/profile.ts` may import gold-set code.

That is why the comparison module is pure and takes two arguments — the
finished `SessionProfile` and the `GoldSetEntry`. Correct uncertainty is a good
result here: a genuinely hard-to-read session that comes back `unknown` /
`low`/`insufficient` confidence earns `JA` on the individual checks (§3:
"korrekt osäkerhet är bättre än självsäkert bullshit") — but if no facit
dimension was actually verified, the run as a whole reports `ATTENTION`, not
`PASS`.

## Running it

```bash
npm run db:up                                # only needed for activityKey / --dump
npm run profile:gold-set                     # the real gold set (gold-set.json)
npm run profile:gold-set -- --gold-set scripts/session-profile/gold-set.example.json
npm run profile:gold-set -- --user wictor    # choose the DB user (default: wictor)
```

Exit codes: `0` = empty gold set, `pass` or `attention` · `1` = `fail` ·
`2` = setup/facit problem: database unreachable, unknown user, no activity on
that date, ambiguous day, malformed or missing gold-set file, a facit entry that
fails validation (bad or missing `date`, missing `expected`, invalid
`expected.category`), an entry with neither `activityKey` nor `fixture` — or a
run in which every entry was skipped — Node too old for DB mode, or an invalid
`--source`.

Requires Node ≥ 22.15 (native type stripping + `module.registerHooks`; also
declared as `engines.node` in `package.json`); no tsx / ts-node. DB mode exits
`2` with an explicit "Node >= 22.15 required" message on older Node — fixture
mode works on any Node. Node prints a harmless `MODULE_TYPELESS_PACKAGE_JSON`
warning because the repo does not set `"type": "module"` — ignore it.

## Facit format (`GoldSetEntry`)

`scripts/session-profile/gold-set.json` is a JSON array of entries. Kevin's
note is the source of truth; `expected` holds only the machine-readable subset
the compare step uses.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable, unique. Convention: `yyyy-mm-dd-short-label` (e.g. `2025-02-12-threshold`). |
| `date` | `yyyy-mm-dd` | Session date. Must match the activity's **UTC** start date. |
| `source` | `"GARMIN" \| "SUUNTO"` (optional) | Only used to disambiguate an `activityKey` lookup. |
| `actual` | string | "Faktiskt pass" — what physically happened, in Kevin's words ("6 × 5 min threshold, ~60 s recovery"). |
| `intent` | string | "Avsikt" — what the session was meant to be. |
| `assessment` | string | "Bedömning" — how it was executed / how it felt ("genomfört enligt plan, jämnt"). |
| `rpe` | number (optional) | Rough RPE, e.g. `6`. |
| `context` | string (optional) | Treadmill, heat, race week, etc. |
| `expected.category` | `SessionClass` | **Required.** Broad class: `easy-recovery`, `long`, `threshold-tempo`, `interval`, `race-benchmark`, `mixed`, `unknown`. |
| `expected.workSegments` | number (optional) | Number of work reps the facit names. **Omit it if Kevin does not remember** — omitting yields `skipped`, it is never a silent pass. |
| `expected.workRecoveryShape` | string (optional) | Free text, e.g. `"6 × 5 min work, ~60 s recovery"` or `"continuous steady running"`. |
| `expected.intensity` | string (optional) | Free text: `"easy"`, `"threshold"`, `"VO2"`, `"tröskel"`. Both Swedish and English keywords are understood. |
| `expected.execution` | string (optional) | Free text: `"even, as planned"`, `"faded in the last reps"`, `"avbrutet"`. |

Two extra CLI-only fields say **where the raw data comes from** (at most one):

```jsonc
// DB mode — real row, needs Postgres + the dev user
{ "id": "2025-02-12-threshold", "date": "2025-02-12",
  "activityKey": { "date": "2025-02-12", "source": "GARMIN" },
  "actual": "...", "intent": "...", "assessment": "...",
  "expected": { "category": "interval", "workSegments": 6,
                "workRecoveryShape": "6 × 5 min, ~60 s recovery",
                "intensity": "threshold", "execution": "even, as planned" } }

// Fixture mode — offline, CI-safe, no database
{ "id": "example-easy", "date": "2025-01-07",
  "fixture": "fixtures/example-easy.json", /* relative to this directory */
  "actual": "...", "intent": "...", "assessment": "...",
  "expected": { "category": "easy-recovery", "intensity": "easy" } }
```

`scripts/session-profile/gold-set.example.json` shows the shape end to end. Its
entries and fixtures are **synthetic placeholders**, clearly marked
`_comment: "ILLUSTRATIVE SHAPE ONLY — not a real labelled session"` — they exist
so the harness is demonstrable/runnable with no DB, not as training data.

## Two resolution modes

- **DB mode (`activityKey`)** — resolves `userId` (from `--user`, default
  `wictor`) → one `Activity` row on that UTC day + source → loads the real
  inputs via `loadSessionInputs()` (`lib/session-profile/input.ts`). An
  ambiguous day (several activities) is a hard error rather than a guess.
- **Fixture mode (`fixture`)** — reads `{ activity, laps, streams }` matching
  `SessionActivityInput` / `SessionLapInput` / `SessionStreamsInput`. No DB, no
  Prisma; this is the mode CI (and anyone without a local Postgres) uses.

## `--dump` workflow

Snapshots a real activity into a committed-or-local fixture so a shown case
stays reproducible even if the provider data changes:

```bash
node scripts/session-profile/gold-set.ts --dump 2025-02-12 --source GARMIN --user wictor
# → wrote scripts/session-profile/fixtures/2025-02-12-garmin.json
```

Reference it from an entry with
`"fixture": "fixtures/2025-02-12-garmin.json"`. Note that a dump is **raw
athlete data**: `scripts/session-profile/fixtures/` is gitignored
(`fixtures/*` with `!fixtures/example-*.json`), so a dump never lands in a
commit by accident. Only the synthetic `example-*.json` fixtures are tracked —
they exist so the harness does not require real data.

## Reading the table

One block per entry, one row per §3 checklist item:

```
2025-02-12-threshold  (2025-02-12, GARMIN)  → profile: interval / high
  CHECK                   VERDICT   NOTE
  broad category          JA        classified "interval" as the facit says
  work segments           JA        6 work segment(s) detected, facit says 6
  work/recovery           JA        detected interval structure (6 work / 5 recovery)
  intensity               JA        profile threshold stimulus high, facit says "threshold" (moderate/high)
  execution               JA        execution "steady" matches the facit
  no unsupported claims   JA        no claim beyond the evidence
  no missed key property  JA        no key property of the facit is missing
  confidence              JA        "high" is defensible for dataQuality "high"
```

| Verdict | Meaning |
|---|---|
| `JA` (`yes`) | The profile's reading matches the facit. |
| `DELVIS` (`partial`) | Broadly right but imprecise / hedged where the facit is definite (e.g. one work segment off, one intensity step off, `unknown` structure). |
| `NEJ` (`no`) | Wrong, or an unsupported claim. |
| `—` (`skipped`) | The facit does not state this dimension. Shown explicitly so a thin facit is visible instead of looking like a pass. |

Two rows are inverted relative to §3's wording ("Påstående utan stöd? JA/NEJ"):
`no unsupported claims` and `no missed key property` read "yes" when the
profile is *clean*, so all eight rows point the same way.

`claimsWithoutSupport` flags fabricated precision: `high` confidence on an
`unknown` classification, any `cost.recovery` other than `"unknown"` (a v0.1
invariant), and `high` confidence on `poor` data quality.
`missedKeyProperty` flags a structural property the facit names (work-segment
count, warm-up, cool-down, late deterioration) that the profile's `structure`
does not reflect.

Summary line + actionable list:

```
Summary: 3 entries — 20 yes, 2 partial, 0 no, 2 skipped → ATTENTION
Actionable (at least one 'no'):
  - 2025-02-19-intervals (2025-02-19)
```

Aggregation (`summarizeGoldSet`): **fail** if any `no` on broad category or on
unsupported claims; **attention** if any `partial`, or if no facit dimension was
actually verified (a facit that states nothing checkable — `skipped` rows are
never a quiet pass); otherwise **pass**. An empty gold set is a pass with
`total: 0` — there is nothing to disagree with yet.

## Adding cases / the loop

1. Kevin picks a well-remembered session and writes an entry.
2. Run the matching date (DB mode) or `--dump` it into a fixture.
3. Run the set, read `NEJ`/`DELVIS` rows, and change one feature/rule in
   `profile.ts` (never in gold-set code to make a case pass).
4. Re-run the **whole** set — keep old cases so a threshold fix cannot silently
   break easy-run classification (§5/regression guard).
