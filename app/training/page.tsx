import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { toActivityDTO } from "@/lib/strava/enrich";
import { StravaSync } from "./StravaSync";
import { ActivityList } from "./ActivityList";

/* eslint-disable @next/next/no-html-link-for-pages */

function formatDate(date: Date): string {
  // Pinned locale + timezone for deterministic SSR/client output (see ActivityList).
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ strava?: string }>;
}) {
  const { strava } = await searchParams;

  const user = await getOrCreateCurrentUser();
  const [connection, activityRows] = await Promise.all([
    prisma.stravaConnection.findUnique({ where: { userId: user.id } }),
    prisma.activity.findMany({
      where: { userId: user.id },
      orderBy: { startDate: "desc" },
      take: 25,
    }),
  ]);

  const activities = activityRows.map(toActivityDTO);
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

          {activities.length === 0 ? (
            <div className="activity-table">
              <div className="table-header">
                <span>Activity</span>
                <span>Distance</span>
                <span>Duration</span>
                <span>Pace / HR</span>
              </div>
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
            </div>
          ) : (
            <ActivityList activities={activities} />
          )}
        </div>
      </section>
    </main>
  );
}
