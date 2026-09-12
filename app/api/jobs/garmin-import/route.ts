import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { importGarminActivities } from "@/lib/garmin/import";
import { importGarminHealth } from "@/lib/garmin/health";
import { GarminAuthError } from "@/lib/garmin/client";
import { isInternalRequestAuthorized } from "@/lib/http-auth";

// POST /api/jobs/garmin-import
// Triggerable Garmin sync: activities (incremental by default, ?full=1 for
// whole history) plus recent health (?healthDays=N, default 14; ?full=1
// raises it to 365). Same auth as other job routes: Bearer JOB_SECRET or
// same-origin browser request.
export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const fullResync = params.get("full") === "1";
  // ?limit=N caps rows processed — diagnostics (e.g. reproduce a FIT failure
  // on 2 activities in seconds instead of a 6-minute full sync). Health sync
  // is skipped on limited runs to keep them fast and focused.
  const limitRaw = params.get("limit");
  const limit = limitRaw !== null ? Math.floor(Number(limitRaw)) : null;
  const maxActivities = limit !== null && Number.isInteger(limit) && limit > 0 ? limit : null;
  if (limitRaw !== null && maxActivities === null) {
    return NextResponse.json({ error: "?limit must be a positive integer." }, { status: 400 });
  }
  const healthDays = params.has("healthDays")
    ? Number(params.get("healthDays"))
    : fullResync
      ? 365
      : 14;

  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const activities = await importGarminActivities(user.id, { fullResync, maxActivities: maxActivities ?? undefined });
    const health =
      maxActivities !== null
        ? { daysChecked: 0, sleepFilled: 0, restingHrFilled: 0, hrvFilled: 0, skipped: "limited run" }
        : await importGarminHealth(user.id, {
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
