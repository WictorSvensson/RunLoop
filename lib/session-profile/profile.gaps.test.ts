import { describe, it, expect } from "vitest";
import { sessionProfile } from "@/lib/session-profile/profile";
import type {
  Confidence,
  SessionActivityInput,
  SessionLapInput,
  SessionStreamsInput,
} from "@/lib/session-profile/types";

// ---------------------------------------------------------------------------
// Gap coverage for SessionProfile v0.1 (pure sessionProfile(activity,laps,
// streams)). The main spec-example paths live in profile.test.ts; these tests
// pin down the branches that file does not reach:
//
//   - structure details: strides, framing exclusion, contiguous blocks,
//     estimated durations, the sub-4-lap ladder, HR falling/stable/unknown,
//     progressive finish, FIT streams, short-stream rejection, stream-vs-lap
//     precedence
//   - classification: "mixed", unknown/low (vs unknown/insufficient),
//     null/non-running types, TrailRun/VirtualRun, quality capping
//   - honesty invariants: qualitative confidence only, recovery UNKNOWN on
//     every class, no-zones limitation stated everywhere
//   - stimulus/cost levels: threshold moderate/unknown, aerobic unknown,
//     mechanical high/elevation/unknown
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

/** DTO-shaped lap: distance + pace only, no per-lap times (estimated path). */
function makeEstimatedLap(
  lapIndex: number,
  paceSecPerKm: number,
  durationSec: number,
  hr: number | null = null,
): SessionLapInput {
  const speed = Math.round((1000 / paceSecPerKm) * 1000) / 1000;
  return {
    lapIndex,
    distance: Math.round(speed * durationSec * 10) / 10,
    averageSpeed: speed,
    averageHeartrate: hr,
  };
}

/** The förtydligande §1 shape: warmup, 6 x 5 min work, ~60 s recovery, cooldown. */
function thresholdLaps(workHrs: (number | null)[]): SessionLapInput[] {
  const laps: SessionLapInput[] = [makeLap(1, 360, 900, 132)];
  let idx = 2;
  for (let i = 0; i < workHrs.length; i++) {
    laps.push(makeLap(idx++, 250, 300, workHrs[i]));
    if (i < workHrs.length - 1) laps.push(makeLap(idx++, 390, 60, 140));
  }
  laps.push(makeLap(idx, 360, 900, 138));
  return laps;
}

function steadyLaps(): SessionLapInput[] {
  return [
    makeLap(1, 360, 720, 134),
    makeLap(2, 358, 720, 136),
    makeLap(3, 362, 720, 137),
    makeLap(4, 359, 720, 138),
  ];
}

/** FIT-only sync shape: cumulative fitTime + distance, no HR series. */
function makeFitStream(
  durationSec: number,
  speedMps: number,
): SessionStreamsInput {
  const fitTime: number[] = [];
  const distance: number[] = [];
  for (let t = 0; t <= durationSec; t += 5) {
    fitTime.push(t);
    distance.push(Math.round(t * speedMps * 10) / 10);
  }
  return {
    fitTime: { data: fitTime },
    distance: { data: distance },
  };
}

function makeSteadyStream(durationSec: number, speedMps: number) {
  const time: number[] = [];
  const distance: number[] = [];
  for (let t = 0; t <= durationSec; t += 5) {
    time.push(t);
    distance.push(Math.round(t * speedMps * 10) / 10);
  }
  return {
    time: { data: time },
    distance: { data: distance },
  };
}

