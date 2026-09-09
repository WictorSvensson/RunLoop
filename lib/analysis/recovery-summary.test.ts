import { describe, expect, it } from "vitest";
import {
  recoveryObservationBullets,
  summarizeRecoveryDays,
  MIN_CHECKINS_FOR_AVERAGE,
  type RecoverySummary,
} from "@/lib/analysis/recovery-summary";
import type { RecoveryDay } from "@/lib/analysis/recovery";

function makeDay(overrides: Partial<RecoveryDay> = {}): RecoveryDay {
  return {
    dateKey: "2026-09-09",
    energy: null,
    sleepMinutes: null,
    sleepQuality: null,
    soreness: null,
    symptoms: null,
    weightKg: null,
    notes: null,
    ...overrides,
  };
}

const BLANK_SUMMARY: RecoverySummary = {
  windowDays: 14,
  checkinCount: 0,
  energyCount: 0,
  avgEnergy: null,
  sleepCount: 0,
  avgSleepMinutes: null,
  sorenessDays: 0,
  symptomDays: 0,
  worstSymptoms: null,
};

describe("summarizeRecoveryDays", () => {
  it("computes averages across a full window", () => {
    const days = [
      makeDay({ energy: 4, sleepMinutes: 420, soreness: "MILD", symptoms: "NONE" }),
      makeDay({ energy: 3, sleepMinutes: 450, soreness: "NONE", symptoms: "MILD" }),
      makeDay({ energy: 5, sleepMinutes: 400, soreness: "NONE", symptoms: "NONE" }),
      makeDay({ energy: 4, sleepMinutes: 430, soreness: "MODERATE", symptoms: "MILD" }),
    ];
    const summary = summarizeRecoveryDays(days, 14);

    expect(summary.checkinCount).toBe(4);
    expect(summary.avgEnergy).toBe(4); // (4+3+5+4)/4
    expect(summary.avgSleepMinutes).toBe(425); // (420+450+400+430)/4
    expect(summary.sorenessDays).toBe(2);
    expect(summary.symptomDays).toBe(2);
    expect(summary.worstSymptoms).toBe("MILD");
  });

  it("gates averages behind the minimum sample size", () => {
    const days = [
      makeDay({ energy: 5, sleepMinutes: 500 }),
      makeDay({ energy: 1, sleepMinutes: 100 }),
    ];
    const summary = summarizeRecoveryDays(days, 14);

    expect(summary.checkinCount).toBe(2);
    expect(summary.avgEnergy).toBeNull();
    expect(summary.avgSleepMinutes).toBeNull();
  });

  it("tracks the worst symptoms across severities", () => {
    const days = [
      makeDay({ symptoms: "MILD" }),
      makeDay({ symptoms: "HIGH" }),
      makeDay({ symptoms: "MODERATE" }),
      makeDay({ symptoms: "NONE" }),
    ];
    expect(summarizeRecoveryDays(days, 14).worstSymptoms).toBe("HIGH");
  });

  it("summarizes an empty window without inventing values", () => {
    expect(summarizeRecoveryDays([], 14)).toEqual(BLANK_SUMMARY);
  });

  it("includes energy 0 in the average instead of dropping it as falsy", () => {
    // 0 is out of the valid 1-5 domain, but the `!= null` filter must not
    // silently drop it (a truthy filter would inflate the average).
    const days = [
      makeDay({ energy: 0 }),
      makeDay({ energy: 4 }),
      makeDay({ energy: 4 }),
      makeDay({ energy: 4 }),
    ];
    const summary = summarizeRecoveryDays(days, 14);

    expect(summary.energyCount).toBe(4);
    expect(summary.avgEnergy).toBe(3); // (0+4+4+4)/4
  });

  it("averages valued days only while symptom fractions use total check-ins", () => {
    const days = [
      makeDay({ energy: 4, symptoms: "MILD" }),
      makeDay({ energy: 4, symptoms: null }),
      makeDay({ energy: 4, symptoms: "NONE" }),
      makeDay({ energy: 4, symptoms: null }),
      makeDay({ energy: null, symptoms: null }),
    ];
    const summary = summarizeRecoveryDays(days, 14);

    expect(summary.checkinCount).toBe(5);
    expect(summary.energyCount).toBe(4);
    expect(summary.avgEnergy).toBe(4);
    expect(summary.symptomDays).toBe(1);
    expect(recoveryObservationBullets(summary)).toContain(
      "1 of 5 days with symptoms above none (highest: mild).",
    );
  });

  it("rounds average energy to one decimal (3.75 -> 3.8)", () => {
    const days = [
      makeDay({ energy: 4 }),
      makeDay({ energy: 4 }),
      makeDay({ energy: 3 }),
      makeDay({ energy: 4 }),
    ];

    expect(summarizeRecoveryDays(days, 14).avgEnergy).toBe(3.8); // 15/4
  });
});

