import { describe, it, expect } from "vitest";
import { sessionProfile } from "@/lib/session-profile/profile";
import type {
  SessionActivityInput,
  SessionLapInput,
  SessionStreamsInput,
} from "@/lib/session-profile/types";

// ---------------------------------------------------------------------------
// Paused-clock (auto-pause) regression coverage for SessionProfile v0.1.
//
// Real shape 2026-07-14 6 km (cmuzh91mk00foyhx0oruec4ex): 6x1 km auto-laps
// steady 4:03–4:12/km with the watch pausing between reps — 454 s of rest
// hidden in fitTime recording gaps (81/135/60 s…), only 11/1487 slow stream
// samples (auto-pause erased the rests), activity elapsed == moving. Laps
// alone read "steady continuous"; the sub-lap gap segmentation must recover
// the interval structure when elevated HR corroborates, and must NOT fire
// for easy runs with tiny stops or walk-break sessions (HR gate).
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

function makeSteadyLap(
  lapIndex: number,
  paceSecPerKm: number,
  durationSec: number,
  hr: number | null = null,
): SessionLapInput {
  const speed = Math.round((1000 / paceSecPerKm) * 1000) / 1000;
  return {
    lapIndex,
    distance: Math.round(speed * durationSec * 10) / 10,
    movingTime: durationSec,
    // Paused clock: the watch stops both timers, so elapsed == moving and
    // the lap-level hidden-rest signal is blind by construction.
    elapsedTime: durationSec,
    averageSpeed: speed,
    averageHeartrate: hr,
  };
}

/** 1 Hz record stream with paused-clock gaps: clock jumps, no samples.
 *
 *  `hrDropBpm` models the real resume dip (July-14 drops were 26–43 bpm per
 *  gap): the first 15 samples of each resumed bout ramp from `hr - drop`
 *  back toward `hr`, so the pre/post-gap step lands near `-drop * 0.53`
 *  (drop 60 → step ≈ −32). Flat `hr` (drop 0) under-models reality.
 */
function makePausedStream(
  boutDurSec: number,
  gapsSec: number[],
  speedMps: number,
  hr: number,
  hrDropBpm = 0,
): SessionStreamsInput {
  const fitTime: number[] = [];
  const distance: number[] = [];
  const heartrate: number[] = [];
  let t = 0;
  let d = 0;
  const bouts = gapsSec.length + 1;
  for (let b = 0; b < bouts; b++) {
    for (let s = 0; s < boutDurSec; s++) {
      fitTime.push(t);
      distance.push(Math.round(d * 10) / 10);
      heartrate.push(
        hrDropBpm > 0 && b > 0 && s < 15
          ? hr - hrDropBpm + Math.round((hrDropBpm * s) / 15)
          : hr,
      );
      t += 1;
      d += speedMps;
    }
    if (b < gapsSec.length) t += gapsSec[b]; // pause: no records
  }
  return {
    fitTime: { data: fitTime },
    distance: { data: distance },
    heartrate: { data: heartrate },
  };
}

/** Nulls heartrate samples in [start, end) by record index (optical dropout). */
function nullHrRange(
  streams: SessionStreamsInput,
  start: number,
  end: number,
): void {
  const hr = (streams as Record<string, { data: unknown[] }>).heartrate;
  for (let i = start; i < end && i < hr.data.length; i++) hr.data[i] = null;
}

/** July-14 replica: 6 steady 1 km auto-laps hiding 7 recording pauses. */
function july14Laps(): SessionLapInput[] {
  const paces = [249.3, 246.3, 251.5, 243.6, 248.8, 252.2];
  const hrs = [169, 175, 180, 171, 172, 176];
  return paces.map((pace, i) =>
    makeSteadyLap(i + 1, pace, Math.round(pace), hrs[i]),
  );
}

function july14Activity(): SessionActivityInput {
  return makeActivity({
    distance: 6013,
    movingTime: 1496,
    elapsedTime: 1496,
    averageHeartrate: 174,
    maxHeartrate: 184,
  });
}

