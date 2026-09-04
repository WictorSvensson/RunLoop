import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { enrichActivity } from "@/lib/strava/enrich";
import { StravaApiError } from "@/lib/strava/client";
import { isInternalRequestAuthorized } from "@/lib/http-auth";

// GET /api/activities/[id]
// Returns the detailed representation of one activity, fetching it from Strava
// on first request and caching it in the DB (fetch-once). Same-origin protected.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const user = await getOrCreateCurrentUser();
    const activity = await enrichActivity(user.id, id);
    return NextResponse.json({ activity });
  } catch (err) {
    if (err instanceof StravaApiError) {
      if (err.status === 429) {
        return NextResponse.json(
          { error: "Strava rate limit reached. Please try again in a few minutes." },
          { status: 429 },
        );
      }
      if (err.status === 400 || err.status === 401) {
        return NextResponse.json(
          { error: "Your Strava connection expired. Please reconnect." },
          { status: 401 },
        );
      }
      if (err.status === 404) {
        return NextResponse.json(
          { error: "This activity no longer exists on Strava." },
          { status: 404 },
        );
      }
    }
    if (err instanceof Error && err.message === "Activity not found") {
      return NextResponse.json({ error: "Activity not found." }, { status: 404 });
    }
    console.error("Activity detail fetch failed:", err);
    return NextResponse.json(
      { error: "Could not load activity details. Please try again." },
      { status: 500 },
    );
  }
}
