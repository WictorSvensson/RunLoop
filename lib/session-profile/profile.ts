import { RUNNING_TYPES } from "@/lib/running-types";
import {
  formatDistance,
  formatDuration,
  formatPaceFromSecPerKm,
} from "@/lib/format";
import type {
  Confidence,
  DataQuality,
  Level,
  SessionActivityInput,
  SessionClass,
  SessionCost,
  SessionExecution,
  SessionLapInput,
  SessionProfile,
  SessionStimulus,
  SessionStreamsInput,
  SessionStructure,
} from "@/lib/session-profile/types";

// ---------------------------------------------------------------------------
// sessionProfile() v0.1 — pure Activity + laps + streams -> SessionProfile.
//
// Strict evaluation order (förtydligande §1):
//   1. STRUCTURE detection (laps + pace stream, no classification yet)
//   2. broad CLASSIFICATION + confidence from that structure
//   3. execution / stimulus / cost / dataQuality derived last
//
// HR is one signal only: it corroborates or weakens, never single-handedly
// decides. Recovery cost is ALWAYS unknown (no RPE/check-in/HR-recovery
// evidence is wired in v0.1). Cutoffs marked "v0.1 heuristic" are starting
// points for the gold-set loop (§5), not physiological truths.
// ---------------------------------------------------------------------------

// --- v0.1 heuristic cutoffs (tune via gold set, not by gut) ----------------
const MIN_TIMED_LAPS = 4; // laps needed before claiming lap structure
const MIN_LAP_DISTANCE_M = 100; // shorter laps are GPS fragments (watch stop/start splits of a few meters/seconds) — their pace is quantization noise, not a running signal, so they are excluded from `timed` entirely
const FAST_SPLIT = 0.92; // lap pace <= median * this => "work" (>=8% faster)
const MIN_WORK_SEC = 60; // faster laps shorter than this are strides, not work
const SHORT_WORK_SEC = 180; // median work below this => "interval", else threshold-tempo
const WORK_PACE_SCATTER_CV = 0.5; // work-PACE CV above this => repeatability doubtful
const STEADY_CV = 0.08; // pace CV at/below => steady
const UNEVEN_CV = 0.15; // pace CV above => uneven (between => variable)
const HR_SHIFT_BPM = 3; // work-HR first/second-half shift needed to claim rise/fall
const DETERIORATION_PCT = 4; // work-pace slowdown % needed to claim deterioration
const LONG_DIST_M = 18000; // 18 km — same marker the spec's WeekProfile example uses
const LONG_TIME_SEC = 5400; // 90 min
const HIDDEN_REST_MIN_SEC = 180; // ≥3 min stopped inside timed laps — below this, traffic lights / shoe-tying noise
const HIDDEN_REST_MIN_FRAC = 0.15; // ≥15% of summed lap elapsed — separates the observed 0–10% urban-stop cluster from the 20%+ workout-with-breaks cluster (wictor history scan); both floors must hold, so short runs with one stop stay easy
const STOP_SPEED_MPS = 0.5; // matches scripts/import-suunto/gpx.ts STOP_SPEED_MPS
// --- paused-clock (auto-pause) sub-lap cutoffs (v0.1 heuristic) ---------------
// A watch on auto-pause stops RECORDING during rests: no slow speed samples,
// no lap elapsed excess — just jumps in the record clock (fitTime/time) with
// distance frozen. These cutoffs key on those jumps, never on slow speeds.
const RECORDING_GAP_SEC = 30; // fitTime jump above this => paused-clock recovery (July-14 gaps were 35–135 s; a single traffic light sits at/below this and fails the count/total gates below)
const FREEZE_SPLIT_SEC = 30; // clock running but distance frozen this long => non-auto-pause stop, also a split point
const MIN_GAP_WORK_SEC = 90; // work bouts shorter than this are strides/fragments, not reps
const MIN_GAP_WORK_M = 200; // work bouts covering less than this are GPS drift, not running
const MIN_GAP_WORKS = 3; // fewer bouts is a stop-interrupted easy run, not intervals
const HR_CORROBORATE_MIN_BPM = 140; // mean work-bout HR floor for corroboration only (v0.1 heuristic): separates the 134–138 easy fixtures from 148+ quality sessions — never classifies alone
const HR_STEP_WINDOW = 15; // valid HR samples per side for pre/post-gap means (≈15 s at 1 Hz — captures the resume dip before HR recovers)
const HR_STEP_MIN_SAMPLES = 5; // valid samples required per side; fewer => gap unmeasurable (optical dropout), excluded not counted against
const HR_STEP_MIN_BPM = 10; // per-gap pre−post drop counting as rest-confirmed (v0.1 heuristic: observed workout dips are 26–43 bpm; 10 sits well above easy-run drift but far below observed cliffs)
const MIN_STREAM_SAMPLES = 30;
const MIN_STREAM_SPAN_SEC = 300;
const RACE_KEYWORDS = [
  "race",
  "competition",
  "tävling",
  "lopp",
  "benchmark",
  "time trial",
  "testlopp",
];

// --- small pure helpers (no existing shared helper covers these) ------------

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Coefficient of variation (fraction, not %). Null without mean/spread. */
function cv(values: number[]): number | null {
  const m = mean(values);
  if (m === null || m === 0 || values.length < 2) return null;
  const variance =
    values.reduce((s, v) => s + (v - m) * (v - m), 0) / values.length;
  return Math.sqrt(variance) / Math.abs(m);
}

function paceSecPerKm(lap: SessionLapInput): number | null {
  if (lap.averageSpeed !== null && lap.averageSpeed > 0)
    return 1000 / lap.averageSpeed;
  if (
    lap.distance !== null &&
    lap.distance > 0 &&
    lap.movingTime != null &&
    lap.movingTime > 0
  )
    return lap.movingTime / (lap.distance / 1000);
  return null;
}

/** Lap duration: measured movingTime preferred; elapsedTime fallback; else a
 *  distance/pace estimate (flagged via `estimated`). */
