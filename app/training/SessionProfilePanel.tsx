"use client";

import type { ReactNode } from "react";
import { formatDuration } from "@/lib/format";
import type {
  Confidence,
  DataQuality,
  Level,
  SessionClass,
  SessionProfile,
} from "@/lib/session-profile/types";

// Full SessionProfile read-out for the expanded Training row: every dimension
// the profiler concluded, plus its explicit evidence and uncertainty lists.
// Presentational only — no computation beyond label/format mapping, and no
// value that isn't in the profile (nulls render as "—"/"unknown", never as a
// guess). Per Docs/RUNLOOP_ANALYSIS_ENGINE_SPEC.md §2.4 uncertainty is
// first-class output, not a footnote.

const CLASS_LABELS: Record<SessionClass, string> = {
  "easy-recovery": "Easy / recovery",
  long: "Long run",
  "threshold-tempo": "Threshold / tempo",
  interval: "Intervals",
  "race-benchmark": "Race benchmark",
  mixed: "Mixed",
  unknown: "Unclassified",
};

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "High confidence",
  moderate: "Moderate confidence",
  low: "Low confidence",
  insufficient: "Not enough data",
};

// One line each: what the confidence level actually licenses.
const CONFIDENCE_NOTES: Record<Confidence, string> = {
  high: "Laps, pace and heart rate agree closely enough to name the session type.",
  moderate: "The best fit from what is stored, but at least one signal is weak or inferred.",
  low: "Low confidence means the evidence is thin or contradictory — read this as a hint, not a finding.",
  insufficient: "Insufficient confidence means too little is stored to name a session type, so none is claimed.",
};

const STRUCTURE_KIND: Record<SessionProfile["structure"]["kind"], string> = {
  interval: "Interval",
  continuous: "Continuous",
  unclear: "Unclear",
};

const PACE_STABILITY: Record<SessionProfile["structure"]["paceStability"], string> = {
  steady: "Steady",
  variable: "Variable",
  uneven: "Uneven",
  unknown: "Unknown",
};

const HR_PROGRESSION: Record<SessionProfile["structure"]["hrProgression"], string> = {
  rising: "Rising",
  stable: "Stable",
  falling: "Falling",
  unknown: "Unknown",
};

const LATE_DRIFT: Record<SessionProfile["structure"]["lateDeterioration"], string> = {
  stable: "Stable",
  deteriorating: "Faded (slower late)",
  progressive: "Progressive (faster late)",
  unknown: "Unknown",
};

const EXECUTION: Record<SessionProfile["execution"]["consistency"], string> = {
  steady: "Steady",
  uneven: "Uneven",
  deteriorated: "Deteriorated",
  unclear: "Unclear",
};

const LEVEL: Record<Level, string> = {
  high: "High",
  moderate: "Moderate",
  low: "Low",
  unknown: "Unknown",
};

