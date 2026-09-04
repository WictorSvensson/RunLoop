import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { importStravaActivities } from "@/lib/strava/import";
import { StravaApiError } from "@/lib/strava/client";
import { isInternalRequestAuthorized } from "@/lib/http-auth";

// POST /api/jobs/strava-import
// A triggerable job that imports the user's Strava activities.
// Authorized via Bearer JOB_SECRET (automated) or a same-origin browser request
// (the "Sync now" button). See lib/http-auth.ts.
export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional ?full=1 forces a full history resync (idempotent).
  const fullResync = request.nextUrl.searchParams.get("full") === "1";

  try {
    const user = await getOrCreateCurrentUser();
    const result = await importStravaActivities(user.id, { fullResync });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof StravaApiError) {
      if (err.status === 429) {
        return NextResponse.json(
          { error: "Strava rate limit reached. Please try again in a few minutes." },
          { status: 429 },
        );
      }
      // A 400/401 from token refresh means the stored refresh token is no longer
      // valid — the user must reconnect.
      if (err.status === 400 || err.status === 401) {
        return NextResponse.json(
          { error: "Your Strava connection expired. Please reconnect." },
          { status: 401 },
        );
      }
    }
    // Log details server-side; return a generic message to the client.
    console.error("Strava import failed:", err);
    return NextResponse.json({ error: "Import failed. Please try again." }, { status: 500 });
  }
}
