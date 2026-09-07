# Runloop — AI Running & Recovery Coach

> **Note (stale tech-stack section):** The "Technology Stack" section below lists Supabase (Postgres + Auth + RLS). The actual implementation uses **Prisma + a local Postgres instance via docker-compose**, with a single hardcoded dev user until real auth is built — see `AGENTS.md` for the accurate, current architecture. The product goal, design direction, and philosophy sections below remain accurate and are not affected by this.

## Project Goal

Build a beautiful, modern web app called **Runloop** that acts as a personal long-term running coach.

The app should collect daily health/recovery data and training data, store it securely per user, analyze longitudinal trends, and eventually provide intelligent coaching recommendations.

The philosophy is:

> **Don't build a chatbot that gives generic running advice. Build a longitudinal training intelligence system that understands the individual athlete.**

The app should eventually be usable by multiple users, with each user's data completely isolated.

---

# Technology Stack

Use:

- **Next.js**
- **TypeScript**
- **Tailwind CSS**
- **Supabase**
  - PostgreSQL database
  - Authentication
  - Row Level Security (RLS)
- **Vercel** for deployment
- **GitHub** for source control
- **OpenAI API** for future AI coaching/analysis
- **Strava** as the first training-data integration
- **COROS** as a likely first wearable integration
- Garmin later

A Next.js + Supabase starter template has already been created.

Do not replace the existing project architecture unnecessarily.

---

# Design Direction

The UI should feel:

- Premium
- Calm
- Modern
- Minimal
- Athletic without looking like a Garmin dashboard
- Slightly "lo-fi luxury"
- Beautiful enough that a user thinks: **"Fuck me, this is sick."**

Visual direction:

- Dark charcoal backgrounds
- Warm cream/off-white text
- Muted teal/lavender accents
- Subtle gradients
- Large typography
- Generous whitespace
- Restrained animations
- Beautiful charts
- Clean cards
- Minimal clutter

Avoid:

- Clinical medical-dashboard aesthetics
- Excessive green/red status indicators
- "Readiness score: 74" type anxiety-inducing UI
- Overly dense dashboards
- Generic SaaS appearance

The application should feel like a **premium running journal + intelligent coach**, not a spreadsheet.

---

# V1 Product

Build the first functional vertical slice before implementing complex analytics.

## Main Navigation

The initial application should have:

1. Dashboard
2. Daily Check-in
3. Training
4. Analytics
5. Coach

---

# Dashboard

The dashboard should eventually show:

- Greeting
- Current weight
- Recent sleep
- Energy
- Current week's running
- Number of runs
- Weekly distance
- Recent training
- Current injury/symptom status
- Coach observation

Example structure:

```text
Good evening, Kevin.

You're building consistency.
                   

This week
32.4 km       4 runs
2h 47m        0 quality sessions


Recovery
Weight       75.2 kg
Sleep        7h 12m
Energy       8/10


Coach
"Your easy running has been remarkably consistent
over the last three weeks. Let's keep resisting the
urge to add intensity."
```

The coach section should eventually be generated from actual longitudinal data.

---

# Daily Check-in

The daily check-in must take **less than one minute**.

Fields:

- Date
- Body weight
- Sleep duration
- Subjective sleep quality
- Energy
- General soreness
- Injury/symptom score
- Notes

Example:

```text
How are you feeling today?

Weight
[ 75.2 kg ]

Sleep
[ 7h 12m ]

Sleep quality
○ Poor   ○ Okay   ● Good   ○ Excellent

Energy
○ 1  ○ 2  ○ 3  ○ 4  ● 5

Soreness
○ None ○ Mild ○ Moderate ○ High

Symptoms
○ None ○ Mild ○ Moderate ○ High

Notes
[                       ]

                 Save check-in
```

The form should save the data to Supabase.

---

# Training

Training data will eventually be imported automatically from Strava/COROS/Garmin.

Each activity should support:

- Date
- Distance
- Duration
- Average pace
- Average HR
- Maximum HR
- Elevation
- Surface
- Shoes
- RPE
- Workout type
- Quality minutes
- Symptoms during run
- Symptoms immediately after
- Symptoms next morning
- Notes

The system should support:

- Easy run
- Long run
- Threshold/sub-threshold
- Intervals
- Race
- Recovery
- Other

---

# Analytics

Eventually analyze:

### Training load

- Weekly distance
- Weekly duration
- Rolling 7-day load
- Rolling 28-day load
- Run frequency
- Long-run duration
- Easy vs quality time
- Threshold volume
- Strength training

### Performance

Look for:

- Pace vs HR
- HR drift / decoupling
- RPE vs pace
- Threshold progression
- Race performance
- Easy pace progression
- Long-run performance
- Training consistency

### Recovery

Compare:

