import type { SeverityValue } from "@/lib/checkin/checkin";
import { severityOrdinal, type RecoveryDay } from "./recovery";

// Deterministic recovery facts for the Coach page (no interpretation, no
// recommendations — those require the reasoning engine). All averages are
// gated behind a minimum sample so a single check-in never presents as a
// pattern.
export const MIN_CHECKINS_FOR_AVERAGE = 4;

export interface RecoverySummary {
  windowDays: number;
  checkinCount: number;
  energyCount: number;
  avgEnergy: number | null; // 1 decimal, null below minimum
  sleepCount: number;
  avgSleepMinutes: number | null; // rounded, null below minimum
  sorenessDays: number; // severity above NONE
  symptomDays: number; // severity above NONE
  worstSymptoms: SeverityValue | null;
}

export function summarizeRecoveryDays(
  days: RecoveryDay[],
  windowDays: number,
): RecoverySummary {
  const energies = days.flatMap((d) => (d.energy != null ? [d.energy] : []));
  const sleeps = days.flatMap((d) =>
    d.sleepMinutes != null ? [d.sleepMinutes] : [],
  );
  const sorenessDays = days.filter(
    (d) => (severityOrdinal(d.soreness) ?? 0) > 0,
  ).length;
  const symptomatic = days.filter(
    (d) => (severityOrdinal(d.symptoms) ?? 0) > 0,
  );
  const worstSymptoms = symptomatic.reduce<SeverityValue | null>(
    (worst, d) =>
      worst == null ||
      (severityOrdinal(d.symptoms) ?? 0) > (severityOrdinal(worst) ?? 0)
        ? d.symptoms
        : worst,
    null,
  );

  return {
    windowDays,
    checkinCount: days.length,
    energyCount: energies.length,
    avgEnergy:
      energies.length >= MIN_CHECKINS_FOR_AVERAGE
        ? Math.round((energies.reduce((a, b) => a + b, 0) / energies.length) * 10) / 10
        : null,
    sleepCount: sleeps.length,
    avgSleepMinutes:
      sleeps.length >= MIN_CHECKINS_FOR_AVERAGE
        ? Math.round(sleeps.reduce((a, b) => a + b, 0) / sleeps.length)
        : null,
    sorenessDays,
    symptomDays: symptomatic.length,
    worstSymptoms,
  };
}

export function severityLabel(value: SeverityValue): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function formatSleep(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

// Plain factual bullets — every claim carries its own sample size so the UI
// never needs a separate (possibly fabricated) confidence badge.
export function recoveryObservationBullets(summary: RecoverySummary): string[] {
  const bullets: string[] = [];

  if (summary.checkinCount === 0) {
    return [
      `No check-ins in the last ${summary.windowDays} days yet.`,
    ];
  }

  if (summary.avgEnergy != null) {
    bullets.push(
      `Average energy ${summary.avgEnergy.toFixed(1)}/5 across ${summary.energyCount} check-ins in the last ${summary.windowDays} days.`,
    );
  } else if (summary.energyCount > 0) {
    // Attribute the shortage to answered fields, not check-ins: 10 rows with
    // 1 energy answer means sparse answers, not insufficient check-ins.
    bullets.push(
      `Only ${summary.energyCount} of ${summary.checkinCount} check-ins logged energy — not enough for an average yet (need ${MIN_CHECKINS_FOR_AVERAGE}).`,
    );
  } else {
    bullets.push(`No energy logged in the last ${summary.windowDays} days.`);
  }

  if (summary.avgSleepMinutes != null) {
    bullets.push(
      `Average sleep ${formatSleep(summary.avgSleepMinutes)} across ${summary.sleepCount} nights.`,
    );
  } else if (summary.sleepCount > 0) {
    bullets.push(
      `Only ${summary.sleepCount} of ${summary.checkinCount} check-ins logged sleep — not enough for an average yet (need ${MIN_CHECKINS_FOR_AVERAGE}).`,
    );
  } else {
    bullets.push(`No sleep logged in the last ${summary.windowDays} days.`);
  }

  if (summary.symptomDays > 0) {
    bullets.push(
      `${summary.symptomDays} of ${summary.checkinCount} days with symptoms above none` +
        (summary.worstSymptoms
          ? ` (highest: ${summary.worstSymptoms.toLowerCase()}).`
          : "."),
    );
  }

  if (summary.sorenessDays > 0) {
    bullets.push(
      `${summary.sorenessDays} of ${summary.checkinCount} days with soreness above none.`,
    );
  }

  return bullets;
}
