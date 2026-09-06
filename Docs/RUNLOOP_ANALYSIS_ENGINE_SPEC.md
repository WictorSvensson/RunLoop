# RunLoop Analysis Engine Specification
**Version:** 0.1  
**Status:** Product / engineering proposal for technical review  
**Purpose:** Define how RunLoop should turn athlete training data into individualized, evidence-based coaching analysis and recommendations.

---

## 1. Product Goal

RunLoop should answer a simple question exceptionally well:

> **Is my training working, why, and what should I do next?**

RunLoop is not intended to be another activity log, generic training-plan generator, or AI chatbot layered on top of Strava. Its core value should be the reasoning process of an excellent endurance coach:

1. Observe what the athlete has actually done.
2. Normalize and contextualize the data.
3. Identify meaningful trends rather than day-to-day noise.
4. Learn how this individual athlete responds to training.
5. Identify strengths, weaknesses, mistakes, and likely limiters.
6. Recommend the smallest useful change.
7. State uncertainty explicitly.
8. Reassess whether the recommendation worked.
9. Update the athlete model as new evidence arrives.

The system should prefer **useful, well-supported coaching decisions** over impressive-looking scores or overconfident explanations.

---

## 2. Design Principles

### 2.1 Deterministic facts before AI interpretation

The language model should not be responsible for basic calculations that can be performed reliably in code.

Examples that should be calculated before the LLM sees the data:

- weekly distance
- training frequency
- rolling volume
- pace distributions
- heart-rate distributions
- interval duration and pace
- elevation gain
- time in training zones
- heart-rate drift
- pace deterioration within workouts
- session spacing
- long-run proportion
- training monotony / variation
- comparable-session trends

The LLM should receive structured facts and use them to reason, explain, prioritize, and ask for missing information.

### 2.2 Individualization over generic rules

RunLoop should treat population-level coaching principles as priors, not as immutable rules.

Examples:

- A 10% weekly mileage rule should not be treated as universal truth.
- A high-volume athlete and a low-volume athlete may respond differently to the same percentage increase.
- Two athletes with identical mileage may have very different recovery requirements.
- A strategy that historically works well for one athlete should receive more weight for that athlete.

### 2.3 Longitudinal evidence over single-session interpretation

A single run should rarely justify a major conclusion.

The engine should prefer repeated observations across comparable sessions, rolling windows, and training blocks.

### 2.4 Explicit uncertainty

The system should distinguish:

- **Observation** — directly supported by data.
- **Inference** — plausible interpretation.
- **Recommendation** — proposed action.
- **Confidence** — how strong the evidence is.

The user-facing UI can use qualitative levels such as:

- High confidence
- Moderate confidence
- Low confidence
- Insufficient evidence

Avoid fake precision such as “87% ready.”

### 2.5 Coaching should be outcome-oriented

The engine should not reward athletes merely for “doing more.”

The core question is whether the training is producing adaptations relevant to the athlete's stated goal.

---

## 3. High-Level Architecture

```text
Strava / wearable data
Daily check-ins
Goals and race targets
Weather / environmental context
Race results
Manual athlete notes
        |
        v
+--------------------------+
| Raw Athlete Data Store   |
+------------+-------------+
             |
             v
+--------------------------+
| Normalization Layer      |
| - units                  |
| - elevation              |
| - weather                |
| - comparable effort      |
| - data quality           |
+------------+-------------+
             |
             v
+--------------------------+
| Metric Engine            |
| - volume                 |
| - intensity              |
| - aerobic efficiency     |
| - threshold              |
| - durability             |
| - recovery               |
| - consistency            |
+------------+-------------+
             |
             v
+--------------------------+
| Athlete Model            |
| - baseline               |
| - response profile       |
| - strengths              |
| - weaknesses             |
| - tolerances             |
| - constraints            |
| - goal requirements      |
+------------+-------------+
             |
             v
+--------------------------+
| Reasoning Engine         |
| - pattern detection      |
| - anomaly detection      |
| - contradictions         |
| - hypotheses             |
| - interventions          |
| - confidence             |
+------------+-------------+
             |
             v
+--------------------------+
| Coach Layer / LLM        |
| - explanation            |
| - recommendation         |
| - questions              |
| - dialogue               |
+------------+-------------+
             |
             v
          Athlete
             |
             v
          New data
             |
             +------------------> Athlete model update
```

