import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import {
  hasPayloadStreams,
  toActivityDTO,
  toProfileBadge,
  type ActivityDTO,
} from "@/lib/activity-detail";
import type { SessionStreamsInput } from "@/lib/session-profile/types";
import type { SessionClass } from "@/lib/session-profile/types";
import { ActivityList } from "./ActivityList";

// Live DB state (recent rows) on every load.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
// v1 profile filtering is post-compute in memory: classification needs laps +
// streams per row, which no Prisma where clause can express. When a profile
// filter is active we scan at most this many of the most recent type/q
// matches, compute badges, filter, then paginate the matches. Documented in
// the result-count line so a capped scan is never mistaken for full history.
const PROFILE_SCAN_LIMIT = 200;

const TYPE_OPTIONS = ["all", "Run", "TrailRun", "VirtualRun", "other"] as const;
type TypeFilter = (typeof TYPE_OPTIONS)[number];

const PROFILE_OPTIONS: ("all" | SessionClass)[] = [
  "all",
  "easy-recovery",
  "long",
  "threshold-tempo",
  "interval",
  "race-benchmark",
  "mixed",
  "unknown",
];

const RUNNING_TYPE_LIST = ["Run", "TrailRun", "VirtualRun"];

// The training archive: activities only. All connection/sync controls live
// on the profile page — this page never triggers imports.
//
// SessionProfile badges are computed here, server-side only: one batched
// Prisma query (activities + laps + stream payloads for the visible rows),
// then the pure toProfileBadge() per row. Only the broad class + confidence
// cross to the client (SessionProfileBadge DTO) — laps/streams never leave
// the server on initial load. Full history on purpose: no RUNNING_TYPES
// filter by default, unlike Dashboard/Analytics.
//
// Perf: one findMany with include per load (25 stream.payloads, no N+1 —
// hasStreams/stream parsing is in-memory off the included rows). The detail
// API (getActivityDetail) computes the same badge, so expanding a row never
// overwrites it with null.
function rowToDTO(row: {
  type: string | null;
  name: string | null;
  description: string | null;
  distance: number | null;
  movingTime: number | null;
  elapsedTime: number | null;
  averageSpeed: number | null;
  maxSpeed: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  totalElevationGain: number | null;
  averageTemp: number | null;
  laps: {
    lapIndex: number;
    distance: number | null;
    movingTime: number | null;
    elapsedTime: number | null;
    averageSpeed: number | null;
    averageHeartrate: number | null;
  }[];
  stream: { payload: unknown } | null;
} & Parameters<typeof toActivityDTO>[0]): ActivityDTO {
  const payload = row.stream?.payload;
  const streams: SessionStreamsInput =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  return toActivityDTO(
    row,
    null,
    hasPayloadStreams(payload),
    toProfileBadge(
      {
        type: row.type,
        name: row.name,
        description: row.description,
        distance: row.distance,
        movingTime: row.movingTime,
        elapsedTime: row.elapsedTime,
        averageSpeed: row.averageSpeed,
        maxSpeed: row.maxSpeed,
        averageHeartrate: row.averageHeartrate,
        maxHeartrate: row.maxHeartrate,
        totalElevationGain: row.totalElevationGain,
        averageTemp: row.averageTemp,
      },
      row.laps.map((lap) => ({
        lapIndex: lap.lapIndex,
        distance: lap.distance,
        movingTime: lap.movingTime,
        elapsedTime: lap.elapsedTime,
        averageSpeed: lap.averageSpeed,
        averageHeartrate: lap.averageHeartrate,
      })),
      streams,
    ),
  );
}

function parsePage(raw: string | string[] | undefined): number {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(first ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function parseOption<T extends string>(
  raw: string | string[] | undefined,
  options: readonly T[],
): T {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return (options as readonly string[]).includes(first ?? "")
    ? (first as T)
    : options[0];
}

function hrefFor(page: number, type: string, profile: string, q: string): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (type !== "all") params.set("type", type);
  if (profile !== "all") params.set("profile", profile);
  if (q !== "") params.set("q", q);
  const qs = params.toString();
  return qs === "" ? "/training" : `/training?${qs}`;
}

// Compact page-number window: all pages when few, else first/last around the
// current page with ellipses.
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set([1, 2, current - 1, current, current + 1, total - 1, total]);
  const sorted = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  for (const n of sorted) {
    if (out.length > 0 && n - (out[out.length - 1] as number) > 1) out.push("…");
    out.push(n);
  }
  return out;
}

