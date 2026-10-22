import { describe, it, expect } from "vitest";
import { sessionProfile } from "@/lib/session-profile/profile";
import type {
  SessionActivityInput,
  SessionLapInput,
  SessionStreamsInput,
} from "@/lib/session-profile/types";

// ---------------------------------------------------------------------------
// Factories (same style as lib/dashboard/aggregate.test.ts): minimal
// Prisma-shaped fixtures, fully deterministic — no NOW needed, a session is
// a single point in time.
// ---------------------------------------------------------------------------

function makeActivity(
  overrides: Partial<SessionActivityInput> = {},
): SessionActivityInput {
  return {
    type: "Run",
    name: null,
    description: null,
    distance: null,
    movingTime: null,
    elapsedTime: null,
    averageSpeed: null,
    maxSpeed: null,
    averageHeartrate: null,
    maxHeartrate: null,
    totalElevationGain: null,
    averageTemp: null,
    ...overrides,
  };
}

function makeLap(
  lapIndex: number,
  paceSecPerKm: number,
  durationSec: number,
  hr: number | null = null,
): SessionLapInput {
  const speed = 1000 / paceSecPerKm;
  return {
    lapIndex,
    distance: Math.round(speed * durationSec * 10) / 10,
    movingTime: durationSec,
    elapsedTime: durationSec,
    averageSpeed: Math.round(speed * 1000) / 1000,
    averageHeartrate: hr,
  };
}

/** GPS stop/start split: a few meters in a few seconds (pace is noise). */
function makeFragmentLap(
  lapIndex: number,
  distanceM: number,
  durationSec: number,
  hr: number | null = null,
): SessionLapInput {
  const speed = distanceM / durationSec;
  return {
    lapIndex,
    distance: distanceM,
    movingTime: durationSec,
    elapsedTime: durationSec,
    averageSpeed: Math.round(speed * 1000) / 1000,
    averageHeartrate: hr,
  };
}

/** Steady synthetic stream: time every 5s, cumulative distance, flat HR. */
function makeSteadyStream(
  durationSec: number,
  speedMps: number,
  hr: number | null = null,
): SessionStreamsInput {
  const time: number[] = [];
  const distance: number[] = [];
  const heartrate: (number | null)[] = [];
  for (let t = 0; t <= durationSec; t += 5) {
    time.push(t);
    distance.push(Math.round(t * speedMps * 10) / 10);
    heartrate.push(hr);
  }
  return {
    time: { data: time },
    distance: { data: distance },
    heartrate: { data: heartrate },
  };
}

/**
 * The förtydligande §1 example: 15 min warmup, 6 x ~5 min work, ~60 s
 * recovery, 15 min cooldown. Work 4:10/km, recovery 6:30/km, framing 6:00/km,
 * HR rising 150 -> 166 across the work laps.
 */
function thresholdSessionLaps(): SessionLapInput[] {
  const laps: SessionLapInput[] = [makeLap(1, 360, 900, 132)];
  const workHrs = [150, 153, 156, 159, 163, 166];
  let idx = 2;
  for (let i = 0; i < 6; i++) {
    laps.push(makeLap(idx++, 250, 300, workHrs[i]));
    if (i < 5) laps.push(makeLap(idx++, 390, 60, 140));
  }
  laps.push(makeLap(idx, 360, 900, 138));
  return laps;
}

function thresholdSessionActivity(): SessionActivityInput {
  return makeActivity({
    name: "Morning intervals",
    distance: 12970,
    movingTime: 3900,
    elapsedTime: 3900,
    averageSpeed: 3.325,
    averageHeartrate: 148,
    maxHeartrate: 172,
  });
}