---

## 4. Primary Data Inputs

### 4.1 Activity data

For each run, capture when available:

- activity ID
- date and start time
- sport / run type
- distance
- moving time
- elapsed time
- average pace
- average heart rate
- max heart rate
- elevation gain
- cadence
- power, if available
- grade-adjusted pace, if available or derivable
- laps / splits
- interval structure, if identifiable
- route / surface metadata if available
- athlete-entered activity name
- athlete description / notes
- perceived exertion if available
- race flag / workout flag if available

### 4.2 Environmental data

When possible:

- temperature
- humidity
- wind
- precipitation
- altitude
- route elevation profile

These should primarily improve comparability and uncertainty estimation rather than create a magical “perfect equivalent pace.”

### 4.3 Daily athlete check-in

The default check-in should remain low-friction.

Core fields:

- sleep duration
- sleep quality
- energy
- symptoms / pain
- optional body weight

Useful optional or context-triggered fields:

- soreness
- life stress
- motivation
- illness
- menstrual-cycle context if the athlete elects to track it
- unusual circumstances
- fueling issues
- travel / jet lag

The system should ask more only when there is a reason.

Example:

> You reported Achilles discomfort yesterday. How does it feel this morning?

### 4.4 Goal data

The athlete model should contain:

- primary event
- goal distance
- goal date
- target performance
- secondary goals
- current training phase
- priority order

Changing the goal should change the definition of useful adaptation without erasing what the system has learned about the athlete.

### 4.5 Race and benchmark data

Capture:

- event distance
- official / self-reported time
- course profile
- environmental conditions
- race RPE
- pacing pattern
- HR if available
- whether performance was representative
- athlete notes

---

## 5. Rolling Time Windows

RunLoop should not rely on a single weekly snapshot.

Candidate rolling windows:

- 7 days
- 14 days
- 28 days
- 42 days
- 56 days
- 84 days
- current training block
- previous training block
- historical best comparable period

Different metrics may require different windows.

Examples:

- acute fatigue signals may rely heavily on 3–14 days
- aerobic trends may need 4–8 weeks
- athlete-response learning may require months or years

---

## 6. Core Metric Families

## 6.1 Training volume and exposure

Track:

- weekly distance
- weekly duration
- weekly elevation gain
- runs per week
- consecutive running days
- rest days
- long-run distance
- long-run duration
- long-run share of weekly volume
- quality-session count
- quality-session duration
- intensity distribution
- easy / moderate / hard exposure
- total threshold minutes
- total high-intensity minutes

Do not collapse all of these immediately into one proprietary load score.

A composite score may be useful later, but the engine should retain the underlying dimensions.

---

## 6.2 Aerobic efficiency

Goal:

> Determine whether the athlete can produce more running speed for the same physiological cost, or the same speed for lower physiological cost.

Candidate inputs:

- pace
- HR
- grade
- temperature
- humidity
- duration
- surface / terrain if known

Potential outputs:

- adjusted HR at comparable pace
- adjusted pace at comparable HR
- HR drift
- pace drift
- efficiency trend
- confidence of trend
- comparable-run count

Important:

Environmental normalization should improve comparison, not imply impossible precision.

Example output:

```json
{
  "metric": "aerobic_efficiency",
  "trend": "improving",
  "confidence": "moderate",
  "evidence": [
    "5 comparable easy runs",
    "HR drift declined from 4.1% to 2.8%",
    "pace at similar HR improved by 7 s/km"
  ],
  "confounders": [
    "recent runs were cooler"
  ]
}
```

---

## 6.3 Heart-rate drift / durability

Heart-rate drift should be evaluated primarily on steady or appropriately comparable aerobic efforts.

Potential method:

