import { describe, it, expect } from "vitest";
import {
  DUP_ELAPSED_TOLERANCE_S,
  DUP_START_WINDOW_S,
  findDuplicateCandidate,
  isDuplicateActivity,
} from "./duplicate";

const T0 = new Date("2024-05-02T17:15:12.000Z");

function plus(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

describe("isDuplicateActivity", () => {
  it("matches same start and comparable duration", () => {
    expect(isDuplicateActivity(T0, 3214, plus(T0, 5), 3224)).toBe(true);
  });

  it("rejects starts outside the window", () => {
    expect(isDuplicateActivity(T0, 3214, plus(T0, DUP_START_WINDOW_S), 3214)).toBe(false);
    expect(isDuplicateActivity(T0, 3214, plus(T0, DUP_START_WINDOW_S - 1), 3214)).toBe(true);
  });

  it("rejects widely different durations inside the window", () => {
    expect(isDuplicateActivity(T0, 1000, plus(T0, 60), 5000)).toBe(false);
    expect(
      isDuplicateActivity(T0, 3000, plus(T0, 60), 3000 + DUP_ELAPSED_TOLERANCE_S),
    ).toBe(true);
  });

  it("falls back to window-only matching when either duration is unknown", () => {
    expect(isDuplicateActivity(T0, null, plus(T0, 60), 3214)).toBe(true);
    expect(isDuplicateActivity(T0, 3214, plus(T0, 60), null)).toBe(true);
    expect(isDuplicateActivity(T0, null, plus(T0, 3600), null)).toBe(false);
  });
});

describe("findDuplicateCandidate", () => {
  it("returns the first twin and null when none match", () => {
    const candidates = [
      { startDate: plus(T0, 3600), elapsedTime: 3000 },
      { startDate: plus(T0, 120), elapsedTime: 3200 },
    ];
    const hit = findDuplicateCandidate(candidates, T0, 3214);
    expect(hit).toBe(candidates[1]);
    expect(findDuplicateCandidate(candidates, plus(T0, 7200), 3214)).toBeNull();
    expect(findDuplicateCandidate([], T0, 3214)).toBeNull();
  });
});