describe("sessionProfile — threshold intervals (spec §1 example)", () => {
  it("detects 6 work segments with ~5:00 work / ~1:00 recovery before classifying", () => {
    const profile = sessionProfile(
      thresholdSessionActivity(),
      thresholdSessionLaps(),
      null,
    );

    expect(profile.structure.hasStructure).toBe(true);
    expect(profile.structure.kind).toBe("interval");
    expect(profile.structure.workCount).toBe(6);
    expect(profile.structure.medianWorkSec).toBe(300);
    expect(profile.structure.medianRecoverySec).toBe(60);
    expect(profile.structure.warmupDetected).toBe(true);
    expect(profile.structure.cooldownDetected).toBe(true);
    expect(profile.structure.hrProgression).toBe("rising");
    expect(profile.structure.lateDeterioration).toBe("stable");
  });

  it("classifies sustained-rep work as threshold-tempo with capped confidence", () => {
    const profile = sessionProfile(
      thresholdSessionActivity(),
      thresholdSessionLaps(),
      null,
    );

    expect(profile.classification).toBe("threshold-tempo");
    // Lap evidence alone earns "high", but with no pace stream data quality
    // is medium — confidence must be capped at moderate, not stay high.
    expect(profile.confidence).toBe("moderate");
    expect(profile.dataQuality).toBe("medium");
  });

  it("reaches high confidence when a pace stream corroborates the laps", () => {
    const profile = sessionProfile(
      thresholdSessionActivity(),
      thresholdSessionLaps(),
      makeSteadyStream(3900, 3.3, 148),
    );

    expect(profile.classification).toBe("threshold-tempo");
    expect(profile.dataQuality).toBe("high");
    expect(profile.confidence).toBe("high");
  });

  it("rates threshold stimulus HIGH for 30 min quality work, recovery UNKNOWN", () => {
    const profile = sessionProfile(
      thresholdSessionActivity(),
      thresholdSessionLaps(),
      null,
    );

    expect(profile.stimulus.threshold).toBe("high");
    expect(profile.stimulus.aerobic).toBe("moderate");
    expect(profile.cost.mechanical).toBe("moderate");
    expect(profile.cost.recovery).toBe("unknown");
  });
});

describe("sessionProfile — easy steady running", () => {
  it("classifies a steady continuous run as easy-recovery with steady execution", () => {
    const activity = makeActivity({
      distance: 8000,
      movingTime: 2880,
      elapsedTime: 2900,
      averageSpeed: 2.778,
      averageHeartrate: 136,
    });
    const laps = [
      makeLap(1, 360, 720, 134),
      makeLap(2, 358, 720, 136),
      makeLap(3, 362, 720, 137),
      makeLap(4, 359, 720, 138),
    ];
    const profile = sessionProfile(activity, laps, null);

    expect(profile.structure.kind).toBe("continuous");
    expect(profile.classification).toBe("easy-recovery");
    expect(profile.execution.consistency).toBe("steady");
    expect(profile.stimulus.threshold).toBe("low");
    expect(profile.cost.recovery).toBe("unknown");
  });

  it("stays low-confidence and says so when HR is entirely absent", () => {
    const activity = makeActivity({ distance: 6000, movingTime: 2160 });
    const laps = [makeLap(1, 360, 2160)];
    const profile = sessionProfile(activity, laps, null);

    expect(profile.classification).toBe("easy-recovery");
    expect(profile.confidence).toBe("low");
    expect(
      profile.uncertainty.some((u) => u.includes("no heart-rate data")),
    ).toBe(true);
  });
});

describe("sessionProfile — long runs and short reps", () => {
  it("classifies by distance/duration markers as long", () => {
    const activity = makeActivity({
      distance: 21000,
      movingTime: 6300,
      elapsedTime: 6500,
      averageHeartrate: 145,
    });
    const laps = [
      makeLap(1, 300, 2100, 142),
      makeLap(2, 302, 2100, 145),
      makeLap(3, 301, 2100, 148),
    ];
    const profile = sessionProfile(activity, laps, null);

    expect(profile.classification).toBe("long");
    expect(profile.stimulus.aerobic).toBe("high");
    expect(profile.evidence.some((e) => e.includes("21.0 km"))).toBe(true);
  });

  it("classifies sub-3-minute reps as interval", () => {
    const laps: SessionLapInput[] = [makeLap(1, 360, 600, 130)];
    const repHrs = [160, 162, 163, 164, 165, 166, 167, 168];
    let idx = 2;
    for (let i = 0; i < 8; i++) {
      laps.push(makeLap(idx++, 210, 75, repHrs[i]));
      if (i < 7) laps.push(makeLap(idx++, 400, 90, 140));
    }
    laps.push(makeLap(idx, 360, 600, 135));
    const activity = makeActivity({
      distance: 9500,
      movingTime: 2400,
      averageHeartrate: 152,
    });
    const profile = sessionProfile(activity, laps, null);

    expect(profile.structure.kind).toBe("interval");
    expect(profile.structure.workCount).toBe(8);
    expect(profile.structure.medianWorkSec).toBe(75);
    expect(profile.classification).toBe("interval");
  });
});

