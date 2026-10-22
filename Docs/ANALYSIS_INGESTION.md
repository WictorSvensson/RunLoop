# RunLoop analysis ingestion

Ingestion is the historical data layer that the analysis engine reads: what
landed on disk for each activity, which routes can trigger a sync, and how to
tell whether a run is actually ready to be profiled. It does **not** train an
LLM and does not claim to infer fitness.

Strava (import, OAuth, per-activity hydration jobs) was removed. Garmin and
Suunto rows arrive with laps and streams stored at import time, so there is no
hydration step and no `/api/jobs/analysis-hydrate` or
`/api/jobs/analysis-coverage` endpoint any more.

## What is stored

Per activity: the `Activity` summary row, explicit `ActivityLap` rows, one
`ActivityStream` row holding the raw payload as a single JSON document, plus
two timestamps:

- `detailFetchedAt` — the summary/detail row was enriched.
- `analysisDataFetchedAt` — streams were actually stored
  (`analysisReady`). Importers only set it when the stream payload is written,
  in the same transaction as the activity.

Streams stay lossless and unnormalized on purpose; we normalize only once real
query patterns prove what shape the deterministic engine needs. Keys differ by
source path: GPX-backed imports store `time/distance/heartrate/altitude` plus
FIT gap-fill keys `fitTime/cadence/watts/speed`, while FIT-only syncs store
`fitTime/distance/cadence/watts` plus granular `heartrate/altitude/speed`. HR
series may still be absent on older rows, so consumers must parse defensively
(`lib/session-profile/types.ts` documents the observed keys).

Duplicate sessions across sources are caught by the pure twin test in
`lib/analysis/duplicate.ts` (±10 min start window, ±5 min elapsed tolerance;
provider type labels are deliberately not compared).

## Sources and routes

| Route | Purpose |
|---|---|
| `POST /api/garmin/connect` | Trade Garmin email + password for tokens once (never stored). Password is entered on the Profile page (`app/profile/GarminSync.tsx`). |
| `POST /api/jobs/garmin-import` | Triggerable Garmin sync: activities + recent health. |
| `POST /api/jobs/suunto-import` | Triggerable Suunto Cloud sync: activities + 24/7 health. |
| `GET /api/suunto/connect`, `GET /api/suunto/callback` | Suunto OAuth2 flow. |
| `POST /api/suunto/upload` | Import a Suunto app export `.zip` for the current user. |
| `GET/POST /api/integrations` | Per-user integration toggles. |
| `GET /api/activities/[id]` | Activity detail DTO (laps, streams flag, SessionProfile). |

Job-route parameters (`?full=1` full history, `?healthDays=N`, `?limit=N` for
diagnostics):

- Incremental by default; `?full=1` re-syncs the whole history and raises the
  health window from 14 to 365 days.
- `?limit=N` caps activities processed and skips health sync — meant to
  reproduce a single FIT failure in seconds.
- Auth: `Bearer $JOB_SECRET` for automated callers, or a same-origin browser
  request, plus a session user. Both checks must pass.

The CLI alternative for Suunto export backfills is `npm run import:suunto`
(`scripts/import-suunto/import.ts`); `POST /api/suunto/upload` mirrors it via
Prisma with the same idempotent upsert on `(userId, source, externalId)`.

## Populating history

Connect a provider on the Profile page (Garmin or Suunto), then run a full
resync once so `Activity` holds the whole history:

```text
POST /api/jobs/garmin-import?full=1
POST /api/jobs/suunto-import?full=1
```

Both are idempotent; re-running continues where the import left off.

## Checking coverage

Coverage is no longer an endpoint. `getAnalysisCoverage(userId)` in
`lib/activity-detail.ts` computes it over the user's running activities and the
Coach page (`app/coach/page.tsx`) surfaces it. It reports:

- total runs,
- detail-enriched runs (`detailFetchedAt` set),
- analysis-ready runs (`analysisDataFetchedAt` set),
- runs with heart-rate summaries,
- runs with explicit laps,
- runs with a usable stream payload.

This is deliberately a **data-readiness** report, not a fitness score. Because
every importer writes laps and streams at import time, it only lags while an
import is young or when a source genuinely had no stream.

## What comes next

Session-level reading is already implemented: `sessionProfile()` in
`lib/session-profile/profile.ts` turns one activity + laps + streams into a
`SessionProfile`, and `getActivityDetail()` computes it once per detail request.
Its cutoffs are heuristic v0.1 and are tuned against the gold set
(`scripts/session-profile/README.md`), not by gut.

Beyond that, the order stays as in `Docs/RUNLOOP_ANALYSIS_ENGINE_SPEC.md`:
workout segmentation/classification → comparable-session similarity →
WeekProfile/block reasoning. Deterministic metrics and valid session
classification precede any coaching reasoning, and no layer may present
cross-session patterns before its inputs are validated.
