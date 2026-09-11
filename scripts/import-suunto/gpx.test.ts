import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  isStationaryTrack,
  parseGpxTrackPoints,
  parseSuuntoFilename,
  resolveSuspiciousTrack,
  summarizeTrack,
  suuntoSportToActivityType,
  type TrackPoint,
  type TrackSummary,
} from "./gpx.ts";

// ---------------------------------------------------------------------------
// Fixtures: tiny synthetic GPX documents (no dependence on the real export).
// ---------------------------------------------------------------------------

function gpxDoc(points: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><gpx><trk><trkseg>${points}</trkseg></trk></gpx>`;
}

function trkpt(lat: string, lon: string, inner: string): string {
  return `<trkpt lat="${lat}" lon="${lon}">${inner}</trkpt>`;
}

// ~111.19 m per 0.001 deg latitude; 60s apart at 100m/60s ≈ 1.667 m/s.
const P1 = trkpt(
  "62.270700",
  "17.365800",
  `<ele>11.6</ele><time>2023-05-02T17:15:12Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>130</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`,
);
const P2 = trkpt(
  "62.271600",
  "17.365800",
  `<ele>12.6</ele><time>2023-05-02T17:16:12Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`,
);
const P3 = trkpt(
  "62.272500",
  "17.365800",
  `<ele>11.0</ele><time>2023-05-02T17:17:12Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>150</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`,
);

describe("parseGpxTrackPoints", () => {
  it("extracts coords, elevation, time and HR from each trkpt", () => {
    const points = parseGpxTrackPoints(gpxDoc(P1 + P2 + P3));
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({
      lat: 62.2707,
      lon: 17.3658,
      ele: 11.6,
      hr: 130,
    });
    expect(points[0].time.toISOString()).toBe("2023-05-02T17:15:12.000Z");
    expect(points[2].hr).toBe(150);
  });

  it("tolerates missing ele/HR and skips points without time", () => {
    const noHr = trkpt("62.0", "17.0", `<time>2023-05-02T17:15:12Z</time>`);
    const noTime = trkpt("62.0", "17.0", `<ele>5</ele>`);
    const points = parseGpxTrackPoints(gpxDoc(noHr + noTime));
    expect(points).toHaveLength(1);
    expect(points[0].ele).toBeNull();
    expect(points[0].hr).toBeNull();
  });

  it("returns an empty array for documents without track points", () => {
    expect(parseGpxTrackPoints(gpxDoc(""))).toEqual([]);
  });
});

describe("haversineMeters", () => {
  it("measures ~100m for a 0.0009 deg latitude step", () => {
    const d = haversineMeters(62.2707, 17.3658, 62.2716, 17.3658);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });

  it("returns 0 for identical points", () => {
    expect(haversineMeters(62.0, 17.0, 62.0, 17.0)).toBe(0);
  });
});

describe("summarizeTrack", () => {
  it("derives distance, times, speeds, HR and elevation from a moving track", () => {
    const summary = summarizeTrack(parseGpxTrackPoints(gpxDoc(P1 + P2 + P3)));
    expect(summary).not.toBeNull();
    // ~100m + ~100m legs.
    expect(summary!.distance!).toBeGreaterThan(190);
    expect(summary!.distance!).toBeLessThan(210);
    expect(summary!.elapsedTime).toBe(120);
    expect(summary!.movingTime).toBe(120);
    expect(summary!.averageHeartrate).toBe(140);
    expect(summary!.maxHeartrate).toBe(150);
    // Smoothed ele rises 11.6 -> ~12 then falls: gain ≈ 1m, never negative.
    expect(summary!.totalElevationGain!).toBeGreaterThanOrEqual(0);
    expect(summary!.totalElevationGain!).toBeLessThan(5);
    expect(summary!.averageSpeed!).toBeGreaterThan(1);
    expect(summary!.series.time).toEqual([0, 60, 120]);
    expect(summary!.series.heartrate).toEqual([130, 140, 150]);
  });

  it("excludes stopped segments from movingTime but keeps them in elapsedTime", () => {
    const stopped = trkpt(
      "62.271600",
      "17.365800", // same spot as P2 -> 0 m/s standstill
      `<ele>12.6</ele><time>2023-05-02T17:17:12Z</time>`,
    );
    const summary = summarizeTrack(parseGpxTrackPoints(gpxDoc(P1 + P2 + stopped)));
    expect(summary!.elapsedTime).toBe(120);
    expect(summary!.movingTime).toBe(60);
  });

  it("returns null distance (not zero) for stationary treadmill tracks", () => {
    const t1 = trkpt(
      "0.0",
      "0.0",
      `<time>2023-10-03T13:55:10Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>110</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`,
    );
    const t2 = trkpt(
      "0.0",
      "0.0",
      `<time>2023-10-03T14:21:21Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>170</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`,
    );
    const points = parseGpxTrackPoints(gpxDoc(t1 + t2));
    expect(isStationaryTrack(points)).toBe(true);
    const summary = summarizeTrack(points);
    expect(summary!.distance).toBeNull();
    expect(summary!.averageSpeed).toBeNull();
    // Duration and HR are still real and must be kept.
    expect(summary!.elapsedTime).toBe(26 * 60 + 11);
    expect(summary!.movingTime).toBe(26 * 60 + 11);
    expect(summary!.averageHeartrate).toBe(140);
    expect(summary!.maxHeartrate).toBe(170);
  });

  it("returns null for fewer than 2 points", () => {
    const one: TrackPoint[] = [
      { lat: 62.0, lon: 17.0, ele: null, time: new Date("2023-05-02T17:15:12Z"), hr: null },
    ];
    expect(summarizeTrack(one)).toBeNull();
    expect(summarizeTrack([])).toBeNull();
  });

  it("reports null HR when no samples carry heart rate", () => {
    const noHr = trkpt("62.0", "17.0", `<time>2023-05-02T17:15:12Z</time>`);
    const noHr2 = trkpt("62.001", "17.0", `<time>2023-05-02T17:16:12Z</time>`);
    const summary = summarizeTrack(parseGpxTrackPoints(gpxDoc(noHr + noHr2)));
    expect(summary!.averageHeartrate).toBeNull();
    expect(summary!.maxHeartrate).toBeNull();
  });
});

describe("summarizeTrack hardening", () => {
  it("sorts out-of-order points instead of storing negative times", () => {
    const pts = parseGpxTrackPoints(gpxDoc(P1 + P2 + P3));
    const reversed = [...pts].reverse();
    const summary = summarizeTrack(reversed);
    expect(summary!.elapsedTime).toBe(120);
    expect(summary!.movingTime).toBe(120);
    expect(summary!.series.time).toEqual([0, 60, 120]);
  });

  it("drops isolated (0,0) GPS dropouts instead of adding thousands of km", () => {
    const dropout = trkpt(
      "0.0",
      "0.0",
      `<ele>12.0</ele><time>2023-05-02T17:16:42Z</time>`,
    );
    const summary = summarizeTrack(parseGpxTrackPoints(gpxDoc(P1 + P2 + dropout + P3)));
    expect(summary!.distance!).toBeGreaterThan(190);
    expect(summary!.distance!).toBeLessThan(210);
  });

  it("returns null when only (0,0) dropouts remain after filtering", () => {
    const d1 = trkpt("0.0", "0.0", `<time>2023-05-02T17:15:12Z</time>`);
    const d2 = trkpt("0.0", "0.0", `<time>2023-05-02T17:16:12Z</time>`);
    // All-(0,0) is a stationary track (treadmill), not a dropout case.
    expect(isStationaryTrack(parseGpxTrackPoints(gpxDoc(d1 + d2)))).toBe(true);
    expect(isStationaryTrack([])).toBe(false);
  });

  it("excludes HR outside the plausible band from aggregates", () => {
    const spike = trkpt(
      "62.273400",
      "17.365800",
      `<ele>11.0</ele><time>2023-05-02T17:18:12Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>255</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`,
    );
    const summary = summarizeTrack(parseGpxTrackPoints(gpxDoc(P1 + P2 + P3 + spike)));
    expect(summary!.maxHeartrate).toBe(150);
    expect(summary!.averageHeartrate).toBe(140);
    // Raw series keeps the spike as evidence; aggregates are cleaned.
    expect(summary!.series.heartrate).toContain(255);
  });

  it("reports null maxSpeed on stationary tracks", () => {
    const t1 = trkpt("0.0", "0.0", `<time>2023-10-03T13:55:10Z</time>`);
    const t2 = trkpt("0.0", "0.0", `<time>2023-10-03T14:21:21Z</time>`);
    const summary = summarizeTrack(parseGpxTrackPoints(gpxDoc(t1 + t2)));
    expect(summary!.maxSpeed).toBeNull();
  });

  it("returns null elevation gain when no ele samples exist", () => {
    const noEle = trkpt("62.0", "17.0", `<time>2023-05-02T17:15:12Z</time>`);
    const noEle2 = trkpt("62.001", "17.0", `<time>2023-05-02T17:16:12Z</time>`);
    expect(summarizeTrack(parseGpxTrackPoints(gpxDoc(noEle + noEle2)))!.totalElevationGain).toBeNull();
  });
});

describe("parseSuuntoFilename hardening", () => {
  it("parses date and sport from export filenames", () => {
    expect(parseSuuntoFilename("2023-05-02_17.15.12-running.gpx")).toEqual({
      startDate: new Date("2023-05-02T17:15:12.000Z"),
      sport: "running",
    });
    expect(parseSuuntoFilename("2023-06-09_13.48.49-roller_skating.fit")).toEqual({
      startDate: new Date("2023-06-09T13:48:49.000Z"),
      sport: "roller_skating",
    });
  });

  it("returns null for non-matching names", () => {
    expect(parseSuuntoFilename("comments.json")).toBeNull();
    expect(parseSuuntoFilename("2023-05-02_running.gpx")).toBeNull();
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseSuuntoFilename("2023-13-40_25.99.99-running.gpx")).toBeNull();
    expect(parseSuuntoFilename("2023-02-30_10.00.00-running.gpx")).toBeNull();
  });
});

describe("suuntoSportToActivityType", () => {
  it("maps running-family slugs onto RUNNING_TYPES values", () => {
    expect(suuntoSportToActivityType("running")).toBe("Run");
    expect(suuntoSportToActivityType("treadmill")).toBe("VirtualRun");
    expect(suuntoSportToActivityType("trail_running")).toBe("TrailRun");
  });

  it("maps cross-training slugs and falls back to Workout", () => {
    expect(suuntoSportToActivityType("cycling")).toBe("Ride");
    expect(suuntoSportToActivityType("swimming")).toBe("Swim");
    expect(suuntoSportToActivityType("floorball")).toBe("Workout");
    expect(suuntoSportToActivityType("something-new")).toBe("Workout");
  });
});

describe("resolveSuspiciousTrack", () => {
  function summaryWith(movingTime: number, elapsedTime: number): TrackSummary {
    return {
      distance: 100,
      elapsedTime,
      movingTime,
      averageSpeed: 1,
      maxSpeed: 2,
      averageHeartrate: 140,
      maxHeartrate: 150,
      totalElevationGain: 5,
      series: { time: [0], distance: [0], heartrate: [140], altitude: [10] },
    };
  }

  it("nulls drift distance on GPS-dead effort but keeps duration + HR", () => {
    // Treadmill mislabeled as outdoor run: meters of GPS drift over an hour
    // at HR 171. Storing 24 m as distance would poison pace stats.
    const gpsDead = summaryWith(7, 3514);
    gpsDead.distance = 24;
    gpsDead.averageSpeed = 0.007;
    gpsDead.maxSpeed = 0.5;
    gpsDead.averageHeartrate = 171;
    const r = resolveSuspiciousTrack(gpsDead);
    expect(r.skipped).toBe(false);
    expect(r.distance).toBeNull();
    expect(r.averageSpeed).toBeNull();
    expect(r.maxSpeed).toBeNull();
    expect(r.movingTime).toBe(3514);
  });

  it("skips dead recordings with resting HR", () => {
    const dead = summaryWith(31, 10592);
    dead.averageHeartrate = 68;
    expect(resolveSuspiciousTrack(dead).skipped).toBe(true);
  });

  it("passes normal and stop-heavy sessions through untouched", () => {
    // Trail ultra with a long lunch break: 50% moving.
    const ultra = summaryWith(7200, 14400);
    expect(resolveSuspiciousTrack(ultra)).toMatchObject({ skipped: false, distance: 100 });
    // Short genuine session under the elapsed floor (distance preserved too).
    const short = resolveSuspiciousTrack(summaryWith(19, 60));
    expect(short).toMatchObject({ skipped: false, distance: 100 });
  });

  it("pins the exact thresholds and the HR boundary", () => {
    // Ratio exactly 0.05 and elapsed exactly 300 both pass through.
    expect(resolveSuspiciousTrack(summaryWith(30, 600))).toMatchObject({ skipped: false, distance: 100 });
    expect(resolveSuspiciousTrack(summaryWith(5, 300))).toMatchObject({ skipped: false, distance: 100 });
    // Just under the ratio trips the suspicious path (fixture HR 140 keeps it
    // as GPS-dead effort: distance nulled, duration kept).
    expect(resolveSuspiciousTrack(summaryWith(17, 360))).toMatchObject({ skipped: false, distance: null });

    const hrCase = (hr: number | null) => {
      const s = summaryWith(7, 3514);
      s.distance = 24;
      s.averageHeartrate = hr;
      return resolveSuspiciousTrack(s);
    };
    expect(hrCase(100)).toMatchObject({ skipped: false, distance: null });
    expect(hrCase(99).skipped).toBe(true);
    // No HR strap: dropped rather than stored as a near-zero-pace workout.
    expect(hrCase(null).skipped).toBe(true);
  });
});
