import { describe, expect, it } from "vitest";
import { formatDistance, formatHr, formatPace, formatPaceFromSecPerKm } from "@/lib/format";

// The lap-split table (ActivityList) renders nullable Strava lap fields
// directly through these helpers. A null/zero slipping through as "NaN",
// a crash, or an empty cell would silently corrupt the panel, so the "—"
// fallbacks are load-bearing and pinned here.
describe("format helpers null-safety (lap table contract)", () => {
  it("renders an em dash for null lap distance and pace fields", () => {
    expect(formatDistance(null)).toBe("—");
    expect(formatPace(null)).toBe("—");
    expect(formatPaceFromSecPerKm(null)).toBe("—");
  });

  it("renders an em dash for non-positive pace values Strava sometimes sends", () => {
    // 0/negative speeds would otherwise divide into Infinity/negative output.
    expect(formatPace(0)).toBe("—");
    expect(formatPace(-2.5)).toBe("—");
    expect(formatPaceFromSecPerKm(0)).toBe("—");
    expect(formatPaceFromSecPerKm(-30)).toBe("—");
  });

  it("treats NaN pace as missing rather than printing it", () => {
    expect(formatPace(Number.NaN)).toBe("—");
  });

  it("returns an empty string (not a dash) for missing heart rate", () => {
    // Asymmetric by design: HR renders inline next to pace, so a dash would
    // read as a value. Empty keeps the pace cell clean.
    expect(formatHr(null)).toBe("");
    expect(formatHr(172.6)).toBe("173 bpm");
  });

  it("formats real lap values without the fallback", () => {
    expect(formatDistance(1500)).toBe("1.5 km");
    // Exactly 500 s/km: exercises the non-rollover path deterministically.
    expect(formatPace(2)).toBe("8:20");
    expect(formatPaceFromSecPerKm(180)).toBe("3:00");
  });

  it("rolls over 60 rounded seconds into the next minute", () => {
    expect(formatPaceFromSecPerKm(179.96)).toBe("3:00");
  });
});
