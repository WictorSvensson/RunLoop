import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import {
  isFutureDateKey,
  parseDateKey,
  toDateKeyUTC,
  type CheckinFormValues,
} from "@/lib/checkin/checkin";
import { CheckInForm, type CheckinHistoryItem } from "./CheckInForm";
import type { DailyCheckin } from "@/generated/prisma/client";

// Reads live DB state (selected check-in + recent history) on every load, so
// it must not be statically prerendered at build time.
export const dynamic = "force-dynamic";

const HISTORY_TAKE = 14;

function toFormValues(row: DailyCheckin): CheckinFormValues {
  return {
    dateKey: toDateKeyUTC(row.date),
    weight: row.weight,
    sleepDuration: row.sleepDuration,
    sleepQuality: row.sleepQuality,
    energy: row.energy,
    soreness: row.soreness,
    symptoms: row.symptoms,
    notes: row.notes,
  };
}

function toHistoryItem(row: DailyCheckin): CheckinHistoryItem {
  return {
    ...toFormValues(row),
    displayDate: row.date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
  };
}

function blankValues(dateKey: string): CheckinFormValues {
  return {
    dateKey,
    weight: null,
    sleepDuration: null,
    sleepQuality: null,
    energy: null,
    soreness: null,
    symptoms: null,
    notes: null,
  };
}

export default async function CheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await getOrCreateCurrentUser();
  const now = new Date();
  const todayKey = toDateKeyUTC(now);
  // Pinned to UTC to match todayKey (date keys are UTC calendar days) — a
  // server-local timezone could otherwise disagree with the form around
  // midnight.
  const todayDisplay = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  const { date: rawDateParam } = await searchParams;
  const dateParam = rawDateParam?.trim();
  const requestedKey =
    dateParam && parseDateKey(dateParam) && !isFutureDateKey(dateParam, now)
      ? dateParam
      : todayKey;

  const recentRows = await prisma.dailyCheckin.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
    take: HISTORY_TAKE,
  });

  // A ?date= older than the history window still deserves its stored values:
  // fetch it directly so editing never starts from a misleading blank form
  // that would silently update on save.
  const inWindow = recentRows.some((row) => toDateKeyUTC(row.date) === requestedKey);
  const outOfWindowRow =
    inWindow || requestedKey === todayKey
      ? null
      : await prisma.dailyCheckin.findUnique({
          where: {
            userId_date: {
              userId: user.id,
              date: new Date(`${requestedKey}T00:00:00.000Z`),
            },
          },
        });

  const recent = recentRows.map(toHistoryItem);
  const selected =
    recentRows.find((row) => toDateKeyUTC(row.date) === requestedKey) ??
    outOfWindowRow;
  const initial = selected ? toFormValues(selected) : blankValues(requestedKey);
  const checkedInToday = recentRows.some(
    (row) => toDateKeyUTC(row.date) === todayKey,
  );

  return (
    <div className="route-wrap">
      <div className="route-intro">
        <p className="eyebrow">
          {todayDisplay} · {checkedInToday ? "Checked in today" : "No check-in yet today"}
        </p>
        <h1>How are you feeling today?</h1>
        <p className="subtle">
          A quick pulse check. Less than a minute, and no scores, no judgement.
        </p>
      </div>
      <CheckInForm
        key={requestedKey}
        initial={initial}
        recent={recent}
        todayKey={todayKey}
        initialIsUpdate={selected != null}
      />
    </div>
  );
}
