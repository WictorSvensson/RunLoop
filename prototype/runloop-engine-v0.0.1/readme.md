# RunLoop Analysis Engine Prototype v0.0.1

This folder contains the first isolated prototype of the RunLoop coaching analysis engine.

It is intentionally separate from the production application.

The goal of this prototype is not to build a complete coaching system yet. The goal is to test whether the basic reasoning architecture makes sense before connecting it to real athlete data, Strava, the database, or an LLM.

## What this prototype does

The current prototype answers a very narrow question:

> Given what has happened over the last several weeks, should the athlete continue as planned, back off temporarily, or reconsider the current stimulus?

The prototype currently looks at a small set of signals:

- Recent running volume
- Recent average weekly volume
- Subjective fatigue
- Easy-run heart rate trends
- Easy-run pace trends
- Whether performance indicators are stable or declining
- Whether useful recovery/context data is missing

It then produces:

- A recommendation
- Supporting findings
- Metric trends
- Missing-data requests
- Explicit uncertainty statements

## Important: this is not production logic

The thresholds and decision rules in this prototype are intentionally crude.

For example, there are currently fixed thresholds for changes in easy-run heart rate and easy-run pace.

Those values are temporary scaffolding.

The long-term RunLoop system should increasingly learn what constitutes meaningful variation for the individual athlete rather than relying on universal fixed thresholds.

The same applies to fatigue, training load, and other metrics.

## Architecture being tested

The intended long-term architecture is roughly:

Raw athlete data  
→ normalized context  
→ derived metrics  
→ athlete model  
→ pattern detection  
→ coaching reasoning  
→ recommendation  
→ explanation/dialogue

The LLM should not be responsible for calculating basic training metrics or inventing relationships directly from raw activity data.

RunLoop should first create structured evidence and deterministic reasoning outputs, then use an LLM later for synthesis, explanation, dialogue, and adaptive questioning.

## Current files

### `types.ts`

Defines the shared data structures for:

- Athlete profile
- Athlete goals
- Athlete preferences
- Activities
- Daily context
- Training blocks
- Trends
- Findings
- Recommendations
- Missing data
- Coach analysis output

### `metrics.ts`

Contains basic deterministic calculations such as:

- Recent activity filtering
- Total distance
- Total training minutes
- Average easy-run heart rate
- Average easy-run pace
- Average RPE
- Average fatigue
- Basic trend detection

### `engine.ts`

Contains the first deterministic coaching decision logic.

Current example decisions include:

- Continue training
- Reduce load temporarily
- Collect more context before making a major change

### `mock-data.ts`

Contains fake athlete data so the analysis engine can be tested without connecting to production data.

### `coach-test-page.tsx`

Simple React page for displaying the output of the prototype engine.

It is currently only included for review and is not wired into the production RunLoop application.

## Core philosophy

RunLoop should not react aggressively to individual bad sessions or noisy short-term metrics.

The system should distinguish between:

- Fitness
- Fatigue
- Freshness
- Context

Elevated fatigue does not automatically mean training is failing.

Performance deterioration does not automatically mean fitness has declined.

The system should evaluate patterns across appropriate timescales and remain comfortable saying:

> Nothing currently gives me a strong reason to change course.

Uncertainty should be represented explicitly rather than hidden behind fake precision.

## Where this should eventually go

Future versions are expected to add:

- Workout prescription vs execution analysis
- Training-block evaluation
- Benchmark and race-performance modeling
- Athlete-specific baselines
- Goal modeling
- Limiter detection
- Intervention history
- Environmental/context weighting
- Learned data-source reliability
- Athlete-specific response patterns
- Interaction effects between training variables
- Adaptive questioning
- LLM coaching explanation layer

A possible development sequence is:

1. v0.0.1 — fatigue/context reasoning
2. v0.0.2 — workout execution
3. v0.0.3 — training-block evaluation
4. v0.0.4 — benchmark/performance model
5. v0.0.5 — limiter model
6. v0.0.6 — intervention history
7. v0.0.7 — athlete-specific baselines
8. v0.0.8 — context weighting
9. v0.0.9 — LLM Coach layer

## Review request

Please review the reasoning structure critically.

The thresholds and logic are intentionally temporary scaffolding and are expected to change.

The main questions are:

- Does the data model make sense?
- Is the separation between metrics, reasoning, and presentation sensible?
- Are there architectural problems that will make this difficult to extend later?
- Are any of the current abstractions obviously wrong?
- Is there a cleaner way to structure the analysis engine?
- Are there TypeScript or Next.js issues in the prototype?
- What should be fixed before connecting this to real backend data?

Please do not treat the current thresholds or coaching rules as finalized product decisions.
