import Link from "next/link";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { getAnalysisCoverage } from "@/lib/strava/analysis-data";

// Reads live DB state (analysis-data readiness), must not be statically
// prerendered. Shows an honest readiness state until the deterministic engine
// (Phases 1-4) can produce real observations — no invented interpretation.
export const dynamic = "force-dynamic";

export default async function CoachPage() {
  const user = await getOrCreateCurrentUser();
  const coverage = await getAnalysisCoverage(user.id);
  const percentage =
    coverage.totalRuns === 0
      ? 0
      : Math.round((coverage.analysisReady / coverage.totalRuns) * 1000) / 10;

  return (
    <div className="route-wrap">
      <div className="route-intro">
        <p className="eyebrow">A considered read of your data</p>
        <h1>Coach</h1>
        <p className="subtle">
          No generic advice. Just observations, hypotheses, and the next sensible move.
        </p>
      </div>
      <div className="coach-stack">
        <article className="coach-insight">
          <div className="insight-label">
            <span className="insight-number">01</span>
            <span className="eyebrow">Readiness</span>
          </div>
          <div className="insight-body">
            <h2>
              {coverage.totalRuns === 0
                ? "No running history yet."
                : `${coverage.analysisReady} of ${coverage.totalRuns} runs ready for analysis (${percentage}%).`}
            </h2>
            <p className="subtle">
              {coverage.totalRuns === 0 ? (
                <>Connect Strava on the Training page to import your runs.</>
              ) : (
                <>
                  Coaching observations need hydrated history (laps and streams)
                  first. Hydrate from the Training page, then workout
                  classification and trend reasoning follow. Nothing here is
                  interpreted yet.
                </>
              )}
            </p>
            <Link href="/training" className="coach-link">
              Go to Training
            </Link>
          </div>
        </article>
      </div>
      <div className="coach-footnote">
        <span className="coach-symbol">✦</span>
        <p>
          This is a working interpretation, not a verdict. The system will
          become more specific as your history grows.
        </p>
      </div>
    </div>
  );
}
