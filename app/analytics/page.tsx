import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { formatPaceFromSecPerKm } from "@/lib/format";
import {
  bucketWeeklyVolume,
  computeConsistency,
  computePaceTrend,
  computeVolumeChange,
  windowStartUTC,
} from "@/lib/dashboard/aggregate";
import { RUNNING_TYPES } from "@/lib/running-types";

// Real DB state (running activities), must not be statically prerendered.
export const dynamic = "force-dynamic";

// Longer lookback than the Dashboard's 8-week window — Analytics is meant to
// show slower-moving trends, not a weekly snapshot.
const WEEK_COUNT = 12;

export default async function AnalyticsPage() {
  const user = await getOrCreateCurrentUser();

  const now = new Date();
  // Same Monday-UTC alignment as the Dashboard's window, so the query and the
  // week-bucketing/trend-splitting logic in aggregate.ts always agree.
  const windowStart = windowStartUTC(WEEK_COUNT, now);

  const activities = await prisma.activity.findMany({
    where: {
      userId: user.id,
      startDate: { gte: windowStart },
      type: { in: [...RUNNING_TYPES] },
    },
    orderBy: { startDate: "desc" },
  });

  const weekSummary = bucketWeeklyVolume(activities, WEEK_COUNT, now);
  const consistency = computeConsistency(activities, WEEK_COUNT);
  const paceTrend = computePaceTrend(activities, WEEK_COUNT, now);
  const volumeChange = computeVolumeChange(activities, WEEK_COUNT, now);

  const maxWeekDistance = Math.max(
    ...weekSummary.weeks.map((w) => w.distanceKm),
    1,
  );

  // Below this many runs in either half of the window, an earlier-vs-later
  // comparison is a single anecdote dressed up as a trend, not a real signal
  // — require at least a couple of runs on each side before showing a
  // confident comparison anywhere on this page (pace trend line + the
  // observation strip both use this).
  const MIN_RUNS_PER_HALF = 2;
  const hasEnoughDataForTrend =
    volumeChange.earlierRunCount >= MIN_RUNS_PER_HALF &&
    volumeChange.laterRunCount >= MIN_RUNS_PER_HALF;

  return (
    <div className="route-wrap">
      <div className="route-intro">
        <p className="eyebrow">Patterns over time</p>
        <h1>Analytics</h1>
        <p className="subtle">
          Signals, not verdicts. Enough context to make a calmer decision.
            </p>
          </div>

          <div className="analytics-grid">
            <section className="analytics-panel wide">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Training load</p>
                  <h2>Weekly distance</h2>
                </div>
                <span className="panel-period">{WEEK_COUNT} weeks · km</span>
              </div>
              <div className="trend-chart">
                {weekSummary.weeks.map((week, index) => (
                  <div className="trend-column" key={week.weekStart.toISOString()}>
                    <div
                      className="trend-bar"
                      style={{
                        height: week.hasData
                          ? `${Math.max((week.distanceKm / maxWeekDistance) * 100, 4)}%`
                          : "4%",
                      }}
                    />
                    <span>{index % 4 === 0 ? `W${index + 1}` : ""}</span>
                  </div>
                ))}
              </div>
              <div className="chart-foot">
                <span>{WEEK_COUNT} weeks ago</span>
                <strong>{weekSummary.currentWeek.distanceKm} km this week</strong>
                <span>Now</span>
              </div>
            </section>

            <section className="analytics-panel">
              <p className="eyebrow">Consistency</p>
              <h2>
                {consistency.avgRunsPerWeek} <small>runs / week</small>
              </h2>
              <div className="consistency-line">
                <span style={{ width: `${consistency.barWidthPct}%` }} />
              </div>
              <p className="panel-note">
                {consistency.totalRuns} runs over the last {WEEK_COUNT} weeks,
                averaging {consistency.avgRunsPerWeek} per week.
              </p>
            </section>

            <section className="analytics-panel">
              <p className="eyebrow">Average pace</p>
              <h2>
                {formatPaceFromSecPerKm(paceTrend.avgPaceSecPerKm)}{" "}
                <small>/km average</small>
              </h2>
              {paceTrend.deltaSecPerKm != null &&
              paceTrend.earlierRunCount >= MIN_RUNS_PER_HALF &&
              paceTrend.laterRunCount >= MIN_RUNS_PER_HALF ? (
                <p
                  className={
                    paceTrend.deltaSecPerKm <= 0
                      ? "trend-positive"
                      : "trend-negative"
                  }
                >
                  {paceTrend.deltaSecPerKm <= 0 ? "↓" : "↑"}{" "}
                  {Math.abs(Math.round(paceTrend.deltaSecPerKm))} sec/km vs.
                  first half of window
                </p>
              ) : (
                <p className="panel-note">
                  Not enough runs yet on both sides of the window to compare
                  pace ({paceTrend.earlierRunCount} earlier /{" "}
                  {paceTrend.laterRunCount} recent — need at least{" "}
                  {MIN_RUNS_PER_HALF} each).
                </p>
              )}
              <p className="panel-note">
                Across all runs — RunLoop can&apos;t distinguish easy runs
                from quality sessions yet, so this isn&apos;t an &quot;easy
                pace&quot; specifically.
              </p>
            </section>
          </div>

          <div className="observation-strip">
            <span className="coach-symbol">✦</span>
            <div>
              <p className="eyebrow">Observation</p>
              {hasEnoughDataForTrend ? (
                <>
                  <strong>
                    {volumeChange.deltaPct == null
                      ? volumeChange.earlierRunCount === 0
                        ? "Started running again after a gap"
                        : "No running volume in this window"
                      : `Volume ${volumeChange.deltaPct >= 0 ? "up" : "down"} ${Math.abs(volumeChange.deltaPct)}%`}
                    {paceTrend.deltaSecPerKm != null &&
                      `, pace ${paceTrend.deltaSecPerKm <= 0 ? "improved" : "slowed"} by ${Math.abs(Math.round(paceTrend.deltaSecPerKm))} sec/km`}
                    {" "}
                    over the last {WEEK_COUNT} weeks.
                  </strong>
                  <p>
                    This compares the first half of the window (
                    {volumeChange.earlierAvgKmPerWeek} km/week avg,{" "}
                    {volumeChange.earlierRunCount} runs) to the second half (
                    {volumeChange.laterAvgKmPerWeek} km/week avg,{" "}
                    {volumeChange.laterRunCount} runs). This is a plain
                    observation, not an interpretation — pattern and
                    contradiction detection require the comparable-session
                    engine, which isn&apos;t built yet.
                  </p>
                </>
              ) : (
                <>
                  <strong>Not enough running data yet.</strong>

                  <p>
                    Once there&apos;s at least a few weeks of running history
                    on both sides of the window, this will show a factual
                    volume/pace comparison here.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
  );
}