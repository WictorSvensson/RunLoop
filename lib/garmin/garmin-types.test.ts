import { describe, it, expect } from "vitest";
import {
  garminTypeKeyToActivityType,
  garminSleepQualifierToQuality,
  mapGarminActivity,
  parseGarminDateTime,
} from "./garmin-types";

describe("garminTypeKeyToActivityType", () => {
  it("maps running-family keys onto RUNNING_TYPES values", () => {
    expect(garminTypeKeyToActivityType("running")).toBe("Run");
    expect(garminTypeKeyToActivityType("treadmill_running")).toBe("VirtualRun");
    expect(garminTypeKeyToActivityType("indoor_running")).toBe("VirtualRun");
    expect(garminTypeKeyToActivityType("trail_running")).toBe("TrailRun");
  });

  it("maps cross-training keys", () => {
    expect(garminTypeKeyToActivityType("swimming")).toBe("Swim");
    expect(garminTypeKeyToActivityType("lap_swimming")).toBe("Swim");
    expect(garminTypeKeyToActivityType("cycling")).toBe("Ride");
    expect(garminTypeKeyToActivityType("strength_training")).toBe("WeightTraining");
    expect(garminTypeKeyToActivityType("walking")).toBe("Walk");
    expect(garminTypeKeyToActivityType("hiking")).toBe("Hike");
  });

  it("falls back to Workout for unknown, null or empty keys", () => {
    expect(garminTypeKeyToActivityType("windsurfing")).toBe("Workout");
    expect(garminTypeKeyToActivityType(null)).toBe("Workout");
    expect(garminTypeKeyToActivityType(undefined)).toBe("Workout");
    expect(garminTypeKeyToActivityType("")).toBe("Workout");
  });
});

describe("garminSleepQualifierToQuality", () => {
  it("maps known qualifiers onto SleepQuality buckets", () => {
    expect(garminSleepQualifierToQuality("EXCELLENT")).toBe("EXCELLENT");
    expect(garminSleepQualifierToQuality("GOOD")).toBe("GOOD");
    expect(garminSleepQualifierToQuality("FAIR")).toBe("OKAY");
    expect(garminSleepQualifierToQuality("POOR")).toBe("POOR");
  });

  it("is case-insensitive and honest about unknowns", () => {
    expect(garminSleepQualifierToQuality("excellent")).toBe("EXCELLENT");
    expect(garminSleepQualifierToQuality("SOMETHING_NEW")).toBeNull();
    expect(garminSleepQualifierToQuality(null)).toBeNull();
    expect(garminSleepQualifierToQuality(undefined)).toBeNull();
  });
});

describe("parseGarminDateTime", () => {
  it("reads bare GMT timestamps as UTC regardless of server timezone", () => {
    // Would parse as server-local via `new Date(str)` (2 h off on CEST).
    expect(parseGarminDateTime("2024-06-01 12:00:00")).toEqual(
      new Date("2024-06-01T12:00:00.000Z"),
    );
    expect(parseGarminDateTime("2024-06-01T12:00:00")).toEqual(
      new Date("2024-06-01T12:00:00.000Z"),
    );
  });

  it("rejects impossible dates and garbage", () => {
    expect(parseGarminDateTime("2024-13-40 25:99:99")).toBeNull();
    expect(parseGarminDateTime("not-a-date")).toBeNull();
    expect(parseGarminDateTime(null)).toBeNull();
    expect(parseGarminDateTime("")).toBeNull();
  });
});

describe("mapGarminActivity", () => {
  function garminActivity(overrides = {}) {
    return {
      activityId: 123,
      activityName: "Morning Run",
      startTimeGMT: "2024-06-01 06:00:00",
      startTimeLocal: "2024-06-01 08:00:00",
      activityType: { typeId: 1, typeKey: "running", parentTypeId: 1, isHidden: false, sortOrder: 1, trimmable: true, restricted: false },
      distance: 10000,
      duration: 3600,
      elapsedDuration: 3610,
      movingDuration: 3500,
      averageHR: 142.6,
      maxHR: 170,
      calories: 600.4,
      ...overrides,
    } as never;
  }

  it("maps a full list row and recomputes average speed", () => {
    const m = mapGarminActivity(garminActivity());
    expect(m).toMatchObject({
      externalId: "123",
      name: "Morning Run",
      type: "Run",
      distance: 10000,
      movingTime: 3500,
      elapsedTime: 3610,
      averageHeartrate: 143,
      maxHeartrate: 170,
      calories: 600,
    });
    expect(m?.startDate).toEqual(new Date("2024-06-01T06:00:00.000Z"));
    expect(m?.startDateLocal).toEqual(new Date("2024-06-01T08:00:00.000Z"));
    // 10000 / 3500, not the list's unit-ambiguous speed.
    expect(m?.averageSpeed).toBeCloseTo(2.857, 3);
  });

  it("returns null without any usable start time", () => {
    expect(
      mapGarminActivity(garminActivity({ startTimeGMT: null, startTimeLocal: null })),
    ).toBeNull();
  });

  it("falls back to local start when GMT is missing", () => {
    const m = mapGarminActivity(garminActivity({ startTimeGMT: null }));
    expect(m?.startDate).toEqual(new Date("2024-06-01T08:00:00.000Z"));
  });

  it("nulls negative glitch values and avoids div-by-zero", () => {
    const neg = mapGarminActivity(garminActivity({ movingDuration: -5, distance: -10 }));
    expect(neg?.movingTime).toBeNull();
    expect(neg?.distance).toBeNull();
    expect(neg?.averageSpeed).toBeNull();
    const zero = mapGarminActivity(garminActivity({ movingDuration: 0, distance: 5000 }));
    expect(zero?.averageSpeed).toBeNull();
  });

  it("falls back to Workout on unknown sport", () => {
    const m = mapGarminActivity(
      garminActivity({ activityType: { typeKey: "windsurfing_xyz" } }),
    );
    expect(m?.type).toBe("Workout");
  });
});
