// Gold-set / facit comparison for SessionProfile v0.1 — Docs/SESSIONPROFILE_
// FORTYDLIGANDE.md §3 (the manual facit checklist) and §5 (build → test →
// find errors → improve → test again).
//
// Two hard rules, straight from §3:
//   1. The algorithm must never see the facit. This module is PURE and takes
//      the already-computed `SessionProfile` plus the human `GoldSetEntry` as
//      separate arguments — nothing here can influence `sessionProfile()`.
//   2. A genuinely hard-to-read session that comes back `unknown` /
//      `insufficient` is a GOOD result, not a failure. Correct uncertainty
//      beats confident nonsense.
//
// Verdict semantics: every check answers "did the profile get this right?".
//   yes     — the profile's reading matches the facit
//   partial — broadly right but imprecise / hedged where the facit is definite
//   no      — wrong, or an unsupported claim was made
//   skipped — the facit does not state this dimension (never a silent pass:
//             the CLI prints skipped rows explicitly, and the summary only
//             counts them, so you can see how thin the facit is)
//
// `claimsWithoutSupport` and `missedKeyProperty` are inverted relative to §3's
// wording ("Påstående utan stöd? JA / NEJ"): here "yes" means the profile
// DID NOT make an unsupported claim / DID NOT miss a key property, so all
// eight checks read the same direction. §3's "missade viktig egenskap? NEJ"
// is this module's "yes".

import type { Confidence, Level, SessionClass, SessionProfile } from "./types.ts";

/** Kevin's facit format (§3): a private note about one remembered session.
 *  `actual` / `intent` / `assessment` are free text in the athlete's own
 *  words; `expected` is the machine-readable subset the compare step uses.
 *  Leave a dimension out when the facit genuinely does not state it. */
export interface GoldSetEntry {
  id: string;
  /** yyyy-mm-dd. */
  date: string;
  /** "GARMIN" | "SUUNTO" — optional, only used to disambiguate a DB lookup. */
  source?: string;
  actual: string;
  intent: string;
  assessment: string;
  rpe?: number;
  context?: string;
  expected: {
    category: SessionClass;
    workSegments?: number;
    /** Free text, e.g. "6 × 5 min work, ~60 s recovery". */
    workRecoveryShape?: string;
    /** Free text, e.g. "threshold", "easy", "VO2". */
    intensity?: string;
    /** Free text, e.g. "even, as planned", "faded in the last reps". */
    execution?: string;
  };
}

export type CompareVerdict = "yes" | "partial" | "no" | "skipped";

export type GoldSetCheck =
  | "rightBroadCategory"
  | "rightWorkSegments"
  | "rightWorkRecoveryStructure"
  | "reasonableIntensity"
  | "reasonableExecution"
  | "claimsWithoutSupport"
  | "missedKeyProperty"
  | "reasonableConfidence";

/** Canonical order = the §3 checklist order, also the CLI table order. */
export const GOLD_SET_CHECKS: readonly GoldSetCheck[] = [
  "rightBroadCategory",
  "rightWorkSegments",
  "rightWorkRecoveryStructure",
  "reasonableIntensity",
  "reasonableExecution",
  "claimsWithoutSupport",
  "missedKeyProperty",
  "reasonableConfidence",
];

/** Old-school column headers, deliberately the §3 wording. */
export const GOLD_SET_CHECK_LABELS: Record<GoldSetCheck, string> = {
  rightBroadCategory: "broad category",
  rightWorkSegments: "work segments",
  rightWorkRecoveryStructure: "work/recovery",
  reasonableIntensity: "intensity",
  reasonableExecution: "execution",
  claimsWithoutSupport: "no unsupported claims",
  missedKeyProperty: "no missed key property",
  reasonableConfidence: "confidence",
};

export interface GoldSetComparison {
  entry: GoldSetEntry;
  rightBroadCategory: CompareVerdict;
  rightWorkSegments: CompareVerdict;
  rightWorkRecoveryStructure: CompareVerdict;
  reasonableIntensity: CompareVerdict;
  reasonableExecution: CompareVerdict;
  claimsWithoutSupport: CompareVerdict;
  missedKeyProperty: CompareVerdict;
  reasonableConfidence: CompareVerdict;
  /** One short human sentence per check, with the numbers that decided it. */
  notes: Record<GoldSetCheck, string>;
}

