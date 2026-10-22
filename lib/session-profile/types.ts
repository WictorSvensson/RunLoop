// SessionProfile v0.1 types — structured, multi-dimensional description of a
// single training session, per RUNLOOP_SESSIONPROFILE_FORTYDLIGANDE.md §1-4
// and Docs/RUNLOOP_ANALYSIS_ENGINE_SPEC.md (§2.4 explicit uncertainty, §6.4
// threshold features, §6.6 intensity classes, §18 confidence, §25 quality).
//
// Scope: broad session types only (no WeekProfile/Block/Athlete Model). Every
// uncertain dimension must say so explicitly — honest unknown/low-confidence
// states over fabricated precision.

/** Broad session types for v0.1. Finer splits (VO2 vs threshold, progression
 *  vs steady) are deliberately out of scope until the gold-set loop (§5 of the
 *  förtydligande) proves the broad layer trustworthy. */
export type SessionClass =
  | "easy-recovery"
  | "long"
  | "threshold-tempo"
  | "interval"
  | "race-benchmark"
  | "mixed"
  | "unknown";

/** Qualitative confidence only (§2.4/§18) — never a fake-precision percent. */
export type Confidence = "high" | "moderate" | "low" | "insufficient";

/** Coarse stimulus/cost level. "unknown" means no supporting evidence, not zero. */
export type Level = "high" | "moderate" | "low" | "unknown";

/** Data-quality readout per §25. Bad inputs must cap confidence, never render
 *  as precise-looking conclusions. */
export type DataQuality = "high" | "medium" | "poor";

/** Minimal activity shape for profiling. Prisma `Activity` and `ActivityDTO`
 *  both satisfy this structurally — callers pass real rows straight in. */
export interface SessionActivityInput {
  type: string | null;
  name: string | null;
  description: string | null;
  distance: number | null; // meters
  movingTime: number | null; // seconds
  elapsedTime: number | null; // seconds
  averageSpeed: number | null; // m/s
  maxSpeed: number | null; // m/s
  averageHeartrate: number | null; // bpm
  maxHeartrate: number | null; // bpm
  totalElevationGain: number | null; // meters
  averageTemp: number | null; // celsius
}

/** Minimal lap shape. `ActivityLapDTO` satisfies this (it carries measured
 *  movingTime/elapsedTime straight from the `ActivityLap` rows). When both
 *  time fields are absent, durations are derived distance/pace estimates
 *  (see profile.ts) — never silently treated as measured. */
export interface SessionLapInput {
  lapIndex: number;
  distance: number | null; // meters
  movingTime?: number | null; // seconds, when the source row carries it
  elapsedTime?: number | null; // seconds, fallback only
  averageSpeed: number | null; // m/s
  averageHeartrate: number | null; // bpm
}

/** Raw `ActivityStream.payload` (Json). Keys observed in this repo:
 *  GPX-backed paths store `time/distance/heartrate/altitude` plus FIT
 *  gap-fill keys `fitTime/cadence/watts/speed` (GPX stays the source of truth
 *  for HR/elevation, so FIT heartrate/altitude are intentionally not stored
 *  there); FIT-only sync paths (`lib/garmin/import.ts`,
 *  `lib/suunto/import.ts`) store `fitTime/distance/cadence/watts` plus
 *  granular `heartrate/altitude/speed` via `fitStreamPayload` — i.e. HR
 *  series may still be ABSENT on older rows and pace must be derived from
 *  distance/time deltas. Parsed defensively; unknown keys are ignored. */
export type SessionStreamsInput = Record<string, unknown> | null;

/** What physically happened, detected BEFORE any classification. HR is one
 *  signal among laps/structure/pace — never the whole algorithm. */
export interface SessionStructure {
  hasStructure: boolean;
  kind: "interval" | "continuous" | "unclear";
  workCount: number;
  recoveryCount: number;
  medianWorkSec: number | null;
  medianRecoverySec: number | null;
  paceStability: "steady" | "variable" | "uneven" | "unknown";
  /** Coefficient of variation of work/steady pace, null when unmeasurable. */
  paceCv: number | null;
  hrProgression: "rising" | "stable" | "falling" | "unknown";
  lateDeterioration: "stable" | "deteriorating" | "progressive" | "unknown";
  warmupDetected: boolean;
  cooldownDetected: boolean;
  /** True when substantial stops are hidden inside the timed laps (summed
   *  lap elapsed well above summed lap moving time, e.g. auto-pause
   *  recoveries averaged into 1 km auto-laps). A steady lap split is then
   *  an averaging artefact — work and rest were blended into the same
   *  laps — so laps alone cannot tell a steady run from sub-lap
   *  intervals. Classification must refuse a steady-easy reading when
   *  set (honest unknown), and must NOT claim intervals from it either —
   *  that needs sub-lap stream segmentation. */
  hiddenRestDetected: boolean;
  /** True when the interval structure was recovered from sub-lap paused-clock
   *  segmentation (FIT/fitTime recording gaps + distance-frozen splits) rather
   *  than lap-level work/recovery alternation — e.g. a watch on auto-pause
   *  erases rests from both the lap split and the speed stream, so steady
   *  auto-laps hide the work bouts. Work/recovery boundaries are then
   *  recording pauses, not coach-prescribed reps: classification must cap
   *  confidence at moderate and say so. HR corroborates the recovery, never
   *  drives it alone. */
  gapRecovered: boolean;
  notes: string[];
}

export interface SessionExecution {
  consistency: "steady" | "uneven" | "deteriorated" | "unclear";
  detail: string;
}

export interface SessionStimulus {
  threshold: Level;
  aerobic: Level;
  detail: string;
}

export interface SessionCost {
  mechanical: Level;
  /** v0.1 invariant: ALWAYS "unknown" — no RPE, check-in, or HR-recovery
   *  evidence is wired, and recovery must never be inferred from load alone. */
  recovery: "unknown";
  recoveryReason: string;
  detail: string;
}

export interface SessionProfile {
  classification: SessionClass;
  confidence: Confidence;
  structure: SessionStructure;
  execution: SessionExecution;
  stimulus: SessionStimulus;
  cost: SessionCost;
  dataQuality: DataQuality;
  /** What the profiler could NOT determine — first-class output (§2.4). */
  uncertainty: string[];
  /** Human-readable observations backing the conclusions, with numbers. */
  evidence: string[];
}
