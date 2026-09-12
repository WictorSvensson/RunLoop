import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  decodeFit,
  mergeSummaryWithFit,
  type FitSummary,
} from "./fit.ts";
import type { TrackSummary } from "./gpx.ts";

// ---------------------------------------------------------------------------
// Pure merge tests with hand-built fixtures (no dependency on the export).
// ---------------------------------------------------------------------------

function gpxSummary(overrides: Partial<TrackSummary> = {}): TrackSummary {
  return {
    distance: 10000,
    elapsedTime: 3600,
    movingTime: 3500,
    averageSpeed: 2.857,
    maxSpeed: 4.1,
    averageHeartrate: 150,
    maxHeartrate: 170,
    totalElevationGain: 120,
    series: { time: [0], distance: [0], heartrate: [150], altitude: [10] },
    ...overrides,
  };
}

function fitSummary(overrides: Partial<FitSummary> = {}): FitSummary {
  return {
    distance: 5005,
    elapsedTime: 1574,
    movingTime: 1573,
    averageHeartrate: 156,
    maxHeartrate: 162,
    averageCadence: 172,
    maxCadence: 76,
    averageWatts: 79,
    maxWatts: null,
    maxSpeed: 3.2,
    calories: 495,
    totalAscent: 88,
    series: { cadence: [170], watts: [80], distance: [5005], time: [0] },
    laps: [],
    ...overrides,
  };
}

describe("mergeSummaryWithFit", () => {
  it("fills a null GPX distance from FIT and recomputes average speed", () => {
    const merged = mergeSummaryWithFit(
      gpxSummary({ distance: null, averageSpeed: null, maxSpeed: null, movingTime: 1573 }),
      fitSummary(),
    );
    expect(merged.distance).toBe(5005);
    expect(merged.distanceFromFit).toBe(true);
    // 5005 m / 1573 s, rounded to 3 decimals.
    expect(merged.averageSpeed).toBeCloseTo(3.182, 3);
    expect(merged.maxSpeed).toBe(3.2);
  });

  it("never clobbers a GPX distance with FIT", () => {
    const merged = mergeSummaryWithFit(gpxSummary(), fitSummary({ distance: 9999 }));
    expect(merged.distance).toBe(10000);
    expect(merged.distanceFromFit).toBe(false);
    expect(merged.averageSpeed).toBe(2.857);
    expect(merged.maxSpeed).toBe(4.1);
  });

  it("keeps nulls null when neither side has data", () => {
    const merged = mergeSummaryWithFit(
      gpxSummary({ distance: null, averageSpeed: null, averageHeartrate: null, maxHeartrate: null }),
      fitSummary({ distance: null, averageHeartrate: null, maxHeartrate: null }),
    );
    expect(merged.distance).toBeNull();
    expect(merged.averageSpeed).toBeNull();
    expect(merged.averageHeartrate).toBeNull();
    expect(merged.maxHeartrate).toBeNull();
    expect(merged.distanceFromFit).toBe(false);
  });

  it("rounds FIT distance and handles zero moving time", () => {
    const rounded = mergeSummaryWithFit(
      gpxSummary({ distance: null, averageSpeed: null, maxSpeed: null, movingTime: 1000 }),
      fitSummary({ distance: 5005.46 }),
    );
    expect(rounded.distance).toBe(5005.5);
    expect(rounded.averageSpeed).toBeCloseTo(5.006, 3);

    const zeroMoving = mergeSummaryWithFit(
      gpxSummary({ distance: null, averageSpeed: null, maxSpeed: null, movingTime: 0 }),
      fitSummary({ distance: 5000 }),
    );
    expect(zeroMoving.distance).toBe(5000);
    expect(zeroMoving.averageSpeed).toBeNull();
    expect(zeroMoving.distanceFromFit).toBe(true);
  });

  it("fills elevation from FIT only when GPX lacks it", () => {
    expect(mergeSummaryWithFit(gpxSummary(), fitSummary()).totalElevationGain).toBe(120);
    expect(
      mergeSummaryWithFit(gpxSummary({ totalElevationGain: null }), fitSummary()).totalElevationGain,
    ).toBe(88);
  });

  it("fills null HR fields from FIT but keeps GPX HR when present", () => {
    const filled = mergeSummaryWithFit(
      gpxSummary({ averageHeartrate: null, maxHeartrate: null }),
      fitSummary(),
    );
    expect(filled.averageHeartrate).toBe(156);
    expect(filled.maxHeartrate).toBe(162);

    const kept = mergeSummaryWithFit(gpxSummary(), fitSummary());
    expect(kept.averageHeartrate).toBe(150);
    expect(kept.maxHeartrate).toBe(170);
  });

  it("always takes cadence/watts/calories from FIT (GPX never has them)", () => {
    const merged = mergeSummaryWithFit(gpxSummary(), fitSummary());
    expect(merged.averageCadence).toBe(172);
    expect(merged.averageWatts).toBe(79);
    expect(merged.maxWatts).toBeNull();
    expect(merged.calories).toBe(495);
  });

  it("is a no-op when FIT is null", () => {
    const merged = mergeSummaryWithFit(gpxSummary(), null);
    expect(merged.distance).toBe(10000);
    expect(merged.averageCadence).toBeNull();
    expect(merged.calories).toBeNull();
    expect(merged.distanceFromFit).toBe(false);
  });
});

describe("decodeFit", () => {
  it("returns null for garbage input instead of throwing", () => {
    expect(decodeFit(new Uint8Array([0, 1, 2, 3, 4]))).toBeNull();
    expect(decodeFit(new Uint8Array(0))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real-file verification: runs only when SUUNTO_EXPORT_DIR is set, so CI
// (which lacks the private export) stays green. Run locally with:
//   SUUNTO_EXPORT_DIR=/path/to/wictorsvensson npx vitest run scripts/import-suunto/fit.test.ts
// ---------------------------------------------------------------------------

const exportDir = process.env.SUUNTO_EXPORT_DIR;
const hasExport = exportDir != null && existsSync(join(exportDir, "workouts"));

describe.runIf(hasExport)("decodeFit on real export files", () => {
  function load(stem: string) {
    // Slice the exact view: readFileSync may return a pooled buffer.
    const raw = readFileSync(join(exportDir as string, "workouts", `${stem}.fit`));
    return decodeFit(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  }

  it("decodes treadmill session distance the GPX lacks", () => {
    const fit = load("2023-10-03_13.55.10-treadmill");
    expect(fit).not.toBeNull();
    expect(fit!.distance).toBeCloseTo(5005, 0);
    expect(fit!.averageHeartrate).toBeGreaterThan(100);
    expect(fit!.series.cadence.length).toBeGreaterThan(1000);
    expect(fit!.laps.length).toBeGreaterThan(0);
  });

  it("decodes pool swim distance and lap count", () => {
    const fit = load("2024-10-19_07.08.53-swimming");
    expect(fit).not.toBeNull();
    expect(fit!.distance).toBeCloseTo(1000, 0);
    expect(fit!.laps.length).toBe(20);
  });

  it("decodes running laps with per-lap totals", () => {
    const fit = load("2023-05-02_17.15.12-running");
    expect(fit).not.toBeNull();
    expect(fit!.distance).toBeCloseTo(11141, 0);
    expect(fit!.laps.length).toBe(12);
    expect(fit!.laps[0].lapIndex).toBe(1);
    expect(fit!.laps[0].distance).toBeGreaterThan(0);
    expect(fit!.calories).toBeGreaterThan(0);
  });
});
