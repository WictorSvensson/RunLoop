// Suunto Cloud API client (official OAuth2 API via cloudapi.suunto.com).
// Server-only (uses token secrets; never import from client components).
//
// Auth model: the client secret / auth code exist only inside the OAuth
// exchange (connect route + callback) — they are traded for tokens
// immediately and never persisted. Everything else runs on stored tokens via
// loadClient(). After every sync, tokens are re-exported and saved (refresh
// rotates them). An in-flight 401 triggers exactly one refresh-and-retry
// (the access token may have expired between load and call, or its stored
// expiry is unknown) — only a failed refresh throws SuuntoAuthError and the
// UI reports "reconnect needed".
//
// API assumptions (oauth2-api.yaml in sibling Suunto-documentation/ +
// https://apizone.suunto.com/how-to-start §4):
// - Authorize: GET {oauthBase}/oauth/authorize with EXACTLY response_type=code,
//   client_id, redirect_uri (+ RFC 6749 `state`; NO scope, NO subscription
//   key — the how-to-start browser URL shows only those three params).
//   {oauthBase} is https://cloudapi-oauth.suunto.com (the yaml's servers
//   entry still says cloudapi.suunto.com but its Important-notes section
//   corrects it). Token: POST {oauthBase}/oauth/token with HTTP Basic
//   client_id:client_secret and form fields grant_type=
//   authorization_code|refresh_token (+ redirect_uri + code for the code
//   grant). Token response:
//   { access_token (JWT, custom `user` claim = Suunto username),
//     refresh_token, expires_in (seconds, ~86400), scope }.
// - Data API base {apiBase} (default https://cloudapi.suunto.com). Every
//   request carries `Authorization: Bearer <JWT>` AND
//   `Ocp-Apim-Subscription-Key: <subscription key>`.
// - Workout list: GET /v3/workouts?since=&until= (epoch ms, defaults 0/now)
//   &limit= (default 50) &offset= (default 0)
//   &filter-by-modification-time= (default true — backdated edits surface).
//   Envelope { error, metadata, payload: [...] }; a non-null `error` carries
//   { code, description } and fails the call loudly.
// - Workout FIT: GET /v3/workouts/{workoutIdOrKey}/fit (raw FIT bytes,
//   application/octet-stream).
// - 24/7 health: GET /247samples/sleep?from=&to= (epoch ms, ≤28 d window,
//   Content-Type: application/json required — see health.ts). Steps/joules
//   aggregates and intraday activity samples have no DailyCheckin columns,
//   so only sleep (+ nightly HR/HRV when present) is synced — honestly,
//   never fabricated.

import { prisma } from "@/lib/prisma";
import { extractZip } from "@/lib/zip";
import { signSessionValue, verifySessionValue } from "@/lib/auth-crypto";
import { suuntoConfig, SUUNTO_WORKOUT_FIT_PATH } from "./config";
import type { SuuntoApiWorkout } from "./suunto-types";

// Single-file download cap: a corrupt/huge response must fail loudly, not OOM.
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

// Refresh proactively when the access token dies within this skew.
const REFRESH_SKEW_MS = 60 * 1000;

// When a 401 arrives on a token obtained within this window, the fresh
// token itself was rejected (subscription key / scope / wrong API product)
// — a second refresh cannot help, so skip it and surface reconnect.
const FRESH_TOKEN_GRACE_MS = 60 * 1000;

export class SuuntoAuthError extends Error {}

/** Quota exhaustion — distinct from auth. Suunto's gateway reports this as
 * status 401 with body "Rate limit is exceeded (RateLimitExceeded)" (and
 * sometimes 429), even on a freshly minted token (expires_in=86399 rejected
 * <200 ms after mint) — i.e. quota, not a dead grant. Must NEVER trigger a
 * token refresh (a refresh burns more quota and cannot help) and must never
 * surface "reconnect". Dev tier: 10 calls/min, 200/week; a full sync costs
 * ~1 + N calls, so large first syncs must be staged with ?limit=N. */
export class SuuntoRateLimitError extends Error {
  /** Seconds from a Retry-After header, when the gateway sent one. */
  retryAfterSeconds?: number;
}

/** User-facing guidance attached to every rate-limit throw (never "reconnect"). */
export const SUUNTO_RATE_LIMIT_MESSAGE =
  "Suunto API quota exceeded (10 calls/min, 200/week). Wait a minute, then retry with a smaller batch (?limit=N).";

