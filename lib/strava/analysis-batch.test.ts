import { describe, expect, it } from "vitest";
import {
  clampAnalysisBatchSize,
  DEFAULT_ANALYSIS_BATCH_SIZE,
  MAX_ANALYSIS_BATCH_SIZE,
} from "@/lib/strava/analysis-batch";

describe("clampAnalysisBatchSize", () => {
  it("uses the conservative default when the input is missing or invalid", () => {
    expect(clampAnalysisBatchSize(undefined)).toBe(DEFAULT_ANALYSIS_BATCH_SIZE);
    expect(clampAnalysisBatchSize(Number.NaN)).toBe(DEFAULT_ANALYSIS_BATCH_SIZE);
  });

  it("clamps the job to a safe 1..MAX range", () => {
    expect(clampAnalysisBatchSize(0)).toBe(1);
    expect(clampAnalysisBatchSize(7.9)).toBe(7);
    expect(clampAnalysisBatchSize(999)).toBe(MAX_ANALYSIS_BATCH_SIZE);
  });
});
