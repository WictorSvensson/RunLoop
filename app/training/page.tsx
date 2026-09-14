import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { toActivityDTO } from "@/lib/activity-detail";
import { ActivityList } from "./ActivityList";

// Live DB state (recent rows) on every load.
export const dynamic = "force-dynamic";

// The training archive: activities only. All connection/sync controls live
// on the profile page — this page never triggers imports.
export default async function TrainingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const activityRows = await prisma.activity.findMany({
    where: { userId: user.id },
    orderBy: { startDate: "desc" },
    take: 25,
  });

  const activities = activityRows.map((row) => toActivityDTO(row));

  return (
    <div className="route-wrap">
      <div className="route-heading">
        <div>
          <p className="eyebrow">The archive</p>
          <h1>Training</h1>
          <p className="subtle">A record of the work that is adding up.</p>
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
                  Connect a wearable on your profile page to import your runs.
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