describe("recoveryObservationBullets", () => {
  it("states the empty window honestly", () => {
    expect(recoveryObservationBullets(BLANK_SUMMARY)).toEqual([
      "No check-ins in the last 14 days yet.",
    ]);
  });

  it("carries sample sizes on every claim", () => {
    const bullets = recoveryObservationBullets({
      ...BLANK_SUMMARY,
      checkinCount: 9,
      energyCount: 9,
      avgEnergy: 3.8,
      sleepCount: 8,
      avgSleepMinutes: 432,
      sorenessDays: 2,
      symptomDays: 3,
      worstSymptoms: "MODERATE",
    });

    expect(bullets).toContain(
      "Average energy 3.8/5 across 9 check-ins in the last 14 days.",
    );
    expect(bullets).toContain("Average sleep 7h 12m across 8 nights.");
    expect(bullets).toContain(
      "3 of 9 days with symptoms above none (highest: moderate).",
    );
    expect(bullets).toContain("2 of 9 days with soreness above none.");
  });

  it("admits below-minimum samples instead of averaging them", () => {
    const bullets = recoveryObservationBullets({
      ...BLANK_SUMMARY,
      checkinCount: 2,
      energyCount: 2,
      sleepCount: 1,
    });

    expect(bullets).toContain(
      `Only 2 of 2 check-ins logged energy — not enough for an average yet (need ${MIN_CHECKINS_FOR_AVERAGE}).`,
    );
    expect(bullets).toContain(
      `Only 1 of 2 check-ins logged sleep — not enough for an average yet (need ${MIN_CHECKINS_FOR_AVERAGE}).`,
    );
    expect(bullets.some((b) => b.startsWith("Average energy"))).toBe(false);
    expect(bullets.some((b) => b.startsWith("Average sleep"))).toBe(false);
  });

  it("attributes sparse answers to fields, not check-ins", () => {
    const bullets = recoveryObservationBullets({
      ...BLANK_SUMMARY,
      checkinCount: 5,
      energyCount: 1,
      sleepCount: 0,
    });

    expect(bullets).toContain(
      `Only 1 of 5 check-ins logged energy — not enough for an average yet (need ${MIN_CHECKINS_FOR_AVERAGE}).`,
    );
    expect(bullets).toContain("No sleep logged in the last 14 days.");
  });

  it("omits symptom/soreness lines when all readings are none", () => {
    const bullets = recoveryObservationBullets({
      ...BLANK_SUMMARY,
      checkinCount: 5,
      energyCount: 5,
      avgEnergy: 4,
    });

    expect(bullets.some((b) => b.includes("symptoms above none"))).toBe(false);
    expect(bullets.some((b) => b.includes("soreness above none"))).toBe(false);
  });

  it("formats whole-number averages with one decimal in bullets", () => {
    const bullets = recoveryObservationBullets({
      ...BLANK_SUMMARY,
      checkinCount: 4,
      energyCount: 4,
      avgEnergy: 4,
    });

    expect(bullets).toContain(
      "Average energy 4.0/5 across 4 check-ins in the last 14 days.",
    );
  });

  it("formats sleep extremes without crashing", () => {
    const zero = recoveryObservationBullets({
      ...BLANK_SUMMARY,
      checkinCount: 4,
      energyCount: 4,
      avgEnergy: 4,
      sleepCount: 4,
      avgSleepMinutes: 0,
    });
    const fullDay = recoveryObservationBullets({
      ...BLANK_SUMMARY,
      checkinCount: 4,
      energyCount: 4,
      avgEnergy: 4,
      sleepCount: 4,
      avgSleepMinutes: 1440,
    });

    expect(zero).toContain("Average sleep 0h 00m across 4 nights.");
    expect(fullDay).toContain("Average sleep 24h 00m across 4 nights.");
  });

  it("states missing fields plainly for a single sparse check-in", () => {
    const bullets = recoveryObservationBullets({
      ...BLANK_SUMMARY,
      checkinCount: 1,
      energyCount: 0,
      sleepCount: 0,
    });

    expect(bullets).toContain("No energy logged in the last 14 days.");
    expect(bullets).toContain("No sleep logged in the last 14 days.");
  });

  it("propagates custom windowDays into bullet copy", () => {
    expect(summarizeRecoveryDays([], 7).windowDays).toBe(7);
    expect(recoveryObservationBullets({ ...BLANK_SUMMARY, windowDays: 7 })).toEqual([
      "No check-ins in the last 7 days yet.",
    ]);

    const bullets = recoveryObservationBullets({
      ...BLANK_SUMMARY,
      windowDays: 7,
      checkinCount: 5,
      energyCount: 5,
      avgEnergy: 4,
    });
    expect(bullets[0]).toContain("in the last 7 days.");
  });
});