describe("sessionProfile — paused-clock interval recovery (2026-07-14)", () => {
  it("recovers threshold-tempo from steady auto-laps + recording gaps + high HR", () => {
    // Arrange: 8 x ~187 s work bouts at 4:08/km separated by 7 pauses
    // (81/135/60/50/70/40/35 s = 471 s hidden rest), HR 174 with a resume
    // dip after each pause (drop 60 → step ≈ −32, inside the observed
    // −26…−43 range).
    const streams = makePausedStream(
      187,
      [81, 135, 60, 50, 70, 40, 35],
      1000 / 248,
      174,
      60,
    );

    // Act.
    const profile = sessionProfile(july14Activity(), july14Laps(), streams);

    // Assert: interval structure recovered at honest (capped) confidence.
    expect(profile.structure.hasStructure).toBe(true);
    expect(profile.structure.kind).toBe("interval");
    expect(profile.structure.gapRecovered).toBe(true);
    expect(profile.structure.workCount).toBe(8);
    // 187 one-second samples per bout = 186 recorded seconds (the
    // gap-crossing pair belongs to the pause, not the work).
    expect(profile.structure.medianWorkSec).toBe(186);
    expect(profile.classification).toBe("threshold-tempo");
    expect(profile.confidence).toBe("moderate");
    expect(profile.cost.recovery).toBe("unknown");
    expect(
      profile.uncertainty.some((u) => u.includes("paused-clock")),
    ).toBe(true);
    expect(
      profile.evidence.some((e) => e.includes("sub-lap work bouts")),
    ).toBe(true);
    // HR-step evidence: median dip across all 7 gaps, with the rest-vs-
    // workout honesty note (the dip confirms rest, not session intent).
    expect(
      profile.evidence.some((e) =>
        e.includes("median HR step -32 bpm across 7 gaps"),
      ),
    ).toBe(true);
    expect(
      profile.uncertainty.some((u) =>
        u.includes("dip confirms the pauses were rest"),
      ),
    ).toBe(true);
  });

  it("refuses recovery when high HR stays flat across the pauses (no rest dip)", () => {
    // Arrange: July-14 bout/gap shape with HR 174 throughout — elevated but
    // no pre/post-gap cliff, so the pauses are not rest-confirmed.
    const streams = makePausedStream(
      187,
      [81, 135, 60, 50, 70, 40, 35],
      1000 / 248,
      174,
    );

    // Act.
    const profile = sessionProfile(july14Activity(), july14Laps(), streams);

    // Assert: the HR-step gate vetoes alongside the mean-HR gate — HR never
    // classifies alone, and here it does not even corroborate.
    expect(profile.structure.gapRecovered).toBe(false);
    expect(profile.classification).not.toBe("interval");
    expect(profile.classification).not.toBe("threshold-tempo");
  });

  it("tolerates optical dropouts: unmeasurable gaps are excluded, not fatal", () => {
    // Arrange: July-14 cliff shape, but the strap drops out from the start
    // of bout 5 to the end — gaps 4–6 have no post-gap HR (unknown), gaps
    // 0–3 still show the dip. Bout b starts at record b*187.
    const streams = makePausedStream(
      187,
      [81, 135, 60, 50, 70, 40, 35],
      1000 / 248,
      174,
      60,
    );
    nullHrRange(streams, 5 * 187, Number.MAX_SAFE_INTEGER);

    // Act.
    const profile = sessionProfile(july14Activity(), july14Laps(), streams);

    // Assert: 4 of 4 measurable gaps rest-confirmed — recovery still holds,
    // honestly worded, with the dropout called out in uncertainty.
    expect(profile.structure.gapRecovered).toBe(true);
    expect(profile.classification).toBe("threshold-tempo");
    expect(
      profile.evidence.some((e) =>
        e.includes("median HR step -32 bpm across 4 of 7 gaps"),
      ),
    ).toBe(true);
    expect(
      profile.uncertainty.some((u) =>
        u.includes("without enough valid HR on both sides"),
      ),
    ).toBe(true);
  });

  it("keeps an urban easy run with one traffic stop as easy-recovery", () => {
    // Arrange: steady 6:00/km laps, one 40 s recording pause, low HR — with
    // a resume dip (drop 30 → step ≈ −16), because easy single-stop
    // controls cliff too: the dip alone must never classify.
    const laps = [
      makeSteadyLap(1, 360, 720, 134),
      makeSteadyLap(2, 358, 720, 136),
      makeSteadyLap(3, 362, 720, 137),
      makeSteadyLap(4, 359, 720, 138),
    ];
    const activity = makeActivity({
      distance: 8000,
      movingTime: 2880,
      elapsedTime: 2880,
      averageHeartrate: 136,
    });
    const streams = makePausedStream(1420, [40], 1000 / 360, 136, 30);

    // Act.
    const profile = sessionProfile(activity, laps, streams);

    // Assert: two bouts fail the count gate — stays easy, no gap recovery.
    expect(profile.structure.gapRecovered).toBe(false);
    expect(profile.structure.kind).toBe("continuous");
    expect(profile.classification).toBe("easy-recovery");
  });

  it("refuses a walk-break session with low HR despite clean bout/gap shape", () => {
    // Arrange: 4 steady 5:00/km run bouts with 60 s walk pauses (auto-paused,
    // so laps look steady) — but HR 135 is easy effort, not quality.
    const laps = [
      makeSteadyLap(1, 300, 300, 134),
      makeSteadyLap(2, 300, 300, 136),
      makeSteadyLap(3, 300, 300, 135),
      makeSteadyLap(4, 300, 300, 137),
    ];
    const activity = makeActivity({
      distance: 5000,
      movingTime: 1800,
      elapsedTime: 1800,
      averageHeartrate: 135,
    });
    const streams = makePausedStream(150, [60, 60, 60], 1000 / 300, 135);

    // Act.
    const profile = sessionProfile(activity, laps, streams);

    // Assert: the HR corroboration gate vetoes — never laundered into
    // intervals from walk breaks.
    expect(profile.structure.gapRecovered).toBe(false);
    expect(profile.classification).not.toBe("interval");
    expect(profile.classification).not.toBe("threshold-tempo");
  });

  it("refuses recovery when only two fast bouts carry high HR", () => {
    // Arrange: 2 x 5 min at 4:05/km with one 90 s pause, HR 175 — hot but
    // too few bouts for an interval claim.
    const laps = [
      makeSteadyLap(1, 245, 300, 172),
      makeSteadyLap(2, 245, 300, 177),
    ];
    const activity = makeActivity({
      distance: 2500,
      movingTime: 600,
      elapsedTime: 600,
      averageHeartrate: 175,
    });
    const streams = makePausedStream(300, [90], 1000 / 245, 175);

    // Act.
    const profile = sessionProfile(activity, laps, streams);

    // Assert.
    expect(profile.structure.gapRecovered).toBe(false);
    expect(profile.classification).not.toBe("interval");
    expect(profile.classification).not.toBe("threshold-tempo");
  });

  it("never classifies on HR alone without bout structure", () => {
    // Arrange: high HR but a gap-free steady stream — no pauses, no bouts.
    const laps = [
      makeSteadyLap(1, 250, 600, 174),
      makeSteadyLap(2, 250, 600, 176),
    ];
    const activity = makeActivity({
      distance: 4800,
      movingTime: 1200,
      elapsedTime: 1200,
      averageHeartrate: 175,
    });
    const streams = makePausedStream(1200, [], 1000 / 250, 175);

    // Act.
    const profile = sessionProfile(activity, laps, streams);

    // Assert: hot steady effort without pauses is not intervals.
    expect(profile.structure.gapRecovered).toBe(false);
    expect(profile.structure.kind).toBe("continuous");
  });
});
