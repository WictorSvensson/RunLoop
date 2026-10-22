import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Mock the FIT SDK so decodeFit can be exercised with crafted messages
// without binary .fit fixtures. Vitest isolates modules per test file, so
// the real-SDK tests in fit.test.ts are unaffected.
const mockState = vi.hoisted(() => ({
  messages: {} as Record<string, unknown[]>,
  errors: [] as unknown[],
  shouldThrow: false,
}));

vi.mock("@garmin/fitsdk", () => ({
  Decoder: class {
    constructor() {}
    read() {
      if (mockState.shouldThrow) throw new Error("decode boom");
      return { messages: mockState.messages, errors: mockState.errors };
    }
  },
  Stream: {
    fromByteArray: () => ({}),
  },
}));

import {
  decodeFit,
  fitStreamPayload,
  mapLapIndicesToRecords,
  type FitSeries,
} from "./fit.ts";

const T0 = Date.UTC(2024, 0, 1, 12, 0, 0);

function rec(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: new Date(T0),
    distance: 0,
    cadence: 80,
    power: 100,
    heartRate: 150,
    speed: 3.0,
    altitude: 50,
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    totalDistance: 1000,
    totalElapsedTime: 400,
    totalTimerTime: 390,
    ...overrides,
  };
}

beforeEach(() => {
  mockState.messages = {};
  mockState.errors = [];
  mockState.shouldThrow = false;
});

function decodeWith(messages: Record<string, unknown[]>) {
  mockState.messages = messages;
  return decodeFit(new Uint8Array([1, 2, 3]));
}

describe("decodeFit granular series", () => {
  it("should build equal-length heartrate/speed/altitude series aligned with time/distance", () => {
    const fit = decodeWith({
      sessionMesgs: [session()],
      recordMesgs: [
        rec({ timestamp: new Date(T0), distance: 0, heartRate: 150, speed: 3.0, altitude: 10 }),
        rec({ timestamp: new Date(T0 + 1000), distance: 3, heartRate: 152, speed: 3.1, altitude: 11 }),
        rec({ timestamp: new Date(T0 + 2000), distance: 6, heartRate: 154, speed: 3.2, altitude: 12 }),
      ],
      lapMesgs: [],
    });
    expect(fit).not.toBeNull();
    const s = fit!.series;
    // Arrange-Act-Assert: all series share one length/indexing.
    for (const arr of [s.time, s.distance, s.cadence, s.watts, s.heartrate, s.speed, s.altitude]) {
      expect(arr.length).toBe(3);
    }
    expect(s.heartrate).toEqual([150, 152, 154]);
    expect(s.speed).toEqual([3.0, 3.1, 3.2]);
    expect(s.altitude).toEqual([10, 11, 12]);
  });

  it("should preserve nulls in place instead of shifting series", () => {
    const fit = decodeWith({
      sessionMesgs: [session()],
      recordMesgs: [
        rec({ timestamp: new Date(T0), distance: 0, heartRate: 150, speed: 3.0, altitude: 10 }),
        // Middle record carries no HR/speed/altitude/cadence/power.
        rec({
          timestamp: new Date(T0 + 1000),
          distance: 3,
          heartRate: undefined,
          speed: undefined,
          altitude: undefined,
          cadence: undefined,
          power: undefined,
        }),
        rec({ timestamp: new Date(T0 + 2000), distance: 6, heartRate: 154, speed: 3.2, altitude: 12 }),
      ],
      lapMesgs: [],
    });
    const s = fit!.series;
    expect(s.heartrate).toEqual([150, null, 154]);
    expect(s.speed).toEqual([3.0, null, 3.2]);
    expect(s.altitude).toEqual([10, null, 12]);
    // Index 1 means the same record in every series.
    expect(s.time).toEqual([0, 1, 2]);
    expect(s.distance).toEqual([0, 3, 6]);
  });

  it("should drop a null-distance record as a whole tuple, keeping the rest aligned", () => {
    const fit = decodeWith({
      sessionMesgs: [session()],
      recordMesgs: [
        rec({ timestamp: new Date(T0), distance: 0, heartRate: 150 }),
        rec({ timestamp: new Date(T0 + 1000), distance: undefined, heartRate: 999 }),
        rec({ timestamp: new Date(T0 + 2000), distance: 6, heartRate: 154 }),
      ],
      lapMesgs: [],
    });
    const s = fit!.series;
    expect(s.distance).toEqual([0, 6]);
    expect(s.heartrate).toEqual([150, 154]);
    expect(s.time).toEqual([0, 2]);
    expect(s.time.length).toBe(s.heartrate.length);
  });

  it("should store fitTime as offset seconds from the first record, not absolute epoch", () => {
    const fit = decodeWith({
      sessionMesgs: [session()],
      recordMesgs: [
        rec({ timestamp: new Date(T0), distance: 0 }),
        rec({ timestamp: new Date(T0 + 5000), distance: 15 }),
        rec({ timestamp: new Date(T0 + 12500), distance: 30 }),
      ],
      lapMesgs: [],
    });
    // 0s, 5s, rounded 12.5s -> 13s (Math.round in impl).
    expect(fit!.series.time).toEqual([0, 5, 13]);
  });

  it("should round heartrate/watts to integers and speed to 3 decimals", () => {
    const fit = decodeWith({
      sessionMesgs: [session()],
      recordMesgs: [rec({ heartRate: 150.6, power: 82.4, speed: 3.12345 })],
      lapMesgs: [],
    });
    expect(fit!.series.heartrate).toEqual([151]);
    expect(fit!.series.watts).toEqual([82]);
    expect(fit!.series.speed).toEqual([3.123]);
  });

  it("should decode all-null series to empty [] (absent) while keeping time/distance", () => {
    const fit = decodeWith({
      sessionMesgs: [session()],
      recordMesgs: [
        rec({
          timestamp: new Date(T0),
          distance: 5,
          cadence: undefined,
          power: undefined,
          heartRate: undefined,
          speed: undefined,
          altitude: undefined,
        }),
      ],
      lapMesgs: [],
    });
    expect(fit!.series.cadence).toEqual([]);
    expect(fit!.series.watts).toEqual([]);
    expect(fit!.series.heartrate).toEqual([]);
    expect(fit!.series.speed).toEqual([]);
    expect(fit!.series.altitude).toEqual([]);
    // Distance present keeps the clock.
    expect(fit!.series.time).toEqual([0]);
    expect(fit!.series.distance).toEqual([5]);
  });

  it("should return empty time when there are no records at all", () => {
    const fit = decodeWith({ sessionMesgs: [session()], recordMesgs: [], lapMesgs: [] });
    expect(fit!.series.time).toEqual([]);
    expect(fit!.series.distance).toEqual([]);
    expect(fit!.series.cadence).toEqual([]);
  });

  it("should return null when the SDK throws or no session exists", () => {
    mockState.shouldThrow = true;
    expect(decodeWith({ sessionMesgs: [session()] })).toBeNull();
    mockState.shouldThrow = false;
    expect(decodeWith({ sessionMesgs: [], recordMesgs: [rec()] })).toBeNull();
  });
});

