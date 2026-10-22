import { describe, it, expect } from "vitest";
import {
  compareToGoldSet,
  summarizeGoldSet,
  type GoldSetEntry,
  type GoldSetComparison,
} from "./gold-set.ts";
import type { SessionProfile } from "./types.ts";

// ---------------------------------------------------------------------------
// Factories: a facit entry in Kevin's format (§3) and a hand-written profile.
// The profiles here are plain literals on purpose — the compare step must be
// testable without running the profiler (and must never see the entry itself).
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<GoldSetEntry> = {}): GoldSetEntry {
  return {
    id: "2025-02-12-threshold",
    date: "2025-02-12",
    actual: "6 x 5 min threshold, ~60 s recovery",
    intent: "controlled threshold session",
    assessment: "executed as planned, even",
    rpe: 6,
    context: "treadmill",
    expected: {
      category: "interval",
      workSegments: 6,
      workRecoveryShape: "6 x 5 min work, ~60 s recovery",
      intensity: "threshold",
      execution: "even, as planned",
    },
    ...overrides,
  };
}

function makeProfile(overrides: Partial<SessionProfile> = {}): SessionProfile {
  return {
    classification: "interval",
    confidence: "high",
    structure: {
      hasStructure: true,
      kind: "interval",
      workCount: 6,
      recoveryCount: 5,
      medianWorkSec: 300,
      medianRecoverySec: 60,
      paceStability: "steady",
      paceCv: 0.02,
      hrProgression: "rising",
      lateDeterioration: "stable",
      warmupDetected: true,
      cooldownDetected: true,
      hiddenRestDetected: false,
      gapRecovered: false,
      notes: [],
    },
    execution: { consistency: "steady", detail: "work paces within 2% of each other" },
    stimulus: {
      threshold: "high",
      aerobic: "moderate",
      detail: "39 min of sustained threshold-speed work",
    },
    cost: {
      mechanical: "moderate",
      recovery: "unknown",
      recoveryReason: "no RPE, check-in or HR-recovery evidence is wired in v0.1",
      detail: "29 min of fast running",
    },
    dataQuality: "high",
    uncertainty: [],
    evidence: ["6 work bouts of ~300 s at a steady pace"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("compareToGoldSet", () => {
  it("passes a correctly described threshold interval session on every facit dimension", () => {
    const comparison = compareToGoldSet(makeProfile(), makeEntry());

    expect(comparison.rightBroadCategory).toBe("yes");
    expect(comparison.rightWorkSegments).toBe("yes");
    expect(comparison.rightWorkRecoveryStructure).toBe("yes");
    expect(comparison.reasonableIntensity).toBe("yes");
    expect(comparison.reasonableExecution).toBe("yes");
    expect(comparison.claimsWithoutSupport).toBe("yes");
    expect(comparison.missedKeyProperty).toBe("yes");
    expect(comparison.reasonableConfidence).toBe("yes");

    expect(summarizeGoldSet([comparison]).overall).toBe("pass");
  });

  it("flags a wrong broad category when the profile calls an easy run a VO2 interval", () => {
    const entry = makeEntry({
      id: "2025-03-01-easy",
      date: "2025-03-01",
      actual: "60 min easy run",
      intent: "easy aerobic volume",
      assessment: "easy throughout, could talk",
      expected: { category: "easy-recovery", intensity: "easy" },
    });
    // The profile confidently reads a plain distance run as a VO2 session —
    // §3's canonical error ("vanligt distanspass → VO2").
    const profile = makeProfile({
      classification: "interval",
      stimulus: { threshold: "high", aerobic: "low", detail: "intermittent fast segments" },
      structure: {
        ...makeProfile().structure,
        workCount: 4,
        kind: "interval",
        lateDeterioration: "stable",
      },
    });

    const comparison = compareToGoldSet(profile, entry);
    expect(comparison.rightBroadCategory).toBe("no");
    expect(summarizeGoldSet([comparison]).overall).toBe("fail");
  });

  it("treats an honest unknown/insufficient profile as a GOOD result", () => {
    const entry = makeEntry({
      id: "2024-11-03-unclear",
      date: "2024-11-03",
      actual: "hard to interpret — I only remember it felt long and muddy",
      intent: "probably a normal run",
      assessment: "hard to say what this was, memory is vague",
      expected: { category: "unknown" },
    });
    const profile = makeProfile({
      classification: "unknown",
      confidence: "insufficient",
      structure: {
        ...makeProfile().structure,
        hasStructure: false,
        kind: "unclear",
        workCount: 0,
        recoveryCount: 0,
        medianWorkSec: null,
        medianRecoverySec: null,
        paceStability: "unknown",
        paceCv: null,
        hrProgression: "unknown",
        lateDeterioration: "unknown",
        warmupDetected: false,
        cooldownDetected: false,
      },
      execution: { consistency: "unclear", detail: "pace and HR disagree" },
      stimulus: { threshold: "unknown", aerobic: "unknown", detail: "no usable evidence" },
      dataQuality: "poor",
    });

    const comparison = compareToGoldSet(profile, entry);
    expect(comparison.rightBroadCategory).toBe("yes");
    // Dimensions the facit never states are skipped, not silently passed.
    expect(comparison.rightWorkSegments).toBe("skipped");
    expect(comparison.reasonableIntensity).toBe("skipped");
    expect(comparison.claimsWithoutSupport).toBe("yes");
    expect(comparison.reasonableConfidence).toBe("yes");

    const summary = summarizeGoldSet([comparison]);
    // Honest doubt is rewarded per check, but a facit that states no dimension
    // verified nothing, so the run cannot claim PASS (thin-facit guard).
    expect(summary.overall).toBe("attention");
    expect(summary.actionable).toHaveLength(0);
  });

  it("flags a claimed recovery cost as an unsupported claim (v0.1 invariant)", () => {
    const profile = makeProfile();
    const withRecoveryClaim: SessionProfile = {
      ...profile,
      cost: {
        ...profile.cost,
        recovery: "moderate" as never,
      },
    };

    const comparison = compareToGoldSet(withRecoveryClaim, makeEntry());
    expect(comparison.claimsWithoutSupport).toBe("no");
    expect(comparison.notes.claimsWithoutSupport).toContain("recovery");
    expect(summarizeGoldSet([comparison]).overall).toBe("fail");
  });

  it("returns a pass with total 0 for an empty gold set", () => {
    const summary = summarizeGoldSet([] as GoldSetComparison[]);
    expect(summary.total).toBe(0);
    expect(summary.overall).toBe("pass");
    expect(summary.actionable).toHaveLength(0);
    expect(summary.counts).toEqual({ yes: 0, partial: 0, no: 0, skipped: 0 });
  });
});

// ---------------------------------------------------------------------------
// Edge cases the §5 loop depends on: a skipped dimension must never be able to
// manufacture a pass, and a fabricated claim must never be softened into
// "partial" (which would exit 0 in the CLI).
// ---------------------------------------------------------------------------

describe("compareToGoldSet edge cases", () => {
  it("never reports pass when every dimension is skipped", () => {
    // The summary contract: skipped dimensions are unverified, never a quiet
    // pass. (compareToGoldSet always judges 3 dimensions, so this is asserted
    // on a comparison object where the facit verified nothing at all.)
    const unverified = {
      entry: makeEntry({ expected: { category: "interval" } }),
      rightBroadCategory: "skipped",
      rightWorkSegments: "skipped",
      rightWorkRecoveryStructure: "skipped",
      reasonableIntensity: "skipped",
      reasonableExecution: "skipped",
      claimsWithoutSupport: "yes",
      missedKeyProperty: "yes",
      reasonableConfidence: "yes",
      notes: {},
    } as unknown as GoldSetComparison;

    const summary = summarizeGoldSet([unverified]);
    expect(summary.counts.skipped).toBe(5);
    expect(summary.overall).toBe("attention");
    expect(summary.actionable).toHaveLength(0);
  });

  it("reports attention rather than pass when a only-partial dimension exists", () => {
    // Proving a partial verdict alone is enough to keep the run out of "pass".
    const entry = makeEntry({ expected: { category: "interval" } });
    const profile = makeProfile({ classification: "threshold-tempo" });
    const comparison = compareToGoldSet(profile, entry);

    expect(comparison.rightBroadCategory).toBe("partial");
    expect(summarizeGoldSet([comparison]).overall).toBe("attention");
  });

  it("reports attention, not pass, when confidence is only partly defensible", () => {
    // "unknown" classification with "moderate" confidence is hedged-but-unsure.
    const entry = makeEntry({ expected: { category: "unknown" } });
    const profile = makeProfile({ classification: "unknown", confidence: "moderate" });
    const comparison = compareToGoldSet(profile, entry);

    expect(comparison.reasonableConfidence).toBe("partial");
    expect(summarizeGoldSet([comparison]).overall).toBe("attention");
  });

  it("flags an unsupported recovery claim even when confidence is also too high for poor data", () => {
    // Both §2.4 violations at once: neither may mask the other, and the claim
    // must stay a hard "no" — a "partial" would exit 0 in the CLI.
    const profile = makeProfile({ dataQuality: "poor", confidence: "moderate" });
    const withRecoveryClaim: SessionProfile = {
      ...profile,
      cost: { ...profile.cost, recovery: "high" as never },
    };

    const comparison = compareToGoldSet(withRecoveryClaim, makeEntry());
    expect(comparison.claimsWithoutSupport).toBe("no");
    expect(comparison.notes.claimsWithoutSupport).toContain("recovery");
    expect(summarizeGoldSet([comparison]).overall).toBe("fail");
  });

  it("flags high confidence on poor data quality as an unsupported claim", () => {
    const profile = makeProfile({ dataQuality: "poor", confidence: "high" });
    const comparison = compareToGoldSet(profile, makeEntry());

    expect(comparison.claimsWithoutSupport).toBe("no");
    expect(comparison.notes.claimsWithoutSupport).toContain("poor");
    expect(summarizeGoldSet([comparison]).overall).toBe("fail");
  });

  it("matches work segments exactly, and rejects a large miss as wrong", () => {
    const exact = compareToGoldSet(makeProfile({ structure: { ...makeProfile().structure, workCount: 6 } }), makeEntry());
    expect(exact.rightWorkSegments).toBe("yes");

    const missingFour = compareToGoldSet(
      makeProfile({ structure: { ...makeProfile().structure, workCount: 2 } }),
      makeEntry(),
    );
    // Facit says 6 × 5 min; detecting 2 bouts is not "broadly right".
    expect(missingFour.rightWorkSegments).toBe("no");
    expect(missingFour.notes.rightWorkSegments).toContain("facit says 6");
  });

  it("does not punish the profile when the facit is silent about the category", () => {
    const entry = makeEntry({ expected: { category: "unknown" } });

    // Direction 1: the facit admits it is unsure and the profile says "unknown"
    // → a correct reading (§3: honest uncertainty is a good result), but the
    // facit stated no category to verify, so it is not a PASS on its own.
    const unsure = compareToGoldSet(
      makeProfile({ classification: "unknown", confidence: "low" }),
      entry,
    );
    expect(unsure.rightBroadCategory).toBe("yes");
    expect(summarizeGoldSet([unsure]).overall).toBe("attention");

    // Direction 2: the profile names a class while the facit states none →
    // unverified (skipped), never a hard "no" that fails the whole gold set.
    const confident = compareToGoldSet(makeProfile({ classification: "interval" }), entry);
    expect(confident.rightBroadCategory).toBe("skipped");
    expect(summarizeGoldSet([confident]).overall).toBe("attention");
  });

  it("surfaces a malformed entry (missing expected) as a clear error, not a TypeError", () => {
    const malformed = {
      id: "2025-05-01-broken",
      date: "2025-05-01",
      actual: "",
      intent: "",
      assessment: "",
    } as unknown as GoldSetEntry;

    let caught: unknown;
    try {
      compareToGoldSet(makeProfile(), malformed);
    } catch (error) {
      caught = error;
    }
    // A typo'd facit must fail loudly and actionably, not with a raw
    // "Cannot read properties of undefined (reading 'category')".
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(TypeError);
    expect((caught as Error).message).toContain("2025-05-01-broken");
  });

  it("rejects an unknown session class in the facit with a named error, not a TypeError", () => {
    const entry = makeEntry({
      expected: { category: "threshold" as GoldSetEntry["expected"]["category"] },
    });

    let caught: unknown;
    try {
      compareToGoldSet(makeProfile(), entry);
    } catch (error) {
      caught = error;
    }
    // "threshold" is a stimulus word, not a SessionClass: the related-class
    // lookup would throw a bare TypeError without this validation.
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(TypeError);
    const message = (caught as Error).message;
    expect(message).toContain("2025-02-12-threshold");
    expect(message).toContain('"threshold" is not a known session class');
    expect(message).toContain("threshold-tempo");
  });
});
