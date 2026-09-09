import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { formatPaceFromSecPerKm } from "@/lib/format";
import {
  computePaceTrend,
  computeVolumeChange,
  windowStartUTC,
} from "@/lib/dashboard/aggregate";
import { RUNNING_TYPES } from "@/lib/running-types";
import { getAnalysisCoverage } from "@/lib/strava/analysis-data";
import { toRecoveryDay } from "@/lib/analysis/recovery";
import {
  recoveryObservationBullets,
  summarizeRecoveryDays,
} from "@/lib/analysis/recovery-summary";

// Live DB state on every load: recent check-ins, running activities, and
// analysis-data readiness. Must not be statically prerendered.
export const dynamic = "force-dynamic";

const RECOVERY_WINDOW_DAYS = 14;
const TRAINING_WEEKS = 12;
// Same minimum-sample discipline as /analytics: an earlier-vs-later
// comparison with fewer runs per side is an anecdote, not a signal.
const MIN_RUNS_PER_HALF = 2;

export default async function CoachPage() {
  const user = await getOrCreateCurrentUser();
  const now = new Date();

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

  const [checkinRows, activities, coverage] = await Promise.all([
    prisma.dailyCheckin.findMany({
      where: { userId: user.id, date: { gte: recoverySince } },
      orderBy: { date: "desc" },
    }),
    prisma.activity.findMany({
      where: {
        userId: user.id,
        startDate: { gte: trainingSince },
        type: { in: [...RUNNING_TYPES] },
      },
      orderBy: { startDate: "desc" },
    }),
    getAnalysisCoverage(user.id),
  ]);

  // --- Recovery observations (deterministic facts from check-ins) ---
  const recoverySummary = summarizeRecoveryDays(
    checkinRows.map(toRecoveryDay),
    RECOVERY_WINDOW_DAYS,
  );
  const recoveryBullets = recoveryObservationBullets(recoverySummary);

  // --- Training observations (same pure math as /analytics) ---
  // NOTE: sentence shapes intentionally differ from /analytics (single
  // evidentiary bullets here vs styled trend blocks there); the shared part
  // is the math + gating, not the copy.
  const trainingBullets: string[] = [];
  const volumeChange = computeVolumeChange(activities, TRAINING_WEEKS, now);
  const paceTrend = computePaceTrend(activities, TRAINING_WEEKS, now);
  const enoughRuns =
    volumeChange.earlierRunCount >= MIN_RUNS_PER_HALF &&
    volumeChange.laterRunCount >= MIN_RUNS_PER_HALF;

  if (enoughRuns) {
    if (volumeChange.deltaPct != null) {
      trainingBullets.push(
        `Volume ${volumeChange.deltaPct >= 0 ? "up" : "down"} ${Math.abs(volumeChange.deltaPct)}% ` +
          `(${volumeChange.earlierAvgKmPerWeek} km/week across ${volumeChange.earlierRunCount} runs ` +
          `vs ${volumeChange.laterAvgKmPerWeek} km/week across ${volumeChange.laterRunCount} runs, ` +
          `first vs second half of ${TRAINING_WEEKS} weeks).`,
      );
    } else if (volumeChange.earlierRunCount === 0) {
      trainingBullets.push(
        `Started running again after a gap (${volumeChange.laterRunCount} runs in the second half of ${TRAINING_WEEKS} weeks).`,
      );
    } else {
      trainingBullets.push("No running volume in this window.");
    }
  }
  if (
    paceTrend.deltaSecPerKm != null &&
    paceTrend.earlierRunCount >= MIN_RUNS_PER_HALF &&
    paceTrend.laterRunCount >= MIN_RUNS_PER_HALF
  ) {
    trainingBullets.push(
      `Average pace ${paceTrend.deltaSecPerKm <= 0 ? "improved" : "slowed"} by ` +
        `${Math.abs(Math.round(paceTrend.deltaSecPerKm))} sec/km ` +
        `(now ${formatPaceFromSecPerKm(paceTrend.avgPaceSecPerKm)}/km across all runs — ` +
        `easy vs quality sessions aren't distinguished yet).`,
    );
  }
  if (trainingBullets.length === 0) {
    trainingBullets.push(
      "Not enough running history on both sides of the window for a volume or pace comparison yet.",
    );
  }

  const observations = [...recoveryBullets, ...trainingBullets];
  const readinessPct =
    coverage.totalRuns === 0
      ? 0
      : Math.round((coverage.analysisReady / coverage.totalRuns) * 1000) / 10;

  return (
    <div className="route-wrap">
      <div className="route-intro">
        <p className="eyebrow">A considered read of your data</p>
        <h1>Coach</h1>
        <p className="subtle">
          Just observations for now — no hypotheses yet, no next move prescribed.
        </p>
      </div>
      <div className="coach-stack">
        <article className="coach-insight">
          <div className="insight-label">
            <span className="insight-number">01</span>
            <span className="eyebrow">Observations</span>
          </div>
          <div className="insight-body">
            <h2>What your data currently says.</h2>
            <ul className="coach-facts">
              {observations.map((bullet, index) => (
                <li key={`${index}-${bullet.slice(0, 24)}`}>{bullet}</li>
              ))}
            </ul>
          </div>
        </article>
        <article className="coach-insight">
          <div className="insight-label">
            <span className="insight-number">02</span>
            <span className="eyebrow">Interpretation</span>
          </div>
          <div className="insight-body">
            <h2>Not available yet.</h2>
            <p className="subtle">
              Connecting these observations into explanations — fatigue vs
              fitness, load vs recovery — needs the reasoning engine, which
              isn&apos;t built yet. Until then this page reports facts only,
              never guesses.
            </p>
          </div>
        </article>
        <article className="coach-insight">
          <div className="insight-label">
            <span className="insight-number">03</span>
            <span className="eyebrow">Recommendation</span>
          </div>
          <div className="insight-body">
            <h2>Not available yet.</h2>
            <p className="subtle">
              The smallest useful change to test next will appear here once
              workout classification and trend reasoning land. Meanwhile,{" "}
              <Link href="/training">your history</Link> keeps accumulating
              {coverage.totalRuns > 0 &&
                ` — ${coverage.analysisReady} of ${coverage.totalRuns} runs hydrated for analysis (${readinessPct}%).`}
            </p>
          </div>
        </article>
      </div>
      <div className="coach-footnote">
        <span className="coach-symbol">✦</span>
        <p>
          These are plain facts from your data, not an interpretation. The
          system will become more specific as your history grows.
        </p>
      </div>
    </div>
  );
}
