import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { toActivityDTO } from "@/lib/strava/enrich";
import { StravaSync } from "./StravaSync";
import { ActivityList } from "./ActivityList";

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

  return (
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
  );
}