- Sleep
- Subjective sleep quality
- Energy
- Weight
- Soreness
- Symptoms
- Training load
- Performance

The system should search for relationships that a human might miss.

Example:

> "Your average HR on easy runs has increased ~6 bpm over the last six weeks while pace has slowed ~12 sec/km. This coincides with a gradual increase in weekly running volume and declining subjective sleep quality."

Do not make claims unless sufficient data exists.

Always distinguish:

- Observation
- Hypothesis
- Confidence

---

# Coach

The Coach page should NOT initially be a generic chatbot.

Instead, create a structured longitudinal coaching model:

```text
Observations
Hypotheses
Recommendations
Watch items
Confidence
```

Example:

```text
OBSERVATION

Your easy-run HR has gradually increased over the
last four weeks despite similar pace.

CONFIDENCE
High

POSSIBLE EXPLANATION

This coincides with increased weekly volume.

CONFIDENCE
Moderate

RECOMMENDATION

Keep the next week aerobic and avoid adding another
quality session until the trend stabilizes.
```

Eventually the OpenAI API should interpret the statistical findings and turn them into natural coaching language.

---

# Database

Use PostgreSQL/Supabase.

Initial conceptual schema:

```text
users
profiles

daily_checkins

activities
activity_laps

strength_sessions

symptoms

body_metrics

wearable_connections

coach_observations
coach_hypotheses
coach_recommendations
```

Every user-owned record must contain a user identifier and be protected with **Supabase Row Level Security**.

Users must never be able to access another user's data.

Do not expose Supabase service-role/secret keys to the browser.

Use environment variables for secrets.

---

# Authentication

Use Supabase Auth.

Initial requirements:

- Sign up
- Log in
- Log out
- Protected application routes
- User-specific database records

The existing Supabase/Next.js authentication template should be reused rather than reinvented.

---

# AI Architecture

Do NOT start with machine learning.

Initial architecture:

```text
Raw training/recovery data
        ↓
Deterministic calculations
        ↓
Statistical trend detection
        ↓
Interesting findings
        ↓
OpenAI interpretation
        ↓
Coach observations/recommendations
```

The system should first calculate facts reliably.

Examples:

- weekly mileage
- rolling mileage
- pace trends
- HR trends
- HR drift
- training frequency
- quality volume
- weight trend
- symptom trends

Then the AI can interpret those facts.

Eventually, with enough data, predictive models can be added for:

- fatigue
- injury risk signals
- individual training response
- recovery patterns
- performance prediction

Do not add fake "AI" features simply for marketing.

---

# Important Coaching Philosophy

The application is designed around long-term endurance development.

The athlete's eventual training philosophy may use **Norwegian Singles Method-style sub-threshold training**, but the system should NOT assume the athlete is ready for that immediately.

The general progression is:

```text
Durability
    ↓
Consistent easy running
    ↓
Increasing aerobic volume
    ↓
Controlled sub-threshold work
    ↓
Performance development
    ↓
Race-specific training
```

The system should prioritize:

1. Consistency
2. Injury durability
3. Aerobic development
4. Recovery
5. Performance

Avoid encouraging excessive intensity simply because the user feels good on one day.

---

# User Experience Philosophy

The app should reduce anxiety rather than create it.

Wearable sleep data should be **optional evidence**, not a verdict.

Subjective sleep quality should be supported because athletes can become psychologically stressed by poor wearable sleep scores.

Do not force users to wear a watch 24/7.

The system should eventually learn whether a particular user's sleep metrics actually correlate with their performance/recovery.

---

# First Development Milestone

Do NOT build the entire application at once.

Build this first:

### Milestone 1

1. Authentication works.
2. User can access a protected dashboard.
3. Dashboard has the Runloop visual design.
4. Daily Check-in page exists.
5. User can submit:
   - weight
   - sleep duration
   - sleep quality
   - energy
   - soreness
   - symptoms
   - notes
6. Data is stored in Supabase.
7. User can see their most recent check-in on the dashboard.
8. RLS prevents users from accessing each other's records.

Once that works, build Training.

Then Analytics.

Then Coach.

Then external integrations.

---

# Development Rules

- Keep the code clean and maintainable.
- Use TypeScript properly.
- Prefer reusable components.
- Do not duplicate logic.
- Do not hardcode user-specific data.
- Use Supabase for persistent data.
- Keep secrets server-side.
- Use RLS for user isolation.
- Do not introduce unnecessary dependencies.
- Explain major architectural decisions in comments/documentation where useful.
- Make the UI responsive.
- Design mobile-first where practical.
- Never sacrifice security for convenience.

Most importantly:

**Build incrementally and keep the application working after every major change.**

Before implementing a feature, inspect the existing project structure and reuse existing components/utilities where appropriate.

When something is ambiguous, choose the simplest maintainable implementation that fits the architecture above rather than introducing unnecessary complexity.