function lapDurationSec(
  lap: SessionLapInput,
): { seconds: number | null; estimated: boolean } {
  if (lap.movingTime != null && lap.movingTime > 0)
    return { seconds: lap.movingTime, estimated: false };
  if (lap.elapsedTime != null && lap.elapsedTime > 0)
    return { seconds: lap.elapsedTime, estimated: true };
  const pace = paceSecPerKm(lap);
  if (lap.distance !== null && lap.distance > 0 && pace !== null)
    return {
      seconds: Math.round((lap.distance / 1000) * pace),
      estimated: true,
    };
  return { seconds: null, estimated: true };
}

// --- stream parsing (defensive: payload shapes differ by importer) ----------

interface PaceStreamSupport {
  sampleCount: number;
  spanSec: number;
  paceCv: number;
  stopCount: number;
  meanPaceSecPerKm: number;
}

interface HrStreamSupport {
  sampleCount: number;
  meanHr: number;
}

function numericArray(value: unknown): (number | null)[] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) return null;
  const out: (number | null)[] = [];
  for (const v of data) {
    out.push(typeof v === "number" && Number.isFinite(v) ? v : null);
  }
  return out;
}

/** Derives per-sample pace from cumulative distance + time series (either the
 *  GPX `time` key or the FIT `fitTime` key). Returns null when the stream
 *  cannot honestly support pace claims (too few samples / too short). */
function derivePaceStream(
  streams: SessionStreamsInput,
): PaceStreamSupport | null {
  if (streams === null) return null;
  const time =
    numericArray(streams.time) ?? numericArray(streams.fitTime) ?? null;
  const distance = numericArray(streams.distance);
  if (time === null || distance === null) return null;

  // Pair by index (both series are record-ordered from their importer), keep
  // only finite pairs, then differentiate over sane gaps.
  const speeds: number[] = [];
  let firstT: number | null = null;
  let lastT: number | null = null;
  const n = Math.min(time.length, distance.length);
  for (let i = 1; i < n; i++) {
    const t0 = time[i - 1];
    const t1 = time[i];
    const d0 = distance[i - 1];
    const d1 = distance[i];
    if (t0 === null || t1 === null || d0 === null || d1 === null) continue;
    const dt = t1 - t0;
    // Standard 1 Hz FIT/GPX series have dt ≈ 1 — accept any positive gap up
    // to 120 s (pauses); only non-positive or huge jumps are unusable.
    if (!(dt > 0) || dt > 120) continue;
    const speed = (d1 - d0) / dt; // m/s
    if (!Number.isFinite(speed) || speed < 0 || speed > 12) continue;
    speeds.push(speed);
    if (firstT === null) firstT = t0;
    lastT = t1;
  }
  if (
    speeds.length < MIN_STREAM_SAMPLES ||
    firstT === null ||
    lastT === null ||
    lastT - firstT < MIN_STREAM_SPAN_SEC
  )
    return null;

  // 9-sample moving average before measuring spread (same smoothing idea as
  // scripts/import-suunto/gpx.ts elevation math) so GPS jitter isn't read as
  // "uneven execution".
  const smoothed: number[] = [];
  for (let i = 0; i < speeds.length; i++) {
    const window = speeds.slice(Math.max(0, i - 8), i + 1);
    const m = mean(window);
    if (m !== null) smoothed.push(m);
  }
  const paces = smoothed
    .filter((s) => s > 0)
    .map((s) => 1000 / s);
  const paceCvValue = cv(paces);
  const meanPace = mean(paces);
  if (paceCvValue === null || meanPace === null) return null;
  return {
    sampleCount: smoothed.length,
    spanSec: Math.round(lastT - firstT),
    paceCv: paceCvValue,
    stopCount: smoothed.filter((s) => s < STOP_SPEED_MPS).length,
    meanPaceSecPerKm: meanPace,
  };
}

function deriveHrStream(streams: SessionStreamsInput): HrStreamSupport | null {
  if (streams === null) return null;
  const series = numericArray(streams.heartrate);
  if (series === null) return null;
  const hrs = series.filter(
    (h): h is number => h !== null && h > 30 && h < 230,
  );
  if (hrs.length < MIN_STREAM_SAMPLES) return null;
  const m = mean(hrs);
  if (m === null) return null;
  return { sampleCount: hrs.length, meanHr: m };
}

// --- paused-clock sub-lap segmentation --------------------------------------

interface PausedClockBouts {
  workDurationsSec: number[];
  workPaceSecPerKm: number[];
  workHrMeans: number[];
  recoveryGapsSec: number[];
  meanWorkHr: number;
  /** Per-gap HR drops (pre-gap mean − post-gap mean, bpm) for recording gaps
   *  with enough valid HR on both sides; gaps with optical dropouts are
   *  excluded here and counted in `hrStepUnknownGaps` instead. */
  hrStepDropsBpm: number[];
  hrStepUnknownGaps: number;
}

/**
 * Segments the record stream into work bouts split by paused-clock recoveries:
 * fitTime/time jumps (auto-pause stops recording, so rests appear as clock
 * gaps with distance frozen, not as slow samples) and distance-frozen runs
 * (clock advancing while the athlete is stopped, i.e. no auto-pause).
 *
 * Returns null unless the bouts look like structured work: enough long
 * steady bouts, substantial total paused time, and elevated HR corroboration
 * (mean work HR floor PLUS a rest-confirmed HR dip across at least half of
 * the measurable recording gaps). HR is a necessary-but-never-sufficient
 * gate — it corroborates bouts the clock gaps already define, and a low-HR
 * session (easy with stops, walk-breaks) always returns null here. The dip
 * confirms the pause was rest, not whether the session is a workout or a
 * stoplight-interrupted run — that distinction stays with the count and
 * total-rest gates.
 */
