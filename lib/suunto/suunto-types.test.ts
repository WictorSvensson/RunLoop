import { describe, it, expect } from "vitest";
import {
  suuntoActivityIdToActivityType,
  parseSuuntoDateTime,
  mapSuuntoWorkout,
  suuntoFeelingToQuality,
  suuntoSleepQualityToQuality,
} from "./suunto-types";

// Fixed reference instant so date assertions stay deterministic regardless
// of when the suite runs (mirrors garmin-types.test.ts discipline).
const NOW = new Date("2026-10-08T12:00:00.000Z");

describe("suuntoActivityIdToActivityType", () => {
  it("maps running-family ids onto RUNNING_TYPES values", () => {
    expect(suuntoActivityIdToActivityType(1)).toBe("Run");
    expect(suuntoActivityIdToActivityType(22)).toBe("TrailRun");
    expect(suuntoActivityIdToActivityType(53)).toBe("VirtualRun");
    expect(suuntoActivityIdToActivityType(59)).toBe("Run");
    expect(suuntoActivityIdToActivityType(103)).toBe("Run");
  });

  it("maps cross-training ids", () => {
    expect(suuntoActivityIdToActivityType(2)).toBe("Ride");
    expect(suuntoActivityIdToActivityType(21)).toBe("Swim");
    expect(suuntoActivityIdToActivityType(0)).toBe("Walk");
    expect(suuntoActivityIdToActivityType(11)).toBe("Hike");
  });

  it("falls back to Workout for unknown, unused, null or garbage ids", () => {
    expect(suuntoActivityIdToActivityType(89)).toBe("Workout");
    expect(suuntoActivityIdToActivityType(999)).toBe("Workout");
    expect(suuntoActivityIdToActivityType(null)).toBe("Workout");
    expect(suuntoActivityIdToActivityType(undefined)).toBe("Workout");
    expect(suuntoActivityIdToActivityType("Running")).toBe("Workout");
    expect(suuntoActivityIdToActivityType(1.5)).toBe("Workout");
  });
});

describe("parseSuuntoDateTime", () => {
  it("reads epoch seconds and epoch milliseconds", () => {
    // 2026-10-01T06:00:00Z in seconds and in millis (spec example is ms).
    expect(parseSuuntoDateTime(1790834400)).toEqual(
      new Date("2026-10-01T06:00:00.000Z"),
    );
    expect(parseSuuntoDateTime(1790834400000)).toEqual(
      new Date("2026-10-01T06:00:00.000Z"),
    );
    // Bare epoch digits serialized as strings (schema drift).
    expect(parseSuuntoDateTime("1790834400000")).toEqual(
      new Date("2026-10-01T06:00:00.000Z"),
    );
  });

  it("reads ISO strings with designators directly", () => {
    expect(parseSuuntoDateTime("2026-10-01T06:00:00.000Z")).toEqual(
      new Date("2026-10-01T06:00:00.000Z"),
    );
    expect(parseSuuntoDateTime("2026-10-01T08:00:00+02:00")).toEqual(
      new Date("2026-10-01T06:00:00.000Z"),
    );
  });

  it("reads bare timestamps as UTC and truncates 7-digit 247 fractions", () => {
    expect(parseSuuntoDateTime("2026-10-01 06:00:00")).toEqual(
      new Date("2026-10-01T06:00:00.000Z"),
    );
    expect(parseSuuntoDateTime("2021-01-24T21:54:52.2170000+00:00")).toEqual(
      new Date("2021-01-24T21:54:52.217Z"),
    );
  });

  it("rejects impossible dates and garbage", () => {
    expect(parseSuuntoDateTime("2026-13-40 25:99:99")).toBeNull();
    expect(parseSuuntoDateTime("not-a-date")).toBeNull();
    expect(parseSuuntoDateTime(null)).toBeNull();
    expect(parseSuuntoDateTime("")).toBeNull();
    expect(parseSuuntoDateTime(-5)).toBeNull();
    expect(parseSuuntoDateTime(NaN)).toBeNull();
  });

  it("parses dates before the fixed NOW", () => {
    const parsed = parseSuuntoDateTime("2026-10-01T06:00:00.000Z");
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBeLessThan(NOW.getTime());
  });
});

