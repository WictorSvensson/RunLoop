import { describe, expect, it } from "vitest";
import { normalizeExportPaths, qualityToSleepQuality } from "./suunto-files";

describe("normalizeExportPaths", () => {
  it("passes through already-rooted exports", () => {
    expect(
      normalizeExportPaths([
        "workouts/2024-01-01_10.00.00-running.gpx",
        "sleep/2024-01-01.ndjson",
        "user/user.json",
      ]),
    ).toEqual([
      "workouts/2024-01-01_10.00.00-running.gpx",
      "sleep/2024-01-01.ndjson",
      "user/user.json",
    ]);
  });

  it("strips a single shared root folder", () => {
    expect(
      normalizeExportPaths([
        "wictorsvensson/workouts/2024-01-01_10.00.00-running.gpx",
        "wictorsvensson/user/user.json",
      ]),
    ).toEqual(["workouts/2024-01-01_10.00.00-running.gpx", "user/user.json"]);
  });

  it("normalizes separators and drops directory entries", () => {
    expect(
      normalizeExportPaths([".\\wictorsvensson\\workouts\\a.gpx", "wictorsvensson/", "./wictorsvensson/user/user.json"]),
    ).toEqual(["workouts/a.gpx", "user/user.json"]);
  });

  it("leaves mixed roots untouched", () => {
    expect(normalizeExportPaths(["a/x.gpx", "b/y.gpx"])).toEqual(["a/x.gpx", "b/y.gpx"]);
  });
});

describe("qualityToSleepQuality", () => {
  it("maps the 0..1 range to enum bands", () => {
    expect(qualityToSleepQuality(0.95)).toBe("EXCELLENT");
    expect(qualityToSleepQuality(0.7)).toBe("GOOD");
    expect(qualityToSleepQuality(0.5)).toBe("OKAY");
    expect(qualityToSleepQuality(0.2)).toBe("POOR");
    expect(qualityToSleepQuality(null)).toBeNull();
    expect(qualityToSleepQuality(NaN)).toBeNull();
  });
});