describe("fitStreamPayload", () => {
  function fullSeries(): FitSeries {
    return {
      cadence: [80, null, 82],
      watts: [100, 101, null],
      heartrate: [150, null, 154],
      speed: [3.0, null, 3.2],
      altitude: [10, null, 12],
      distance: [0, 3, 6],
      time: [0, 1, 2],
    };
  }

  it("should emit every non-empty series with nulls preserved and never include distance", () => {
    const payload = fitStreamPayload(fullSeries());
    expect(payload.heartrate).toEqual({ data: [150, null, 154] });
    expect(payload.speed).toEqual({ data: [3.0, null, 3.2] });
    expect(payload.altitude).toEqual({ data: [10, null, 12] });
    expect(payload.fitTime).toEqual({ data: [0, 1, 2] });
    expect(payload).not.toHaveProperty("distance");
  });

  it("should omit empty series with the empty-[]=absent convention", () => {
    const payload = fitStreamPayload({
      cadence: [],
      watts: [],
      heartrate: [],
      speed: [],
      altitude: [],
      distance: [0, 3],
      time: [],
    });
    expect(payload).toEqual({});
  });

  it("should support the upload-route subset (fitTime/cadence/watts/speed only)", () => {
    const fitKeys = fitStreamPayload(fullSeries());
    const subset: Record<string, { data: (number | null)[] }> = {};
    for (const key of ["fitTime", "cadence", "watts", "speed"] as const) {
      if (fitKeys[key]) subset[key] = fitKeys[key];
    }
    expect(Object.keys(subset).sort()).toEqual(["cadence", "fitTime", "speed", "watts"]);
    expect(subset).not.toHaveProperty("heartrate");
    expect(subset).not.toHaveProperty("altitude");
    expect(subset).not.toHaveProperty("distance");
  });

  it("should support the FIT-only sync shape (payload + distance, gated on time)", () => {
    // Mirrors lib/garmin/import.ts + lib/suunto/import.ts:
    // gate on time.length > 0, merge fitStreamPayload, then add distance.
    const withTime = fullSeries();
    const gated: Record<string, { data: (number | null)[] }> = {};
    if (withTime.time.length > 0) {
      Object.assign(gated, fitStreamPayload(withTime));
      if (withTime.distance.length > 0) gated.distance = { data: withTime.distance };
    }
    expect(gated.fitTime).toBeDefined();
    expect(gated.heartrate).toBeDefined();
    expect(gated.distance).toEqual({ data: [0, 3, 6] });

    const noTime: FitSeries = { ...withTime, time: [] };
    const empty: Record<string, { data: (number | null)[] }> = {};
    if (noTime.time.length > 0) Object.assign(empty, fitStreamPayload(noTime));
    expect(empty).toEqual({});
  });
});