describe("sessionProfile gaps — structure details", () => {
  it("treats sub-60s fast laps as strides, not work, and claims no structure", () => {
    // Arrange: 4 slow laps + 2 fast 30 s pickups — too short to be work.
    const laps = [
      makeLap(1, 360, 600, 130),
      makeLap(2, 250, 30, 160),
      makeLap(3, 360, 600, 132),
      makeLap(4, 250, 30, 162),
      makeLap(5, 360, 600, 134),
      makeLap(6, 360, 600, 136),
    ];
    const activity = makeActivity({ distance: 7000, movingTime: 2500 });

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert.
    expect(profile.structure.hasStructure).toBe(false);
    expect(profile.structure.workCount).toBe(0);
    expect(profile.structure.notes.some((n) => n.includes("strides"))).toBe(
      true,
    );
  });

  it("excludes warmup/cooldown laps from the recovery count", () => {
    // Arrange: the §1 example has 5 inner recoveries + 2 framing laps.
    const activity = makeActivity({
      distance: 12970,
      movingTime: 3900,
      averageHeartrate: 148,
    });

    // Act.
    const profile = sessionProfile(
      activity,
      thresholdLaps([150, 153, 156, 159, 163, 166]),
      null,
    );

    // Assert.
    expect(profile.structure.recoveryCount).toBe(5);
    expect(profile.structure.warmupDetected).toBe(true);
    expect(profile.structure.cooldownDetected).toBe(true);
  });

  it("reads one contiguous fast block as continuous, not intervals", () => {
    // Arrange: slow, slow, fast x3, slow — no work/recovery alternation.
    const laps = [
      makeLap(1, 360, 300, 130),
      makeLap(2, 360, 300, 132),
      makeLap(3, 250, 300, 158),
      makeLap(4, 250, 300, 160),
      makeLap(5, 250, 300, 162),
      makeLap(6, 360, 300, 140),
    ];
    const activity = makeActivity({
      distance: 9000,
      movingTime: 2400,
      averageHeartrate: 145,
    });

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert.
    expect(profile.structure.hasStructure).toBe(false);
    expect(profile.structure.kind).toBe("continuous");
    expect(
      profile.structure.notes.some((n) => n.includes("contiguous block")),
    ).toBe(true);
  });

  it("flags estimated lap durations in notes and uncertainty", () => {
    // Arrange: DTO-shaped laps carry no per-lap times.
    const full = thresholdLaps([150, 153, 156, 159, 163, 166]);
    const estimated: SessionLapInput[] = full.map((lap, i) =>
      makeEstimatedLap(i + 1, 1000 / (lap.averageSpeed ?? 3), 300, 150),
    );
    const activity = makeActivity({
      distance: 12000,
      movingTime: 3900,
      averageHeartrate: 148,
    });

    // Act.
    const profile = sessionProfile(activity, estimated, null);

    // Assert.
    expect(
      profile.structure.notes.some((n) => n.includes("estimated")),
    ).toBe(true);
    expect(
      profile.uncertainty.some((u) => u.includes("estimates")),
    ).toBe(true);
  });

  it("reads two steady laps as one continuous effort", () => {
    // Arrange.
    const laps = [makeLap(1, 360, 600, 135), makeLap(2, 362, 600, 136)];
    const activity = makeActivity({
      distance: 3400,
      movingTime: 1200,
      averageHeartrate: 136,
    });

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert.
    expect(profile.structure.kind).toBe("continuous");
    expect(
      profile.structure.notes.some((n) => n.includes("steady laps")),
    ).toBe(true);
  });

  it("reads a single timed lap as continuous with unmeasurable steadiness", () => {
    // Arrange.
    const activity = makeActivity({ distance: 6000, movingTime: 2160 });
    const laps = [makeLap(1, 360, 2160)];

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert.
    expect(profile.structure.kind).toBe("continuous");
    expect(
      profile.structure.notes.some((n) =>
        n.includes("single timed lap"),
      ),
    ).toBe(true);
  });

  it("reports falling HR across work laps as falling progression", () => {
    // Arrange.
    const activity = makeActivity({
      distance: 12970,
      movingTime: 3900,
      averageHeartrate: 155,
    });

    // Act.
    const profile = sessionProfile(
      activity,
      thresholdLaps([166, 163, 159, 156, 153, 150]),
      null,
    );

    // Assert.
    expect(profile.structure.hrProgression).toBe("falling");
  });

  it("reports flat HR across work laps as stable progression", () => {
    // Arrange.
    const activity = makeActivity({
      distance: 12970,
      movingTime: 3900,
      averageHeartrate: 158,
    });

    // Act.
    const profile = sessionProfile(
      activity,
      thresholdLaps([158, 158, 158, 158, 158, 158]),
      null,
    );

    // Assert.
    expect(profile.structure.hrProgression).toBe("stable");
  });

  it("reports unknown HR progression when work laps carry no HR", () => {
    // Arrange: activity-level HR exists, but no work lap carries HR.
    const activity = makeActivity({
      distance: 12970,
      movingTime: 3900,
      averageHeartrate: 150,
    });

    // Act.
    const profile = sessionProfile(
      activity,
      thresholdLaps([null, null, null, null, null, null]),
      null,
    );

    // Assert.
    expect(profile.structure.hrProgression).toBe("unknown");
    expect(
      profile.uncertainty.some((u) =>
        u.includes("HR progression unknown"),
      ),
    ).toBe(true);
  });

  it("marks a progressive finish as progressive with uneven execution", () => {
    // Arrange: 4 work laps speeding up 4:24 -> 4:00 (faster than -4%).
    const laps = [
      makeLap(1, 360, 600, 130),
      makeLap(2, 264, 300, 155),
      makeLap(3, 390, 90, 140),
      makeLap(4, 256, 300, 158),
      makeLap(5, 390, 90, 142),
      makeLap(6, 248, 300, 161),
      makeLap(7, 390, 90, 144),
      makeLap(8, 240, 300, 164),
      makeLap(9, 360, 600, 140),
    ];
    const activity = makeActivity({
      distance: 10000,
      movingTime: 3180,
      averageHeartrate: 155,
    });

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert.
    expect(profile.structure.kind).toBe("interval");
    expect(profile.structure.lateDeterioration).toBe("progressive");
    expect(profile.execution.consistency).toBe("uneven");
    expect(profile.execution.detail.includes("progressive")).toBe(true);
  });

  it("accepts FIT fitTime streams for pace support", () => {
    // Arrange: FIT-only sync shape, no HR series at all.
    const activity = makeActivity({ distance: 5000, movingTime: 1800 });

    // Act.
    const profile = sessionProfile(activity, [], makeFitStream(1800, 2.78));

    // Assert.
    expect(
      profile.evidence.some((e) => e.startsWith("pace stream:")),
    ).toBe(true);
    expect(profile.classification).toBe("easy-recovery");
    expect(profile.confidence).toBe("low");
  });

  it("rejects too-short streams so no pace claims are made", () => {
    // Arrange: 60 s stream — below the 30-sample / 300 s span floor.
    const activity = makeActivity({ distance: 5000, movingTime: 1500 });

    // Act.
    const profile = sessionProfile(
      activity,
      [],
      makeSteadyStream(60, 2.78),
    );

    // Assert.
    expect(
      profile.evidence.some((e) => e.startsWith("pace stream:")),
    ).toBe(false);
    expect(
      profile.uncertainty.some((u) =>
        u.includes("no usable pace stream"),
      ),
    ).toBe(true);
    expect(profile.classification).toBe("unknown");
    expect(profile.confidence).toBe("low");
  });

  it("never lets a flat pace stream override lap-detected intervals", () => {
    // Arrange: interval laps plus a steady aggregate stream.
    const activity = makeActivity({
      distance: 12970,
      movingTime: 3900,
      averageHeartrate: 148,
    });

    // Act.
    const profile = sessionProfile(
      activity,
      thresholdLaps([150, 153, 156, 159, 163, 166]),
      makeSteadyStream(3900, 3.3),
    );

    // Assert: structure still comes from the laps.
    expect(profile.structure.hasStructure).toBe(true);
    expect(profile.structure.kind).toBe("interval");
    expect(profile.structure.workCount).toBe(6);
    expect(profile.classification).toBe("threshold-tempo");
  });
});