/** True when a status/body/header triple is quota-shaped: an explicit 429,
 * or a body carrying the gateway's RateLimitExceeded marker. Checked before
 * any auth classification — the gateway reuses 401 for quota. */
function isRateLimitResponse(status: number, bodySnippet: string): boolean {
  if (status === 429) return true;
  return /ratelimitexceeded|rate[\s_-]*limit.*(exceeded|hit|reached)|too many requests|quota.*exceeded|exceed.*quota/i.test(
    bodySnippet,
  );
}

/** True for quota-shaped failures: the error instance or its message.
 * Exported alongside isSuuntoAuthFailure so callers can route quota before
 * auth (a 401-status rate limit must never read as a dead grant). */
export function isSuuntoRateLimitFailure(err: unknown): boolean {
  if (err instanceof SuuntoRateLimitError) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /ratelimitexceeded|rate[\s_-]*limit.*(exceeded|hit|reached)|too many requests/i.test(msg);
}

/** Stored token shape (JSON of SuuntoConnection.tokenJson). */
export interface StoredSuuntoTokens {
  access_token: string;
  refresh_token?: string;
  /** Epoch ms when the access token was obtained. */
  obtained_at_ms?: number;
  /** Lifetime seconds from the token endpoint (expires_in). */
  expires_in?: number;
}

