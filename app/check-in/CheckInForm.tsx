"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upsertDailyCheckin, type CheckinActionState } from "./actions";
import {
  formatSleepForInput,
  formatWeightForInput,
  type CheckinFormValues,
  type SeverityValue,
  type SleepQualityValue,
} from "@/lib/checkin/checkin";

// One recent row for the history list + edit-prefill. Display strings are
// preformatted server-side so the client never does date formatting.
export interface CheckinHistoryItem extends CheckinFormValues {
  displayDate: string;
}

interface Props {
  initial: CheckinFormValues;
  recent: CheckinHistoryItem[];
  todayKey: string;
  initialIsUpdate: boolean;
}

const SLEEP_QUALITY_OPTIONS: { value: SleepQualityValue; label: string }[] = [
  { value: "POOR", label: "Poor" },
  { value: "OKAY", label: "Okay" },
  { value: "GOOD", label: "Good" },
  { value: "EXCELLENT", label: "Excellent" },
];

const SEVERITY_OPTIONS: { value: SeverityValue; label: string }[] = [
  { value: "NONE", label: "None" },
  { value: "MILD", label: "Mild" },
  { value: "MODERATE", label: "Moderate" },
  { value: "HIGH", label: "High" },
];

const ENERGY_OPTIONS = [1, 2, 3, 4, 5];