export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const type = parseOption(sp.type, TYPE_OPTIONS) as TypeFilter;
  const profile = parseOption(sp.profile, PROFILE_OPTIONS);
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q ?? "").trim().slice(0, 80);
  const requestedPage = parsePage(sp.page);

  // Server-side where clause for type + text search (both Prisma-expressible).
  // "other" = anything outside the three running types (null included — SQL
  // NOT IN never matches NULL, hence the explicit OR branch).
  const where = {
    userId: user.id,
    ...(type === "Run" || type === "TrailRun" || type === "VirtualRun"
      ? { type }
      : {}),
    ...(type === "other"
      ? { OR: [{ type: { notIn: RUNNING_TYPE_LIST } }, { type: null }] }
      : {}),
    ...(q !== "" ? { name: { contains: q, mode: "insensitive" as const } } : {}),
  };

  let activities: ActivityDTO[];
  let totalCount: number;
  let totalPages: number;
  let page: number;
  let cappedScan = false;

  if (profile === "all") {
    totalCount = await prisma.activity.count({ where });
    totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    page = Math.min(requestedPage, totalPages);
    const activityRows = await prisma.activity.findMany({
      where,
      orderBy: { startDate: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        laps: { orderBy: { lapIndex: "asc" } },
        stream: { select: { payload: true } },
      },
    });
    activities = activityRows.map(rowToDTO);
  } else {
    const scanned = await prisma.activity.findMany({
      where,
      orderBy: { startDate: "desc" },
      take: PROFILE_SCAN_LIMIT,
      include: {
        laps: { orderBy: { lapIndex: "asc" } },
        stream: { select: { payload: true } },
      },
    });
    cappedScan = scanned.length === PROFILE_SCAN_LIMIT;
    const matched = scanned
      .map((row) => ({ row, dto: rowToDTO(row) }))
      .filter(({ dto }) => dto.profile?.classification === profile)
      .map(({ dto }) => dto);
    totalCount = matched.length;
    totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    page = Math.min(requestedPage, totalPages);
    activities = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }

  const filtersActive = type !== "all" || profile !== "all" || q !== "";
  const from = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, totalCount);

  return (
    <div className="route-wrap">
      <div className="route-heading">
        <div>
          <p className="eyebrow">The archive</p>
          <h1>Training</h1>
          <p className="subtle">A record of the work that is adding up.</p>
        </div>
      </div>

      <form className="training-filters" method="get" action="/training">
        <label>
          Activity
          <select name="type" defaultValue={type}>
            <option value="all">All activities</option>
            <option value="Run">Run</option>
            <option value="TrailRun">Trail run</option>
            <option value="VirtualRun">Virtual run</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Session type
          <select name="profile" defaultValue={profile}>
            <option value="all">All session types</option>
            <option value="easy-recovery">Easy</option>
            <option value="long">Long</option>
            <option value="threshold-tempo">Threshold</option>
            <option value="interval">Intervals</option>
            <option value="race-benchmark">Race</option>
            <option value="mixed">Mixed</option>
            <option value="unknown">Unclassified</option>
          </select>
        </label>
        <label className="training-search">
          Search
          <input
            name="q"
            type="search"
            placeholder="Search by name"
            defaultValue={q}
            maxLength={80}
          />
        </label>
        <button className="checkin-button training-filter-button" type="submit">
          Apply
        </button>
      </form>

      <p className="subtle training-meta" role="status">
        {totalCount === 0
          ? "No activities found."
          : `Showing ${from}–${to} of ${totalCount} ${totalCount === 1 ? "activity" : "activities"}.`}
        {cappedScan && profile !== "all"
          ? " Session-type filter scans the 200 most recent matches."
          : null}
      </p>

      {activities.length === 0 ? (
        <div className="activity-table">
          <div className="table-header">
            <span>Activity</span>
            <span>Distance</span>
            <span>Duration</span>
            <span>Pace / HR</span>
          </div>
          <div className="table-row">
            <div className="activity-detail">
              <div>
                <strong>
                  {filtersActive ? "No matches" : "No activities yet"}
                </strong>
                <span>
                  {filtersActive ? (
                    <>
                      No activities match these filters.{" "}
                      <a className="training-reset" href="/training">
                        Clear filters
                      </a>
                    </>
                  ) : (
                    "Connect a wearable on your profile page to import your runs."
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <ActivityList activities={activities} />
          {totalPages > 1 && (
            <nav className="training-pagination" aria-label="Training pages">
              {page > 1 ? (
                <a href={hrefFor(page - 1, type, profile, q)} rel="prev">
                  ← Prev
                </a>
              ) : (
                <span aria-hidden="true" className="training-page-disabled">
                  ← Prev
                </span>
              )}
              {pageWindow(page, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`gap-${i}`} className="training-page-gap">
                    …
                  </span>
                ) : p === page ? (
                  <span key={p} aria-current="page" className="training-page-current">
                    {p}
                  </span>
                ) : (
                  <a key={p} href={hrefFor(p, type, profile, q)}>
                    {p}
                  </a>
                ),
              )}
              {page < totalPages ? (
                <a href={hrefFor(page + 1, type, profile, q)} rel="next">
                  Next →
                </a>
              ) : (
                <span aria-hidden="true" className="training-page-disabled">
                  Next →
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