1. Exclude warm-up where appropriate.
2. Divide steady-state portion into early and late sections.
3. Compare HR relative to pace / power / grade-adjusted effort.
4. Reject sessions with too many stops, large intensity changes, or unsuitable terrain.
5. Track trend over time.

Potential interpretation:

- decreasing drift at comparable duration/effort → improving durability
- increasing drift alongside rising volume → possible fatigue, heat effect, fueling issue, or insufficient aerobic durability
- low drift but declining performance → investigate other limiters

Do not interpret drift without considering temperature, terrain, fueling, duration, and session type.

---

## 6.4 Threshold development

The engine should compare sustained efforts of meaningful durations.

Initial target durations:

- 3 min
- 6 min
- 10 min
- 20 min
- 30 min

For each duration, track:

- best representative pace
- representative HR
- repeatability
- within-session deterioration
- recovery between repetitions
- session RPE if available
- environmental context
- number of comparable efforts

The engine should distinguish one isolated fast rep from a repeatable workout.

Example:

Session A:

```text
6 x 6 min
4:10
4:09
4:08
4:09
4:11
4:12
```

Session B three weeks later:

```text
4:05
4:05
4:06
4:05
4:06
4:07
```

Session B is strong evidence of improvement because performance is both faster and repeatable.

Potential derived features:

- mean interval pace
- median interval pace
- best interval
- worst interval
- coefficient of variation
- first-half vs second-half deterioration
- HR rise across reps
- recovery HR
- total quality duration

---

## 6.5 Long-run durability

For longer-distance goals, track:

- long-run distance
- long-run duration
- late-run pace relative to early-run pace
- late-run HR relative to early-run HR
- late-run efficiency
- pace stability
- fueling intake if entered
- RPE drift
- recovery after long run

This metric should receive more importance for half marathon / marathon athletes than for short-distance goals.

---

## 6.6 Intensity distribution

Classify training into practical effort categories.

Initial model may use:

- easy
- moderate / steady
- threshold
- VO2 / high intensity
- race / maximal

Classification may combine:

- activity type
- pace
- HR
- athlete zones
- lap duration
- workout structure
- RPE

Avoid pretending HR zones are perfectly accurate if athlete physiology is poorly calibrated.

---

## 6.7 Consistency

Potential features:

- runs/week stability
- missed-session frequency
- abrupt gaps
- weekly volume variability
- planned vs completed training, if plans later exist
- sustained uninterrupted training blocks

Consistency should be interpreted relative to the athlete's life and history, not as a moral score.

---

## 6.8 Recovery and readiness context

Use subjective data to modify interpretation.

Potential signals:

- sleep trend
- energy trend
- soreness trend
- symptom trend
- illness
- life stress
- performance deterioration
- HR anomalies

Avoid collapsing all recovery information into one fake-precision readiness number.

Preferred output:

> Recovery looks normal.

or:

> Recovery signals have deteriorated for four days and are now consistent with the decline in workout quality.

---

## 7. Comparable Session Engine

A key technical requirement is deciding which sessions are fair to compare.

Potential similarity factors:

- duration
- intensity
- average HR
- pace
- elevation
- route
- temperature
- humidity
- workout structure
- recovery interval
- surface
- time of day if useful

The engine should create a similarity score and only make strong claims when enough comparable observations exist.

Example:

```json
{
  "session_a": "2026-08-10",
  "session_b": "2026-09-02",
  "similarity": 0.86,
  "major_differences": [
    "temperature +3 C"
  ]
}
```

Confidence should fall as comparability decreases.

---

## 8. Athlete Model

The athlete model is the core individualization layer.

It should evolve over time and contain both factual baselines and learned response characteristics.

Example conceptual model:

```text
ATHLETE PROFILE

Primary goal:
10K PB

Current training phase:
Threshold development

Historical sustainable volume:
35–50 km/week

Typical frequency:
5 runs/week

Typical long run:
14–18 km

Typical hard-session recovery:
~48 hours

Typical easy HR:
135–142 bpm

Typical easy pace:
5:20–5:50/km
```

### Learned response profile

Potential traits:

- response to mileage increases
- response to threshold work
- response to VO2 work
- response to long runs
- response to frequency
- response to consecutive days
- recovery time after hard sessions
- heat sensitivity
- hill sensitivity
- taper response
- race-response patterns
- injury / symptom sensitivity
- durability
- speed endurance
- threshold repeatability

Each learned trait should include:

- current estimate
- confidence
- evidence count
- time period
- contradictory evidence
- last updated

Example:

```json
{
  "trait": "response_to_threshold_volume",
  "estimate": "strong_positive",
  "confidence": "moderate",
  "evidence_count": 3,
  "evidence": [
    "6-min pace improved after 3-week threshold block",
    "10-min pace improved after increased sustained threshold duration"
  ]
}
```

---

## 9. Goal Model

The athlete's goal changes the weighting of relevant adaptations.

### 5K-oriented emphasis

Higher weighting on:

- VO2 / 3–6 minute performance
- threshold
- running economy
- race pace
- speed
- ability to tolerate race-specific intensity

### 10K-oriented emphasis

Higher weighting on:

- threshold
- 6–20 minute performance
- aerobic efficiency
- VO2 support
- race-specific pace durability

### Half marathon emphasis

Higher weighting on:

- sustained threshold
- aerobic volume
- long-run durability
- late-run efficiency
- fueling tolerance
- ability to maintain strong pace for long durations

### Marathon emphasis

Higher weighting on:

- aerobic volume
- durability
- long-run tolerance
- fueling
- fatigue resistance
- marathon-pace sustainability
- recovery from high volume

A goal change should not reset the athlete model.

Instead:

> Keep what we learned about the athlete; change which adaptations receive priority.

---

## 10. Pattern Detection

The engine should search for repeated relationships rather than simple correlations.

Examples:

### Positive pattern

```text
Threshold minutes increase
+
recovery remains stable
+
6–10 minute interval performance improves
=
likely positive threshold response
```

### Negative pattern

```text
Weekly volume rises
+
easy HR rises
+
threshold performance declines
+
energy declines
=
possible accumulated fatigue / excessive load
```

### Neutral pattern

```text
Mileage rises
+
performance unchanged
+
recovery stable
=
insufficient evidence that added volume is producing useful adaptation
```

### Environmental contradiction

```text
Race performance declines
+
training indicators improve
+
race temperature substantially hotter
=
race result may not represent fitness decline
```

---

## 11. Contradiction Detection

This should be a first-class feature.

The engine should actively identify when common explanations do not match the evidence.

Example athlete statement:

> “I'm running more than ever, but my 10K got 1:30 slower.”

RunLoop should investigate whether:

- volume rose
- intensity distribution changed
- threshold volume changed
- recovery worsened
- HR at comparable pace worsened
- environmental conditions changed
- race course changed
- body mass changed
- training specificity changed
- long runs became disproportionately large
- hard sessions became too frequent
- athlete became more fatigued
- race result was an outlier

Possible conclusion:

> Training load increased, but multiple adaptation markers deteriorated. More training is not currently producing more fitness.

Alternative conclusion:

> Your race result was slower, but your training markers improved and race-day conditions were substantially worse. The race result alone is weak evidence of declining fitness.

---

## 12. Mistake Detection

RunLoop should be capable of identifying likely training mistakes.

Examples:

### Excessive load progression

Evidence:

- rapid volume increase
- intensity maintained or increased
- recovery deteriorating
- workout execution worsening

### Too much intensity

Evidence:

- frequent moderate/hard running
- declining workout performance
- poor recovery
- easy runs no longer easy

### Insufficient specificity

Example:

10K goal but training contains increasing easy volume with little threshold / race-specific work.

### Long-run disproportion

Example:

A large percentage of weekly mileage concentrated into one run.

### Workout progression too aggressive

Evidence:

- threshold duration jumps rapidly
- pace falls across reps
- RPE increases
- next-session performance deteriorates

### Training stagnation

Evidence:

- same stimulus repeated for many weeks
- no meaningful adaptation marker improving

### Recovery mismatch

Evidence:

- training load stable
- sleep / energy deteriorate
- HR response worsens
- workouts become less repeatable

