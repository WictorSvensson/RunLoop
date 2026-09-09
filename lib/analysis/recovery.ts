import type { DailyCheckin } from "@/generated/prisma/client";
import { toDateKeyUTC } from "@/lib/checkin/checkin";
import type {
  SeverityValue,
  SleepQualityValue,
} from "@/lib/checkin/checkin";

// Native-scale daily recovery input for the deterministic engine (Phase 1:
// check-in adapter).
//
// Scales are preserved exactly as stored — energy 1-5, sleep in minutes,
// Prisma enum labels — with NO inversion or rescaling (product decision: keep
// the native 1-5 energy scale rather than mapping onto a 10-point fatigue
// scale). Numeric ordinals for trend math are derived on demand via the
// explicit ordinal helpers below, so engine stages can choose the raw or the
// ordinal view without a lossy stored transform in between.
//
// Pure module: no Prisma client import, safe for client islands and unit
// tests alike.
export interface RecoveryDay {
  dateKey: string; // YYYY-MM-DD (UTC calendar day)
  energy: number | null; // 1-5 native
  sleepMinutes: number | null;
  sleepQuality: SleepQualityValue | null;
  soreness: SeverityValue | null;
  symptoms: SeverityValue | null;
  weightKg: number | null;
  notes: string | null;
}

export function toRecoveryDay(checkin: DailyCheckin): RecoveryDay {
  return {
    dateKey: toDateKeyUTC(checkin.date),
    energy: checkin.energy,
    sleepMinutes: checkin.sleepDuration,
    sleepQuality: checkin.sleepQuality,
    soreness: checkin.soreness,
    symptoms: checkin.symptoms,
    weightKg: checkin.weight,
    notes: checkin.notes,
  };
}

const SEVERITY_ORDER: readonly SeverityValue[] = [
  "NONE",
  "MILD",
  "MODERATE",
  "HIGH",
];

const SLEEP_QUALITY_ORDER: readonly SleepQualityValue[] = [
  "POOR",
  "OKAY",
  "GOOD",
  "EXCELLENT",
];

// Ordinal position for trend math. NOTE the opposite polarities: higher
// severity = worse, higher sleep quality = better. Never diff raw ordinals
// across the two scales — compare within one scale only.
// Null stays null, and unknown runtime values (casts, future enum variants)
// map to null too: absence of data must never read as a value (indexOf would
// otherwise yield -1, sorting "better than NONE").
export function severityOrdinal(value: SeverityValue | null): number | null {
  if (value == null) return null;
  const index = SEVERITY_ORDER.indexOf(value);
  return index === -1 ? null : index;
}

export function sleepQualityOrdinal(
  value: SleepQualityValue | null,
): number | null {
  if (value == null) return null;
  const index = SLEEP_QUALITY_ORDER.indexOf(value);
  return index === -1 ? null : index;
}

// Whether the day carries any user-provided signal at all. Notes count: a
// notes-only check-in is still context (future missing-data logic treats a
// fully blank day differently from a notes-only one).
export function hasAnyRecoverySignal(day: RecoveryDay): boolean {
  return (
    day.energy != null ||
    day.sleepMinutes != null ||
    day.sleepQuality != null ||
    day.soreness != null ||
    day.symptoms != null ||
    day.weightKg != null ||
    day.notes != null
  );
}