const DATA_QUALITY: Record<DataQuality, { label: string; note: string }> = {
  high: { label: "High", note: "The signals backing this profile are consistent." },
  medium: { label: "Medium", note: "Some signals are coarse, inferred, or missing." },
  poor: { label: "Poor", note: "Most signals are missing or inconsistent — conclusions are capped." },
};

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="session-profile-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Dimension({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="session-profile-card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function TextList({
  items,
  empty,
  className,
}: {
  items: string[];
  empty: string;
  className: string;
}) {
  if (items.length === 0) {
    return <p className="session-profile-empty-line">{empty}</p>;
  }
  return (
    <ul className={className}>
      {items.map((item, i) => (
        <li key={`${i}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

export function SessionProfilePanel({ profile }: { profile: SessionProfile }) {
  const { structure, execution, stimulus, cost } = profile;
  // "unknown" classification or "insufficient" confidence is the honest empty
  // state: lead with why, instead of twelve rows of dashes.
  const unclassified =
    profile.classification === "unknown" || profile.confidence === "insufficient";

  return (
    <section className="session-profile" aria-label="Session profile">
      <div className="session-profile-head">
        <p className="eyebrow">Session profile</p>
        <div className="session-profile-title">
          <strong>{CLASS_LABELS[profile.classification]}</strong>
          <span
            className={`session-profile-confidence confidence-${profile.confidence}`}
          >
            {CONFIDENCE_LABELS[profile.confidence]}
          </span>
        </div>
        <p className="session-profile-note">{CONFIDENCE_NOTES[profile.confidence]}</p>
      </div>

      {unclassified && (
        <div className="session-profile-empty">
          <strong>Not enough information to classify this session</strong>
          <p>
            The stored laps and streams do not support a specific session type, so
            none is claimed. What the profiler could not determine is listed
            below, alongside whatever it did observe.
          </p>
          {structure.notes.length > 0 && (
            <TextList
              items={structure.notes}
              empty=""
              className="session-profile-notes"
            />
          )}
        </div>
      )}

      {!unclassified && (
        <div className="session-profile-grid">
          <Dimension title="Structure">
            <Row label="Kind" value={STRUCTURE_KIND[structure.kind]} />
            <Row label="Work bouts" value={String(structure.workCount)} />
            <Row label="Recoveries" value={String(structure.recoveryCount)} />
            <Row
              label="Median work"
              value={formatDuration(structure.medianWorkSec)}
            />
            <Row
              label="Median recovery"
              value={formatDuration(structure.medianRecoverySec)}
            />
            <Row
              label="Pace stability"
              value={PACE_STABILITY[structure.paceStability]}
            />
            <Row
              label="Pace CV"
              value={
                structure.paceCv === null
                  ? "—"
                  : `${Math.round(structure.paceCv * 100)}%`
              }
            />
            <Row label="HR progression" value={HR_PROGRESSION[structure.hrProgression]} />
            <Row label="Late drift" value={LATE_DRIFT[structure.lateDeterioration]} />
            <Row label="Warm-up" value={yesNo(structure.warmupDetected)} />
            <Row label="Cool-down" value={yesNo(structure.cooldownDetected)} />
            <Row
              label="Hidden rest in laps"
              value={yesNo(structure.hiddenRestDetected)}
            />
            <Row
              label="Recovered from pauses"
              value={yesNo(structure.gapRecovered)}
            />
            {structure.notes.length > 0 && (
              <TextList
                items={structure.notes}
                empty=""
                className="session-profile-notes"
              />
            )}
          </Dimension>

          <Dimension title="Execution">
            <Row label="Consistency" value={EXECUTION[execution.consistency]} />
            <p className="session-profile-detail">{execution.detail}</p>
          </Dimension>

          <Dimension title="Stimulus">
            <Row label="Threshold" value={LEVEL[stimulus.threshold]} />
            <Row label="Aerobic" value={LEVEL[stimulus.aerobic]} />
            <p className="session-profile-detail">{stimulus.detail}</p>
          </Dimension>

          <Dimension title="Cost">
            <Row label="Mechanical" value={LEVEL[cost.mechanical]} />
            <Row label="Recovery" value={LEVEL[cost.recovery]} />
            <p className="session-profile-detail">{cost.recoveryReason}</p>
            <p className="session-profile-detail">{cost.detail}</p>
          </Dimension>

          <Dimension title="Data quality">
            <Row label="Quality" value={DATA_QUALITY[profile.dataQuality].label} />
            <p className="session-profile-detail">
              {DATA_QUALITY[profile.dataQuality].note}
            </p>
          </Dimension>
        </div>
      )}

      <div className="session-profile-blocks">
        <section className="session-profile-block session-profile-uncertainty">
          <h3>What is not known</h3>
          <TextList
            items={profile.uncertainty}
            empty="No known gaps were recorded."
            className="session-profile-list"
          />
        </section>
        <section className="session-profile-block">
          <h3>Evidence</h3>
          <TextList
            items={profile.evidence}
            empty="No positive evidence was recorded for this session."
            className="session-profile-list"
          />
        </section>
      </div>
    </section>
  );
}