The engine should avoid treating every deviation as an error.

A “mistake” should require evidence that training behavior is inconsistent with the athlete's goal, tolerance, or observed response.

---

## 13. Strength Detection

RunLoop should identify what the athlete is doing well.

Examples:

- strong response to threshold work
- excellent durability
- consistent easy-run discipline
- high tolerance for volume
- rapid recovery from quality sessions
- strong repeatability
- excellent pacing control
- resilience in warm conditions
- effective taper response
- good consistency

This is not motivational fluff.

Strengths should influence future decisions.

Example:

> This athlete historically responds well to moderate volume increases and maintains recovery. Mileage may be a useful lever.

---

## 14. Hypothesis → Intervention → Outcome Loop

RunLoop should record coaching decisions internally.

### Hypothesis

Example:

```text
Current limiter:
Sustained threshold capacity

Evidence:
- 3-min pace improving
- 6-min pace improving
- 10-min pace flat
- aerobic efficiency improving
- mileage already increasing

Confidence:
Moderate-high
```

### Intervention

```text
Maintain:
40–43 km/week

Change:
Increase sustained threshold exposure

Duration:
3 weeks
```

### Expected response

```text
10-min threshold pace:
improve

Aerobic efficiency:
stable or improve

Recovery:
stable
```

### Reassessment

After the intervention window:

- Did the predicted adaptation occur?
- Was recovery acceptable?
- Did symptoms emerge?
- Did another metric deteriorate?
- Was the intervention completed as intended?

### Update

If successful:

> Increase confidence that this athlete responds positively to sustained threshold work.

If unsuccessful:

> Reduce confidence in the hypothesis and investigate alternatives.

---

## 15. Self-Correction

Self-correction should not mean that the LLM freely rewrites its own rules.

Instead, RunLoop should update structured beliefs based on outcomes.

Examples:

### Successful strategy

```text
Intervention:
+8 min/week sustained threshold work

Observed:
10-min pace improved
recovery stable
easy HR stable

Update:
threshold response confidence ↑
```

### Failed strategy

```text
Intervention:
+15% weekly mileage

Observed:
no performance improvement
energy ↓
HR drift ↑
workout repeatability ↓

Update:
confidence in volume increase as current solution ↓
```

### Mixed response

```text
Intervention:
increased long-run duration

Observed:
durability improved
threshold performance declined slightly

Update:
useful for HM goal, potentially costly during 5K-specific phase
```

---

## 16. Major New Input / Context Change

The engine should have an event system that can reprioritize coaching.

Examples:

- injury / pain
- illness
- goal change
- race date change
- missed training block
- travel
- major life stress
- new race result
- change in available training days

### Example: new injury symptom

Before:

```text
Goal:
5K PB

Primary limiter:
Threshold

Intervention:
Increase threshold volume
```

New information:

```text
Achilles discomfort:
3/10
new
localized
impact-related
```

New priority order:

1. Manage symptom trajectory.
2. Avoid unnecessary escalation.
3. Preserve aerobic fitness where appropriate.
4. Maintain safe training exposure.
5. Resume performance progression when evidence supports it.

The performance goal remains stored but becomes temporarily subordinate.

RunLoop should not diagnose injury.

It should recognize when medical evaluation may be appropriate and avoid pretending to distinguish serious pathology from benign soreness from app data alone.

---

## 17. Adaptive Questioning

The system should ask questions only when they materially improve interpretation.

Examples:

- New pain → location, severity, persistence, impact sensitivity.
- Unexpected high HR → heat, illness, sleep, caffeine, stress.
- Slower race → weather, pacing, course, illness, race execution.
- Workout collapse → RPE, fueling, recovery, terrain.

Avoid static 20-question daily forms.

---

## 18. Confidence Framework

Each major conclusion should have a confidence score internally.

Potential contributors:

### Increase confidence

- many comparable sessions
- consistent trend
- multiple independent metrics agree
- low environmental variation
- athlete history supports interpretation
- intervention produces predicted outcome

### Decrease confidence

