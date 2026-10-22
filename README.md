# RunLoop

RunLoop is a running-analysis app that answers one question per session: *what actually happened in this workout, and how hard did it really cost me?* Activities are imported from Garmin and Suunto, described by a deterministic `SessionProfile`, and only then fed to the analysis and coaching surfaces. It is deliberately not an activity log, a plan generator, or a chatbot: every claim in the UI has to be backed by stored data.

## The three pillars

1. **Import** — Garmin Connect (unofficial API), Suunto Cloud API auto-sync, and manual Suunto export upload. Every importer stores `Activity` + `ActivityLap` + `ActivityStream` at import time, so no later hydration step exists.
2. **SessionProfile** — a pure function, `sessionProfile(activity, laps, streams)` in `lib/session-profile/profile.ts`, that describes a single session along nine dimensions: classification, confidence, structure, execution, stimulus, cost, dataQuality, uncertainty and evidence. Uncertainty is first-class output, not a footnote.
3. **Analysis** — the Dashboard, Analytics and Coach pages read those stored rows (and the profile) to show volume, consistency, pace trend, recovery facts and coverage. The analysis engine follows `Docs/RUNLOOP_ANALYSIS_ENGINE_SPEC.md`.

## Prerequisites

- Node.js 22.15 or newer — `import:suunto` and `profile:gold-set` run TypeScript directly on native type stripping, no tsx/ts-node.
- Docker (for the local Postgres container `runloop-postgres`) — or any Postgres you point `DATABASE_URL` at.
- A Garmin Connect account and/or Suunto account if you want live imports.

## Setup

```bash
git clone <repo> && cd RunLoop        # repo dir name may differ
npm install
cp .env.example .env                  # then fill in the secrets you need
npm run db:up                         # docker compose up -d (Postgres 17)
npm run db:migrate                    # prisma migrate dev
npm run db:seed                       # scripts/seed-users.mjs (dev user)
npm run dev                           # http://localhost:3000
```

`.env.example` documents every variable: `DATABASE_URL`, `JOB_SECRET` (protects the import job routes), `SESSION_SECRET` (signs the `runloop_session` cookie, required for login), `GARMIN_USERNAME` (prefill only — the password is entered once on the Profile page and never stored), the `SUUNTO_*` OAuth app credentials, and the Azure AI Foundry `FOUNDRY_*` pair used for coach briefs.

## Scripts

All scripts live in `package.json`.

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (`next build`) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run test` | Vitest (`vitest run`) |
| `npm run postinstall` | `prisma generate` (Prisma client output goes to `generated/prisma`) |
| `npm run db:up` | Start local Postgres via `docker compose up -d` |
| `npm run db:down` | Stop the compose stack |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:deploy` | `prisma migrate deploy` |
| `npm run db:seed` | Seed dev users (`scripts/seed-users.mjs`) |
| `npm run db:studio` | Open Prisma Studio |
| `npm run import:suunto` | CLI Suunto export backfill (`scripts/import-suunto/import.ts`) |
| `npm run profile:gold-set` | Run the SessionProfile gold-set harness (`scripts/session-profile/gold-set.ts`) |

`profile:gold-set` flags (see `scripts/session-profile/README.md`):

```bash
npm run profile:gold-set                                            # gold-set.json
npm run profile:gold-set -- --gold-set scripts/session-profile/gold-set.example.json
npm run profile:gold-set -- --user wictor                           # DB user (default: wictor)
npm run profile:gold-set -- --dump 2025-02-12 --source GARMIN --user wictor
```

Exit codes: `0` empty set / pass / attention, `1` fail, `2` a setup or facit problem — unreachable database, missing/ambiguous activity or unknown user, malformed facit entry (bad `expected.category`, missing required fields), an entry with neither `activityKey` nor `fixture` (or a run where all entries were skipped), an invalid `--source`, or Node older than 22.15 in DB mode.

## From activity to SessionProfile

1. `lib/garmin/import.ts`, `lib/suunto/import.ts` and `app/api/suunto/upload/route.ts` upsert `Activity`, `ActivityLap` and a single `ActivityStream.payload` JSON document per activity, then set `detailFetchedAt` and — when streams are actually stored — `analysisDataFetchedAt`.
2. `lib/activity-detail.ts`'s `getActivityDetail(userId, activityId)` loads the row, its laps and its stream payload, and calls `sessionProfile()` exactly once.
3. `lib/session-profile/profile.ts` detects structure (laps + pace stream), classifies the session, then derives execution/stimulus/cost/dataQuality — heart rate only corroborates, never decides alone.
4. The result travels as `sessionProfile` in the `ActivityDTO` (full payload) plus `profile` (cheap list badge, via `toSessionProfileBadge()`).
5. `app/training/SessionProfilePanel.tsx` renders all nine dimensions, evidence and uncertainty in the expanded Training row.

The gold-set CLI uses a separate DB input layer, `loadSessionInputs()` in `lib/session-profile/input.ts`, so the pure profiler imports no Prisma code and can be unit-tested without a database.

## Gold set / validation

`gold-set.json` (currently empty) is a private set of remembered sessions labelled by the athlete — never a product feature, since no user will ever label a session. The loop is: run the profile blind, compare it against the labels with `compareToGoldSet()` in `lib/session-profile/gold-set.ts`, fix one rule, re-run the whole set to catch regressions. The profiler must never see the labels; the comparison module is pure and takes the finished profile plus the entry as separate arguments. Correct "unknown / insufficient confidence" on a hard-to-read session earns `yes` on the individual checks — honest uncertainty is the success signal, not a misclassification — but a run in which no dimension was actually verified reports `attention` (a thin-facit signal), never `pass` and never `fail`.

See `scripts/session-profile/README.md` for the entry format, fixture mode, `--dump`, and the verdict table.

## Status and limits

- The profiler is **heuristic v0.1**. The cutoffs at the top of `lib/session-profile/profile.ts` are starting points for the gold-set loop, not physiological truths.
- Only session-level output exists. There is no `WeekProfile`, no training block and no Athlete Model yet.
- `cost.recovery` is **always `"unknown"`** in v0.1 — RPE, check-in and HR-recovery evidence are not wired, and recovery is never inferred from load alone.
- Classification is **unvalidated** until a real gold set exists; the shipped `gold-set.json` is empty, so a passing run means "nothing to disagree with", not "the algorithm is right".
- Running-only filters (`RUNNING_TYPES`) apply to Dashboard and Analytics; the Training page shows full history.
- No fabricated precision: no confidence percentages, no inferred "problems", and comparisons are gated behind minimum sample sizes.

## Documentation

- `Docs/RUNLOOP_ANALYSIS_ENGINE_SPEC.md` — the analysis-engine spec (read before building analytics/coaching features).
- `Docs/SESSIONPROFILE_FORTYDLIGANDE.md` — SessionProfile, scoring and reference sessions (Swedish).
- `Docs/ANALYSIS_INGESTION.md` — what gets stored at import, which routes exist, and how coverage is read.
- `Docs/SUUNTO_SYNC.md` — Suunto OAuth/sync details.
- `Docs/PROXMOX_DEPLOY.md` — self-hosted deployment.
- `scripts/session-profile/README.md` — gold-set harness usage.
- `AGENTS.md` — conventions for working in this repo.
