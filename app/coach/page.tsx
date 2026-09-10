import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { getAnalysisCoverage } from "@/lib/strava/analysis-data";
import { getCoachFacts } from "@/lib/coach/facts";
import { GenerateButton } from "./GenerateButton";

// Live DB state on every load: deterministic facts, latest AI brief, and
// analysis-data readiness. Must not be statically prerendered.
export const dynamic = "force-dynamic";

function formatBriefDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export default async function CoachPage() {
  const user = await getOrCreateCurrentUser();

  const [facts, latestBrief, coverage] = await Promise.all([
    getCoachFacts(user.id),
    prisma.coachBrief.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
    getAnalysisCoverage(user.id),
  ]);

  const observations = [...facts.recovery, ...facts.training];
  const readinessPct =
    coverage.totalRuns === 0
      ? 0
      : Math.round((coverage.analysisReady / coverage.totalRuns) * 1000) / 10;
  const aiConfigured = Boolean(
    process.env.FOUNDRY_ENDPOINT?.trim() &&
      process.env.FOUNDRY_API_KEY?.trim() &&
      process.env.FOUNDRY_DEPLOYMENT?.trim(),
  );

  return (
    <div className="route-wrap">
      <div className="route-intro">
        <p className="eyebrow">A considered read of your data</p>
        <h1>Coach</h1>
        <p className="subtle">
          Just observations for now — no hypotheses yet, no next move prescribed.
        </p>
      </div>
      <div className="coach-stack">
        <article className="coach-insight">
          <div className="insight-label">
            <span className="insight-number">01</span>
            <span className="eyebrow">Observations</span>
          </div>
          <div className="insight-body">
            <h2>What your data currently says.</h2>
            <ul className="coach-facts">
              {observations.map((bullet, index) => (
                <li key={`${index}-${bullet.slice(0, 24)}`}>{bullet}</li>
              ))}
            </ul>
          </div>
        </article>
        <article className="coach-insight">
          <div className="insight-label">
            <span className="insight-number">02</span>
            <span className="eyebrow">Interpretation</span>
          </div>
          <div className="insight-body">
            {latestBrief ? (
              <>
                <h2>{latestBrief.interpretation}</h2>
                <p className="subtle">
                  Generated {formatBriefDate(latestBrief.createdAt)} ·{" "}
                  {latestBrief.model}
                </p>
              </>
            ) : (
              <>
                <h2>Not available yet.</h2>
                <p className="subtle">
                  Connecting these observations into explanations — fatigue vs
                  fitness, load vs recovery — needs an AI brief. Generate one
                  below; until then this page reports facts only, never
                  guesses.
                </p>
              </>
            )}
          </div>
        </article>
        <article className="coach-insight">
          <div className="insight-label">
            <span className="insight-number">03</span>
            <span className="eyebrow">Recommendation</span>
          </div>
          <div className="insight-body">
            {latestBrief ? (
              <>
                <h2>{latestBrief.recommendation}</h2>
                <p className="subtle">
                  Generated {formatBriefDate(latestBrief.createdAt)} ·{" "}
                  {latestBrief.model}
                </p>
              </>
            ) : (
              <>
                <h2>Not available yet.</h2>
                <p className="subtle">
                  The smallest useful change to test next will appear here
                  once you generate a brief. Meanwhile,{" "}
                  <Link href="/training">your history</Link> keeps
                  accumulating
                  {coverage.totalRuns > 0 &&
                    ` — ${coverage.analysisReady} of ${coverage.totalRuns} runs hydrated for analysis (${readinessPct}%).`}
                </p>
              </>
            )}
            <GenerateButton
              configured={aiConfigured}
              hasBrief={latestBrief !== null}
            />
          </div>
        </article>
      </div>
      <div className="coach-footnote">
        <span className="coach-symbol">✦</span>
        <p>
          These are plain facts from your data, not an interpretation. The
          system will become more specific as your history grows.
        </p>
      </div>
    </div>
  );
}