describe("mapSuuntoWorkout", () => {
  // Real LimitedWorkout shape: numeric activityId, epoch startTime (ms here),
  // km/h speeds, hrdata block, kcal energy, SummaryExtension watts/cadence.
  function suuntoWorkout(overrides = {}) {
    return {
      workoutKey: "abc123def456",
      workoutName: "Morning Run",
      activityId: 1,
      startTime: 1790834400000,
      totalTime: 3610,
      totalDistance: 10000,
      totalAscent: 42.4,
      maxSpeed: 12.6,
      hrdata: { userMaxHR: 190, workoutAvgHR: 142.6, workoutMaxHR: 170 },
      energyConsumption: 600.4,
      cadence: { avg: 85.4, max: 95 },
      extensions: [
        { type: "SummaryExtension", avgPower: 210.6, maxPower: 350, avgCadence: 86.2 },
      ],
      timeOffsetInMinutes: 120,
      ...overrides,
    };
  }

  it("maps a full list row and recomputes average speed from distance/time", () => {
    const m = mapSuuntoWorkout(suuntoWorkout());
    expect(m).toMatchObject({
      externalId: "abc123def456",
      name: "Morning Run",
      type: "Run",
      distance: 10000,
      movingTime: 3610,
      elapsedTime: 3610,
      averageHeartrate: 143,
      maxHeartrate: 170,
      calories: 600,
      totalElevationGain: 42.4,
      averageWatts: 211,
      maxWatts: 350,
      averageCadence: 86,
    });
    expect(m?.startDate).toEqual(new Date("2026-10-01T06:00:00.000Z"));
    expect(m?.startDateLocal).toEqual(new Date("2026-10-01T08:00:00.000Z"));
    // 10000 / 3610 m/s — recomputed, never the list avgSpeed/avgPace units.
    expect(m?.averageSpeed).toBeCloseTo(2.77, 2);
    // maxSpeed 12.6 km/h → m/s.
    expect(m?.maxSpeed).toBeCloseTo(3.5, 3);
  });

  it("accepts epoch seconds and the key alias", () => {
    const m = mapSuuntoWorkout(
      suuntoWorkout({ key: "key2", workoutKey: undefined, startTime: 1790834400 }),
    );
    expect(m?.externalId).toBe("key2");
    expect(m?.startDate).toEqual(new Date("2026-10-01T06:00:00.000Z"));
  });

  it("returns null without a key or a usable start time", () => {
    expect(mapSuuntoWorkout(suuntoWorkout({ workoutKey: undefined }))).toBeNull();
    expect(mapSuuntoWorkout(suuntoWorkout({ startTime: "garbage" }))).toBeNull();
    expect(mapSuuntoWorkout(suuntoWorkout({ startTime: null }))).toBeNull();
  });

  it("nulls negative glitch values and avoids div-by-zero", () => {
    const neg = mapSuuntoWorkout(suuntoWorkout({ totalTime: -5, totalDistance: -10 }));
    expect(neg?.elapsedTime).toBeNull();
    expect(neg?.distance).toBeNull();
    expect(neg?.averageSpeed).toBeNull();
    const zero = mapSuuntoWorkout(suuntoWorkout({ totalTime: 0, totalDistance: 5000 }));
    expect(zero?.averageSpeed).toBeNull();
  });

  it("falls back to Workout on unknown activityId", () => {
    const m = mapSuuntoWorkout(suuntoWorkout({ activityId: 9999 }));
    expect(m?.type).toBe("Workout");
  });

  it("leaves startDateLocal null without an integer offset", () => {
    expect(mapSuuntoWorkout(suuntoWorkout({ timeOffsetInMinutes: undefined }))?.startDateLocal).toBeNull();
  });
});

describe("suuntoFeelingToQuality", () => {
  it("buckets Feeling 1-5 (Poor..Excellent)", () => {
    expect(suuntoFeelingToQuality(1)).toBe("POOR");
    expect(suuntoFeelingToQuality(2)).toBe("OKAY");
    expect(suuntoFeelingToQuality(3)).toBe("GOOD");
    expect(suuntoFeelingToQuality(4)).toBe("EXCELLENT");
    expect(suuntoFeelingToQuality(5)).toBe("EXCELLENT");
  });

  it("is honest about absent or garbage input", () => {
    expect(suuntoFeelingToQuality(null)).toBeNull();
    expect(suuntoFeelingToQuality(undefined)).toBeNull();
    expect(suuntoFeelingToQuality(NaN)).toBeNull();
    expect(suuntoFeelingToQuality(0)).toBeNull();
  });
});

describe("suuntoSleepQualityToQuality", () => {
  it("buckets 0..1 quality scores like the export importer", () => {
    expect(suuntoSleepQualityToQuality(0.95)).toBe("EXCELLENT");
    expect(suuntoSleepQualityToQuality(0.7)).toBe("GOOD");
    expect(suuntoSleepQualityToQuality(0.5)).toBe("OKAY");
    expect(suuntoSleepQualityToQuality(0.2)).toBe("POOR");
  });

  it("is honest about absent or garbage input", () => {
    expect(suuntoSleepQualityToQuality(null)).toBeNull();
    expect(suuntoSleepQualityToQuality(undefined)).toBeNull();
    expect(suuntoSleepQualityToQuality(NaN)).toBeNull();
    expect(suuntoSleepQualityToQuality(-1)).toBeNull();
  });
});
