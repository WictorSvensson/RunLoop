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

  it("rejects negatives, non-finite numbers, and non-numeric input safely", () => {
    // Negatives floor up to 1. The lower bound is load-bearing: Prisma
    // rejects a negative `take`, so this must never pass one through.
    expect(clampAnalysisBatchSize(-5)).toBe(1);
    expect(clampAnalysisBatchSize(-0.5)).toBe(1);
    // ±Infinity falls back to the default rather than clamping to MAX, so a
    // ?limit=1e999-style value cannot request an unbounded batch.
    expect(clampAnalysisBatchSize(Infinity)).toBe(DEFAULT_ANALYSIS_BATCH_SIZE);
    expect(clampAnalysisBatchSize(-Infinity)).toBe(
      DEFAULT_ANALYSIS_BATCH_SIZE,
    );
    // Number.isFinite does not coerce, so out-of-contract non-numbers also
    // get the default instead of being parsed.
    expect(clampAnalysisBatchSize(null as unknown as undefined)).toBe(
      DEFAULT_ANALYSIS_BATCH_SIZE,
    );
    expect(clampAnalysisBatchSize("10" as unknown as undefined)).toBe(
      DEFAULT_ANALYSIS_BATCH_SIZE,
    );
  });
});
