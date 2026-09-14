export type ConfidenceLevel =
  | "low"
  | "moderate"
  | "high"
  | "repeatedly-demonstrated";

export type GoalType =
  | "general-fitness"
  | "5k"
  | "10k"
  | "half-marathon"
  | "marathon"
  | "other";

export type PerformancePriority =
  | "general-fitness"
  | "balanced"
  | "performance";

export interface AthleteGoal {
  type: GoalType;
  priority: PerformancePriority;
  targetDate?: string;
  targetTimeSeconds?: number;
  description?: string;
}

export interface AthletePreferences {
  coachingDepth: "minimal" | "normal" | "deep";
  coachingTone: "supportive" | "balanced" | "direct";
  wantsBenchmarkSessions: boolean;
  preferredTrainingDays?: number;
}

export interface AthleteProfile {
  id: string;
  name: string;

  experience:
    | "new"
    | "recreational"
    | "experienced"
    | "competitive";

  goal: AthleteGoal;
  preferences: AthletePreferences;
}

export interface RunActivity {
  id: string;
  date: string;

  distanceKm: number;
  durationMinutes: number;

  averageHeartRate?: number;
  averagePaceSecondsPerKm?: number;

  rpe?: number;

  intendedType?:
    | "easy"
    | "steady"
    | "threshold"
    | "vo2"
    | "interval"
    | "long-run"
    | "race"
    | "benchmark"
    | "unknown";

  executionQuality?: "below-target" | "on-target" | "above-target";

  temperatureC?: number;

  elevationGainMeters?: number;
}

export interface DailyContext {
  date: string;

  sleepHours?: number;
  sleepQuality?: number;

  fatigue?: number;
  stress?: number;

  restingHeartRate?: number;
  hrv?: number;

  notes?: string;
}

export interface TrainingBlock {
  startDate: string;
  expectedEndDate: string;

  purpose:
    | "base"
    | "threshold"
    | "speed"
    | "race-specific"
    | "recovery"
    | "mixed";

  plannedWeeks: number;
}

export interface AnalysisInput {
  athlete: AthleteProfile;

  activities: RunActivity[];
  dailyContext: DailyContext[];

  currentBlock?: TrainingBlock;
}

export interface MetricTrend {
  metric: string;

  currentValue?: number;
  previousValue?: number;

  direction:
    | "improving"
    | "stable"
    | "declining"
    | "unknown";

  confidence: ConfidenceLevel;

  explanation: string;
}

export interface Finding {
  id: string;

  title: string;
  detail: string;

  type:
    | "positive"
    | "neutral"
    | "attention"
    | "warning";

  confidence: ConfidenceLevel;

  evidence: string[];
}

export interface Recommendation {
  action:
    | "continue"
    | "reduce-load"
    | "increase-load"
    | "change-stimulus"
    | "collect-more-data"
    | "benchmark";

  headline: string;

  explanation: string;

  parameters?: string[];

  confidence: ConfidenceLevel;
}

export interface MissingDataRequest {
  field: string;

  reason: string;

  importance:
    | "low"
    | "moderate"
    | "high";
}

export interface CoachAnalysis {
  summary: string;

  recommendation: Recommendation;

  findings: Finding[];

  trends: MetricTrend[];

  missingData: MissingDataRequest[];

  uncertainty: string[];
}