export function parseStoredTokens(tokenJson: string): StoredSuuntoTokens {
  let parsed: unknown;
  try {
    parsed = JSON.parse(tokenJson);
  } catch {
    throw new SuuntoAuthError("Stored Suunto tokens are malformed; please reconnect.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { access_token?: unknown }).access_token !== "string"
  ) {
    throw new SuuntoAuthError("Stored Suunto tokens are malformed; please reconnect.");
  }
  return parsed as StoredSuuntoTokens;
}

export function accessTokenExpiresAt(tokens: StoredSuuntoTokens): Date | null {
  if (
    typeof tokens.obtained_at_ms === "number" &&
    typeof tokens.expires_in === "number" &&
    Number.isFinite(tokens.obtained_at_ms) &&
    Number.isFinite(tokens.expires_in) &&
    tokens.expires_in > 0
  ) {
    return new Date(tokens.obtained_at_ms + tokens.expires_in * 1000);
  }
  return null;
}

function isExpiredSoon(tokens: StoredSuuntoTokens, nowMs: number = Date.now()): boolean {
  const exp = accessTokenExpiresAt(tokens);
  if (!exp) return false; // unknown expiry: use as-is, 401s surface reconnects
  return exp.getTime() - nowMs <= REFRESH_SKEW_MS;
}

/** Decodes the JWT payload (no signature verification — it is Suunto's own
 * token, freshly issued to us; only the `user` claim is read). */
export function decodeJwtClaim(jwt: string): Record<string, unknown> | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function suuntoUserFromJwt(jwt: string): string | null {
  const claims = decodeJwtClaim(jwt);
  // Suunto carries the authorizing App username in the custom `user` claim;
  // `sub` is the fallback subject (per Open Wearables provider docs both
  // identify the user).
  for (const key of ["user", "sub"]) {
    const value = claims?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// OAuth flow.
// ---------------------------------------------------------------------------

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Builds the Suunto authorize URL exactly per oauth2-api.yaml:
 * response_type=code, client_id, redirect_uri — plus the RFC 6749 `state`
 * CSRF binding (signed, expiring envelope verified in the callback). The
 * spec defines no `scope` request parameter, so none is sent. */
export function buildAuthorizeUrl(userId: string): string {
  const state = signSessionValue(userId, Date.now() + OAUTH_STATE_TTL_MS);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: suuntoConfig.clientId,
    redirect_uri: suuntoConfig.redirectUri,
    state,
  });
  return `${suuntoConfig.oauthBaseUrl}/oauth/authorize?${params.toString()}`;
}

/** Verifies callback `state`; returns the user id or null (bad/expired). */
export function verifyOAuthState(state: string | null): string | null {
  if (!state) return null;
  try {
    return verifySessionValue(state)?.userId ?? null;
  } catch {
    return null;
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

async function requestTokens(params: Record<string, string>): Promise<TokenResponse> {
  // Token endpoint uses HTTP Basic client_id:client_secret (per Suunto
  // quickstart curl). Secrets stay server-side; failures surface the
  // endpoint's description when it provides one (never the secret).
  const basic = Buffer.from(`${suuntoConfig.clientId}:${suuntoConfig.clientSecret}`).toString("base64");
  const res = await fetch(`${suuntoConfig.oauthBaseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const detail = await describeTokenError(res);
    // Shape-only server config diagnostic: a truncated SUUNTO_CLIENT_SECRET
    // (copy-paste/placeholder) fails here, not on the data API. Log lengths
    // only — never secret values (not even prefixes).
    try {
      const cid = suuntoConfig.clientId;
      const csec = suuntoConfig.clientSecret;
      console.warn(
        `Suunto token endpoint rejected: status=${res.status} grant=${params.grant_type ?? "?"} ` +
          `client_id=${cid.slice(0, 4)}...len=${cid.length} client_secret_len=${csec.length} ` +
          `detail="${detail.slice(0, 120)}"`,
      );
    } catch {
      // Config itself unreadable (missing env) — the throw below carries it.
    }
    throw new SuuntoAuthError(`Suunto authorization failed (${res.status}): ${detail}`);
  }
  const body: unknown = await res.json().catch(() => null);
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { access_token?: unknown }).access_token !== "string"
  ) {
    throw new SuuntoAuthError("Suunto token response was unreadable; please try again.");
  }
  return body as TokenResponse;
}

async function describeTokenError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return "no detail";
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      const desc = (parsed as { error_description?: unknown }).error_description;
      const err = (parsed as { error?: unknown }).error;
      if (typeof desc === "string") return desc.slice(0, 160);
      if (typeof err === "string") return err.slice(0, 160);
    }
    return text.slice(0, 160);
  } catch {
    return "no detail";
  }
}

/** Exchanges a callback auth code for tokens. Single-use: codes expire fast. */
export async function exchangeCodeForTokens(code: string): Promise<StoredSuuntoTokens> {
  const body = await requestTokens({
    grant_type: "authorization_code",
    redirect_uri: suuntoConfig.redirectUri,
    code,
  });
  return toStoredTokens(body);
}

/** Refreshes an access token. Throws SuuntoAuthError when the refresh fails
 * (revoked/expired grant → user must reconnect, not retry). */
export async function refreshAccessToken(refreshToken: string): Promise<StoredSuuntoTokens> {
  const body = await requestTokens({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return toStoredTokens(body);
}

function toStoredTokens(body: TokenResponse): StoredSuuntoTokens {
  return {
    access_token: body.access_token,
    ...(typeof body.refresh_token === "string" ? { refresh_token: body.refresh_token } : {}),
    obtained_at_ms: Date.now(),
    ...(typeof body.expires_in === "number" ? { expires_in: body.expires_in } : {}),
  };
}

/** Persists (or refreshes) a user's token pair after connect or sync. */
export async function saveSuuntoTokens(
  userId: string,
  tokens: StoredSuuntoTokens,
  extra: { suuntoUserId?: string | null; username?: string | null } = {},
): Promise<void> {
  await prisma.suuntoConnection.upsert({
    where: { userId },
    create: {
      userId,
      suuntoUserId: extra.suuntoUserId ?? null,
      username: extra.username ?? null,
      tokenJson: JSON.stringify(tokens),
      expiresAt: accessTokenExpiresAt(tokens),
    },
    update: {
      tokenJson: JSON.stringify(tokens),
      expiresAt: accessTokenExpiresAt(tokens),
      ...(extra.suuntoUserId !== undefined ? { suuntoUserId: extra.suuntoUserId } : {}),
      ...(extra.username !== undefined ? { username: extra.username } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Authenticated API access.
// ---------------------------------------------------------------------------

/** Live credentials for one request batch (access token + headers). */
export interface SuuntoCredentials {
  accessToken: string;
  subscriptionKey: string;
  apiBaseUrl: string;
}

/** Loads credentials from stored tokens, refreshing first when expiring. */
export async function loadCredentials(userId: string): Promise<{ creds: SuuntoCredentials; tokens: StoredSuuntoTokens }> {
  const connection = await prisma.suuntoConnection.findUnique({ where: { userId } });
  if (!connection) {
    throw new SuuntoAuthError("No Suunto connection. Connect Suunto first.");
  }
  let tokens = parseStoredTokens(connection.tokenJson);
  if (isExpiredSoon(tokens)) {
    if (!tokens.refresh_token) {
      throw new SuuntoAuthError("Suunto session expired. Please reconnect.");
    }
    tokens = await refreshAccessToken(tokens.refresh_token);
    await saveSuuntoTokens(userId, tokens);
    logFreshTokens("proactive refresh (expiring token)", tokens, suuntoConfig.subscriptionKey);
  }
  return {
    creds: {
      accessToken: tokens.access_token,
      subscriptionKey: suuntoConfig.subscriptionKey,
      apiBaseUrl: suuntoConfig.apiBaseUrl,
    },
    tokens,
  };
}

/** Message shown when the user must reconnect (surfaced verbatim in the UI). */
export const SUUNTO_RECONNECT_MESSAGE =
  "Suunto connection expired. Please Reconnect Suunto below, then sync again.";

/** True for auth-shaped failures: SuuntoAuthError or a 401/403-pattern message.
 * Quota-shaped failures are explicitly excluded — a 401 carrying
 * RateLimitExceeded is quota, not a dead grant (checked first via
 * isSuuntoRateLimitFailure).
 * Exported so per-workout FIT handling (which swallows errors into
 * summary-only rows) can detect an expired token mid-sync and refresh it
 * instead of reusing a stale token for every remaining download. */
export function isSuuntoAuthFailure(err: unknown): boolean {
  if (err instanceof SuuntoRateLimitError) return false;
  if (isSuuntoRateLimitFailure(err)) return false;
  if (err instanceof SuuntoAuthError) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /401|403|unauthorized|forbidden|invalid_token|expired/i.test(msg);
}

/** Shape-only descriptors for logs — prefixes + lengths, never values. */
function tokenShape(token: string): string {
  return `${token.slice(0, 6)}...len=${token.length}`;
}

function subKeyShape(key: string): string {
  return `${key.slice(0, 4)}...len=${key.length}`;
}

/** One-line shape log for a fresh token pair (no secrets/tokens). */
function logFreshTokens(tag: string, tokens: StoredSuuntoTokens, subscriptionKey: string): void {
  console.log(
    `Suunto ${tag}: token=${tokenShape(tokens.access_token)} ` +
      `expires_in=${typeof tokens.expires_in === "number" ? tokens.expires_in : "unknown"} ` +
      `obtained_at_ms=${tokens.obtained_at_ms ?? "unknown"} ` +
      `has_refresh=${typeof tokens.refresh_token === "string" && tokens.refresh_token.length > 0} ` +
      `sub=${subKeyShape(subscriptionKey)}`,
  );
}

/** Latest stored tokens, or null when missing/unreadable. */
async function readStoredTokens(userId: string): Promise<StoredSuuntoTokens | null> {
  const row = await prisma.suuntoConnection.findUnique({
    where: { userId },
    select: { tokenJson: true },
  });
  if (!row) return null;
  try {
    return parseStoredTokens(row.tokenJson);
  } catch {
    return null;
  }
}

/**
 * Runs fn with Suunto credentials, then re-saves tokens (refresh may rotate
 * them mid-sync). Saved in a finally so a rotated pair is never lost when the
 * sync itself throws. Do not run concurrent Suunto syncs for one user
 * (last-writer-wins on rotated refresh tokens); the job route is the single
 * entry point.
 *
 * On an auth-shaped failure from fn, exactly one refresh-and-retry is
 * attempted (the access token may have expired between loadCredentials and
 * the API call, or its stored expiry was unknown so no proactive refresh
 * happened). Only when the refresh itself fails is SuuntoAuthError thrown —
 * a failed refresh means the grant is revoked/expired or the server-side
 * client secret is wrong, and no retry can help. Secrets/tokens are never
 * logged (status + lengths only).
 *
 * Quota (SuuntoRateLimitError) is never refreshed and never retried here:
 * a refresh burns more of the same 10/min quota and cannot help. It
 * propagates untouched so callers can abort gracefully with partial counts.
 */
export async function withSuuntoClient<T>(
  userId: string,
  fn: (creds: SuuntoCredentials) => Promise<T>,
): Promise<T> {
  const { creds, tokens } = await loadCredentials(userId);
  // Newest known tokens: the 401-retry below may rotate them, and the
  // finally re-export must compare against the newest — never un-rotate a
  // pair something else saved mid-flight.
  let current = tokens;
  try {
    try {
      return await fn(creds);
    } catch (err) {
      // Quota is never refreshed: a refresh burns more of the same 10/min
      // quota and cannot help. Propagates untouched (never converted to
      // SuuntoAuthError in the outer catch either).
      if (isSuuntoRateLimitFailure(err)) throw err;
      if (!isSuuntoAuthFailure(err)) throw err;
      // Re-read: fn ran long enough for another call to rotate the pair.
      const latest = await readStoredTokens(userId);
      // Fresh-token guard: only when the stored pair actually rotated during
      // this run (latest.access_token differs from the pair loaded at entry)
      // AND the rotated pair was obtained seconds ago (e.g. a mid-sync FIT
      // refresh just rotated it) and the API still 401s, the fresh token
      // itself is rejected — authorization (subscription key / scope / API
      // product), not expiry. A second refresh + full retry-from-offset-0
      // cannot help; surface reconnect instead of burning quota on a doomed
      // second pass. An initial stored token that merely looks fresh
      // (obtained_at_ms ≈ now) must still get its legitimate first refresh.
      const latestObtained = latest?.obtained_at_ms;
      const rotatedThisRun = latest?.access_token !== tokens.access_token;
      if (
        rotatedThisRun &&
        typeof latestObtained === "number" &&
        Number.isFinite(latestObtained) &&
        Date.now() - latestObtained < FRESH_TOKEN_GRACE_MS
      ) {
        console.warn(
          `Suunto 401 on a token obtained ${Date.now() - latestObtained}ms ago ` +
            `(token=${tokenShape(latest?.access_token ?? "?")} ` +
            `expires_in=${latest?.expires_in ?? "unknown"} ` +
            `sub=${subKeyShape(suuntoConfig.subscriptionKey)}): ` +
            `fresh token rejected — skipping refresh, check subscription key / scopes.`,
        );
        throw new SuuntoAuthError(SUUNTO_RECONNECT_MESSAGE);
      }
      const refreshToken = latest?.refresh_token ?? current.refresh_token;
      if (!refreshToken) {
        throw new SuuntoAuthError(SUUNTO_RECONNECT_MESSAGE);
      }
      try {
        current = await refreshAccessToken(refreshToken);
        await saveSuuntoTokens(userId, current);
      } catch (refreshErr) {
        console.warn(
          "Suunto refresh after 401 failed (reconnect needed):",
          refreshErr instanceof Error ? refreshErr.message.slice(0, 160) : "?",
        );
        throw new SuuntoAuthError(SUUNTO_RECONNECT_MESSAGE);
      }
      logFreshTokens("refreshed after 401; retrying once", current, suuntoConfig.subscriptionKey);
      return await fn({
        accessToken: current.access_token,
        subscriptionKey: suuntoConfig.subscriptionKey,
        apiBaseUrl: suuntoConfig.apiBaseUrl,
      });
    }
  } catch (err) {
    if (err instanceof SuuntoRateLimitError) throw err;
    if (err instanceof SuuntoAuthError) throw err;
    if (isSuuntoAuthFailure(err)) throw new SuuntoAuthError(SUUNTO_RECONNECT_MESSAGE);
    throw err;
  } finally {
    try {
      const latest = await readStoredTokens(userId);
      if (latest) {
        // Only touch the row when nothing else rotated it mid-flight.
        if (latest.access_token === tokens.access_token) {
          await saveSuuntoTokens(userId, current);
        }
      }
    } catch (err) {
      console.error("Suunto token re-export failed:", err);
    }
  }
}

function authHeaders(creds: SuuntoCredentials): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.accessToken}`,
    "Ocp-Apim-Subscription-Key": creds.subscriptionKey,
  };
}

/** Unwraps Suunto's { error, metadata, payload } envelope (or a bare array).
 * A non-null `error` ({ code, description }) fails loudly — callers must
 * check it before trusting an empty payload. */
export function unwrapPayload<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (typeof body === "object" && body !== null) {
    const payload = (body as { payload?: unknown }).payload;
    if (Array.isArray(payload)) return payload as T[];
    const items = (body as { items?: unknown }).items;
    if (Array.isArray(items)) return items as T[];
    const workouts = (body as { workouts?: unknown }).workouts;
    if (Array.isArray(workouts)) return workouts as T[];
  }
  return [];
}

/** Returns the envelope's error description, or null on success. */
export function envelopeError(body: unknown): string | null {
  if (typeof body === "object" && body !== null) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "object" && error !== null) {
      const description = (error as { description?: unknown }).description;
      const code = (error as { code?: unknown }).code;
      const detail =
        (typeof description === "string" ? description : "") ||
        (typeof code === "string" ? code : "");
      if (detail) return detail.slice(0, 200);
      return "unknown Suunto API error";
    }
  }
  return null;
}

