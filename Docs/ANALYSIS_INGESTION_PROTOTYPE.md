# RunLoop analysis-ingestion prototype

This branch does **not** train an LLM or claim to infer fitness yet. It adds the
historical data layer needed before workout classification and comparable-session
analysis can be trustworthy.

## What it adds

For each running activity RunLoop can now cache:

- the existing detailed Strava activity fields,
- explicit Strava laps,
- raw activity streams (time, distance, GPS, altitude, smoothed velocity,
  heart rate, cadence, watts, temperature, moving flag and grade when available),
- a timestamp indicating that the activity has been hydrated for analysis.

The raw streams are intentionally stored as one JSON document per activity in
this prototype. That keeps ingestion lossless while the segment model is still
being designed. We should normalize only after real query patterns prove what
shape the deterministic engine needs.

## Database setup

After checking out the branch:

```bash
npm install
npm run db:up
npm run db:migrate
```

The migration adds `ActivityLap`, `ActivityStream`, and
`Activity.analysisDataFetchedAt`.

## Populate the historical activity summaries first

Use the existing full Strava resync route from the app/UI so `Activity` contains
all available history. The existing importer is idempotent.

## Hydrate history for analysis

The new endpoint is deliberately batch-limited because one previously-unenriched
activity can require up to three Strava requests: detail + laps + streams.

From the RunLoop UI/domain, a same-origin request can call:

```text
POST /api/jobs/analysis-hydrate?limit=10
```

Automated callers can use the existing `JOB_SECRET` bearer protection.
Re-running the endpoint continues with the next running activities whose
`analysisDataFetchedAt` is still null.

Default batch size: 10. Maximum: 25.

## Check coverage

```text
GET /api/jobs/analysis-coverage
```

The response reports:

- total running activities,
- detail-enriched runs,
- analysis-ready runs,
- runs with heart-rate summaries,
- runs with explicit laps,
- runs with streams,
- percentage of running history that is analysis-ready.

This is deliberately a **data-readiness** report, not a fitness score.

## What should come next

Once enough history is hydrated, the next deterministic milestone should be
workout segmentation/classification:

1. detect steady aerobic sections and explicit lap/interval structure,
2. classify sessions as easy / long / threshold / high intensity / race /
   unknown, with athlete correction,
3. derive rep-level pace/HR/recovery/deterioration features,
4. only then build comparable-session similarity logic.

That order follows `Docs/RUNLOOP_ANALYSIS_ENGINE_SPEC.md`: deterministic metrics
and workout classification precede the comparable-session engine and coaching
reasoning.
