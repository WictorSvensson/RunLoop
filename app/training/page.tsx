import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { toActivityDTO } from "@/lib/strava/enrich";
import { getAnalysisCoverage } from "@/lib/strava/analysis-data";
import { garminConfig } from "@/lib/garmin/config";
import { StravaSync } from "./StravaSync";
import { GarminSync } from "./GarminSync";
import { AnalysisHydration } from "./AnalysisHydration";
import { ActivityList } from "./ActivityList";

// Live DB state (connections, recent rows, analysis coverage) on every load.
export const dynamic = "force-dynamic";

export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ strava?: string; garmin?: string }>;
}) {
  const { strava, garmin } = await searchParams;

  const user = await getOrCreateCurrentUser();
  const [stravaConnection, garminConnection, activityRows, coverage] = await Promise.all([
    prisma.stravaConnection.findUnique({ where: { userId: user.id } }),
    prisma.garminConnection.findUnique({ where: { userId: user.id } }),
    prisma.activity.findMany({
      where: { userId: user.id },
      orderBy: { startDate: "desc" },
      take: 25,
    }),
    getAnalysisCoverage(user.id),
  ]);

  const activities = activityRows.map((row) => toActivityDTO(row));
  const isStravaConnected = stravaConnection !== null;
  const isGarminConnected = garminConnection !== null;

  return (
    <div className="route-wrap">
      <div className="route-heading">
        <div>
          <p className="eyebrow">The archive</p>
          <h1>Training</h1>
          <p className="subtle">A record of the work that is adding up.</p>
        </div>
        <div className="training-controls">
          <StravaSync isConnected={isStravaConnected} status={strava} />
          <GarminSync
            isConnected={isGarminConnected}
            username={garminConnection?.username}
            status={garmin}
            defaultUsername={garminConfig.username}
          />
          {(isStravaConnected || isGarminConnected) && (
            <AnalysisHydration initialCoverage={coverage} />
          )}
        </div>
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
                  {isStravaConnected || isGarminConnected
                    ? "Click “Sync now” to import."
                    : "Connect Strava or Garmin to import your runs."}
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
