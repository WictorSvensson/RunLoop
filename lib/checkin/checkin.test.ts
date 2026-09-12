import { describe, it, expect } from "vitest";
import {
  parseWeightInput,
  formatWeightForInput,
  parseSleepInput,
  formatSleepForInput,
  toDateKeyUTC,
  parseDateKey,
  dateKeyToUTCDate,
  isFutureDateKey,
  validateCheckinValues,
  normalizeNotes,
  type CheckinFormValues,
} from "@/lib/checkin/checkin";

const BLANK: CheckinFormValues = {
  dateKey: "2026-09-09",
  weight: null,
  sleepDuration: null,
  sleepQuality: null,
  energy: null,
  soreness: null,
  symptoms: null,
  notes: null,
};

// Fixed "now" so future-date validation is deterministic.
const NOW = new Date("2026-09-09T12:00:00.000Z");

describe("parseWeightInput", () => {
  it("parses plain numbers, kg suffixes, and comma decimals", () => {
    expect(parseWeightInput("75.2")).toBe(75.2);
    expect(parseWeightInput("75.2 kg")).toBe(75.2);
    expect(parseWeightInput("75,2")).toBe(75.2);
    expect(parseWeightInput("  80 KG ")).toBe(80);
  });

  it("returns null for empty input", () => {
    expect(parseWeightInput("")).toBeNull();
    expect(parseWeightInput("   ")).toBeNull();
    expect(parseWeightInput(null)).toBeNull();
    expect(parseWeightInput(undefined)).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(parseWeightInput("abc")).toBeNull();
    expect(parseWeightInput("kg")).toBeNull();
  });

  it("returns null for malformed dot sequences", () => {
    expect(parseWeightInput("..75")).toBeNull();
    expect(parseWeightInput("75.2.3")).toBeNull();
  });

  it("rejects signs, exponents, and embedded units instead of stripping them", () => {
    // Strict shape: garbage must surface as an error upstream, never as a
    // wrong-but-valid number ("7h5" must not become 75).
    expect(parseWeightInput("-75")).toBeNull();
    expect(parseWeightInput("1e2")).toBeNull();
    expect(parseWeightInput("7h5")).toBeNull();
    expect(parseWeightInput("75kgabc")).toBeNull();
  });

  it("rounds to 1 decimal", () => {
    expect(parseWeightInput("75.25")).toBe(75.3);
  });
});

describe("formatWeightForInput", () => {
  it("round-trips through the parser", () => {
    expect(parseWeightInput(formatWeightForInput(75.2))).toBe(75.2);
    expect(formatWeightForInput(null)).toBe("");
  });
});

describe("parseSleepInput", () => {
  it("parses h/m combinations", () => {
    expect(parseSleepInput("7h 12m")).toBe(432);
    expect(parseSleepInput("7h12m")).toBe(432);
    expect(parseSleepInput("7 h 12 m")).toBe(432);
    expect(parseSleepInput("7h")).toBe(420);
    expect(parseSleepInput("45m")).toBe(45);
  });

  it("parses colon and decimal-hour shapes", () => {
    expect(parseSleepInput("7:12")).toBe(432);
    expect(parseSleepInput("7.5h")).toBe(450);
    expect(parseSleepInput("7,5h")).toBe(450);
  });

  it("treats small bare numbers as hours and large ones as minutes", () => {
    expect(parseSleepInput("7.5")).toBe(450);
    expect(parseSleepInput("450")).toBe(450);
  });

  it("returns null for empty or unparseable input", () => {
    expect(parseSleepInput("")).toBeNull();
    expect(parseSleepInput("   ")).toBeNull();
    expect(parseSleepInput("abc")).toBeNull();
    expect(parseSleepInput("7h?")).toBeNull();
    expect(parseSleepInput("7:99")).toBeNull();
  });

  it("rejects trailing garbage after an h/m shape", () => {
    expect(parseSleepInput("7h 12x")).toBeNull();
  });

  it("is case-insensitive for h/m markers", () => {
    expect(parseSleepInput("7H 12M")).toBe(432);
  });

  it("rejects lone markers and negative durations", () => {
    expect(parseSleepInput("h")).toBeNull();
    expect(parseSleepInput("-7h")).toBeNull();
  });

  it("documents the bare-number hours/minutes boundary", () => {
    // 24 is the largest bare value treated as hours; anything above is minutes.
    expect(parseSleepInput("24")).toBe(1440);
    expect(parseSleepInput("24.1")).toBe(24);
  });

  it("accepts single-digit colon minutes as h:mm", () => {
    expect(parseSleepInput("7:5")).toBe(425);
  });

  it("rejects partially malformed h/m shapes instead of parsing a substring", () => {
    expect(parseSleepInput("1.5.2h")).toBeNull();
    expect(parseSleepInput("7hm")).toBeNull();
    expect(parseSleepInput("m")).toBeNull();
    expect(parseSleepInput("7h 12")).toBeNull();
  });
});

