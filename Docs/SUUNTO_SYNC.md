# Suunto Cloud API auto-sync (v3 workouts + 24/7 sleep)

Mirrors the Garmin connection: one `SuuntoConnection` row per user
(migration `20261008000000_suunto_connection`), tokens re-exported and
saved after every use since refresh rotates them. Manual export-zip upload
(`<SuuntoUpload />` → `/api/suunto/upload`, idempotent on filename stem)
is kept as a fallback alongside auto-sync.

## Setup

1. Register an OAuth app at https://apizone.suunto.com/ to get a client id,
   then set the client secret + redirect URI there.
2. Mirror them in `.env` (see `.env.example`):

```bash
SUUNTO_CLIENT_ID=
SUUNTO_CLIENT_SECRET=          # server-only, never exposed to the browser
SUUNTO_SUBSCRIPTION_KEY=       # Developer API subscription, sent as Ocp-Apim-Subscription-Key
SUUNTO_REDIRECT_URI=http://localhost:3000/api/suunto/callback  # must match exactly
# (no scope variable — oauth2-api.yaml defines no scope request parameter)
# SUUNTO_OAUTH_BASE_URL=...    # optional host override, testing only (default https://cloudapi-oauth.suunto.com)
# SUUNTO_API_BASE_URL=...      # optional host override, testing only (default https://cloudapi.suunto.com)
```

```bash
npm run db:migrate
```

## Connect flow (Profile)

- `POST /api/suunto/connect` returns the Suunto authorize URL
  (`response_type=code`, signed 10-min `state` bound to the user).
- User authorizes at Suunto, Suunto redirects to
  `GET /api/suunto/callback?code=…&state=…`, which trades the code for
  tokens (HTTP Basic `client_id:client_secret`), saves them, re-enables
  the `SUUNTO` integration, and lands on `/profile?suunto=connected`
  (`denied` / `expired` / `failed` on failure — never tokens in the URL).
- Toggling Suunto off keeps tokens + history but blocks future syncs.

## Sync job

```text
POST /api/jobs/suunto-import?full=1&limit=N&healthDays=N
```

- Default is incremental (high-water mark minus 24 h overlap,
  modification-time filtered so backdated edits surface). `?full=1`
  imports whole history, newest-first.
- `?limit=N` caps rows processed and skips health (diagnostics / staging).
- `?healthDays=N` sets the 24/7 sleep window (default 14, `?full=1`
  raises it to 365, chunked into ≤28-day fetches). Profile buttons:
  "Sync Suunto now" (incremental) and "Full Suunto resync".
- Same auth as other job routes: Bearer `JOB_SECRET` or same-origin
  browser request, plus session user. 401 means reconnect needed.

Quota: Developer API tier allows 10 calls/min up to 200/week. A sync
costs ~1 list call per page + 1 FIT download per workout (the detail
endpoint is deliberately not called), so stage a large first backfill
with `?limit=N` across weeks, then rely on cheap incremental syncs.

## What maps where

- `Activity` (`source: SUUNTO`, `externalId` = Cloud API `workoutKey`,
  upsert; twin-matched ±10 min / ±300 s against other brands via
  `lib/analysis/duplicate.ts`): numeric `activityId` → `type`
  (unknown → `Workout`), speeds converted km/h → m/s (average recomputed
  from distance/time), HR from `hrdata` (`workoutAvgHR`/`workoutMaxHR`),
  watts/cadence from `SummaryExtension`, calories from
  `energyConsumption`, ascent from `totalAscent`. Every workout gets its
  FIT (`GET /v3/workouts/{key}/fit`) downloaded and merged — FIT wins
  every conflict, summary fills the rest; FIT-less rows stay honestly
  not analysis-ready.
- `DailyCheckin` (manual-wins, empty fields only): 24/7 sleep `Duration`
  (s → min), `Feeling` 1–5 → quality (`SleepQualityScore` /100 fallback),
  `HRMin` → resting HR, `AvgHRV` → HRV. Naps (`IsNap`) skipped, longest
  sleep per date wins. Steps/joules aggregates, intraday activity
  samples, and recovery Balance have no columns and are not synced.

Assumption: every data API request carries `Authorization: Bearer <JWT>`
AND `Ocp-Apim-Subscription-Key: <subscription key>` (partner-gated
public docs; paths straight from the spec siblings noted in
`lib/suunto/config.ts`).