function detectPausedClockBouts(
  streams: SessionStreamsInput,
): PausedClockBouts | null {
  if (streams === null) return null;
  const time =
    numericArray(streams.time) ?? numericArray(streams.fitTime) ?? null;
  const distance = numericArray(streams.distance);
  if (time === null || distance === null) return null;
  const heartrate = numericArray(streams.heartrate);

  const n = Math.min(time.length, distance.length);
  if (n < MIN_STREAM_SAMPLES + 1) return null;

  const recoveryGapsSec: number[] = [];
  const bouts: { dur: number; dist: number; hrSum: number; hrN: number }[] = [];
  let cur = { dur: 0, dist: 0, hrSum: 0, hrN: 0 };
  let frozenAcc = 0;
  // Record-index bounds of each recording gap (pair i-1 → i): pre-gap HR is
  // read at/before `pre`, post-gap HR at/after `post`.
  const gapBounds: { pre: number; post: number }[] = [];

  const closeBout = () => {
    bouts.push(cur);
    cur = { dur: 0, dist: 0, hrSum: 0, hrN: 0 };
    frozenAcc = 0;
  };

  for (let i = 1; i < n; i++) {
    const t0 = time[i - 1];
    const t1 = time[i];
    const d0 = distance[i - 1];
    const d1 = distance[i];
    if (t0 === null || t1 === null || d0 === null || d1 === null) continue;
    const dt = t1 - t0;
    const dd = d1 - d0;
    if (!(dt > 0) || dt > 3600 || dd < 0 || dd > dt * 12) continue;
    if (dt > RECORDING_GAP_SEC) {
      // Paused clock: the watch recorded nothing for dt seconds. The gap
      // itself is the recovery evidence (wall-clock approximation).
      closeBout();
      recoveryGapsSec.push(Math.round(dt));
      gapBounds.push({ pre: i - 1, post: i });
      continue;
    }
    const speed = dd / dt;
    const hr =
      heartrate !== null && i < heartrate.length ? heartrate[i] : null;
    const hrValid = hr !== null && hr > 30 && hr < 230;
    if (speed < STOP_SPEED_MPS) {
      frozenAcc += dt;
      if (frozenAcc >= FREEZE_SPLIT_SEC) {
        // Stopped with the clock running — split here; the frozen stretch
        // (carrying ~no distance) is the recovery, not work.
        closeBout();
        recoveryGapsSec.push(Math.round(frozenAcc));
        continue;
      }
      // Brief freeze inside a bout (GPS jitter at a turn): keep the clock in
      // the bout duration but neither its distance (none) nor its HR.
      cur.dur += dt;
      continue;
    }
    frozenAcc = 0;
    cur.dur += dt;
    cur.dist += dd;
    if (hrValid && hr !== null) {
      cur.hrSum += hr;
      cur.hrN += 1;
    }
  }
  bouts.push(cur);

  const works = bouts.filter(
    (b) => b.dur >= MIN_GAP_WORK_SEC && b.dist >= MIN_GAP_WORK_M,
  );
  if (works.length < MIN_GAP_WORKS) return null;
  const totalRecovery = recoveryGapsSec.reduce((s, g) => s + g, 0);
  if (totalRecovery < HIDDEN_REST_MIN_SEC) return null;

  const workPaces = works.map((b) => b.dur / (b.dist / 1000));
  const workCv = cv(workPaces);
  if (workCv === null || workCv > STEADY_CV) return null;

  // HR corroboration only: bouts must carry sustained elevated HR. Low HR
  // (easy pace, walk-breaks) vetoes the recovery regardless of bout shape.
  const workHrMeans = works
    .filter((b) => b.hrN >= 5)
    .map((b) => b.hrSum / b.hrN);
  if (workHrMeans.length < 2) return null;
  const meanWorkHr = mean(workHrMeans);
  if (meanWorkHr === null || meanWorkHr < HR_CORROBORATE_MIN_BPM) return null;

  // HR-step corroboration (ADDITIONAL, alongside the meanWorkHr floor above —
  // never replacing it, never classifying alone): each recording gap should
  // show HR falling off a cliff into the rest (end-of-rep high vs dipped
  // resume HR). Nulls/optical dropouts are skipped; a gap with fewer than
  // HR_STEP_MIN_SAMPLES valid samples per side is unmeasurable (excluded,
  // not counted against); with zero measurable gaps the check is skipped as
  // unassessable. Otherwise at least half the measurable gaps must drop by
  // HR_STEP_MIN_BPM — the dip confirms rest, not workout-vs-stoplight.
  const hrAt = (idx: number): number | null => {
    if (heartrate === null || idx < 0 || idx >= heartrate.length) return null;
    const h = heartrate[idx];
    return h !== null && h > 30 && h < 230 ? h : null;
  };
  const hrStepDropsBpm: number[] = [];
  let hrStepUnknownGaps = 0;
  for (const g of gapBounds) {
    const pre: number[] = [];
    for (let j = g.pre; j >= 0 && pre.length < HR_STEP_WINDOW; j--) {
      const h = hrAt(j);
      if (h !== null) pre.push(h);
    }
    const post: number[] = [];
    for (let j = g.post; j < n && post.length < HR_STEP_WINDOW; j++) {
      const h = hrAt(j);
      if (h !== null) post.push(h);
    }
    if (pre.length < HR_STEP_MIN_SAMPLES || post.length < HR_STEP_MIN_SAMPLES) {
      hrStepUnknownGaps++;
      continue;
    }
    const preM = mean(pre);
    const postM = mean(post);
    if (preM === null || postM === null) {
      hrStepUnknownGaps++;
      continue;
    }
    hrStepDropsBpm.push(preM - postM);
  }
  if (hrStepDropsBpm.length > 0) {
    const confirmed = hrStepDropsBpm.filter(
      (d) => d >= HR_STEP_MIN_BPM,
    ).length;
    if (confirmed * 2 < hrStepDropsBpm.length) return null;
  }

  return {
    workDurationsSec: works.map((b) => Math.round(b.dur)),
    workPaceSecPerKm: workPaces,
    workHrMeans,
    recoveryGapsSec,
    meanWorkHr,
    hrStepDropsBpm,
    hrStepUnknownGaps,
  };
}