describe("sessionProfile gaps — classification", () => {
  it("classifies variable pace without structure as mixed at low confidence", () => {
    // Arrange: two divergent laps — neither steady nor alternating.
    const laps = [makeLap(1, 240, 600, 150), makeLap(2, 400, 600, 155)];
    const activity = makeActivity({
      distance: 4000,
      movingTime: 1200,
      averageHeartrate: 152,
    });

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert.
    expect(profile.structure.hasStructure).toBe(false);
    expect(profile.classification).toBe("mixed");
    expect(profile.confidence).toBe("low");
    expect(
      profile.uncertainty.some((u) => u.includes("variable pace")),
    ).toBe(true);
    expect(profile.execution.consistency).toBe("uneven");
  });

  it("returns unknown/low with honest wording when pace evidence is insufficient", () => {
    // Arrange: distance + time exist, but there are no laps and no stream.
    const activity = makeActivity({ distance: 5000, movingTime: 1500 });

    // Act.
    const profile = sessionProfile(activity, [], null);

    // Assert: unknown, but NOT "insufficient" — some activity data exists.
    expect(profile.classification).toBe("unknown");
    expect(profile.confidence).toBe("low");
    expect(profile.dataQuality).toBe("poor");
    expect(
      profile.uncertainty.some((u) =>
        u.includes("insufficient pace evidence"),
      ),
    ).toBe(true);
  });

  it("returns unknown/insufficient for a null activity type", () => {
    // Arrange.
    const activity = makeActivity({
      type: null,
      distance: 8000,
      movingTime: 2800,
    });

    // Act.
    const profile = sessionProfile(activity, [], null);

    // Assert.
    expect(profile.classification).toBe("unknown");
    expect(profile.confidence).toBe("insufficient");
    expect(
      profile.uncertainty.some((u) => u.includes("non-running")),
    ).toBe(true);
  });

  it("accepts TrailRun and VirtualRun as running types", () => {
    for (const type of ["TrailRun", "VirtualRun"]) {
      // Arrange.
      const activity = makeActivity({
        type,
        distance: 8000,
        movingTime: 2880,
        averageHeartrate: 136,
      });

      // Act.
      const profile = sessionProfile(activity, steadyLaps(), null);

      // Assert.
      expect(profile.classification).toBe("easy-recovery");
    }
  });

  it("caps a race label at low when poor data quality applies", () => {
    // Arrange: race name but no moving time — basic inputs incomplete.
    const activity = makeActivity({
      name: "City 10K Race",
      distance: 10000,
      movingTime: null,
      averageHeartrate: 170,
    });

    // Act.
    const profile = sessionProfile(
      activity,
      [makeLap(1, 240, 2400, 170)],
      null,
    );

    // Assert: the label still classifies, but poor quality caps moderate->low.
    expect(profile.classification).toBe("race-benchmark");
    expect(profile.dataQuality).toBe("poor");
    expect(profile.confidence).toBe("low");
    expect(
      profile.uncertainty.some((u) => u.includes("label only")),
    ).toBe(true);
  });
});