describe("sessionProfile — honest unknown states", () => {
  it("returns unknown/insufficient when distance and time are both missing", () => {
    const profile = sessionProfile(makeActivity(), [], null);

    expect(profile.classification).toBe("unknown");
    expect(profile.confidence).toBe("insufficient");
    expect(profile.dataQuality).toBe("poor");
    expect(profile.cost.recovery).toBe("unknown");
  });

  it("returns unknown/insufficient for non-running activity types", () => {
    const profile = sessionProfile(
      makeActivity({ type: "Ride", distance: 40000, movingTime: 3600 }),
      [],
      null,
    );

    expect(profile.classification).toBe("unknown");
    expect(profile.confidence).toBe("insufficient");
  });

  it("classifies race labels as race-benchmark but caps at moderate", () => {
    const activity = makeActivity({
      name: "Stockholm 10K Race",
      distance: 10000,
      movingTime: 2400,
      averageHeartrate: 172,
    });
    const profile = sessionProfile(activity, [makeLap(1, 240, 2400, 172)], null);

    expect(profile.classification).toBe("race-benchmark");
    expect(profile.confidence).toBe("moderate");
    expect(
      profile.uncertainty.some((u) => u.includes("label only")),
    ).toBe(true);
  });

  it("detects late-rep deterioration and marks execution deteriorated", () => {
    // 4 x ~5 min, work pace fading 4:00 -> 4:24 (+10%).
    const laps = [
      makeLap(1, 360, 600, 130),
      makeLap(2, 240, 300, 158),
      makeLap(3, 248, 300, 162),
      makeLap(4, 390, 90, 140),
      makeLap(5, 256, 300, 165),
      makeLap(6, 390, 90, 142),
      makeLap(7, 264, 300, 168),
      makeLap(8, 360, 600, 140),
    ];
    const activity = makeActivity({
      distance: 10500,
      movingTime: 3180,
      averageHeartrate: 155,
    });
    const profile = sessionProfile(activity, laps, null);

    expect(profile.structure.kind).toBe("interval");
    expect(profile.structure.lateDeterioration).toBe("deteriorating");
    expect(profile.execution.consistency).toBe("deteriorated");
  });

  it("uses a steady pace stream when laps are absent, staying low-confidence", () => {
    const activity = makeActivity({ distance: 9000, movingTime: 3240 });
    const profile = sessionProfile(
      activity,
      [],
      makeSteadyStream(3240, 2.78),
    );

    expect(profile.structure.hasStructure).toBe(false);
    expect(profile.classification).toBe("easy-recovery");
    expect(profile.confidence).toBe("low");
    expect(
      profile.evidence.some((e) => e.startsWith("pace stream:")),
    ).toBe(true);
  });
});