describe("formatSleepForInput", () => {
  it("round-trips through the parser", () => {
    expect(parseSleepInput(formatSleepForInput(432))).toBe(432);
    expect(formatSleepForInput(432)).toBe("7h 12m");
    expect(formatSleepForInput(null)).toBe("");
  });

  it("formats midnight and full-day boundaries", () => {
    expect(formatSleepForInput(0)).toBe("0h 00m");
    expect(formatSleepForInput(1440)).toBe("24h 00m");
    expect(parseSleepInput(formatSleepForInput(0))).toBe(0);
    expect(parseSleepInput(formatSleepForInput(1440))).toBe(1440);
  });
});

describe("date key helpers", () => {
  it("formats UTC calendar days with zero padding", () => {
    expect(toDateKeyUTC(new Date("2026-09-09T12:00:00.000Z"))).toBe("2026-09-09");
  });

  it("rejects malformed or impossible dates", () => {
    expect(parseDateKey("2026-09-09")).toEqual({ y: 2026, m: 9, d: 9 });
    expect(parseDateKey("09/09/2026")).toBeNull();
    expect(parseDateKey("2026-02-30")).toBeNull();
    expect(parseDateKey("2026-13-01")).toBeNull();
  });

  it("trims surrounding whitespace and validates leap days", () => {
    expect(parseDateKey(" 2026-09-09 ")).toEqual({ y: 2026, m: 9, d: 9 });
    expect(parseDateKey("2024-02-29")).toEqual({ y: 2024, m: 2, d: 29 });
    expect(parseDateKey("2025-02-29")).toBeNull();
  });

  it("converts a key to a UTC-midnight date", () => {
    expect(dateKeyToUTCDate("2026-09-09").toISOString()).toBe(
      "2026-09-09T00:00:00.000Z",
    );
  });

  it("throws on invalid keys instead of returning a shifted date", () => {
    expect(() => dateKeyToUTCDate("not-a-date")).toThrow();
    expect(() => dateKeyToUTCDate("2026-02-30")).toThrow();
  });

  it("detects future dates against a fixed now", () => {
    expect(isFutureDateKey("2026-09-09", NOW)).toBe(false);
    expect(isFutureDateKey("2026-09-10", NOW)).toBe(true);
  });

  it("returns false (not throw) for invalid keys", () => {
    expect(isFutureDateKey("not-a-date", NOW)).toBe(false);
    expect(isFutureDateKey("", NOW)).toBe(false);
  });

  it("compares trimmed keys so padded future dates are still caught", () => {
    expect(isFutureDateKey(" 2026-09-10 ", NOW)).toBe(true);
    expect(isFutureDateKey(" 2026-09-09 ", NOW)).toBe(false);
  });
});