describe("sessionProfile gaps — honesty invariants", () => {
  it("expresses confidence only qualitatively, never as a percent", () => {
    // Arrange: one profile per reachable class.
    const shapes: [SessionActivityInput, SessionLapInput[], SessionStreamsInput][] = [
      [
        makeActivity({
          distance: 8000,
          movingTime: 2880,
          averageHeartrate: 136,
        }),
        steadyLaps(),
        null,
      ],
      [
        makeActivity({
          distance: 21000,
          movingTime: 6300,
          averageHeartrate: 145,
        }),
        [],
        makeFitStream(6300, 3.3),
      ],
      [
        makeActivity({
          distance: 12970,
          movingTime: 3900,
          averageHeartrate: 148,
        }),
        thresholdLaps([150, 153, 156, 159, 163, 166]),
        null,
      ],
      [
        makeActivity({
          name: "Club 5K Race",
          distance: 5000,
          movingTime: 1200,
          averageHeartrate: 175,
        }),
        [makeLap(1, 240, 1200, 175)],
        null,
      ],
      [
        makeActivity({ distance: 4000, movingTime: 1200 }),
        [makeLap(1, 240, 600), makeLap(2, 400, 600)],
        null,
      ],
      [makeActivity(), [], null],
    ];
    const allowed: Confidence[] = ["high", "moderate", "low", "insufficient"];

    for (const [activity, laps, streams] of shapes) {
      // Act.
      const profile = sessionProfile(activity, laps, streams);

      // Assert.
      expect(allowed).toContain(profile.confidence);
      expect(typeof profile.confidence).toBe("string");
      const text = [...profile.evidence, ...profile.uncertainty].join("\n");
      expect(text).not.toMatch(/confiden\w*[^.\n]*\d+\s*%/i);
    }
  });

  it("keeps recovery cost UNKNOWN with a reason on every session class", () => {
    // Arrange: one fixture per reachable class.
    const shortReps: SessionLapInput[] = [makeLap(1, 360, 600, 130)];
    let repIdx = 2;
    for (let i = 0; i < 4; i++) {
      shortReps.push(makeLap(repIdx++, 210, 75, 162 + i));
      if (i < 3) shortReps.push(makeLap(repIdx++, 400, 90, 140));
    }
    shortReps.push(makeLap(repIdx, 360, 600, 135));
    const shapes: [SessionActivityInput, SessionLapInput[], SessionStreamsInput][] = [
      [
        makeActivity({
          distance: 8000,
          movingTime: 2880,
          averageHeartrate: 136,
        }),
        steadyLaps(),
        null,
      ],
      [
        makeActivity({
          distance: 21000,
          movingTime: 6300,
          averageHeartrate: 145,
        }),
        [],
        makeFitStream(6300, 3.3),
      ],
      [
        makeActivity({
          distance: 12970,
          movingTime: 3900,
          averageHeartrate: 148,
        }),
        thresholdLaps([150, 153, 156, 159, 163, 166]),
        null,
      ],
      [
        makeActivity({
          distance: 9500,
          movingTime: 2400,
          averageHeartrate: 152,
        }),
        shortReps,
        null,
      ],
      [
        makeActivity({
          name: "Club 5K Race",
          distance: 5000,
          movingTime: 1200,
          averageHeartrate: 175,
        }),
        [makeLap(1, 240, 1200, 175)],
        null,
      ],
      [
        makeActivity({ distance: 4000, movingTime: 1200 }),
        [makeLap(1, 240, 600), makeLap(2, 400, 600)],
        null,
      ],
      [makeActivity(), [], null],
    ];

    for (const [activity, laps, streams] of shapes) {
      // Act.
      const profile = sessionProfile(activity, laps, streams);

      // Assert.
      expect(profile.cost.recovery).toBe("unknown");
      expect(profile.cost.recoveryReason.length).toBeGreaterThan(0);
      expect(
        profile.uncertainty.some((u) => u.includes("RPE")),
      ).toBe(true);
    }
  });

  it("states the no-individualized-zones limitation on every shape", () => {
    const shapes: [SessionActivityInput, SessionLapInput[], SessionStreamsInput][] = [
      [
        makeActivity({
          distance: 8000,
          movingTime: 2880,
          averageHeartrate: 136,
        }),
        steadyLaps(),
        null,
      ],
      [
        makeActivity({ distance: 4000, movingTime: 1200 }),
        [makeLap(1, 240, 600), makeLap(2, 400, 600)],
        null,
      ],
      [makeActivity(), [], null],
    ];

    for (const [activity, laps, streams] of shapes) {
      const profile = sessionProfile(activity, laps, streams);
      expect(
        profile.uncertainty.some((u) =>
          u.includes("no individualized HR zones"),
        ),
      ).toBe(true);
    }
  });
});

