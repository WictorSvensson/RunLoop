import { describe, expect, it } from "vitest";
import type { DailyCheckin } from "@/generated/prisma/client";
import {
  hasAnyRecoverySignal,
  severityOrdinal,
  sleepQualityOrdinal,
  toRecoveryDay,
  type RecoveryDay,
} from "@/lib/analysis/recovery";

let idCounter = 0;

// Minimal DailyCheckin-shaped fixture. Only the mapped columns matter;
// timestamps/ids are placeholders to satisfy the type.
function makeCheckin(overrides: Partial<DailyCheckin> = {}): DailyCheckin {
  idCounter += 1;
  return {
    id: `checkin-${idCounter}`,
    userId: "user-1",
    date: new Date("2026-09-09T00:00:00.000Z"),
    weight: null,
    sleepDuration: null,
    sleepQuality: null,
    energy: null,
    soreness: null,
    symptoms: null,
    notes: null,
    createdAt: new Date("2026-09-09T12:00:00.000Z"),
    updatedAt: new Date("2026-09-09T12:00:00.000Z"),
    ...overrides,
  } as DailyCheckin;
}

describe("toRecoveryDay", () => {
  it("maps every column without rescaling", () => {
    const day = toRecoveryDay(
      makeCheckin({
        date: new Date("2026-09-09T00:00:00.000Z"),
        weight: 75.2,
        sleepDuration: 432,
        sleepQuality: "GOOD",
        energy: 4,
        soreness: "MILD",
        symptoms: "NONE",
        notes: "Easy day.",
      }),
    );

    expect(day).toEqual({
      dateKey: "2026-09-09",
      energy: 4,
      sleepMinutes: 432,
      sleepQuality: "GOOD",
      soreness: "MILD",
      symptoms: "NONE",
      weightKg: 75.2,
      notes: "Easy day.",
    });
  });

  it("preserves nulls instead of inventing values", () => {
    expect(toRecoveryDay(makeCheckin())).toEqual({
      dateKey: "2026-09-09",
      energy: null,
      sleepMinutes: null,
      sleepQuality: null,
      soreness: null,
      symptoms: null,
      weightKg: null,
      notes: null,
    });
  });

  it("keys by UTC calendar day regardless of time component", () => {
    const day = toRecoveryDay(
      makeCheckin({ date: new Date("2026-09-09T23:59:59.000Z") }),
    );
    expect(day.dateKey).toBe("2026-09-09");
  });

  it("keeps the native 1-5 energy scale (no fatigue inversion)", () => {
    expect(toRecoveryDay(makeCheckin({ energy: 1 })).energy).toBe(1);
    expect(toRecoveryDay(makeCheckin({ energy: 5 })).energy).toBe(5);
  });

  it("preserves out-of-range energy verbatim (validation lives elsewhere)", () => {
    // The adapter is a mapping layer, not a validator: range enforcement is
    // validateCheckinValues' job, so unexpected stored values must pass
    // through untouched rather than being clamped or nulled here.
    expect(toRecoveryDay(makeCheckin({ energy: 9 })).energy).toBe(9);
  });

  it("keys month/year boundaries and leap days by UTC calendar day", () => {
    expect(
      toRecoveryDay(makeCheckin({ date: new Date("2025-12-31T23:59:59.000Z") }))
        .dateKey,
    ).toBe("2025-12-31");
    expect(
      toRecoveryDay(makeCheckin({ date: new Date("2026-01-01T00:00:00.000Z") }))
        .dateKey,
    ).toBe("2026-01-01");
    expect(
      toRecoveryDay(makeCheckin({ date: new Date("2024-02-29T12:00:00.000Z") }))
        .dateKey,
    ).toBe("2024-02-29");
  });
});

describe("severityOrdinal", () => {
  it("orders NONE < MILD < MODERATE < HIGH", () => {
    expect(severityOrdinal("NONE")).toBe(0);
    expect(severityOrdinal("MILD")).toBe(1);
    expect(severityOrdinal("MODERATE")).toBe(2);
    expect(severityOrdinal("HIGH")).toBe(3);
  });

  it("keeps null as null", () => {
    expect(severityOrdinal(null)).toBeNull();
  });

  it("maps unknown runtime values to null, never -1", () => {
    expect(severityOrdinal("CRITICAL" as never)).toBeNull();
  });
});

describe("sleepQualityOrdinal", () => {
  it("orders POOR < OKAY < GOOD < EXCELLENT", () => {
    expect(sleepQualityOrdinal("POOR")).toBe(0);
    expect(sleepQualityOrdinal("OKAY")).toBe(1);
    expect(sleepQualityOrdinal("GOOD")).toBe(2);
    expect(sleepQualityOrdinal("EXCELLENT")).toBe(3);
  });

  it("keeps null as null", () => {
    expect(sleepQualityOrdinal(null)).toBeNull();
  });

  it("maps unknown runtime values to null, never -1", () => {
    expect(sleepQualityOrdinal("BOGUS" as never)).toBeNull();
  });
});

describe("hasAnyRecoverySignal", () => {
  const BLANK: RecoveryDay = {
    dateKey: "2026-09-09",
    energy: null,
    sleepMinutes: null,
    sleepQuality: null,
    soreness: null,
    symptoms: null,
    weightKg: null,
    notes: null,
  };

  it("is false for a fully blank day", () => {
    expect(hasAnyRecoverySignal(BLANK)).toBe(false);
  });

  it("is true when any single field is present", () => {
    const fields: Array<keyof Omit<RecoveryDay, "dateKey">> = [
      "energy",
      "sleepMinutes",
      "sleepQuality",
      "soreness",
      "symptoms",
      "weightKg",
      "notes",
    ];
    const values = [3, 420, "GOOD", "MILD", "NONE", 75.2, "note"] as const;
    fields.forEach((field, index) => {
      expect(
        hasAnyRecoverySignal({ ...BLANK, [field]: values[index] }),
      ).toBe(true);
    });
  });

  it("treats falsy-but-present numerics as signal (guards != null checks)", () => {
    // 0 is falsy but non-null: a truthiness refactor would silently drop
    // these days, so pin the null-check semantics explicitly.
    expect(hasAnyRecoverySignal({ ...BLANK, energy: 0 })).toBe(true);
    expect(hasAnyRecoverySignal({ ...BLANK, sleepMinutes: 0 })).toBe(true);
    expect(hasAnyRecoverySignal({ ...BLANK, weightKg: 0 })).toBe(true);
  });
});
