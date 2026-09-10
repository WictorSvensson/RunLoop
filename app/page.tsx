import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { toActivityDTO } from "@/lib/strava/enrich";
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatDate,
  toneFor,
  displayNameFromEmail,
} from "@/lib/format";
import {
  bucketWeeklyVolume,
  computeThisWeekStats,
  windowStartUTC,
} from "@/lib/dashboard/aggregate";
import { RUNNING_TYPES } from "@/lib/running-types";
import { CheckInModal } from "./CheckInModal";

// This page reads live DB state (today's check-in, this week's activities) on
// every load, so it must not be statically prerendered at build time.
export const dynamic = "force-dynamic";

const WEEK_COUNT = 8;

function ArrowUpRight() {
  return (
    <span aria-hidden="true" className="arrow">
      ↗
    </span>
  );
}

function symptomsLabel(symptoms: string | null): string {
  switch (symptoms) {
    case "NONE":
      return "Clear";
    case "MILD":
      return "Mild";
    case "MODERATE":
      return "Moderate";
    case "HIGH":
      return "High";
    default:
      return "—";
  }
}

function formatSleep(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function greetingForHour(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function Home() {
  const user = await getOrCreateCurrentUser();

  const now = new Date();
  // Aligned to the same Monday-UTC week boundary bucketWeeklyVolume uses, so
  // the query window and the bucket boundaries can never silently drift apart.
  const windowStart = windowStartUTC(WEEK_COUNT, now);

  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const [activities, recentRows, todaysCheckin, latestBrief] = await Promise.all([
    prisma.activity.findMany({
      where: {
        userId: user.id,
        startDate: { gte: windowStart },
        type: { in: [...RUNNING_TYPES] },
      },
      orderBy: { startDate: "desc" },
    }),
    prisma.activity.findMany({
      where: { userId: user.id, type: { in: [...RUNNING_TYPES] } },
      orderBy: { startDate: "desc" },
      take: 3,
    }),
    prisma.dailyCheckin.findUnique({
      where: { userId_date: { userId: user.id, date: today } },
    }),
    prisma.coachBrief.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const weekSummary = bucketWeeklyVolume(activities, WEEK_COUNT, now);
  const thisWeekStats = computeThisWeekStats(activities, now);
  const recentActivities = recentRows.map((row) => toActivityDTO(row));

  const maxWeekDistance = Math.max(
    ...weekSummary.weeks.map((w) => w.distanceKm),
    1, // avoid divide-by-zero when there's no data at all
  );

  return (
    <div className="dashboard-wrap">
      <div className="welcome-row">
        <div>
          <p className="eyebrow">
            {now.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          <h1>
            {greetingForHour(now.getHours())}, {displayNameFromEmail(user.email)}
            <span className="accent-dot">.</span>
          </h1>
          <p className="subtle">
            Last {WEEK_COUNT} weeks of training
          </p>
        </div>
        <CheckInModal />
      </div>

      <section className="week-hero training-block-panel">
        <div className="training-block-header">
          <p className="eyebrow light">Recent training volume</p>
          <span className="training-block-week">
            Last {WEEK_COUNT} weeks
          </span>
        </div>
        <div className="week-stats training-block-stats">
          <div className="big-stat training-block-stat">
            <strong>
              {thisWeekStats.distanceKm} <span>km</span>
            </strong>
            <small>This week</small>
          </div>
          <div className="big-stat training-block-stat">
            <strong>
              {thisWeekStats.runCount} <span>runs</span>
            </strong>
            <small>Frequency</small>
          </div>
          <div className="big-stat training-block-stat">
            <strong>{formatDuration(thisWeekStats.movingTimeSeconds)}</strong>
            <small>Running time</small>
          </div>
          <div className="big-stat training-block-stat">
            <strong>
              {thisWeekStats.avgHeartrate ?? "—"} <span>bpm</span>
            </strong>
            <small>Avg HR</small>
          </div>
        </div>
        <div
          className="training-block-chart"
          aria-label={`${WEEK_COUNT}-week training volume`}
        >
          <div className="training-chart-grid">
            <i />
            <i />
            <i />
          </div>
          {weekSummary.weeks.map((week, index) => (
            <div
              className={`training-week ${
                !week.hasData
                  ? "future"
                  : index === weekSummary.weeks.length - 1
                    ? "current"
                    : "completed"
              }`}
              key={week.weekStart.toISOString()}
            >
              <span className="training-volume">
                {week.hasData ? week.distanceKm : "—"}
                {week.hasData && <small> km</small>}
              </span>
              <div
                className="training-bar"
                style={{
                  height: week.hasData
                    ? `${Math.max((week.distanceKm / maxWeekDistance) * 100, 8)}%`
                    : "8%",
                }}
              />
              <span className="training-week-label">{week.label}</span>
            </div>
          ))}
        </div>
        <div className="training-block-summary">
          <div>
            <span>{WEEK_COUNT - 1}-week avg</span>
            <strong>{weekSummary.avgKmPerWeek} km/week</strong>
          </div>
          <div>
            <span>Current week</span>
            <strong>
              {weekSummary.currentVsAvgPct == null
                ? "Not enough data yet"
                : `${weekSummary.currentVsAvgPct > 0 ? "+" : ""}${weekSummary.currentVsAvgPct}% `}
              {weekSummary.currentVsAvgPct != null && (
                <em>vs recent average</em>
              )}
            </strong>
          </div>
        </div>
      </section>

      <div className="analysis-grid">
        <section className="analysis-panel aerobic-panel">
          <div className="analysis-heading">
            <div>
              <p className="eyebrow">Aerobic efficiency</p>
              <h2>{WEEK_COUNT} week trend</h2>
            </div>
            <span className="analysis-period">
              W1 — W{WEEK_COUNT}
            </span>
          </div>
          <div className="analysis-primary">
            <strong>
              {thisWeekStats.avgHeartrate ?? "—"} <small>bpm</small>
            </strong>
            <span>Avg HR this week</span>
          </div>
          <div className="analysis-secondary">
            <p>
              Aerobic efficiency and HR-drift analysis require the RunLoop
              analysis engine and aren&apos;t computed from raw activity data
              yet.
            </p>
          </div>
        </section>
        <section className="analysis-panel threshold-panel">
          <div className="analysis-heading">
            <div>
              <p className="eyebrow">Threshold development</p>
              <h2>{WEEK_COUNT} week trend</h2>
            </div>
            <span className="analysis-period">PACE / KM</span>
          </div>
          <div className="threshold-list">
            <p className="subtle">
              Threshold pace detection isn&apos;t implemented yet — this
              needs interval/effort analysis on top of raw activity data.
            </p>
          </div>
        </section>
      </div>

      <div className="supporting-grid">
        <section className="recovery-section">
          <div className="section-heading">
            <p className="eyebrow">Recovery</p>
            <span className="supporting-state">
              {todaysCheckin ? "Checked in today" : "No check-in yet today"}
            </span>
          </div>
          <div className="recovery-grid compact-recovery">
            <div className="metric-card">
              <span className="metric-label">Sleep</span>
              <strong>{formatSleep(todaysCheckin?.sleepDuration ?? null)}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Energy</span>
              <strong>
                {todaysCheckin?.energy ?? "—"}
                <em>/5</em>
              </strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Symptoms</span>
              <strong className="clear-state">
                {symptomsLabel(todaysCheckin?.symptoms ?? null)}
              </strong>
            </div>
          </div>
        </section>
        <section className="recent-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Your last movement</p>
              <h2>Recent training</h2>
            </div>
            <Link
              className="round-arrow"
              aria-label="View all training"
              href="/training"
            >
              <ArrowUpRight />
            </Link>
          </div>
          <div className="activity-list">
            {recentActivities.length === 0 ? (
              <p className="subtle">
                No activities yet. Connect Strava on the Training page to
                import your runs.
              </p>
            ) : (
              recentActivities.map((activity) => {
                const tone = toneFor(activity.type);
                return (
                  <div className="activity-row" key={activity.id}>
                    <div className={`activity-icon ${tone}`}>
                      {tone === "long" ? "↗" : tone === "recovery" ? "◌" : "∿"}
                    </div>
                    <div className="activity-detail">
                      <strong>{activity.name ?? activity.type ?? "Run"}</strong>
                      <span>
                        {formatDate(activity.startDate)} ·{" "}
                        {formatDistance(activity.distance)} ·{" "}
                        {formatDuration(activity.movingTime)}
                      </span>
                    </div>
                    <span className="activity-value">
                      {formatPace(activity.averageSpeed)}
                      <span>/km</span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <section className="coach-card">
        <div className="coach-header">
          <p className="eyebrow">RunLoop Coach</p>
          <span className="confidence">
            {latestBrief
              ? `Generated ${latestBrief.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
              : "Not yet available"}
          </span>
        </div>
        <div className="coach-copy">
          <p className="coach-kicker">Recommendation</p>
          {latestBrief ? (
            <>
              <h2>{latestBrief.recommendation}</h2>
              <p>{latestBrief.interpretation}</p>
            </>
          ) : (
            <>
              <h2>Coaching analysis isn&apos;t generated yet.</h2>
              <p>
                Generate your first AI brief on the Coach page — until then
                this card stays quiet rather than guessing.
              </p>
            </>
          )}
        </div>
        <div className="coach-actions">
          <Link href="/coach" className="coach-link">
            Full analysis <ArrowUpRight />
          </Link>
        </div>
      </section>
      <footer>
        <span>Runloop / Personal training intelligence</span>
        <span>Data is yours, always.</span>
      </footer>
    </div>
  );
}
