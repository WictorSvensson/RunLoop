"use client";

import { useState } from "react";
import type { AnalysisCoverage } from "@/lib/strava/analysis-data";

interface Props {
  initialCoverage: AnalysisCoverage;
}

interface HydrateResponse {
  ok: boolean;
  selected: number;
  hydrated: number;
  alreadyReady: number;
  failed: number;
  rateLimited: boolean;
  errors: Array<{ activityId: string; message: string }>;
  message?: string;
  error?: string;
}

// Manual operator control for backfilling laps + streams (analysis ingestion).
// Rendered on the Training page next to StravaSync. Each click hydrates one
// small batch — deliberately no polling, no auto-loop, no schedule.
async function safeJson(res: Response): Promise<unknown | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function AnalysisHydration({ initialCoverage }: Props) {
  const [coverage, setCoverage] = useState(initialCoverage);
  const [hydrating, setHydrating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fullyReady =
    coverage.totalRuns > 0 && coverage.analysisReady >= coverage.totalRuns;

  async function refreshCoverage() {
    try {
      const res = await fetch("/api/jobs/analysis-coverage");
      const data = await safeJson(res);
      if (res.ok && data && typeof data === "object" && "coverage" in data) {
        setCoverage((data as { coverage: AnalysisCoverage }).coverage);
      }
    } catch {
      // Coverage refresh is best-effort; the batch message already conveys the
      // outcome. A stale readout corrects itself on next page load.
    }
  }

  async function handleHydrate() {
    setHydrating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/jobs/analysis-hydrate?limit=10", {
        method: "POST",
      });
      const data = (await safeJson(res)) as HydrateResponse | null;
      if (!data) {
        setMessage("Unexpected server response. Check the server log.");
        return;
      }
      if (!res.ok) {
        if (res.status === 429) {
          setMessage("Strava rate limited — wait ~15 min and run again.");
        } else if (res.status === 401) {
          setMessage(data.error ?? "Strava connection expired. Please reconnect.");
        } else {
          setMessage(data.error ?? "Hydration failed. Check the server log.");
        }
      } else if (data.rateLimited) {
        setMessage(
          `Hydrated ${data.hydrated} before Strava rate limiting — wait ~15 min and run again.`,
        );
      } else if (data.selected === 0) {
        setMessage("History fully hydrated.");
      } else {
        const failedNote =
          data.failed > 0
            ? ` ${data.failed} failed${data.errors[0] ? `: ${data.errors[0].message}` : "."}`
            : "";
        setMessage(`Hydrated ${data.hydrated} of ${data.selected} activities.${failedNote}`);
      }
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      await refreshCoverage();
      setHydrating(false);
    }
  }

  return (
    <div className="strava-sync">
      <p className="subtle">
        {coverage.totalRuns === 0
          ? "No runs to analyze yet."
          : `${coverage.analysisReady} / ${coverage.totalRuns} runs ready for analysis.`}
      </p>
      {!fullyReady && coverage.totalRuns > 0 && (
        <button
          className="checkin-button"
          onClick={handleHydrate}
          disabled={hydrating}
          aria-busy={hydrating}
        >
          {hydrating ? "Hydrating…" : "Hydrate next 10"}
        </button>
      )}
      {message && (
        <p className="strava-sync-message subtle" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