/**
 * Refreshes + saves credentials mid-sync. withSuuntoClient only retries when
 * fn itself throws — but per-workout FIT failures are swallowed into
 * summary-only rows inside the import loop, so without this the whole
 * remaining loop would reuse a stale token after expiry. Returns fresh
 * credentials; throws SuuntoAuthError when the grant is dead (caller must
 * let that propagate so the UI reports "reconnect needed"). Secrets/tokens
 * are never logged (status + lengths only).
 */
export async function refreshSuuntoCredentials(userId: string): Promise<SuuntoCredentials> {
  const latest = await readStoredTokens(userId);
  const refreshToken = latest?.refresh_token;
  if (!refreshToken) {
    throw new SuuntoAuthError(SUUNTO_RECONNECT_MESSAGE);
  }
  try {
    const tokens = await refreshAccessToken(refreshToken);
    await saveSuuntoTokens(userId, tokens);
    logFreshTokens("refreshed mid-sync (FIT retry)", tokens, suuntoConfig.subscriptionKey);
    return {
      accessToken: tokens.access_token,
      subscriptionKey: suuntoConfig.subscriptionKey,
      apiBaseUrl: suuntoConfig.apiBaseUrl,
    };
  } catch (err) {
    console.warn(
      "Suunto mid-sync refresh failed (reconnect needed):",
      err instanceof Error ? err.message.slice(0, 160) : "?",
    );
    throw new SuuntoAuthError(SUUNTO_RECONNECT_MESSAGE);
  }
}