export interface GoldSetSummary {
  counts: Record<CompareVerdict, number>;
  overall: "pass" | "attention" | "fail";
  total: number;
  /** Entries containing at least one "no" — the ones worth investigating. */
  actionable: GoldSetEntry[];
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Neighbouring broad classes: calling an interval session "threshold-tempo"
 *  is imprecise, calling an easy run "interval" is wrong (§3: "Om algoritmen
 *  kallar ett vanligt distanspass VO2 har vi hittat ett fel"). */
const RELATED_CLASSES: Record<SessionClass, readonly SessionClass[]> = {
  "easy-recovery": ["long", "mixed"],
  long: ["easy-recovery", "mixed"],
  "threshold-tempo": ["interval", "race-benchmark", "mixed"],
  interval: ["threshold-tempo", "mixed"],
  "race-benchmark": ["threshold-tempo", "interval"],
  mixed: ["easy-recovery", "long", "threshold-tempo", "interval"],
  unknown: [],
};

function norm(text: string): string {
  return text.toLowerCase();
}

function hasAny(text: string, needles: readonly string[]): boolean {
  const t = norm(text);
  return needles.some((needle) => t.includes(needle));
}

/** Free-text intensity → the threshold-stimulus levels the facit would accept,
 *  or null when the wording is not machine-mappable (then the check reports
 *  "skipped" and a human reads it — never invent a mapping).
 *  A "threshold" session is legitimately "moderate" or "high" threshold
 *  stimulus (§2's own example pairs threshold intervals with HIGH), while
 *  "easy" must stay low. */
function intensityLevelsFromText(text: string): Level[] | null {
  if (
    hasAny(text, [
      "vo2",
      "vo₂",
      "max effort",
      "maximal",
      "hårt",
      "hard",
      "5k pace",
      "3k pace",
      "sprint",
      "race pace",
    ])
  )
    return ["high"];
  if (
    hasAny(text, [
      "threshold",
      "tröskel",
      "tempo",
      "marathon pace",
      "half marathon",
      "komfortabelt snabb",
      "comfortably hard",
      "sub-threshold",
    ])
  )
    return ["moderate", "high"];
  if (
    hasAny(text, [
      "easy",
      "lugnt",
      "lugn",
      "jogg",
      "recovery",
      "återhämtning",
      "aerobic",
      "aerob",
      "zone 2",
      "zon 2",
      "z2",
      "distans",
    ])
  )
    return ["low"];
  return null;
}

const LEVEL_RANK: Record<Exclude<Level, "unknown">, number> = {
  low: 0,
  moderate: 1,
  high: 2,
};

function executionFromText(
  text: string,
): "steady" | "uneven" | "deteriorated" | null {
  if (
    hasAny(text, [
      "försämr",
      "deteriorat",
      "faded",
      "fade",
      "blev sämre",
      "tröttnade",
      "tappade",
      "slowed",
    ])
  )
    return "deteriorated";
  if (
    hasAny(text, [
      "ojämnt",
      "uneven",
      "avbrutet",
      "aborted",
      "bröt",
      "sprack",
      "gick inte",
      "bailed",
    ])
  )
    return "uneven";
  if (
    hasAny(text, [
      "enligt plan",
      "as planned",
      "jämnt",
      "even",
      "kontrollerat",
      "controlled",
      "consistent",
      "stabilt",
      "steady",
    ])
  )
    return "steady";
  return null;
}

function shapeKindFromText(text: string): "interval" | "continuous" | null {
  if (
    hasAny(text, [
      "×",
      " x ",
      "intervall",
      "interval",
      "reps",
      "repetition",
      "recovery between",
      "serie",
    ])
  )
    return "interval";
  if (
    hasAny(text, [
      "continuous",
      "sammanhängande",
      "i ett svep",
      "steady",
      "jämn distans",
      "non-stop",
    ])
  )
    return "continuous";
  return null;
}

// ---------------------------------------------------------------------------
// The §3 checklist
// ---------------------------------------------------------------------------

function compareCategory(
  profile: SessionProfile,
  entry: GoldSetEntry,
): [CompareVerdict, string] {
  const expected = entry.expected.category;
  const actual = profile.classification;
  // §3: a facit that does not state the category must not punish the profile —
  // "I don't remember / unclear" says nothing about the algorithm's reading.
  if (expected === "unknown") {
    if (actual === "unknown")
      return ["yes", 'facit names no category, profile honestly says "unknown"'];
    return [
      "skipped",
      `facit states no category; profile read "${actual}" (not scored)`,
    ];
  }
  if (actual === expected)
    return ["yes", `classified "${actual}" as the facit says`];
  if (RELATED_CLASSES[expected].includes(actual))
    return [
      "partial",
      `classified "${actual}" — a neighbouring class to the facit's "${expected}"`,
    ];
  return ["no", `classified "${actual}", facit says "${expected}"`];
}

function compareWorkSegments(
  profile: SessionProfile,
  entry: GoldSetEntry,
): [CompareVerdict, string] {
  const expected = entry.expected.workSegments;
  if (expected === undefined)
    return ["skipped", "facit states no work-segment count"];
  const actual = profile.structure.workCount;
  const note = `${actual} work segment(s) detected, facit says ${expected}`;
  if (actual === expected) return ["yes", note];
  if (Math.abs(actual - expected) === 1)
    return ["partial", `${note} — off by one`];
  if (actual === 0)
    return ["no", `${note} — no interval structure recovered`];
  return ["no", note];
}

function compareWorkRecoveryShape(
  profile: SessionProfile,
  entry: GoldSetEntry,
): [CompareVerdict, string] {
  const shape = entry.expected.workRecoveryShape;
  if (shape === undefined) return ["skipped", "facit states no work/recovery shape"];
  const expectedKind = shapeKindFromText(shape);
  if (expectedKind === null)
    return ["skipped", `facit shape "${shape}" is not machine-mappable`];
  const actualKind = profile.structure.kind;
  if (actualKind === "unclear")
    return ["partial", `structure unclear; facit describes "${expectedKind}" work`];
  if (actualKind === expectedKind)
    return [
      "yes",
      `detected ${expectedKind} structure (${profile.structure.workCount} work / ${profile.structure.recoveryCount} recovery)`,
    ];
  return ["no", `detected ${actualKind}, facit describes ${expectedKind}`];
}

function compareIntensity(
  profile: SessionProfile,
  entry: GoldSetEntry,
): [CompareVerdict, string] {
  const text = entry.expected.intensity;
  if (text === undefined) return ["skipped", "facit states no intensity"];
  const accepted = intensityLevelsFromText(text);
  if (accepted === null)
    return ["skipped", `facit intensity "${text}" is not machine-mappable`];
  const actual = profile.stimulus.threshold;
  if (actual === "unknown")
    return [
      "partial",
      `facit says "${text}" intensity, profile claims no threshold stimulus evidence`,
    ];
  const note = `profile threshold stimulus ${actual}, facit says "${text}" (${accepted.join("/")})`;
  if (accepted.includes(actual)) return ["yes", note];
  const rankOf = (level: Level): number =>
    level === "unknown" ? Number.NaN : LEVEL_RANK[level];
  const nearest = Math.min(
    ...accepted.map((level) => Math.abs(rankOf(level) - rankOf(actual))),
  );
  if (nearest === 1) return ["partial", `${note} — one step off`];
  return ["no", note];
}

function compareExecution(
  profile: SessionProfile,
  entry: GoldSetEntry,
): [CompareVerdict, string] {
  const text = entry.expected.execution;
  if (text === undefined) return ["skipped", "facit states no execution readout"];
  const expected = executionFromText(text);
  if (expected === null)
    return ["skipped", `facit execution "${text}" is not machine-mappable`];
  const actual = profile.execution.consistency;
  if (actual === "unclear")
    return ["partial", `facit reads ${expected}, profile could not judge execution`];
  if (actual === expected)
    return ["yes", `execution "${actual}" matches the facit`];
  return ["no", `execution "${actual}", facit reads ${expected}`];
}

/** Did the profile assert anything the data cannot support? §2.4/§3: high
 *  confidence on an `unknown` classification, any recovery-cost estimate
 *  (v0.1 invariant: recovery is ALWAYS "unknown"), or high confidence on
 *  poor data are all fabricated precision. */
function compareClaims(
  profile: SessionProfile,
): [CompareVerdict, string] {
  const problems: string[] = [];
  if (profile.classification === "unknown" && profile.confidence === "high")
    problems.push('high confidence on an "unknown" classification');

  if ((profile.cost.recovery as string) !== "unknown")
    problems.push(
      `recovery cost claimed as "${profile.cost.recovery}" — v0.1 invariant is "unknown"`,
    );

  if (profile.dataQuality === "poor" && profile.confidence === "high")
    problems.push('high confidence on "poor" data quality');

  // A hard "no" always wins over the softer poor-data nuance: a fabricated
  // recovery claim must never be softened into "partial" (which the CLI would
  // report as exit 0).
  if (problems.length > 0) return ["no", problems.join("; ")];

  if (profile.dataQuality === "poor" && profile.confidence === "moderate")
    return [
      "partial",
      'moderate confidence on "poor" data quality — should be capped at low',
    ];

  return ["yes", "no claim beyond the evidence"];
}

/** Did the profile silently drop a structural property the facit names? */
function compareMissedProperty(
  profile: SessionProfile,
  entry: GoldSetEntry,
): [CompareVerdict, string] {
  const prose = `${entry.actual} ${entry.assessment}`;
  const structure = profile.structure;
  const missed: string[] = [];
  const hedged: string[] = [];

  // Work segments named in `expected` but not recovered at all.
  if (entry.expected.workSegments !== undefined && structure.workCount === 0) {
    missed.push(`facit names ${entry.expected.workSegments} work segments, none detected`);
  }

  if (hasAny(prose, ["uppvärmning", "warmup", "warm-up", "warm up"])) {
    if (!structure.warmupDetected) hedged.push("facit names a warm-up, none detected");
  }
  if (hasAny(prose, ["nedjogg", "cooldown", "cool-down", "cool down"])) {
    if (!structure.cooldownDetected) hedged.push("facit names a cool-down, none detected");
  }
  if (hasAny(prose, ["försämr", "deteriorat", "faded", "blev sämre", "tappade"])) {
    if (structure.lateDeterioration === "unknown")
      hedged.push("facit names late deterioration, profile could not judge it");
    else if (structure.lateDeterioration === "stable")
      missed.push('facit names late deterioration, profile saw "stable"');
  }

  if (missed.length > 0) return ["no", missed.join("; ")];
  if (hedged.length > 0) return ["partial", hedged.join("; ")];
  return ["yes", "no key property of the facit is missing"];
}

/** Is the stated confidence defensible for this profile and this data? */
function compareConfidence(
  profile: SessionProfile,
  entry: GoldSetEntry,
): [CompareVerdict, string] {
  const conf: Confidence = profile.confidence;
  const structure = profile.structure;

  if (profile.classification === "unknown" && conf === "high")
    return ["no", 'high confidence on an "unknown" classification'];
  if (profile.classification === "unknown" && conf === "moderate")
    return ["partial", 'moderate confidence on an "unknown" classification'];

  if (profile.dataQuality === "poor") {
    if (conf === "high" || conf === "moderate")
      return ["partial", 'poor data quality should cap confidence at low'];
  }
  if (structure.kind === "unclear" && conf === "high")
    return ["no", 'high confidence while the structure is "unclear"'];
  if (
    (structure.gapRecovered || structure.hiddenRestDetected) &&
    conf === "high"
  )
    return [
      "partial",
      "structure was recovered indirectly (paused clock / hidden rest) — confidence should cap at moderate",
    ];

  // A facit that admits the session is hard to read should meet honest doubt.
  if (entry.expected.category === "unknown" && (conf === "low" || conf === "insufficient"))
    return ["yes", `honest "${conf}" on a facit that is itself unsure`];

  return ["yes", `"${conf}" is defensible for dataQuality "${profile.dataQuality}"`];
}

/** Rejects a facit entry the compare step cannot interpret. Throws a plain
 *  Error naming the entry so a typo'd gold set fails loudly ("entry X is
 *  broken") instead of with "Cannot read properties of undefined". */
export function assertValidGoldSetEntry(entry: GoldSetEntry): void {
  const label = entry?.id ? `"${entry.id}"` : "<no id>";
  if (typeof entry?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date))
    throw new Error(`malformed facit entry ${label}: date must be yyyy-mm-dd`);
  if (Number.isNaN(new Date(`${entry.date}T00:00:00.000Z`).getTime()))
    throw new Error(`malformed facit entry ${label}: date "${entry.date}" is not a real day`);
  if (entry.expected === undefined || entry.expected === null)
    throw new Error(`malformed facit entry ${label}: "expected" is required`);
  if (typeof entry.expected.category !== "string" || entry.expected.category.length === 0)
    throw new Error(`malformed facit entry ${label}: expected.category is required`);
  // A typo'd category would otherwise blow up in RELATED_CLASSES[category]
  // as "Cannot read properties of undefined" — name the valid values instead.
  const validCategories = Object.keys(RELATED_CLASSES);
  if (!validCategories.includes(entry.expected.category))
    throw new Error(
      `malformed facit entry ${label}: expected.category "${entry.expected.category}" is not a known session class (valid: ${validCategories.join(", ")})`,
    );
}

/** Compares one already-computed profile against one facit entry. Pure: the
 *  profile is an input, never derived from the entry. */
export function compareToGoldSet(
  profile: SessionProfile,
  entry: GoldSetEntry,
): GoldSetComparison {
  assertValidGoldSetEntry(entry);
  const checks: Record<GoldSetCheck, [CompareVerdict, string]> = {
    rightBroadCategory: compareCategory(profile, entry),
    rightWorkSegments: compareWorkSegments(profile, entry),
    rightWorkRecoveryStructure: compareWorkRecoveryShape(profile, entry),
    reasonableIntensity: compareIntensity(profile, entry),
    reasonableExecution: compareExecution(profile, entry),
    claimsWithoutSupport: compareClaims(profile),
    missedKeyProperty: compareMissedProperty(profile, entry),
    reasonableConfidence: compareConfidence(profile, entry),
  };

  const notes = {} as Record<GoldSetCheck, string>;
  for (const check of GOLD_SET_CHECKS) notes[check] = checks[check][1];

  return {
    entry,
    rightBroadCategory: checks.rightBroadCategory[0],
    rightWorkSegments: checks.rightWorkSegments[0],
    rightWorkRecoveryStructure: checks.rightWorkRecoveryStructure[0],
    reasonableIntensity: checks.reasonableIntensity[0],
    reasonableExecution: checks.reasonableExecution[0],
    claimsWithoutSupport: checks.claimsWithoutSupport[0],
    missedKeyProperty: checks.missedKeyProperty[0],
    reasonableConfidence: checks.reasonableConfidence[0],
    notes,
  };
}

/** Rolls a gold-set run up to one verdict. `fail` = a real error (wrong broad
 *  category, or an unsupported claim); `attention` = imprecision worth a look,
 *  or a facit so thin that nothing was machine-verifiable; `pass` = every
 *  facit-stated dimension matched and at least one dimension was checkable. An
 *  empty gold set is a pass with `total: 0` — nothing to disagree with yet. */
export function summarizeGoldSet(
  comparisons: readonly GoldSetComparison[],
): GoldSetSummary {
  const counts: Record<CompareVerdict, number> = {
    yes: 0,
    partial: 0,
    no: 0,
    skipped: 0,
  };
  const actionable: GoldSetEntry[] = [];
  let hardFailure = false;
  // Dimensions the facit itself can state. `claimsWithoutSupport`,
  // `missedKeyProperty` and `reasonableConfidence` are always judged, so they
  // cannot tell us whether the facit actually verified anything.
  const FACIT_CHECKS = GOLD_SET_CHECKS.slice(0, 5);
  let verifiedFacitDimensions = 0;

  for (const comparison of comparisons) {
    let entryHasNo = false;
    for (const check of GOLD_SET_CHECKS) {
      const verdict = comparison[check];
      counts[verdict] += 1;
      // A facit that states no category cannot verify one: "yes" there only
      // means both sides said "unknown", which is not evidence the algorithm
      // read anything right. Counting it would let a facit with no stated
      // dimension reach PASS, defeating the thin-facit guard below.
      const facitStatedCategory =
        check !== "rightBroadCategory" ||
        comparison.entry.expected.category !== "unknown";
      if (verdict !== "skipped" && FACIT_CHECKS.includes(check) && facitStatedCategory)
        verifiedFacitDimensions += 1;
      if (verdict === "no") {
        entryHasNo = true;
        if (check === "claimsWithoutSupport" || check === "rightBroadCategory")
          hardFailure = true;
      }
    }
    if (entryHasNo) actionable.push(comparison.entry);
  }

  // "skipped" is never a quiet pass: a run whose facit stated nothing
  // checkable has established nothing, so it must not report PASS.
  const overall = hardFailure
    ? "fail"
    : comparisons.length === 0
      ? "pass"
      : counts.partial > 0 || verifiedFacitDimensions === 0
        ? "attention"
        : "pass";

  return { counts, overall, total: comparisons.length, actionable };
}