- few observations
- poor data quality
- large environmental differences
- conflicting signals
- unknown workout intent
- missing HR
- uncertain activity classification
- recent illness
- unfamiliar training stimulus

User-facing confidence should remain qualitative.

Example:

```json
{
  "conclusion": "aerobic_efficiency_improving",
  "confidence": "high",
  "evidence_count": 7,
  "supporting_signals": 3,
  "contradictory_signals": 0
}
```

---

## 19. Coaching Decision Hierarchy

When deciding what to recommend, the system should prioritize approximately:

1. Safety / meaningful new symptoms
2. Major recovery deterioration
3. Goal relevance
4. Current limiter
5. Athlete-specific response history
6. Training continuity
7. Adaptation opportunity
8. Optimization details

This prevents performance optimization from overriding obvious constraints.

---

## 20. Recommendation Philosophy

Recommendations should be:

- specific
- minimal
- testable
- linked to evidence
- appropriate to the athlete's goal
- appropriate to their history
- reversible where uncertainty is high

Prefer:

> Hold mileage around 40–43 km and extend sustained threshold work for three weeks.

over:

> Run more threshold and focus on recovery.

The recommendation should answer:

- what to change
- what to keep
- for how long
- what response is expected
- when to reassess

---

## 21. LLM Role

The LLM should receive structured analytical context rather than raw activity dumps whenever possible.

Example input:

```json
{
  "goal": "10K PB",
  "training_block": {
    "week": 5,
    "total_weeks": 8
  },
  "volume": {
    "current_week_km": 42.6,
    "recent_average_km": 38.2,
    "trend": "increasing"
  },
  "aerobic_efficiency": {
    "trend": "improving",
    "confidence": "moderate"
  },
  "threshold": {
    "3_min": "improving",
    "6_min": "improving",
    "10_min": "flat"
  },
  "recovery": {
    "status": "normal"
  },
  "current_hypothesis": {
    "limiter": "sustained_threshold_capacity",
    "confidence": "moderate_high"
  }
}
```

The LLM then performs:

- synthesis
- explanation
- prioritization
- conversational follow-up
- clarification questions

It should not invent missing facts.

---

## 22. Required Coach Output Structure

Internal response schema should eventually resemble:

```json
{
  "status": "on_track",
  "headline": "Your training is moving in the right direction.",
  "observations": [],
  "interpretation": "",
  "recommendation": "",
  "keep": [],
  "change": [],
  "watch": [],
  "confidence": "high",
  "evidence": [],
  "contradictions": [],
  "missing_information": [],
  "reassessment_date": null
}
```

This structured response can then power:

- Dashboard briefing
- full Coach analysis
- Ask RunLoop dialogue
- history of coaching decisions
- future outcome evaluation

---

## 23. Example Coach Briefing

### Observation

Mileage has risen gradually across five weeks. Aerobic efficiency and shorter threshold intervals are improving. Ten-minute threshold performance is essentially unchanged.

### Interpretation

The athlete appears to be absorbing the current volume successfully, but sustained threshold capacity may now be a more important limiter than total mileage.

### Recommendation

Hold weekly volume around 40–43 km and increase sustained threshold duration rather than adding more mileage.

### Evidence

- volume ↑
- HR drift ↓
- 3-min threshold ↑
- 6-min threshold ↑
- 10-min threshold →

### Confidence

Moderate-high.

### Reassessment

Evaluate after approximately three weeks of comparable threshold exposure.

---

## 24. Safety and Medical Boundary

RunLoop is a coaching system, not a diagnostic medical system.

It may:

- identify unusual symptom patterns
- recommend reducing or modifying training
- recommend medical / physiotherapy evaluation where appropriate
- track symptom response
- incorporate clinician restrictions

It should not:

- diagnose fractures, tendinopathy, illness, cardiac disease, etc.
- claim that absence of pain proves absence of injury
- override clinician advice
- make strong medical claims from Strava data

Medical uncertainty should be explicit.

---

## 25. Data Quality

Every analytical metric should ideally track data quality.

Examples:

```text
HR quality:
high / medium / poor

Weather available:
yes / no

Route elevation reliable:
yes / uncertain

Workout classification:
manual / inferred / unknown

Comparable-session count:
6
```