async function throwForStatus(
  res: Response,
  what: string,
  logDetails: string = "",
  creds?: SuuntoCredentials,
): Promise<void> {
  if (res.ok) return;
  // Precise server log: HTTP status + which call (list vs FIT vs 247 path)
  // + caller-supplied context (workout key / page) + shape-only credential
  // descriptors + the gateway's own body snippet. The body is the key
  // discriminator: Azure APIM subscription-key failures ("Invalid/Missing
  // subscription key", wrong API product) vs JWT failures (invalid_token /
  // expired) vs QUOTA (status 401 with "Rate limit is exceeded
  // (RateLimitExceeded)") look identical as bare statuses without it. Never
  // tokens/secrets — only prefixes + lengths and the server's own text.
  //
  // Quota is classified FIRST: the gateway reuses 401 for rate limits
  // (fresh token, expires_in=86399, rejected <200 ms after mint), and that
  // must throw SuuntoRateLimitError — never SuuntoAuthError — so no refresh
  // fires and no "reconnect" surfaces.
  const credShape = creds
    ? ` token=${tokenShape(creds.accessToken)} sub=${subKeyShape(creds.subscriptionKey)} api=${creds.apiBaseUrl}`
    : "";
  const bodySnippet = await res
    .text()
    .then((t) => t.slice(0, 200))
    .catch(() => "");
  if (isRateLimitResponse(res.status, bodySnippet)) {
    const retryAfterRaw = res.headers?.get?.("retry-after");
    const retryAfter =
      retryAfterRaw !== null && retryAfterRaw !== undefined && retryAfterRaw !== ""
        ? Number(retryAfterRaw)
        : NaN;
    const retryHint =
      Number.isFinite(retryAfter) && retryAfter > 0 ? ` Retry after ${Math.ceil(retryAfter)}s.` : "";
    console.warn(
      `Suunto API rate-limited: status=${res.status} call="${what}"${logDetails ? ` ${logDetails}` : ""}${credShape} body="${bodySnippet}"${retryHint}`,
    );
    const err = new SuuntoRateLimitError(
      `Suunto rate limit hit on ${what} (${res.status}): quota is 10 calls/min, 200/week — wait a minute, then retry with a smaller batch (?limit=N).${retryHint}`,
    );
    if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterSeconds = Math.ceil(retryAfter);
    throw err;
  }
  if (res.status === 401 || res.status === 403) {
    console.warn(
      `Suunto API rejected: status=${res.status} call="${what}"${logDetails ? ` ${logDetails}` : ""}${credShape} body="${bodySnippet}"`,
    );
    // Keeps the "Suunto rejected … (401)" shape: isSuuntoAuthFailure and the
    // 247 sleep fetcher match on it to route reconnects.
    throw new SuuntoAuthError(
      `Suunto rejected ${what} (${res.status}); the connection may need re-authorizing.`,
    );
  }
  console.warn(
    `Suunto API rejected: status=${res.status} call="${what}"${logDetails ? ` ${logDetails}` : ""}${credShape} body="${bodySnippet}"`,
  );
  throw new Error(`Suunto ${what} failed (${res.status}): ${bodySnippet.slice(0, 160)}`);
}

