import type { StravaConnection } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { stravaConfig, STRAVA_TOKEN_URL, STRAVA_API_BASE } from "./config";

// ---------------------------------------------------------------------------
// Types (only the fields we use from Strava responses)
// ---------------------------------------------------------------------------

interface StravaTokenResponse {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  expires_in: number;
  scope?: string;
  athlete?: { id: number };
}

export interface StravaSummaryActivity {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date: string; // ISO 8601, UTC
  distance?: number; // meters
  moving_time?: number; // seconds
  elapsed_time?: number; // seconds
  average_speed?: number; // m/s
  max_speed?: number; // m/s
  average_heartrate?: number; // bpm
  max_heartrate?: number; // bpm
  total_elevation_gain?: number; // meters
}

// The detailed representation from GET /activities/{id}. Extends the summary
// with richer fields. All optional since Strava omits fields that don't apply.
export interface StravaDetailedActivity extends StravaSummaryActivity {
  start_date_local?: string; // ISO 8601, athlete local time
  timezone?: string;
  average_cadence?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  max_watts?: number;
  kilojoules?: number;
  calories?: number;
  average_temp?: number; // celsius
  description?: string;
  device_name?: string;
  gear_id?: string;
  gear?: { id?: string; name?: string };
}

export interface StravaLap {
  name?: string;
  lap_index?: number;
  split?: number;
  start_date?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  start_index?: number;
  end_index?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
  total_elevation_gain?: number;
}

export type StravaStreamKey =
  | "time"
  | "distance"
  | "latlng"
  | "altitude"
  | "velocity_smooth"
  | "heartrate"
  | "cadence"
  | "watts"
  | "temp"
  | "moving"
  | "grade_smooth";

export interface StravaStream {
  data: number[] | boolean[] | Array<[number, number]>;
  series_type?: string;
  original_size?: number;
  resolution?: string;
}

export type StravaStreamsByType = Partial<Record<StravaStreamKey, StravaStream>>;

export const ANALYSIS_STREAM_KEYS: StravaStreamKey[] = [
  "time",
  "distance",
  "latlng",
  "altitude",
  "velocity_smooth",
  "heartrate",
  "cadence",
  "watts",
  "temp",
  "moving",
  "grade_smooth",
];

export class StravaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "StravaApiError";
  }
}

// ---------------------------------------------------------------------------
// OAuth: exchange authorization code for tokens (first connection)
// ---------------------------------------------------------------------------

export async function exchangeCodeForTokens(
  code: string,
): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: stravaConfig.clientId,
      client_secret: stravaConfig.clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new StravaApiError("Failed to exchange code for tokens", res.status, body);
  }
  return (await res.json()) as StravaTokenResponse;
}

// ---------------------------------------------------------------------------
// OAuth: refresh an expired access token.
// IMPORTANT: Strava may return a NEW refresh_token; the old one is invalidated
// immediately. We always persist whatever comes back.
// ---------------------------------------------------------------------------

async function refreshTokens(refreshToken: string): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: stravaConfig.clientId,
      client_secret: stravaConfig.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new StravaApiError("Failed to refresh access token", res.status, body);
  }
  return (await res.json()) as StravaTokenResponse;
}

// Returns a valid (non-expired) access token for the connection, refreshing and
// persisting new tokens if the current one is expired or about to expire.
//
// Refresh is guarded so concurrent callers don't both refresh (which would make
// Strava rotate + invalidate the refresh token twice, bricking the connection):
// only the writer whose expiresAt still matches what we read performs the update;
// a loser re-reads the freshly-persisted token.
export async function getValidAccessToken(
  connection: StravaConnection,
): Promise<string> {
  // Refresh if it expires within the next 5 minutes.
  const skewMs = 5 * 60 * 1000;
  const isExpiring = connection.expiresAt.getTime() - skewMs <= Date.now();

  if (!isExpiring) {
    return connection.accessToken;
  }

  const tokens = await refreshTokens(connection.refreshToken);

  // Guarded write: only succeeds if nobody else refreshed since we read.
  const { count } = await prisma.stravaConnection.updateMany({
    where: { id: connection.id, expiresAt: connection.expiresAt },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expires_at * 1000),
      scope: tokens.scope ?? connection.scope,
    },
  });

  if (count === 0) {
    // Another request refreshed first; use whatever is now persisted.
    const fresh = await prisma.stravaConnection.findUnique({
      where: { id: connection.id },
    });
    if (fresh) return fresh.accessToken;
  }

  return tokens.access_token;
}

// ---------------------------------------------------------------------------
// API: list the authenticated athlete's activities (single page).
// Docs: GET /athlete/activities  (100 req / 15 min, 1000 / day)
// ---------------------------------------------------------------------------

export async function listActivities(
  accessToken: string,
  params: { after?: number; before?: number; page?: number; perPage?: number },
): Promise<StravaSummaryActivity[]> {
  const query = new URLSearchParams();
  if (params.after !== undefined) query.set("after", String(params.after));
  if (params.before !== undefined) query.set("before", String(params.before));
  query.set("page", String(params.page ?? 1));
  query.set("per_page", String(params.perPage ?? 200));

  const res = await fetch(`${STRAVA_API_BASE}/athlete/activities?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    throw new StravaApiError("Strava rate limit exceeded", 429);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new StravaApiError("Failed to list activities", res.status, body);
  }
  return (await res.json()) as StravaSummaryActivity[];
}

// ---------------------------------------------------------------------------
// API: get one activity's detailed representation.
// Docs: GET /activities/{id}  (costs 1 request per activity)
// ---------------------------------------------------------------------------

export async function getActivityDetail(
  accessToken: string,
  stravaId: bigint,
): Promise<StravaDetailedActivity> {
  const res = await fetch(`${STRAVA_API_BASE}/activities/${stravaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    throw new StravaApiError("Strava rate limit exceeded", 429);
  }
  if (res.status === 404) {
    throw new StravaApiError("Activity not found on Strava", 404);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new StravaApiError("Failed to get activity detail", res.status, body);
  }
  return (await res.json()) as StravaDetailedActivity;
}

// ---------------------------------------------------------------------------
// API: get laps for one activity.
// Used by the analysis ingestion layer to preserve explicit workout splits.
// ---------------------------------------------------------------------------

export async function getActivityLaps(
  accessToken: string,
  stravaId: bigint,
): Promise<StravaLap[]> {
  const res = await fetch(`${STRAVA_API_BASE}/activities/${stravaId}/laps`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    throw new StravaApiError("Strava rate limit exceeded", 429);
  }
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new StravaApiError("Failed to get activity laps", res.status, body);
  }

  return (await res.json()) as StravaLap[];
}

// ---------------------------------------------------------------------------
// API: get raw streams for one activity.
// We ask Strava to key the response by stream type so unavailable streams are
// simply omitted instead of forcing placeholder data.
// ---------------------------------------------------------------------------

export async function getActivityStreams(
  accessToken: string,
  stravaId: bigint,
  keys: StravaStreamKey[] = ANALYSIS_STREAM_KEYS,
): Promise<StravaStreamsByType> {
  const query = new URLSearchParams({
    keys: keys.join(","),
    key_by_type: "true",
  });

  const res = await fetch(
    `${STRAVA_API_BASE}/activities/${stravaId}/streams?${query}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (res.status === 429) {
    throw new StravaApiError("Strava rate limit exceeded", 429);
  }
  if (res.status === 404) {
    return {};
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new StravaApiError("Failed to get activity streams", res.status, body);
  }

  return (await res.json()) as StravaStreamsByType;
}