Bad inputs should reduce confidence rather than silently produce precise-looking conclusions.

---

## 26. Suggested Development Phases

### Phase 1 — deterministic dashboard metrics

Implement:

- weekly mileage
- training frequency
- moving time
- recent-average mileage
- basic rolling trends
- recent training
- check-in context

### Phase 2 — workout classification

Implement:

- easy
- long
- threshold
- high intensity
- race
- unknown

Allow athlete correction.

### Phase 3 — comparable-session engine

Implement:

- similarity logic
- threshold comparison
- aerobic comparison
- confidence

### Phase 4 — athlete model

Implement:

- baselines
- historical sustainable volume
- recovery behavior
- response traits
- strengths / weaknesses

### Phase 5 — coaching reasoning

Implement:

- patterns
- contradiction detection
- hypotheses
- interventions
- reassessment

### Phase 6 — LLM Coach

Implement structured prompt / response schema.

The LLM explains analytical conclusions rather than replacing the analysis engine.

### Phase 7 — closed-loop learning

Store:

- recommendation
- predicted response
- actual response
- model update

---

## 27. Engineering Questions for Review

These are deliberately unresolved and should be discussed before implementation.

1. Which Strava fields are reliably available for all users?
2. How much stream / lap data can be pulled within API limits?
3. Where should weather data come from?
4. Should environmental normalization use an explicit mathematical model, matched-session regression, or both?
5. How should activity/workout classification work?
6. How much manual athlete correction should be supported?
7. What minimum sample size should each metric require?
8. How should confidence be computed?
9. How should learned athlete traits be persisted?
10. Should interventions be stored as explicit database entities?
11. How should RunLoop distinguish planned workouts from accidental hard running?
12. How should race-specific goal weighting be represented?
13. What parts belong in deterministic code vs LLM reasoning?
14. How should model outputs be validated before being shown?
15. How should analysis behave when HR data is absent?
16. How should treadmill runs be handled?
17. How should trail / highly technical terrain be handled?
18. How should sensor errors and bad GPS data be detected?
19. How much historical data is needed before individualization becomes meaningful?
20. What is the simplest viable version that can be tested on real athletes?

---

## 28. Non-Goals for Initial Implementation

Do not begin by building:

- a fully autonomous training-plan generator
- a proprietary readiness score
- a black-box injury prediction score
- perfect weather-adjusted equivalent pace
- a giant ML model
- a social feed
- gamification
- dozens of obscure metrics

The first useful version should reliably answer:

> **Is the athlete improving, stagnating, or deteriorating — what evidence supports that — and what is the smallest reasonable change to test next?**

---

## 29. Definition of Success

RunLoop is working when it can look at a case such as:

> “I am running more than ever, but my 10K got 1:30 slower.”

and respond with something substantially better than:

> “Keep being consistent.”

A successful system should inspect the athlete's training history, adaptation markers, recovery, environment, goal specificity, and previous response patterns and produce a clear, defensible conclusion such as:

> Your total training volume increased, but your threshold performance, aerobic efficiency, and recovery markers all deteriorated during the same period. The additional mileage is therefore not currently translating into useful 10K fitness. Hold volume rather than increasing it further, reduce accumulated fatigue, and restore one high-quality threshold session before reassessing.

Or, where appropriate:

> The slower race result conflicts with the rest of your training data. Your threshold pace and aerobic efficiency both improved, while race-day conditions were substantially hotter. The race result alone is weak evidence that your fitness declined.

That combination of **individualization, contradiction detection, uncertainty, and closed-loop learning** is the core product advantage RunLoop should aim to build.

---

## 30. Next Review

Before implementation, review this document for:

- feasibility with available Strava/API data
- database implications
- computational complexity
- API cost
- weather-data requirements
- privacy implications
- LLM cost
- which calculations can be implemented deterministically
- which assumptions need validation with coaches / literature
- smallest viable analysis engine for testing

This specification is intentionally a product / reasoning proposal, not an instruction to implement every idea exactly as written.
