import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { isInternalRequestAuthorized } from "@/lib/http-auth";
import { getAnalysisCoverage } from "@/lib/strava/analysis-data";

// GET /api/jobs/analysis-coverage
// Reports how much of the athlete's running history is ready for deterministic
// workout classification/comparable-session work. It does not infer fitness.
export async function GET(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await getOrCreateCurrentUser();
    const coverage = await getAnalysisCoverage(user.id);
    const percentage =
      coverage.totalRuns === 0
        ? 0
        : Math.round((coverage.analysisReady / coverage.totalRuns) * 1000) / 10;

    return NextResponse.json({ ok: true, coverage, analysisReadyPct: percentage });
  } catch (err) {
    console.error("Analysis coverage failed:", err);
    return NextResponse.json(
      { error: "Could not calculate analysis-data coverage." },
      { status: 500 },
    );
  }
}
