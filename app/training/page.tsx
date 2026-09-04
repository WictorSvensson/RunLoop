import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { StravaSync } from "./StravaSync";

/* eslint-disable @next/next/no-html-link-for-pages */

// ---------------------------------------------------------------------------
// Formatting helpers for the objective fields Strava gives us.
// ---------------------------------------------------------------------------
function formatDistance(meters: number | null): string {
  if (meters == null) return "—";
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

// Pace in min/km from average speed (m/s).
function formatPace(metersPerSecond: number | null): string {
  if (!metersPerSecond || metersPerSecond <= 0) return "—";
  const secPerKm = 1000 / metersPerSecond;
  let m = Math.floor(secPerKm / 60);
  let s = Math.round(secPerKm % 60);
  if (s === 60) {
    // Rounding carry, e.g. 4:59.6 -> 5:00 (not 4:60).
    m += 1;
    s = 0;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatHr(bpm: number | null): string {
  if (bpm == null) return "";
  return `${Math.round(bpm)} bpm`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function toneFor(type: string | null): string {
  const t = (type ?? "").toLowerCase();
  if (t.includes("trail") || t.includes("long")) return "long";
  if (t.includes("walk") || t.includes("hike")) return "recovery";
  return "easy";
}

export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ strava?: string }>;
}) {
  const { strava } = await searchParams;

  const user = await getOrCreateCurrentUser();
  const [connection, activities] = await Promise.all([
    prisma.stravaConnection.findUnique({ where: { userId: user.id } }),
    prisma.activity.findMany({
      where: { userId: user.id },
      orderBy: { startDate: "desc" },
      take: 25,
    }),
  ]);

  const isConnected = connection !== null;
  const lastSynced = connection?.lastSyncedAt
    ? `Last synced ${formatDate(connection.lastSyncedAt)}`
    : "Not synced yet";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark">r</span> runloop
        </a>
        <nav className="main-nav route-nav">
          <span className="nav-label">Workspace</span>
          {["Dashboard", "Daily check-in", "Training", "Analytics", "Coach"].map(
            (item, index) => (
              <a
                className={`nav-item ${item === "Training" ? "active" : ""}`}
                href={
                  index === 0
                    ? "/"
                    : `/${["", "check-in", "training", "analytics", "coach"][index]}`
                }
                key={item}
              >
                <span className="nav-icon">
                  {["⌂", "✧", "◒", "◌", "◈"][index]}
                </span>
                {item}
              </a>
            ),
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sync-status">
            <span className="status-pulse" />
            {lastSynced}
          </div>
        </div>
      </aside>
      <section className="content">
        <header className="topbar">
          <a className="mobile-brand" href="/">
            <span className="brand-mark">r</span> runloop
          </a>
          <div className="breadcrumb">
            <span>Workspace</span>
            <b>/</b>Training
          </div>
          <div className="top-actions">
            <div className="top-avatar">K</div>
          </div>
        </header>
        <div className="route-wrap">
          <div className="route-heading">
            <div>
              <p className="eyebrow">The archive</p>
              <h1>Training</h1>
              <p className="subtle">A record of the work that is adding up.</p>
            </div>
            <StravaSync isConnected={isConnected} status={strava} />
          </div>

          <div className="activity-table">
            <div className="table-header">
              <span>Activity</span>
              <span>Distance</span>
              <span>Duration</span>
              <span>Pace / HR</span>
            </div>
            {activities.length === 0 ? (
              <div className="table-row">
                <div className="activity-detail">
                  <div>
                    <strong>No activities yet</strong>
                    <span>
                      {isConnected
                        ? "Click “Sync now” to import from Strava."
                        : "Connect Strava to import your runs."}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              activities.map((activity) => {
                const tone = toneFor(activity.type);
                return (
                  <div className="table-row" key={activity.id}>
                    <div className="activity-detail">
                      <div className={`activity-icon ${tone}`}>
                        {tone === "long" ? "↗" : tone === "recovery" ? "◌" : "∿"}
                      </div>
                      <div>
                        <strong>{activity.name ?? activity.type ?? "Run"}</strong>
                        <span>{formatDate(activity.startDate)}</span>
                      </div>
                    </div>
                    <span>{formatDistance(activity.distance)}</span>
                    <span>{formatDuration(activity.movingTime)}</span>
                    <span>
                      {formatPace(activity.averageSpeed)}{" "}
                      <small>{formatHr(activity.averageHeartrate)}</small>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