// --- step 1: structure ------------------------------------------------------

interface TimedLap {
  lap: SessionLapInput;
  pace: number;
  durationSec: number | null;
  durationEstimated: boolean;
}

function detectStructure(
  laps: SessionLapInput[],
  paceStream: PaceStreamSupport | null,
  streams: SessionStreamsInput,
  evidence: string[],
  uncertainty: string[],
): SessionStructure {
  const base: SessionStructure = {
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
    hiddenRestDetected: false,
    gapRecovered: false,
    notes: [],
  };

  const timed: TimedLap[] = [];
  let estimatedDurations = false;
  let fragmentLaps = 0;
  for (const lap of laps) {
    // GPS fragment guard: a lap of a few meters (typical watch stop/start
    // split, e.g. 4–16 m in 2–7 s) carries no pace signal — its pace is
    // quantization noise that inflates lap CV and blocks both the steady
    // path and the work/recovery split. Real short reps (existing fixtures:
    // recovery jogs ≥ ~225 m, work reps ≥ ~357 m) are far above this floor.
    if (lap.distance !== null && lap.distance < MIN_LAP_DISTANCE_M) {
      fragmentLaps++;
      continue;
    }
    const pace = paceSecPerKm(lap);
    if (pace === null) continue;
    const { seconds, estimated } = lapDurationSec(lap);
    if (estimated) estimatedDurations = true;
    timed.push({ lap, pace, durationSec: seconds, durationEstimated: estimated });
  }

  // Hidden-rest signal: stops (auto-pause recoveries, traffic, shoe-tying)
  // averaged INTO auto-laps show up as lap elapsed exceeding lap moving
  // time. Summed over timed laps carrying both fields; unmeasurable when
  // the source rows carry no per-lap times (then no claim is made).
  let hiddenRestSec = 0;
  let hiddenElapsedSec = 0;
  for (const t of timed) {
    const moving = t.lap.movingTime;
    const elapsed = t.lap.elapsedTime;
    if (moving != null && moving > 0 && elapsed != null && elapsed > 0) {
      hiddenRestSec += Math.max(0, elapsed - moving);
      hiddenElapsedSec += elapsed;
    }
  }
  base.hiddenRestDetected =
    hiddenElapsedSec > 0 &&
    hiddenRestSec >= HIDDEN_REST_MIN_SEC &&
    hiddenRestSec / hiddenElapsedSec >= HIDDEN_REST_MIN_FRAC;

  if (timed.length < MIN_TIMED_LAPS) {
    base.notes.push(
      `fewer than ${MIN_TIMED_LAPS} timed laps (${timed.length}) — no lap structure claimed`,
    );
    if (fragmentLaps > 0)
      base.notes.push(
        `${fragmentLaps} fragment lap(s) under ${MIN_LAP_DISTANCE_M} m excluded — GPS stop/start splits, not running`,
      );
    if (timed.length === 0) {
      uncertainty.push("no timed laps — structure cannot be assessed from laps");
    } else if (timed.length === 1) {
      // One timed lap is still one continuous effort; steadiness is simply
      // unmeasurable, which the low confidence downstream must reflect.
      base.kind = "continuous";
      base.notes.push("single timed lap — steadiness unmeasurable");
    } else {
      const fewCv = cv(timed.map((t) => t.pace));
      base.paceCv = fewCv;
      if (fewCv !== null && fewCv <= STEADY_CV) {
        base.kind = "continuous";
        base.notes.push("2–3 steady laps — one continuous effort");
      }
    }
    // Fall through to stream-only steadiness below.
  } else {
    if (estimatedDurations) {
      base.notes.push(
        "lap durations estimated or elapsed-based (measured movingTime absent on some laps)",
      );
      uncertainty.push(
        "work/recovery durations are estimates or elapsed-based — some import lap rows carry no measured movingTime",
      );
    }
    if (fragmentLaps > 0) {
      base.notes.push(
        `${fragmentLaps} fragment lap(s) under ${MIN_LAP_DISTANCE_M} m excluded — GPS stop/start splits, not running`,
      );
    }
    const medianPace = median(timed.map((t) => t.pace));
    if (medianPace !== null) {
      // Split work vs recovery on within-session relativity (no HR zones in
      // v0.1, so "fast for this session" is all we can honestly claim).
      const work = timed.filter((t) => t.pace <= medianPace * FAST_SPLIT);
      const slow = timed.filter((t) => t.pace > medianPace * FAST_SPLIT);
      const realWork = work.filter(
        (t) => t.durationSec === null || t.durationSec >= MIN_WORK_SEC,
      );
      const strides = work.length - realWork.length;
      if (strides > 0)
        base.notes.push(
          `${strides} fast lap(s) under ${MIN_WORK_SEC}s treated as strides, not work`,
        );

      if (realWork.length >= 2 && slow.length >= 2) {
        // Warmup/cooldown: slow boundary laps are session framing, and must
        // not inflate the recovery count.
        const firstSlow = timed[0].pace > medianPace * FAST_SPLIT;
        const lastSlow =
          timed[timed.length - 1].pace > medianPace * FAST_SPLIT;
        base.warmupDetected = firstSlow;
        base.cooldownDetected = lastSlow;

        // Alternation check on the middle laps: interval work must be
        // separated by recovery, not one contiguous fast block.
        const labels = timed.map((t) =>
          t.pace <= medianPace * FAST_SPLIT ? "W" : "R",
        );
        const inner = labels.slice(
          firstSlow ? 1 : 0,
          lastSlow ? labels.length - 1 : labels.length,
        );
        let transitions = 0;
        for (let i = 1; i < inner.length; i++) {
          if (inner[i] !== inner[i - 1]) transitions++;
        }
        const fastContiguous =
          inner.indexOf("W") !== -1 &&
          inner.lastIndexOf("W") - inner.indexOf("W") + 1 ===
            inner.filter((l) => l === "W").length;

        if (!fastContiguous && transitions >= 3) {
          base.hasStructure = true;
          base.kind = "interval";
          const workDurs = realWork
            .map((t) => t.durationSec)
            .filter((d): d is number => d !== null);
          const recDurs = slow
            .filter(
              (t) =>
                !(firstSlow && t === timed[0]) &&
                !(lastSlow && t === timed[timed.length - 1]),
            )
            .map(({ lap }) => lapDurationSec(lap).seconds)
            .filter((d): d is number => d !== null);
          base.workCount = realWork.length;
          base.recoveryCount = slow.length - (firstSlow ? 1 : 0) - (lastSlow ? 1 : 0);
          base.medianWorkSec = median(workDurs);
          base.medianRecoverySec =
            recDurs.length > 0 ? median(recDurs) : null;

          const workPaces = realWork.map((t) => t.pace);
          base.paceCv = cv(workPaces);

          // §6.4 features: HR progression + late-rep deterioration across
          // work laps (HR corroborates; it does not classify).
          const workHrs = realWork
            .map((t) => t.lap.averageHeartrate)
            .filter((h): h is number => h !== null && h > 30 && h < 230);
          if (workHrs.length >= 2) {
            const half = Math.floor(workHrs.length / 2);
            const first = mean(workHrs.slice(0, half));
            const second = mean(workHrs.slice(half));
            if (first !== null && second !== null) {
              const shift = second - first;
              base.hrProgression =
                shift > HR_SHIFT_BPM
                  ? "rising"
                  : shift < -HR_SHIFT_BPM
                    ? "falling"
                    : "stable";
              evidence.push(
                `HR across ${workHrs.length} work laps: ${base.hrProgression} (${Math.round(first)} → ${Math.round(second)} bpm)`,
              );
            }
          } else {
            uncertainty.push(
              "HR progression unknown — fewer than 2 work laps carry HR",
            );
          }

          if (realWork.length >= 4) {
            const half = Math.floor(realWork.length / 2);
            const early = mean(realWork.slice(0, half).map((t) => t.pace));
            const late = mean(realWork.slice(half).map((t) => t.pace));
            if (early !== null && late !== null && early > 0) {
              const driftPct = ((late - early) / early) * 100;
              base.lateDeterioration =
                driftPct > DETERIORATION_PCT
                  ? "deteriorating"
                  : driftPct < -DETERIORATION_PCT
                    ? "progressive"
                    : "stable";
              evidence.push(
                `work pace first vs second half: ${formatPaceFromSecPerKm(early)} → ${formatPaceFromSecPerKm(late)} (${base.lateDeterioration})`,
              );
            }
          } else {
            base.notes.push(
              "fewer than 4 work laps — late-rep deterioration not assessed",
            );
          }

          evidence.push(
            `${base.workCount} work segments, median ${formatDuration(base.medianWorkSec)} work / ${formatDuration(base.medianRecoverySec)} recovery`,
          );
          if (base.warmupDetected || base.cooldownDetected)
            evidence.push(
              `session framing: ${[base.warmupDetected ? "warmup" : null, base.cooldownDetected ? "cooldown" : null].filter(Boolean).join(" + ")} lap(s) excluded from recovery count`,
            );
        } else if (fastContiguous) {
          base.kind = "continuous";
          base.notes.push(
            "fast laps form one contiguous block — sustained effort, not intervals",
          );
          base.paceCv = cv(timed.map((t) => t.pace));
        } else {
          base.notes.push(
            "pace split found but no clean work/recovery alternation — structure unclear",
          );
          uncertainty.push(
            "lap pattern is neither steady nor clearly alternating",
          );
          base.paceCv = cv(timed.map((t) => t.pace));
        }
      } else {
        // No bimodal split: either one steady effort or uninterpretable.
        const allCv = cv(timed.map((t) => t.pace));
        base.paceCv = allCv;
        if (allCv !== null && allCv <= STEADY_CV) {
          base.kind = "continuous";
          base.notes.push("no pace split — steady continuous effort");
        } else {
          base.notes.push("no pace split and pace spread is wide — unclear");
          uncertainty.push(
            "laps show no steady pace and no work/recovery split",
          );
        }
      }
    }
  }

  // Pace-stream steadiness supplements (never overrides) lap structure.
  if (paceStream !== null) {
    evidence.push(
      `pace stream: ${paceStream.sampleCount} smoothed samples over ${formatDuration(paceStream.spanSec)}, CV ${Math.round(paceStream.paceCv * 100)}%${paceStream.stopCount > 0 ? `, ${paceStream.stopCount} stopped samples` : ""}`,
    );
    if (base.paceCv === null) base.paceCv = paceStream.paceCv;
  } else if (timed.length === 0) {
    uncertainty.push("no usable pace stream — pace claims unsupported");
  }

  if (base.paceCv !== null) {
    base.paceStability =
      base.paceCv <= STEADY_CV
        ? "steady"
        : base.paceCv > UNEVEN_CV
          ? "uneven"
          : "variable";
  }

  // Hidden-rest honesty floor: a "steady continuous" lap split built from
  // laps that blend moving and stopped time is an averaging artefact, not
  // evidence of a steady run — sub-lap intervals hide exactly this way
  // (1 km auto-laps slicing through short reps + walk breaks). Refuse the
  // continuous reading; classification turns it into an honest unknown
  // (genuine lap-alternation intervals above are untouched).
  if (base.hiddenRestDetected && base.kind === "continuous") {
    base.kind = "unclear";
    base.notes.push(
      `substantial stops hidden inside auto-laps (${formatDuration(Math.round(hiddenRestSec))} stopped of ${formatDuration(hiddenElapsedSec)} lap elapsed) — steady lap pace averages work and rest, so sub-lap intervals cannot be ruled out`,
    );
    uncertainty.push(
      "stops hidden inside auto-laps exceed the v0.1 honesty floor — a steady lap split may average work and rest; the session needs sub-lap stream segmentation",
    );
  }

  // Paused-clock recovery: when lap-level detection found no intervals but
  // the record clock shows repeated pauses between steady work bouts
  // (auto-pause erases rests from lap elapsed AND from the speed stream, so
  // neither the lap split nor hiddenRestDetected can see them), recover the
  // interval structure from the bouts — provided elevated HR corroborates.
  // Genuine lap-alternation intervals above are untouched; easy runs with
  // tiny stops and walk-break sessions fail the bout/HR gates inside
  // detectPausedClockBouts and stay on their lap reading.
  if (!base.hasStructure && base.kind !== "interval") {
    const paused = detectPausedClockBouts(streams);
    if (paused !== null) {
      const workDurs = paused.workDurationsSec;
      const medianWork = median(workDurs);
      const medianRec = median(paused.recoveryGapsSec);
      base.hasStructure = true;
      base.kind = "interval";
      base.gapRecovered = true;
      base.workCount = workDurs.length;
      base.recoveryCount = paused.recoveryGapsSec.length;
      base.medianWorkSec = medianWork;
      base.medianRecoverySec = medianRec;
      base.paceCv = cv(paused.workPaceSecPerKm);
      base.paceStability =
        base.paceCv !== null && base.paceCv <= STEADY_CV ? "steady" : "variable";
      // Sub-lap resolution cannot identify warmup/cooldown framing laps.
      base.warmupDetected = false;
      base.cooldownDetected = false;

      const half = Math.floor(paused.workHrMeans.length / 2);
      const firstHr = mean(paused.workHrMeans.slice(0, half));
      const secondHr = mean(paused.workHrMeans.slice(half));
      if (firstHr !== null && secondHr !== null) {
        const shift = secondHr - firstHr;
        base.hrProgression =
          shift > HR_SHIFT_BPM
            ? "rising"
            : shift < -HR_SHIFT_BPM
              ? "falling"
              : "stable";
      }
      if (workDurs.length >= 4) {
        const h = Math.floor(paused.workPaceSecPerKm.length / 2);
        const early = mean(paused.workPaceSecPerKm.slice(0, h));
        const late = mean(paused.workPaceSecPerKm.slice(h));
        if (early !== null && late !== null && early > 0) {
          const driftPct = ((late - early) / early) * 100;
          base.lateDeterioration =
            driftPct > DETERIORATION_PCT
              ? "deteriorating"
              : driftPct < -DETERIORATION_PCT
                ? "progressive"
                : "stable";
        }
      } else {
        base.notes.push(
          "fewer than 4 sub-lap work bouts — late-rep deterioration not assessed",
        );
      }

      evidence.push(
        `${base.workCount} sub-lap work bouts between recording pauses, median ${formatDuration(base.medianWorkSec)} work / ${formatDuration(base.medianRecoverySec)} paused-clock recovery`,
      );
      if (base.hrProgression !== "unknown" && firstHr !== null && secondHr !== null)
        evidence.push(
          `HR across ${paused.workHrMeans.length} work bouts: ${base.hrProgression} (${Math.round(firstHr)} → ${Math.round(secondHr)} bpm) — corroboration only, mean ${Math.round(paused.meanWorkHr)} bpm`,
        );
      else
        evidence.push(
          `mean HR across work bouts ${Math.round(paused.meanWorkHr)} bpm — corroboration only`,
        );
      const medianStep = median(paused.hrStepDropsBpm);
      if (medianStep !== null) {
        const measured = paused.hrStepDropsBpm.length;
        const total = measured + paused.hrStepUnknownGaps;
        // Drops are stored pre−post (positive = dip); surfaced as a signed
        // step (negative = HR fell into the rest).
        evidence.push(
          `median HR step ${-Math.round(medianStep)} bpm across ${measured === total ? `${measured} gaps` : `${measured} of ${total} gaps`} (rest-confirmed pauses)`,
        );
      }
      base.notes.push(
        `sub-lap paused-clock segmentation: ${paused.recoveryGapsSec.length} recording pause(s) ≥${RECORDING_GAP_SEC}s (fitTime jumps / distance-frozen splits); lap-level warmup/cooldown framing not identifiable at this resolution`,
      );
      uncertainty.push(
        "work/recovery boundaries are watch-pause recording gaps, not coach-prescribed reps — recovery durations are wall-clock approximations",
      );
      uncertainty.push(
        "HR dip confirms the pauses were rest, not whether the session is a workout or a stoplight-interrupted run — that distinction rests on the bout count and total paused time",
      );
      if (paused.hrStepUnknownGaps > 0)
        uncertainty.push(
          `${paused.hrStepUnknownGaps} pause(s) without enough valid HR on both sides — HR step unmeasurable there (optical dropout), excluded from the step median`,
        );
    }
  }
  return base;
}