function labelFor(
  value: SleepQualityValue | SeverityValue | null,
): string {
  if (value == null) return "—";
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function summaryFor(item: CheckinHistoryItem): string {
  const parts: string[] = [];
  parts.push(
    item.sleepDuration != null ? formatSleepForInput(item.sleepDuration) : "no sleep logged",
  );
  parts.push(item.energy != null ? `energy ${item.energy}/5` : "no energy logged");
  if (item.soreness && item.soreness !== "NONE") {
    parts.push(`soreness ${labelFor(item.soreness).toLowerCase()}`);
  }
  if (item.symptoms && item.symptoms !== "NONE") {
    parts.push(`symptoms ${labelFor(item.symptoms).toLowerCase()}`);
  }
  return parts.join(" · ");
}

// NOTE: this must live in the client module — plain values imported from a
// `"use server"` module are stripped and arrive as undefined on the client.
const CHECKIN_ACTION_INITIAL_STATE: CheckinActionState = {
  ok: false,
  message: "",
  errors: {},
  savedDateKey: null,
};

export function CheckInForm({ initial, recent, todayKey, initialIsUpdate }: Props) {
  const router = useRouter();
  const [actionState, formAction, isPending] = useActionState(
    upsertDailyCheckin,
    CHECKIN_ACTION_INITIAL_STATE,
  );

  // A successful save only revalidates server data — push the fresh Server
  // Component props (history list, header, sidebar dot) into this mounted
  // island, otherwise the UI looks stale until a manual reload.
  useEffect(() => {
    if (actionState.ok && actionState.savedDateKey) {
      router.refresh();
    }
  }, [actionState.ok, actionState.savedDateKey, router]);

  const [dateKey, setDateKey] = useState(initial.dateKey);
  const [weightText, setWeightText] = useState(formatWeightForInput(initial.weight));
  const [sleepText, setSleepText] = useState(
    formatSleepForInput(initial.sleepDuration),
  );
  const [sleepQuality, setSleepQuality] = useState<SleepQualityValue | null>(
    initial.sleepQuality,
  );
  const [energy, setEnergy] = useState<number | null>(initial.energy);
  const [soreness, setSoreness] = useState<SeverityValue | null>(initial.soreness);
  const [symptoms, setSymptoms] = useState<SeverityValue | null>(initial.symptoms);
  const [notes, setNotes] = useState(initial.notes ?? "");

  const dateInputRef = useRef<HTMLInputElement>(null);

  const existingForDate = recent.find((item) => item.dateKey === dateKey) ?? null;
  const isUpdate = existingForDate != null || initialIsUpdate;
  const errors = actionState.errors;

  function loadEntry(item: CheckinHistoryItem) {
    setDateKey(item.dateKey);
    setWeightText(formatWeightForInput(item.weight));
    setSleepText(formatSleepForInput(item.sleepDuration));
    setSleepQuality(item.sleepQuality);
    setEnergy(item.energy);
    setSoreness(item.soreness);
    setSymptoms(item.symptoms);
    setNotes(item.notes ?? "");
    // Keyboard/screen-reader users activating "Edit" are otherwise left
    // behind on the button — move focus to the top of the form.
    dateInputRef.current?.focus();
  }

  function toggle<T>(current: T | null, next: T): T | null {
    return current === next ? null : next;
  }

  const footerMessage =
    actionState.message ||
    (isUpdate && dateKey
      ? `A check-in already exists for ${dateKey} — saving will update it.`
      : "Your check-in stays private to you.");

  return (
    <>
      <form className="checkin-form" action={formAction}>
        <div className="form-grid">
          <label>
            Date
            <input
              ref={dateInputRef}
              type="date"
              name="date"
              required
              value={dateKey}
              max={todayKey}
              onChange={(event) => setDateKey(event.target.value)}
              aria-describedby={errors.dateKey ? "checkin-date-error" : undefined}
            />
          </label>
          <label>
            Weight
            <input
              type="text"
              name="weight"
              inputMode="decimal"
              placeholder="75.2 kg"
              autoComplete="off"
              value={weightText}
              onChange={(event) => setWeightText(event.target.value)}
              aria-describedby={errors.weight ? "checkin-weight-error" : undefined}
            />
          </label>
        </div>
        {errors.dateKey && (
          <p className="field-error" role="alert" id="checkin-date-error">
            {errors.dateKey}
          </p>
        )}
        {errors.weight && (
          <p className="field-error" role="alert" id="checkin-weight-error">
            {errors.weight}
          </p>
        )}

        <label className="checkin-sleep-label">
          Sleep duration
          <input
            type="text"
            name="sleepDuration"
            inputMode="text"
            placeholder="7h 12m"
            autoComplete="off"
            value={sleepText}
            onChange={(event) => setSleepText(event.target.value)}
            aria-describedby={errors.sleepDuration ? "checkin-sleep-error" : undefined}
          />
        </label>
        {errors.sleepDuration && (
          <p className="field-error" role="alert" id="checkin-sleep-error">
            {errors.sleepDuration}
          </p>
        )}

        <fieldset aria-describedby={errors.sleepQuality ? "checkin-quality-error" : undefined}>
          <legend>Sleep quality</legend>
          <input type="hidden" name="sleepQuality" value={sleepQuality ?? ""} />
          <div className="option-row">
            {SLEEP_QUALITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={sleepQuality === option.value ? "selected" : ""}
                aria-pressed={sleepQuality === option.value}
                onClick={() => setSleepQuality(toggle(sleepQuality, option.value))}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        {errors.sleepQuality && (
          <p className="field-error" role="alert" id="checkin-quality-error">
            {errors.sleepQuality}
          </p>
        )}

        <fieldset aria-describedby={errors.energy ? "checkin-energy-error" : undefined}>
          <legend>Energy</legend>
          <input type="hidden" name="energy" value={energy ?? ""} />
          <div className="option-row compact">
            {ENERGY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={energy === option ? "selected" : ""}
                aria-pressed={energy === option}
                onClick={() => setEnergy(toggle(energy, option))}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>
        {errors.energy && (
          <p className="field-error" role="alert" id="checkin-energy-error">
            {errors.energy}
          </p>
        )}

        <div className="form-grid">
          <fieldset aria-describedby={errors.soreness ? "checkin-soreness-error" : undefined}>
            <legend>Soreness</legend>
            <input type="hidden" name="soreness" value={soreness ?? ""} />
            <div className="option-row">
              {SEVERITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={soreness === option.value ? "selected" : ""}
                  aria-pressed={soreness === option.value}
                  onClick={() => setSoreness(toggle(soreness, option.value))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset aria-describedby={errors.symptoms ? "checkin-symptoms-error" : undefined}>
            <legend>Symptoms</legend>
            <input type="hidden" name="symptoms" value={symptoms ?? ""} />
            <div className="option-row">
              {SEVERITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={symptoms === option.value ? "selected" : ""}
                  aria-pressed={symptoms === option.value}
                  onClick={() => setSymptoms(toggle(symptoms, option.value))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        {errors.soreness && (
          <p className="field-error" role="alert" id="checkin-soreness-error">
            {errors.soreness}
          </p>
        )}
        {errors.symptoms && (
          <p className="field-error" role="alert" id="checkin-symptoms-error">
            {errors.symptoms}
          </p>
        )}

        <label className="checkin-notes-label">
          Notes
          <textarea
            name="notes"
            placeholder="Anything worth remembering?"
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            aria-describedby={errors.notes ? "checkin-notes-error" : undefined}
          />
        </label>
        {errors.notes && (
          <p className="field-error" role="alert" id="checkin-notes-error">
            {errors.notes}
          </p>
        )}

        <div className="form-footer">
          <span
            className={actionState.ok ? "form-success" : undefined}
            role={actionState.ok || actionState.message ? "status" : undefined}
          >
            {footerMessage}
          </span>
          <button className="save-button" type="submit" disabled={isPending}>
            {isPending ? "Saving…" : isUpdate ? "Update check-in" : "Save check-in"}
          </button>
        </div>
      </form>

      <section className="checkin-history" aria-label="Recent check-ins">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Last 14 days</p>
            <h2>Recent check-ins</h2>
          </div>
        </div>
        {recent.length === 0 ? (
          <p className="subtle">
            No check-ins yet. Your first save will appear here.
          </p>
        ) : (
          <ul>
            {recent.map((item) => (
              <li key={item.dateKey} className="checkin-history-row">
                <div className="checkin-history-detail">
                  <strong>{item.displayDate}</strong>
                  <span>{summaryFor(item)}</span>
                </div>
                <button
                  type="button"
                  className="checkin-edit-button"
                  onClick={() => loadEntry(item)}
                  aria-label={`Edit check-in for ${item.displayDate}`}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