describe("sessionProfile gaps — stimulus and cost levels", () => {
  it("rates two 5-minute work segments as moderate threshold stimulus", () => {
    // Arrange: 2 x 5 min work with recovery framing — 600 s quality.
    const laps = [
      makeLap(1, 360, 600, 130),
      makeLap(2, 250, 300, 158),
      makeLap(3, 390, 120, 142),
      makeLap(4, 250, 300, 162),
      makeLap(5, 390, 180, 144),
      makeLap(6, 360, 600, 138),
    ];
    const activity = makeActivity({
      distance: 8000,
      movingTime: 2400,
      averageHeartrate: 150,
    });

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert.
    expect(profile.structure.kind).toBe("interval");
    expect(profile.classification).toBe("threshold-tempo");
    expect(profile.stimulus.threshold).toBe("moderate");
    // Two work segments is a thin basis — confidence stays low.
    expect(profile.confidence).toBe("low");
  });

  it("reports threshold and aerobic stimulus UNKNOWN when inputs are empty", () => {
    // Act.
    const profile = sessionProfile(makeActivity(), [], null);

    // Assert.
    expect(profile.classification).toBe("unknown");
    expect(profile.stimulus.threshold).toBe("unknown");
    expect(profile.stimulus.aerobic).toBe("unknown");
    expect(profile.execution.consistency).toBe("unclear");
  });

  it("rates mechanical cost high for marathon-distance load", () => {
    // Arrange.
    const activity = makeActivity({
      distance: 26000,
      movingTime: 7200,
      averageHeartrate: 145,
    });

    // Act.
    const profile = sessionProfile(
      activity,
      [],
      makeFitStream(7200, 3.6),
    );

    // Assert.
    expect(profile.classification).toBe("long");
    expect(profile.cost.mechanical).toBe("high");
  });

  it("rates mechanical cost moderate on climbing alone", () => {
    // Arrange: short on distance, 400 m of climbing.
    const activity = makeActivity({
      distance: 8000,
      movingTime: 2700,
      totalElevationGain: 400,
    });

    // Act.
    const profile = sessionProfile(activity, [], null);

    // Assert.
    expect(profile.cost.mechanical).toBe("moderate");
  });

  it("reports mechanical cost UNKNOWN when distance is missing", () => {
    // Arrange.
    const activity = makeActivity({ distance: null, movingTime: 1800 });

    // Act.
    const profile = sessionProfile(activity, [], null);

    // Assert.
    expect(profile.cost.mechanical).toBe("unknown");
    expect(
      profile.uncertainty.some((u) =>
        u.includes("mechanical cost unknown"),
      ),
    ).toBe(true);
  });
});