describe("mapLapIndicesToRecords", () => {
  it("should map lap starts to kept-record indices with end as next start minus one", () => {
    expect(
      mapLapIndicesToRecords([T0, T0 + 1000, T0 + 2000, T0 + 3000], [T0, T0 + 2000]),
    ).toEqual([
      { startIndex: 0, endIndex: 1 },
      { startIndex: 2, endIndex: 3 },
    ]);
  });

  it("should skip null record timestamps when matching", () => {
    expect(mapLapIndicesToRecords([null, T0 + 2000], [T0 + 2000])).toEqual([
      { startIndex: 1, endIndex: 1 },
    ]);
  });

  it("should clamp a start before the first record to 0 and a start past the end to the final index", () => {
    expect(mapLapIndicesToRecords([T0 + 1000, T0 + 2000], [T0, T0 + 9999])).toEqual([
      { startIndex: 0, endIndex: 0 },
      { startIndex: 1, endIndex: 1 },
    ]);
  });

  it("should return nulls for unknown lap starts and empty record lists", () => {
    expect(mapLapIndicesToRecords([T0], [null])).toEqual([{ startIndex: null, endIndex: null }]);
    expect(mapLapIndicesToRecords([], [T0])).toEqual([{ startIndex: null, endIndex: null }]);
  });

  it("should extend a lap end across a later unknown (null) lap start", () => {
    expect(mapLapIndicesToRecords([T0, T0 + 1000, T0 + 2000], [T0, null, T0 + 2000])).toEqual([
      { startIndex: 0, endIndex: 1 },
      { startIndex: null, endIndex: null },
      { startIndex: 2, endIndex: 2 },
    ]);
  });
});

describe("decodeFit lap index integration", () => {
  it("should address lap indices into the kept (distance-filtered) series", () => {
    const fit = decodeWith({
      sessionMesgs: [session()],
      recordMesgs: [
        rec({ timestamp: new Date(T0), distance: 0 }),
        // Dropped tuple (null distance) — indices must skip it.
        rec({ timestamp: new Date(T0 + 1000), distance: undefined }),
        rec({ timestamp: new Date(T0 + 2000), distance: 6 }),
        rec({ timestamp: new Date(T0 + 3000), distance: 9 }),
      ],
      lapMesgs: [
        { startTime: new Date(T0), totalElapsedTime: 2, totalTimerTime: 2, totalDistance: 6 },
        { startTime: new Date(T0 + 3000), totalElapsedTime: 1, totalTimerTime: 1, totalDistance: 3 },
      ],
    });
    expect(fit!.laps.length).toBe(2);
    // Kept timestamps are [T0, T0+2000, T0+3000]; lap 2 starts at the last one.
    expect(fit!.laps[0].startIndex).toBe(0);
    expect(fit!.laps[0].endIndex).toBe(1);
    expect(fit!.laps[1].startIndex).toBe(2);
    expect(fit!.laps[1].endIndex).toBe(2);
    // Indices stay inside every aligned series.
    for (const lap of fit!.laps) {
      expect(lap.startIndex).toBeGreaterThanOrEqual(0);
      expect(lap.endIndex).toBeLessThan(fit!.series.time.length);
    }
  });
});

describe("importer payload-shape contract (static)", () => {
  function src(rel: string) {
    return readFileSync(join(process.cwd(), rel), "utf8");
  }

  it("should keep Garmin + Suunto FIT-only paths on fitStreamPayload gated by time, with distance added separately", () => {
    for (const rel of ["lib/garmin/import.ts", "lib/suunto/import.ts"]) {
      const text = src(rel);
      expect(text).toContain("fitStreamPayload(fit.series)");
      expect(text).toContain("fit.series.time.length > 0");
      expect(text).toContain("payload.distance");
      expect(text).not.toMatch(/payload\.heartrate\s*=/);
    }
  });

  it("should keep the upload route on the GPX-truth subset (fitTime/cadence/watts/speed, no FIT heartrate/altitude)", () => {
    const text = src("app/api/suunto/upload/route.ts");
    expect(text).toContain('["fitTime", "cadence", "watts", "speed"]');
    expect(text).toContain("fitStreamPayload(fit.series)");
    // FIT heartrate/altitude must not be copied into the GPX-backed payload.
    expect(text).not.toContain('"heartrate", "altitude"');
  });
});
