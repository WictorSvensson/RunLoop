import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { importGarminActivities } from "@/lib/garmin/import";
import { importGarminHealth } from "@/lib/garmin/health";
import { GarminAuthError } from "@/lib/garmin/client";
import { isInternalRequestAuthorized } from "@/lib/http-auth";

// POST /api/jobs/garmin-import
// Triggerable Garmin sync: activities (incremental by default, ?full=1 for
// whole history) plus recent health (?healthDays=N, default 14; ?full=1
// raises it to 365). Same auth as the Strava job: Bearer JOB_SECRET or
// same-origin browser request.
export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const fullResync = params.get("full") === "1";
  const healthDays = params.has("healthDays")
    ? Number(params.get("healthDays"))
    : fullResync
      ? 365
      : 14;

  try {
    const user = await getOrCreateCurrentUser();
    const activities = await importGarminActivities(user.id, { fullResync });
    const health = await importGarminHealth(user.id, {
      daysBack: Number.isInteger(healthDays) && healthDays >= 0 ? healthDays : 14,
    });
    return NextResponse.json({ ok: true, activities, health });
  } catch (err) {
    if (err instanceof GarminAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("Garmin import failed:", err);
    return NextResponse.json({ error: "Import failed. Please try again." }, { status: 500 });
  }
}
