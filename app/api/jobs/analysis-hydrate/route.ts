import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { isInternalRequestAuthorized } from "@/lib/http-auth";
import { StravaApiError } from "@/lib/strava/client";
import { hydrateHistoricalAnalysisData } from "@/lib/strava/analysis-data";

// POST /api/jobs/analysis-hydrate?limit=10
// Enriches a small, repeatable batch of running activities with Strava detail,
// laps and streams. Re-run it until coverage reports the desired history.
export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawLimit = request.nextUrl.searchParams.get("limit");
  const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);

  try {
    const user = await getOrCreateCurrentUser();
    const result = await hydrateHistoricalAnalysisData(user.id, {
      limit: parsedLimit,
    });

    return NextResponse.json({
      ok: !result.rateLimited,
      ...result,
      message: result.rateLimited
        ? "Partial batch completed before Strava rate limiting. Re-run later."
        : "Analysis-data batch completed.",
    });
  } catch (err) {
    if (err instanceof StravaApiError) {
      if (err.status === 429) {
        return NextResponse.json(
          { error: "Strava rate limit reached. Re-run the hydration job later." },
          { status: 429 },
        );
      }
      if (err.status === 400 || err.status === 401) {
        return NextResponse.json(
          { error: "Your Strava connection expired. Please reconnect." },
          { status: 401 },
        );
      }
    }

    console.error("Analysis hydration failed:", err);
    return NextResponse.json(
      { error: "Analysis-data hydration failed. Check the server log." },
      { status: 500 },
    );
  }
}