describe("sessionProfile — hidden-rest honesty floor", () => {
  /** Auto-lap blending moving + stopped time (auto-pause recoveries sliced
   *  into 1 km laps): pace looks steady, elapsed exceeds moving. */
  function makeRestLap(
    lapIndex: number,
    paceSecPerKm: number,
    movingSec: number,
    elapsedSec: number,
    hr: number | null = null,
  ): SessionLapInput {
    const speed = Math.round((1000 / paceSecPerKm) * 1000) / 1000;
    return {
      lapIndex,
      distance: Math.round(speed * movingSec * 10) / 10,
      movingTime: movingSec,
      elapsedTime: elapsedSec,
      averageSpeed: speed,
      averageHeartrate: hr,
    };
  }

  it("refuses an easy reading when auto-laps hide interval breaks (2026-07-14 6 km shape)", () => {
    // Arrange: six steady-looking 1 km laps (~4:08/km, HR ~174) hiding
    // 454 s of auto-pause rest across 1946 s of lap elapsed (23%).
    const laps = [
      makeRestLap(1, 249, 249, 249, 169),
      makeRestLap(2, 246, 246, 326, 175),
      makeRestLap(3, 252, 252, 252, 180),
      makeRestLap(4, 244, 244, 436, 171),
      makeRestLap(5, 249, 249, 370, 172),
      makeRestLap(6, 252, 252, 313, 176),
    ];
    const activity = makeActivity({
      distance: 6013,
      movingTime: 1496,
      elapsedTime: 1496,
      averageHeartrate: 174,
      maxHeartrate: 184,
    });

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert: honest unknown — NOT a moderate-confidence easy, and NOT
    // laundered into intervals from walk-breaks either.
    expect(profile.structure.hiddenRestDetected).toBe(true);
    expect(profile.classification).toBe("unknown");
    expect(profile.confidence).toBe("low");
    expect(profile.structure.kind).not.toBe("continuous");
    expect(
      profile.uncertainty.some((u) => u.includes("sub-lap")),
    ).toBe(true);
  });

  it("keeps an urban easy run with minor stops as easy-recovery", () => {
    // Arrange: steady laps, one 30 s traffic stop (30 s / ~2900 s ≈ 1%).
    const laps = [
      makeRestLap(1, 360, 720, 720, 134),
      makeRestLap(2, 358, 720, 750, 136),
      makeRestLap(3, 362, 720, 720, 137),
      makeRestLap(4, 359, 720, 720, 138),
    ];
    const activity = makeActivity({
      distance: 8000,
      movingTime: 2880,
      averageHeartrate: 136,
    });

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert.
    expect(profile.structure.hiddenRestDetected).toBe(false);
    expect(profile.classification).toBe("easy-recovery");
  });

  it("keeps genuine lap-alternation intervals when recovery laps hide extra standing rest", () => {
    // Arrange: the §1 threshold shape, but each 60 s recovery lap hides
    // 4 min of standing rest (1200 s / 5100 s ≈ 24% hidden rest).
    const laps: SessionLapInput[] = [makeLap(1, 360, 900, 132)];
    const workHrs = [150, 153, 156, 159, 163, 166];
    let idx = 2;
    for (let i = 0; i < workHrs.length; i++) {
      laps.push(makeLap(idx++, 250, 300, workHrs[i]));
      if (i < workHrs.length - 1)
        laps.push(makeRestLap(idx++, 390, 60, 300, 140));
    }
    laps.push(makeLap(idx, 360, 900, 138));
    const activity = makeActivity({
      distance: 12970,
      movingTime: 3900,
      averageHeartrate: 148,
    });

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert: real alternation still classifies — hidden rest only blocks
    // the steady-easy reading, never sinks detected structure.
    expect(profile.structure.hiddenRestDetected).toBe(true);
    expect(profile.structure.kind).toBe("interval");
    expect(profile.classification).toBe("threshold-tempo");
  });
});