describe("validateCheckinValues", () => {
  it("accepts a fully blank (all-optional) form for today", () => {
    expect(validateCheckinValues(BLANK, NOW)).toEqual({});
  });

  it("accepts a fully filled valid form", () => {
    expect(
      validateCheckinValues(
        {
          ...BLANK,
          weight: 75.2,
          sleepDuration: 432,
          sleepQuality: "GOOD",
          energy: 4,
          soreness: "NONE",
          symptoms: "MILD",
          notes: "Easy day.",
        },
        NOW,
      ),
    ).toEqual({});
  });

  it("rejects future, malformed, and ancient dates", () => {
    expect(
      validateCheckinValues({ ...BLANK, dateKey: "2026-09-10" }, NOW).dateKey,
    ).toBeDefined();
    expect(
      validateCheckinValues({ ...BLANK, dateKey: "not-a-date" }, NOW).dateKey,
    ).toBeDefined();
    expect(
      validateCheckinValues({ ...BLANK, dateKey: "1999-01-01" }, NOW).dateKey,
    ).toBeDefined();
  });

  it("rejects out-of-range weight, sleep, and energy", () => {
    expect(
      validateCheckinValues({ ...BLANK, weight: 20 }, NOW).weight,
    ).toBeDefined();
    expect(
      validateCheckinValues({ ...BLANK, sleepDuration: 1500 }, NOW)
        .sleepDuration,
    ).toBeDefined();
    expect(validateCheckinValues({ ...BLANK, energy: 6 }, NOW).energy).toBeDefined();
  });

  it("rejects NaN values (e.g. Number('abc') from hand-crafted posts)", () => {
    expect(validateCheckinValues({ ...BLANK, energy: NaN }, NOW).energy).toBeDefined();
    expect(validateCheckinValues({ ...BLANK, weight: NaN }, NOW).weight).toBeDefined();
    expect(
      validateCheckinValues({ ...BLANK, sleepDuration: NaN }, NOW).sleepDuration,
    ).toBeDefined();
  });

  it("rejects non-integer and zero energy", () => {
    expect(
      validateCheckinValues({ ...BLANK, energy: 2.5 }, NOW).energy,
    ).toBeDefined();
    expect(validateCheckinValues({ ...BLANK, energy: 0 }, NOW).energy).toBeDefined();
  });

  it("accepts energy boundaries 1 and 5", () => {
    expect(validateCheckinValues({ ...BLANK, energy: 1 }, NOW)).toEqual({});
    expect(validateCheckinValues({ ...BLANK, energy: 5 }, NOW)).toEqual({});
  });

  it("enforces weight boundaries 30 and 300", () => {
    expect(validateCheckinValues({ ...BLANK, weight: 30 }, NOW)).toEqual({});
    expect(validateCheckinValues({ ...BLANK, weight: 300 }, NOW)).toEqual({});
    expect(
      validateCheckinValues({ ...BLANK, weight: 29.9 }, NOW).weight,
    ).toBeDefined();
    expect(
      validateCheckinValues({ ...BLANK, weight: 300.1 }, NOW).weight,
    ).toBeDefined();
  });

  it("enforces sleep boundaries 0 and 1440 and integer-only", () => {
    expect(validateCheckinValues({ ...BLANK, sleepDuration: 0 }, NOW)).toEqual({});
    expect(validateCheckinValues({ ...BLANK, sleepDuration: 1440 }, NOW)).toEqual(
      {},
    );
    expect(
      validateCheckinValues({ ...BLANK, sleepDuration: -1 }, NOW).sleepDuration,
    ).toBeDefined();
    expect(
      validateCheckinValues({ ...BLANK, sleepDuration: 1441 }, NOW).sleepDuration,
    ).toBeDefined();
    expect(
      validateCheckinValues({ ...BLANK, sleepDuration: 30.5 }, NOW).sleepDuration,
    ).toBeDefined();
  });

  it("accepts the year-2000 lower bound", () => {
    expect(validateCheckinValues({ ...BLANK, dateKey: "2000-01-01" }, NOW)).toEqual(
      {},
    );
  });

  it("rejects spoofed enum values with targeted messages", () => {
    expect(
      validateCheckinValues({ ...BLANK, sleepQuality: "BAD" as never }, NOW)
        .sleepQuality,
    ).toBe("Choose Poor, Okay, Good, or Excellent.");
    expect(
      validateCheckinValues({ ...BLANK, soreness: "BAD" as never }, NOW).soreness,
    ).toBe("Choose None, Mild, Moderate, or High.");
    expect(
      validateCheckinValues({ ...BLANK, symptoms: "BAD" as never }, NOW).symptoms,
    ).toBe("Choose None, Mild, Moderate, or High.");
  });

  it("rejects overlong notes", () => {
    expect(
      validateCheckinValues({ ...BLANK, notes: "x".repeat(2001) }, NOW).notes,
    ).toBeDefined();
  });

  it("accepts notes at exactly the 2000-character limit", () => {
    expect(validateCheckinValues({ ...BLANK, notes: "x".repeat(2000) }, NOW)).toEqual(
      {},
    );
  });
});

describe("normalizeNotes", () => {
  it("returns null for null, undefined, empty, and whitespace-only input", () => {
    expect(normalizeNotes(null)).toBeNull();
    expect(normalizeNotes(undefined)).toBeNull();
    expect(normalizeNotes("")).toBeNull();
    expect(normalizeNotes("   ")).toBeNull();
  });

  it("trims surrounding whitespace but preserves content", () => {
    expect(normalizeNotes("  Easy day.  ")).toBe("Easy day.");
  });
});