describe("sessionProfile — GPS fragment laps (reported mixed-shape regressions)", () => {
  it("reads a steady 10 km plus a 10 m stop-split as continuous, not mixed", () => {
    // Real shape cmuzh8zig: 10 steady ~4:04–4:23/km laps (HR 170–188) plus a
    // 10 m / 2 s watch split whose 3:00/km noise pace inflated lap CV to
    // 0.089 (variable → mixed). Without the fragment CV is ~0.025.
    const laps = [
      makeLap(1, 243.6, 244, 175),
      makeLap(2, 244, 244, 182),
      makeLap(3, 250.8, 251, 184),
      makeLap(4, 252.9, 253, 185),
      makeLap(5, 256.2, 256, 183),
      makeLap(6, 255.8, 256, 184),
      makeLap(7, 258.5, 259, 185),
      makeLap(8, 263, 263, 170),
      makeLap(9, 258.5, 259, 177),
      makeLap(10, 246.2, 246, 188),
      makeFragmentLap(11, 10, 2, 190),
    ];
    const activity = makeActivity({
      distance: 10010,
      movingTime: 2531,
      averageHeartrate: 181,
    });
    const profile = sessionProfile(activity, laps, null);

    expect(profile.structure.kind).toBe("continuous");
    expect(profile.classification).toBe("easy-recovery");
    expect(
      profile.structure.notes.some((n) => n.includes("fragment lap")),
    ).toBe(true);
  });

  it("reads a steady 6 km plus a slow 13 m tail split as easy, not mixed", () => {
    // Real shape cmuzh91mk: 6 steady ~4:04–4:12/km laps plus a 13 m / 5 s
    // tail split — the fragment alone pushed lap CV to 0.13 (mixed).
    const laps = [
      makeLap(1, 249.3, 249, 169),
      makeLap(2, 246.3, 246, 175),
      makeLap(3, 251.5, 252, 180),
      makeLap(4, 243.6, 244, 171),
      makeLap(5, 248.8, 249, 172),
      makeLap(6, 252.2, 252, 176),
      makeFragmentLap(7, 13, 5, 183),
    ];
    const activity = makeActivity({
      distance: 6013,
      movingTime: 1496,
      averageHeartrate: 174,
    });
    const profile = sessionProfile(activity, laps, null);

    expect(profile.structure.kind).toBe("continuous");
    expect(profile.classification).toBe("easy-recovery");
  });

  it("reads one real kilometre plus a 16 m split as a single continuous effort", () => {
    // Real shape cmuzh8zah: 1000 m + 16 m / 7 s split — two "timed laps"
    // with CV 0.114 read as variable (mixed); one timed lap is continuous.
    const laps = [makeLap(1, 367.8, 368, 135), makeFragmentLap(2, 16, 7, 141)];
    const activity = makeActivity({ distance: 1016, movingTime: 375 });
    const profile = sessionProfile(activity, laps, null);

    expect(profile.structure.kind).toBe("continuous");
    expect(profile.classification).toBe("easy-recovery");
    expect(
      profile.structure.notes.some((n) => n.includes("single timed lap")),
    ).toBe(true);
  });

  it("still detects intervals when a fragment split trails the session", () => {
    // Fragments must not mask real structure: 4 x ~75 s reps with recovery
    // framing plus a 7 m / 4 s watch split at the end.
    const laps: SessionLapInput[] = [makeLap(1, 360, 600, 130)];
    let idx = 2;
    for (let i = 0; i < 4; i++) {
      laps.push(makeLap(idx++, 210, 75, 162 + i));
      if (i < 3) laps.push(makeLap(idx++, 400, 90, 140));
    }
    laps.push(makeLap(idx++, 360, 600, 135));
    laps.push(makeFragmentLap(idx, 7, 4, 159));
    const activity = makeActivity({
      distance: 5200,
      movingTime: 2100,
      averageHeartrate: 152,
    });
    const profile = sessionProfile(activity, laps, null);

    expect(profile.structure.kind).toBe("interval");
    expect(profile.structure.workCount).toBe(4);
    expect(profile.classification).toBe("interval");
  });

  it("says timed laps are missing when only fragments were recorded", () => {
    const laps = [
      makeFragmentLap(1, 10, 2, 150),
      makeFragmentLap(2, 16, 7, 152),
    ];
    const activity = makeActivity({ distance: 26, movingTime: 9 });
    const profile = sessionProfile(activity, laps, null);

    expect(profile.structure.hasStructure).toBe(false);
    expect(
      profile.uncertainty.some((u) => u.includes("no timed laps")),
    ).toBe(true);
  });
});
describe("sessionProfile — no fabricated precision", () => {
  it("keeps recovery cost UNKNOWN on every session shape", () => {
    const sessions: [SessionActivityInput, SessionLapInput[], SessionStreamsInput][] = [
      [thresholdSessionActivity(), thresholdSessionLaps(), null],
      [makeActivity(), [], null],
      [
        makeActivity({ distance: 21000, movingTime: 6300, averageHeartrate: 145 }),
        [],
        makeSteadyStream(6300, 3.3, 145),
      ],
    ];
    for (const [activity, laps, streams] of sessions) {
      const profile = sessionProfile(activity, laps, streams);
      expect(profile.cost.recovery).toBe("unknown");
      expect(profile.cost.recoveryReason.length).toBeGreaterThan(0);
    }
  });

  it("always states the v0.1 no-zones limitation in uncertainty", () => {
    const profile = sessionProfile(
      thresholdSessionActivity(),
      thresholdSessionLaps(),
      makeSteadyStream(3900, 3.3, 148),
    );
    expect(
      profile.uncertainty.some((u) => u.includes("no individualized HR zones")),
    ).toBe(true);
  });
});