describe("sessionProfile — BUG-001 regression", () => {
  it("excludes warmup/cooldown framing from medianRecoverySec", () => {
    // Arrange: inner recoveries of 120 s / 180 s framed by a 600 s warmup
    // and a SHORT 60 s cooldown. Correct median of [120, 180] is 150.
    const laps = [
      makeLap(1, 360, 600, 130),
      makeLap(2, 250, 300, 156),
      makeLap(3, 390, 120, 142),
      makeLap(4, 250, 300, 160),
      makeLap(5, 390, 180, 144),
      makeLap(6, 250, 300, 164),
      makeLap(7, 360, 60, 138),
    ];
    const activity = makeActivity({
      distance: 6203,
      movingTime: 2160,
      averageHeartrate: 150,
    });

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert.
    expect(profile.structure.kind).toBe("interval");
    expect(profile.structure.workCount).toBe(3);
    expect(profile.structure.recoveryCount).toBe(2);
    // FAILS while profile.ts filters `slow` with an index into `timed`:
    // the 60 s cooldown leaks into the recovery durations (median 120).
    expect(profile.structure.medianRecoverySec).toBe(150);
  });
});

describe("sessionProfile — blocking-fix regressions", () => {
  /** Standard 1 Hz series (dt = 1 s) as real FIT/GPX record streams arrive. */
  function make1HzStream(
    durationSec: number,
    speedMps: number,
  ): SessionStreamsInput {
    const time: number[] = [];
    const distance: number[] = [];
    for (let t = 0; t <= durationSec; t += 1) {
      time.push(t);
      distance.push(Math.round(t * speedMps * 10) / 10);
    }
    return {
      time: { data: time },
      distance: { data: distance },
    };
  }

  /** Lap with measured elapsedTime but no movingTime (elapsed-fallback path). */
  function makeElapsedLap(
    lapIndex: number,
    paceSecPerKm: number,
    elapsedSec: number,
    hr: number | null = null,
  ): SessionLapInput {
    const speed = Math.round((1000 / paceSecPerKm) * 1000) / 1000;
    return {
      lapIndex,
      distance: Math.round(speed * elapsedSec * 10) / 10,
      elapsedTime: elapsedSec,
      averageSpeed: speed,
      averageHeartrate: hr,
    };
  }

  it("accepts 1 Hz streams for pace support (dt ≈ 1, not only dt ≥ 5)", () => {
    // Arrange: 30 min steady 1 Hz stream, no laps.
    const activity = makeActivity({ distance: 5000, movingTime: 1800 });

    // Act.
    const profile = sessionProfile(activity, [], make1HzStream(1800, 2.78));

    // Assert: pre-fix every dt = 1 gap was skipped and no pace claim survived.
    expect(
      profile.evidence.some((e) => e.startsWith("pace stream:")),
    ).toBe(true);
    expect(profile.classification).toBe("easy-recovery");
  });

  it("uses measured elapsedTime for lap durations and flags the fallback", () => {
    // Arrange: 2 x 5 min work / 120 s + 180 s recovery + framing, elapsed only.
    const laps = [
      makeElapsedLap(1, 360, 600, 130),
      makeElapsedLap(2, 250, 300, 156),
      makeElapsedLap(3, 390, 120, 142),
      makeElapsedLap(4, 250, 300, 160),
      makeElapsedLap(5, 390, 180, 144),
      makeElapsedLap(6, 360, 60, 138),
    ];
    const activity = makeActivity({
      distance: 6203,
      movingTime: 1860,
      averageHeartrate: 150,
    });

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert: durations are the measured elapsed values, honestly flagged.
    expect(profile.structure.kind).toBe("interval");
    expect(profile.structure.workCount).toBe(2);
    expect(profile.structure.medianWorkSec).toBe(300);
    expect(profile.structure.medianRecoverySec).toBe(150);
    expect(
      profile.structure.notes.some((n) => n.includes("elapsed-based")),
    ).toBe(true);
    expect(
      profile.uncertainty.some((u) => u.includes("elapsed-based")),
    ).toBe(true);
  });

  it("excludes a short cooldown from the median with two work segments", () => {
    // Arrange: warmup + W/R/W/R + 60 s cooldown — inner recoveries
    // 120 s / 180 s, median 150; leaked cooldown would give 120.
    const laps = [
      makeLap(1, 360, 600, 130),
      makeLap(2, 250, 300, 156),
      makeLap(3, 390, 120, 142),
      makeLap(4, 250, 300, 160),
      makeLap(5, 390, 180, 144),
      makeLap(6, 360, 60, 138),
    ];
    const activity = makeActivity({
      distance: 6203,
      movingTime: 1860,
      averageHeartrate: 150,
    });

    // Act.
    const profile = sessionProfile(activity, laps, null);

    // Assert.
    expect(profile.structure.kind).toBe("interval");
    expect(profile.structure.workCount).toBe(2);
    expect(profile.structure.recoveryCount).toBe(2);
    expect(profile.structure.medianRecoverySec).toBe(150);
  });
});