// --- step 2: classification -------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Keyword match on word boundaries so "lopp" matches "5K lopp" but not "loppor" ("testlopp" is its own keyword). */
function labelMatchesKeyword(label: string, keyword: string): boolean {
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`).test(label);
}

function isRunningType(type: string | null): boolean {
  if (type === null) return false;
  return (RUNNING_TYPES as readonly string[]).includes(type);
}

function classify(
  activity: SessionActivityInput,
  structure: SessionStructure,
  paceStream: PaceStreamSupport | null,
  hrPresent: boolean,
  evidence: string[],
  uncertainty: string[],
): { classification: SessionClass; confidence: Confidence } {
  if (!isRunningType(activity.type)) {
    uncertainty.push(
      `non-running activity type (${activity.type ?? "missing"}) — v0.1 profiles running only`,
    );
    return { classification: "unknown", confidence: "insufficient" };
  }
  if (activity.distance === null && activity.movingTime === null) {
    uncertainty.push("no distance and no moving time recorded");
    return { classification: "unknown", confidence: "insufficient" };
  }

  // Race/benchmark intent is NOT inferable from physiology in v0.1 (no zones,
  // no athlete model) — only from an explicit label, and even then capped.
  const label = `${activity.name ?? ""} ${activity.description ?? ""}`.toLowerCase();
  if (RACE_KEYWORDS.some((k) => labelMatchesKeyword(label, k))) {
    evidence.push("race/benchmark label found in activity name/description");
    uncertainty.push(
      "race classification rests on the activity label only, not on measured intent",
    );
    return { classification: "race-benchmark", confidence: "moderate" };
  }

  if (structure.hasStructure && structure.kind === "interval") {
    const workDurs =
      structure.medianWorkSec !== null ? structure.medianWorkSec : null;
    let classification: SessionClass;
    if (workDurs !== null && workDurs < SHORT_WORK_SEC)
      classification = "interval";
    else if (workDurs !== null) classification = "threshold-tempo";
    else classification = "interval";

    // Very wide work-pace spread means the reps were not one repeatable
    // stimulus (§6.4) — cap confidence rather than pretend otherwise.
    const scattered =
      structure.paceCv !== null && structure.paceCv > WORK_PACE_SCATTER_CV;
    if (scattered)
      uncertainty.push(
        "very wide pace spread across work segments — repeatability doubtful",
      );

    let confidence: Confidence;
    if (
      structure.workCount >= 4 &&
      structure.paceStability === "steady" &&
      structure.lateDeterioration !== "deteriorating" &&
      !scattered
    ) {
      confidence = "high";
    } else if (structure.workCount >= 3 && !scattered) {
      confidence = "moderate";
    } else {
      confidence = "low";
      if (structure.workCount < 3)
        uncertainty.push("fewer than 3 work segments — thin basis for a type claim");
    }
    // Paused-clock honesty cap: bout boundaries are recording pauses, not
    // prescribed reps, so a gap-recovered interval reading never exceeds
    // moderate no matter how clean the bouts look.
    if (structure.gapRecovered && confidence === "high") {
      confidence = "moderate";
      uncertainty.push(
        "paused-clock inference — work bouts are segmented by watch-pause recording gaps, so the interval reading is capped at moderate confidence",
      );
    }
    if (!hrPresent)
      uncertainty.push(
        "no HR data — intensity reading rests on within-session pace relativity only",
      );
    evidence.push(
      `structured ${classification === "interval" ? "short-rep" : "sustained-rep"} session: ${structure.workCount} × ${formatDuration(structure.medianWorkSec)}`,
    );
    return { classification, confidence };
  }

  // Detected lap structure takes precedence over distance/duration: a long
  // session with clear work/recovery alternation is classified by its reps
  // below; only unstructured sessions fall through to the long markers.
  const longEvidence: string[] = [];
  if (activity.distance !== null && activity.distance >= LONG_DIST_M)
    longEvidence.push(formatDistance(activity.distance));
  if (activity.movingTime !== null && activity.movingTime >= LONG_TIME_SEC)
    longEvidence.push(formatDuration(activity.movingTime));
  if (longEvidence.length > 0) {
    evidence.push(`long-session markers: ${longEvidence.join(", ")}`);
    return {
      classification: "long",
      confidence: hrPresent || paceStream !== null ? "moderate" : "low",
    };
  }

  // Hidden-rest honesty floor (never loosened into an interval claim):
  // stops averaged into auto-laps can hide sub-lap work/recovery the lap
  // split cannot see, so neither steady-easy nor intervals may be claimed
  // from laps — that distinction needs stream segmentation. Genuine
  // lap-alternation intervals keep their classification above.
  if (structure.hiddenRestDetected && structure.kind !== "interval") {
    uncertainty.push(
      "substantial intra-lap stops — lap pace averages moving and stopped time, so the session is neither claimable as steady-easy nor as intervals without sub-lap segmentation",
    );
    return { classification: "unknown", confidence: "low" };
  }

  if (structure.kind === "continuous") {
    // v0.1 prior, stated openly: an unstructured steady run is most likely
    // easy — but without HR zones this stays low-confidence by design, and
    // moderate at best when flat HR corroborates.
    if (!hrPresent)
      uncertainty.push(
        "no individualized HR zones in v0.1 — easy reading is a low-confidence prior, not a measurement",
      );
    evidence.push(
      `steady continuous effort${structure.paceCv !== null ? `, pace CV ${Math.round(structure.paceCv * 100)}%` : ""}`,
    );
    return {
      classification: "easy-recovery",
      confidence: hrPresent ? "moderate" : "low",
    };
  }

  if (
    structure.paceStability === "uneven" ||
    structure.paceStability === "variable"
  ) {
    uncertainty.push(
      "variable pace with no clear structure — mixed effort or external disruption (terrain/stops)",
    );
    return { classification: "mixed", confidence: "low" };
  }

  // Single timed lap or less, no stream support: nothing to stand on.
  if (structure.paceCv === null && paceStream === null) {
    uncertainty.push("insufficient pace evidence for any type claim");
    return { classification: "unknown", confidence: "low" };
  }
  if (!hrPresent)
    uncertainty.push(
      "no individualized HR zones in v0.1 — easy reading is a low-confidence prior, not a measurement",
    );
  return { classification: "easy-recovery", confidence: "low" };
}

// --- step 3: execution / stimulus / cost / dataQuality ----------------------

function deriveExecution(structure: SessionStructure): SessionExecution {
  if (structure.lateDeterioration === "deteriorating")
    return {
      consistency: "deteriorated",
      detail: "work pace faded across the session — execution deteriorated",
    };
  if (
    structure.paceStability === "steady" &&
    (structure.lateDeterioration === "stable" ||
      structure.lateDeterioration === "unknown")
  )
    return { consistency: "steady", detail: "even pacing, no late fade" };
  if (
    structure.paceStability === "uneven" ||
    structure.lateDeterioration === "progressive"
  )
    return {
      consistency: "uneven",
      detail:
        structure.lateDeterioration === "progressive"
          ? "effort rose across the session — progressive, not deteriorated"
          : "pace varied beyond steady bounds",
    };
  return {
    consistency: "unclear",
    detail: "too little stability evidence to judge execution",
  };
}

function deriveStimulus(
  classification: SessionClass,
  structure: SessionStructure,
  activity: SessionActivityInput,
): SessionStimulus {
  const qualitySec =
    structure.hasStructure && structure.medianWorkSec !== null
      ? structure.medianWorkSec * structure.workCount
      : 0;
  let threshold: Level;
  if (qualitySec >= 1200) threshold = "high";
  else if (qualitySec >= 480) threshold = "moderate";
  else if (qualitySec > 0) threshold = "low";
  else threshold = classification === "unknown" ? "unknown" : "low";

  const moving = activity.movingTime;
  let aerobic: Level;
  if (moving === null) aerobic = "unknown";
  else if (moving >= LONG_TIME_SEC) aerobic = "high";
  else if (moving >= 2700) aerobic = "moderate";
  else aerobic = "low";

  return {
    threshold,
    aerobic,
    detail:
      qualitySec > 0
        ? `${formatDuration(Math.round(qualitySec))} detected quality work; ${moving !== null ? formatDuration(moving) : "unknown"} total moving time`
        : `no structured quality detected; ${moving !== null ? formatDuration(moving) : "unknown"} total moving time`,
  };
}

function deriveCost(
  activity: SessionActivityInput,
  uncertainty: string[],
): SessionCost {
  let mechanical: Level;
  if (activity.distance === null) {
    mechanical = "unknown";
    uncertainty.push("mechanical cost unknown — no distance recorded");
  } else if (activity.distance >= 25000) mechanical = "high";
  else if (
    activity.distance >= 10000 ||
    (activity.totalElevationGain !== null && activity.totalElevationGain >= 300)
  )
    mechanical = "moderate";
  else mechanical = "low";

  // Invariant: recovery is NEVER inferred from load alone in v0.1.
  const recoveryReason =
    "v0.1 wires no RPE, check-in, or HR-recovery evidence — recovery cost stays unknown regardless of load";
  uncertainty.push(recoveryReason);
  return {
    mechanical,
    recovery: "unknown",
    recoveryReason,
    detail:
      mechanical === "unknown"
        ? "mechanical cost unknown — no distance recorded"
        : `mechanical cost from ${formatDistance(activity.distance)}${activity.totalElevationGain !== null ? ` / ${Math.round(activity.totalElevationGain)} m climbing` : ""}`,
  };
}

function deriveDataQuality(
  activity: SessionActivityInput,
  laps: SessionLapInput[],
  paceStream: PaceStreamSupport | null,
  hrStream: HrStreamSupport | null,
  hrPresent: boolean,
): DataQuality {
  const basic =
    activity.distance !== null && activity.movingTime !== null;
  const timedLaps = laps.filter((l) => paceSecPerKm(l) !== null).length;
  const richLaps = timedLaps >= MIN_TIMED_LAPS;
  const signals = [richLaps, paceStream !== null, hrStream !== null || hrPresent].filter(
    Boolean,
  ).length;
  if (basic && signals >= 3) return "high";
  if (basic && signals >= 1) return "medium";
  return "poor";
}

function capByQuality(confidence: Confidence, quality: DataQuality): Confidence {
  const rank: Record<Confidence, number> = {
    high: 3,
    moderate: 2,
    low: 1,
    insufficient: 0,
  };
  const cap: Record<DataQuality, number> = { high: 3, medium: 2, poor: 1 };
  const capped = Math.min(rank[confidence], cap[quality]);
  // "insufficient" is sticky — quality can never upgrade it.
  if (confidence === "insufficient") return "insufficient";
  return (["insufficient", "low", "moderate", "high"] as Confidence[])[capped];
}

// --- public API --------------------------------------------------------------

/**
 * Pure SessionProfile builder. DB input loading lives in `input.ts`
 * (`loadSessionInputs`, built on lib/activity-detail.ts readers); all
 * interpretation happens here, in the strict order
 * structure → classification → execution/stimulus/cost/quality.
 */
export function sessionProfile(
  activity: SessionActivityInput,
  laps: SessionLapInput[],
  streams: SessionStreamsInput,
): SessionProfile {
  const evidence: string[] = [];
  const uncertainty: string[] = [
    "v0.1 has no individualized HR zones or athlete model — intensity is within-session relativity only",
  ];

  // 1. structure first — what happened, before any guess at what it "was".
  const paceStream = derivePaceStream(streams);
  const hrStream = deriveHrStream(streams);
  const structure = detectStructure(laps, paceStream, streams, evidence, uncertainty);

  const hrPresent =
    hrStream !== null ||
    activity.averageHeartrate !== null ||
    laps.some((l) => l.averageHeartrate !== null);
  if (!hrPresent)
    uncertainty.push("no heart-rate data from any source — HR is absent, not neutral");
  else if (hrStream === null)
    uncertainty.push("no HR stream — HR reading rests on lap/activity averages only");

  // 2. broad classification + confidence from the detected structure.
  const { classification, confidence: rawConfidence } = classify(
    activity,
    structure,
    paceStream,
    hrPresent,
    evidence,
    uncertainty,
  );

  // 3. execution / stimulus / cost / dataQuality, derived last.
  const execution = deriveExecution(structure);
  const stimulus = deriveStimulus(classification, structure, activity);
  const cost = deriveCost(activity, uncertainty);
  const dataQuality = deriveDataQuality(
    activity,
    laps,
    paceStream,
    hrStream,
    hrPresent,
  );
  if (dataQuality === "poor")
    uncertainty.push("poor data quality caps confidence — treat all claims as tentative");
  const confidence = capByQuality(rawConfidence, dataQuality);

  return {
    classification,
    confidence,
    structure,
    execution,
    stimulus,
    cost,
    dataQuality,
    uncertainty,
    evidence,
  };
}
