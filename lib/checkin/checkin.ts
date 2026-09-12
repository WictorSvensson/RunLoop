// Pure helpers for the Daily Check-in form (Project Brief: date, weight,
// sleep duration, sleep quality, energy 1-5, soreness, symptoms, notes).
//
// Kept free of server-only imports so both the Server Component page and the
// `"use client"` form island can share parsing/formatting/validation without
// duplicating logic. Persistence lives in app/check-in/actions.ts.

export const SLEEP_QUALITIES = ["POOR", "OKAY", "GOOD", "EXCELLENT"] as const;
export type SleepQualityValue = (typeof SLEEP_QUALITIES)[number];

export const SEVERITIES = ["NONE", "MILD", "MODERATE", "HIGH"] as const;
export type SeverityValue = (typeof SEVERITIES)[number];

export interface CheckinFormValues {
  dateKey: string; // YYYY-MM-DD (UTC calendar day)
  weight: number | null; // kg
  sleepDuration: number | null; // minutes
  sleepQuality: SleepQualityValue | null;
  energy: number | null; // 1-5
  soreness: SeverityValue | null;
  symptoms: SeverityValue | null;
  notes: string | null;
}

export type CheckinFieldErrors = Partial<Record<keyof CheckinFormValues, string>>;

// --- Weight ----------------------------------------------------------------

/**
 * Accepts "75.2", "75,2", "75.2 kg" (case-insensitive, surrounding whitespace
 * ignored). Empty -> null. Anything else (letters, signs, malformed numbers
 * like "7h5" or "1e2") -> null so callers can surface a field error instead
 * of silently stripping garbage into a wrong-but-valid number.
 */
export function parseWeightInput(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(?:kg)?\s*$/i.exec(raw);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, "."));
  if (!Number.isFinite(value)) return null;
  // Round to 1 decimal — scale precision matches the Brief's "75.2 kg" mock.
  return Math.round(value * 10) / 10;
}

export function formatWeightForInput(weight: number | null): string {
  if (weight == null) return "";
  return `${weight} kg`;
}

// --- Sleep duration ----------------------------------------------------------
//
// Accepted shapes (case-insensitive, surrounding whitespace ignored):
//   "7h 12m", "7h12m", "7 h 12 m", "7h", "45m",
//   "7:12" (colon = h:mm),
//   "7.5h" / "7,5h" (decimal hours),
//   bare "450" (> 24 -> minutes), bare "7.5" (<= 24 -> hours).
// Empty -> null. Unparseable -> null.

export function parseSleepInput(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim().toLowerCase().replace(/,/g, ".");
  if (!text) return null;

  const colon = text.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (colon) {
    const h = Number(colon[1]);
    const m = Number(colon[2]);
    if (m >= 60) return null;
    return h * 60 + m;
  }

  const hasH = text.includes("h");
  const hasM = text.includes("m");
  if (hasH || hasM) {
    // Fully anchored: partial matches must not silently drop characters
    // (e.g. "1.5.2h" previously parsed as "5.2h", "7hm" as "7h").
    const both = /^(\d+(?:\.\d+)?)\s*h\s*(\d+(?:\.\d+)?)\s*m$/.exec(text);
    const hoursOnly = /^(\d+(?:\.\d+)?)\s*h$/.exec(text);
    const minutesOnly = /^(\d+(?:\.\d+)?)\s*m$/.exec(text);
    const matched = both ?? hoursOnly ?? minutesOnly;
    if (!matched) return null;
    const h = both || hoursOnly ? Number(matched[1]) : 0;
    const m = both ? Number(matched[2]) : minutesOnly ? Number(matched[1]) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return Math.round(h * 60 + m);
  }

  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  // Bare numbers are ambiguous: treat values plausibly in the "hours" range
  // as hours, larger ones as minutes.
  if (value <= 24) return Math.round(value * 60);
  return Math.round(value);
}

export function formatSleepForInput(minutes: number | null): string {
  if (minutes == null) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

// --- Date keys (UTC calendar days) -------------------------------------------

export function toDateKeyUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Strict YYYY-MM-DD with real calendar validation (rejects "2026-02-30"). */
export function parseDateKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d };
}

export function dateKeyToUTCDate(key: string): Date {
  const parsed = parseDateKey(key);
  if (!parsed) throw new Error(`Invalid date key: ${key}`);
  return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
}

export function isFutureDateKey(key: string, now: Date = new Date()): boolean {
  // Compare trimmed keys: parseDateKey trims internally, so the comparison
  // must too — otherwise " 2026-09-10" (leading space sorts before digits)
  // would slip past the future guard.
  const trimmed = key.trim();
  if (!parseDateKey(trimmed)) return false;
  return trimmed > toDateKeyUTC(now);
}

// --- Validation ----------------------------------------------------------------

const MAX_NOTES_LENGTH = 2000;

export function validateCheckinValues(
  values: CheckinFormValues,
  now: Date = new Date(),
): CheckinFieldErrors {
  const errors: CheckinFieldErrors = {};

  if (!parseDateKey(values.dateKey)) {
    errors.dateKey = "Use a valid date (YYYY-MM-DD).";
  } else {
    const { y } = parseDateKey(values.dateKey)!;
    if (y < 2000) {
      errors.dateKey = "Date looks too far in the past.";
    } else if (isFutureDateKey(values.dateKey, now)) {
      errors.dateKey = "Date can't be in the future.";
    }
  }

  if (values.weight != null) {
    if (!Number.isFinite(values.weight) || values.weight < 30 || values.weight > 300) {
      errors.weight = "Weight must be between 30 and 300 kg.";
    }
  }

  if (values.sleepDuration != null) {
    if (
      !Number.isInteger(values.sleepDuration) ||
      values.sleepDuration < 0 ||
      values.sleepDuration > 24 * 60
    ) {
      errors.sleepDuration = "Sleep must be between 0 minutes and 24 hours.";
    }
  }

  if (values.energy != null) {
    if (!Number.isInteger(values.energy) || values.energy < 1 || values.energy > 5) {
      errors.energy = "Energy must be between 1 and 5.";
    }
  }

  // Enum membership is enforced here (not just in the Server Action's
  // pre-guards) so every caller of this shared validator — current or future
  // (API routes, modal wiring) — gets the same gate.
  if (
    values.sleepQuality != null &&
    !(SLEEP_QUALITIES as readonly string[]).includes(values.sleepQuality)
  ) {
    errors.sleepQuality = "Choose Poor, Okay, Good, or Excellent.";
  }
  if (
    values.soreness != null &&
    !(SEVERITIES as readonly string[]).includes(values.soreness)
  ) {
    errors.soreness = "Choose None, Mild, Moderate, or High.";
  }
  if (
    values.symptoms != null &&
    !(SEVERITIES as readonly string[]).includes(values.symptoms)
  ) {
    errors.symptoms = "Choose None, Mild, Moderate, or High.";
  }

  if (values.notes != null && values.notes.length > MAX_NOTES_LENGTH) {
    errors.notes = `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
  }

  return errors;
}

export function normalizeNotes(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}
