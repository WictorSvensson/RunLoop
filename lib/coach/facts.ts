// Server-only facts assembly for the coach page and the brief generator.
// Same deterministic bullets the page renders — the LLM prompt and the UI
// can never disagree because both read from here.
import { prisma } from "@/lib/prisma";
import { formatPaceFromSecPerKm } from "@/lib/format";
import {
  computePaceTrend,
  computeVolumeChange,
  windowStartUTC,
} from "@/lib/dashboard/aggregate";
import { RUNNING_TYPES } from "@/lib/running-types";
import { toRecoveryDay } from "@/lib/analysis/recovery";
import {
  recoveryObservationBullets,
  summarizeRecoveryDays,
} from "@/lib/analysis/recovery-summary";
import type { CoachFacts } from "./prompt";

export const RECOVERY_WINDOW_DAYS = 14;
export const TRAINING_WEEKS = 12;
// Same minimum-sample discipline as /analytics: an earlier-vs-later
// comparison with fewer runs per side is an anecdote, not a signal.
export const MIN_RUNS_PER_HALF = 2;

export async function getCoachFacts(
  userId: string,
  now: Date = new Date(),
): Promise<CoachFacts> {
  // Floored to UTC midnight: DailyCheckin.date is @db.Date (midnight UTC),
  // so a bound carrying the current time-of-day would silently exclude the
  // boundary day while the copy still claims a full 14-day window.
  const recoverySince = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - RECOVERY_WINDOW_DAYS,
    ),
  );
  const trainingSince = windowStartUTC(TRAINING_WEEKS, now);

  const [checkinRows, activities] = await Promise.all([
    prisma.dailyCheckin.findMany({
      where: { userId, date: { gte: recoverySince } },
      orderBy: { date: "desc" },
    }),
    prisma.activity.findMany({
      where: {
        userId,
        startDate: { gte: trainingSince },
        type: { in: [...RUNNING_TYPES] },
      },
      orderBy: { startDate: "desc" },
    }),
  ]);

  const recovery = recoveryObservationBullets(
    summarizeRecoveryDays(
      checkinRows.map(toRecoveryDay),
      RECOVERY_WINDOW_DAYS,
    ),
  );

  // Sentence shapes intentionally differ from /analytics (single evidentiary
  // bullets here vs styled trend blocks there); the shared part is the math +
  // gating, not the copy.
  const training: string[] = [];
  const volumeChange = computeVolumeChange(activities, TRAINING_WEEKS, now);
  const paceTrend = computePaceTrend(activities, TRAINING_WEEKS, now);
  const enoughRuns =
    volumeChange.earlierRunCount >= MIN_RUNS_PER_HALF &&
    volumeChange.laterRunCount >= MIN_RUNS_PER_HALF;

  if (enoughRuns) {
    if (volumeChange.deltaPct != null) {
      training.push(
        `Volume ${volumeChange.deltaPct >= 0 ? "up" : "down"} ${Math.abs(volumeChange.deltaPct)}% ` +
          `(${volumeChange.earlierAvgKmPerWeek} km/week across ${volumeChange.earlierRunCount} runs ` +
          `vs ${volumeChange.laterAvgKmPerWeek} km/week across ${volumeChange.laterRunCount} runs, ` +
          `first vs second half of ${TRAINING_WEEKS} weeks).`,
      );
    } else if (volumeChange.earlierRunCount === 0) {
      training.push(
        `Started running again after a gap (${volumeChange.laterRunCount} runs in the second half of ${TRAINING_WEEKS} weeks).`,
      );
    } else {
      training.push("No running volume in this window.");
    }
  }
  if (
    paceTrend.deltaSecPerKm != null &&
    paceTrend.earlierRunCount >= MIN_RUNS_PER_HALF &&
    paceTrend.laterRunCount >= MIN_RUNS_PER_HALF
  ) {
    training.push(
      `Average pace ${paceTrend.deltaSecPerKm <= 0 ? "improved" : "slowed"} by ` +
        `${Math.abs(Math.round(paceTrend.deltaSecPerKm))} sec/km ` +
        `(now ${formatPaceFromSecPerKm(paceTrend.avgPaceSecPerKm)}/km across all runs — ` +
        `easy vs quality sessions aren't distinguished yet).`,
    );
  }
  if (training.length === 0) {
    training.push(
      "Not enough running history on both sides of the window for a volume or pace comparison yet.",
    );
  }

  return { recovery, training };
}
