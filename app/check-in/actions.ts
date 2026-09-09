"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import {
  SEVERITIES,
  SLEEP_QUALITIES,
  dateKeyToUTCDate,
  normalizeNotes,
  parseSleepInput,
  parseWeightInput,
  validateCheckinValues,
  type CheckinFieldErrors,
  type CheckinFormValues,
  type SeverityValue,
  type SleepQualityValue,
} from "@/lib/checkin/checkin";

export interface CheckinActionState {
  ok: boolean;
  message: string;
  errors: CheckinFieldErrors;
  savedDateKey: string | null;
}

function parseOptionalEnum<T extends string>(
  raw: FormDataEntryValue | null,
  allowed: readonly T[],
): T | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toUpperCase();
  if (!cleaned) return null;
  return (allowed as readonly string[]).includes(cleaned) ? (cleaned as T) : null;
}

function failure(errors: CheckinFieldErrors): CheckinActionState {
  return {
    ok: false,
    message: "Please fix the highlighted fields.",
    errors,
    savedDateKey: null,
  };
}

// FormData entry point for the Daily Check-in form. Creates or updates the
// single DailyCheckin row for (user, date) — one row per user per day — then
// revalidates the check-in page, the dashboard, and the layout (the sidebar's
// check-in reminder dot reads today's check-in from layout data, which is a
// separate cache segment hence the explicit "layout" revalidation).
export async function upsertDailyCheckin(
  _prevState: CheckinActionState,
  formData: FormData,
): Promise<CheckinActionState> {
  const dateKey = String(formData.get("date") ?? "").trim();
  const weightRaw = String(formData.get("weight") ?? "").trim();
  const sleepRaw = String(formData.get("sleepDuration") ?? "").trim();
  const energyRaw = String(formData.get("energy") ?? "").trim();

  // Tri-state parsing: empty means "not provided" (null), but non-empty yet
  // unparseable input is a user typo or crafted post — surface a field error
  // rather than silently saving NULL over a previously stored value.
  const weight = weightRaw ? parseWeightInput(weightRaw) : null;
  if (weightRaw && weight == null) {
    return failure({ weight: "Enter a weight like “75.2 kg”." });
  }
  const sleepDuration = sleepRaw ? parseSleepInput(sleepRaw) : null;
  if (sleepRaw && sleepDuration == null) {
    return failure({ sleepDuration: "Enter sleep like “7h 12m”." });
  }

  // Non-empty but unrecognized enum values are crafted posts, not "not
  // provided" — reject rather than silently dropping them (consistent with
  // the weight/sleep tri-state handling above).
  const qualityRaw = String(formData.get("sleepQuality") ?? "").trim();
  if (qualityRaw && !SLEEP_QUALITIES.includes(qualityRaw.toUpperCase() as never)) {
    return failure({ sleepQuality: "Choose Poor, Okay, Good, or Excellent." });
  }
  for (const field of ["soreness", "symptoms"] as const) {
    const raw = String(formData.get(field) ?? "").trim();
    if (raw && !SEVERITIES.includes(raw.toUpperCase() as never)) {
      return failure({ [field]: "Choose None, Mild, Moderate, or High." });
    }
  }

  const values: CheckinFormValues = {
    dateKey,
    weight,
    sleepDuration,
    sleepQuality: parseOptionalEnum<SleepQualityValue>(
      formData.get("sleepQuality"),
      SLEEP_QUALITIES,
    ),
    energy: energyRaw === "" ? null : Number(energyRaw),
    soreness: parseOptionalEnum<SeverityValue>(formData.get("soreness"), SEVERITIES),
    symptoms: parseOptionalEnum<SeverityValue>(formData.get("symptoms"), SEVERITIES),
    notes: normalizeNotes(
      typeof formData.get("notes") === "string"
        ? (formData.get("notes") as string)
        : null,
    ),
  };

  const errors = validateCheckinValues(values);
  if (Object.keys(errors).length > 0) {
    return failure(errors);
  }

  // A fully blank form carries no information — refuse to write a vacuous
  // all-NULL row that would flip "Checked in today" with zero data.
  const hasAnyField =
    values.weight != null ||
    values.sleepDuration != null ||
    values.sleepQuality != null ||
    values.energy != null ||
    values.soreness != null ||
    values.symptoms != null ||
    values.notes != null;
  if (!hasAnyField) {
    return {
      ok: false,
      message: "Fill in at least one field before saving.",
      errors: {},
      savedDateKey: null,
    };
  }

  try {
    const user = await getOrCreateCurrentUser();
    const date = dateKeyToUTCDate(values.dateKey);

    await prisma.dailyCheckin.upsert({
      where: { userId_date: { userId: user.id, date } },
      create: {
        userId: user.id,
        date,
        weight: values.weight,
        sleepDuration: values.sleepDuration,
        sleepQuality: values.sleepQuality,
        energy: values.energy,
        soreness: values.soreness,
        symptoms: values.symptoms,
        notes: values.notes,
      },
      update: {
        weight: values.weight,
        sleepDuration: values.sleepDuration,
        sleepQuality: values.sleepQuality,
        energy: values.energy,
        soreness: values.soreness,
        symptoms: values.symptoms,
        notes: values.notes,
      },
    });

    revalidatePath("/check-in");
    revalidatePath("/");
    revalidatePath("/", "layout");

    return {
      ok: true,
      message: `Check-in saved for ${values.dateKey}.`,
      errors: {},
      savedDateKey: values.dateKey,
    };
  } catch (error) {
    console.error("Daily check-in save failed:", error);
    return {
      ok: false,
      message: "Could not save your check-in. Please try again.",
      errors: {},
      savedDateKey: null,
    };
  }
}