/** Paginated workout listing. `sinceMs`/`untilMs` are epoch millis for the
 * spec's since/until params; modification-time filtering (the default) is
 * left on so backdated edits surface in incremental syncs. */
export async function listSuuntoWorkouts(
  creds: SuuntoCredentials,
  options: {
    offset: number;
    limit: number;
    sinceMs?: number | null;
    untilMs?: number | null;
  },
  path: string = "/v3/workouts",
): Promise<SuuntoApiWorkout[]> {
  const url = new URL(path, creds.apiBaseUrl);
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("offset", String(options.offset));
  if (options.sinceMs !== undefined && options.sinceMs !== null) {
    url.searchParams.set("since", String(Math.max(0, Math.floor(options.sinceMs))));
  }
  if (options.untilMs !== undefined && options.untilMs !== null) {
    url.searchParams.set("until", String(Math.floor(options.untilMs)));
  }
  const res = await fetch(url.toString(), { headers: authHeaders(creds) });
  await throwForStatus(
    res,
    "workout list",
    `path=${path} offset=${options.offset} limit=${options.limit}`,
    creds,
  );
  const body: unknown = await res.json().catch(() => null);
  const apiError = envelopeError(body);
  if (apiError) {
    // A 200-envelope can still carry quota exhaustion — same routing as the
    // status path (no refresh, no reconnect).
    if (isSuuntoRateLimitFailure(apiError)) {
      console.warn(
        `Suunto API rate-limited: status=200 call="workout list" path=${path} offset=${options.offset} limit=${options.limit} body="${apiError.slice(0, 200)}"`,
      );
      throw new SuuntoRateLimitError(
        `Suunto rate limit hit on workout list: quota is 10 calls/min, 200/week — wait a minute, then retry with a smaller batch (?limit=N).`,
      );
    }
    throw new Error(`Suunto workout list failed: ${apiError}`);
  }
  return unwrapPayload<SuuntoApiWorkout>(body);
}

/**
 * Downloads a workout's FIT file and returns its bytes. Raw FIT is expected;
 * a .zip response (PK magic) is unpacked to its first .fit (mirrors the
 * Garmin disk-staging path, but fully in-memory).
 */
export async function downloadSuuntoFitBytes(
  creds: SuuntoCredentials,
  workoutKey: string,
  path?: string,
): Promise<Uint8Array> {
  if (!workoutKey || workoutKey.length > 128) {
    throw new Error(`Invalid Suunto workout key: ${workoutKey.slice(0, 32)}`);
  }
  const configured = SUUNTO_WORKOUT_FIT_PATH;
  const primary = path ?? configured(workoutKey);
  const res = await fetch(new URL(primary, creds.apiBaseUrl).toString(), {
    headers: authHeaders(creds),
  });
  await throwForStatus(res, "workout FIT download", `workoutKey=${workoutKey} path=${primary}`, creds);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error("Downloaded .fit is empty");
  if (buf.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Downloaded file exceeds size cap (${buf.byteLength} bytes)`);
  }
  // ZIP magic "PK\x03\x04": unpack to the first .fit inside.
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const entries = extractZip(buf);
    const fit = entries.find((e) => e.name.toLowerCase().endsWith(".fit"));
    if (!fit) throw new Error("ZIP contained no .fit file");
    return fit.data;
  }
  return buf;
}

/** Generic authenticated GET returning tolerant JSON (null on empty body).
 * Extra headers (e.g. Content-Type, required by the 247 endpoints) merge
 * over the auth headers. */
export async function suuntoGetJson(
  creds: SuuntoCredentials,
  path: string,
  params: Record<string, string> = {},
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const url = new URL(path, creds.apiBaseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { ...authHeaders(creds), ...extraHeaders },
  });
  await throwForStatus(res, `GET ${path}`, "", creds);
  return res.json().catch(() => null);
}
