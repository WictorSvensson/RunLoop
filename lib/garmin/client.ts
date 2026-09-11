// Garmin Connect client wrapper (unofficial API via @flow-js/garmin-connect).
// Server-only (uses node:fs/os for FIT download staging).
//
// Auth model: the password exists only inside connectGarmin() — it is traded
// for tokens immediately and never persisted. Everything else runs on stored
// tokens via loadClient(). After every mutating sync, tokens are re-exported
// and saved (refresh rotates them). If tokens die (401/MFA), calls throw
// GarminAuthError and the UI reports "reconnect needed" — there is no
// password to retry with.

import { GarminConnect } from "@flow-js/garmin-connect";
import type {
  IActivity,
  IGarminTokens,
  IOauth1Token,
  IOauth2Token,
} from "@flow-js/garmin-connect";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { extractZip } from "./zip";

// Single-file download cap: a corrupt/huge response must fail loudly, not OOM.
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export class GarminAuthError extends Error {}

/** Stored token pair shape (JSON of the library's exportToken()). */
export interface StoredGarminTokens {
  oauth1: IOauth1Token;
  oauth2: IOauth2Token;
}

export function parseStoredTokens(tokenJson: string): StoredGarminTokens {
  const parsed: unknown = JSON.parse(tokenJson);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("oauth1" in parsed) ||
    !("oauth2" in parsed)
  ) {
    throw new GarminAuthError("Stored Garmin tokens are malformed; please reconnect.");
  }
  return parsed as StoredGarminTokens;
}

function expiresAtFrom(tokens: IGarminTokens): Date | null {
  const at = tokens.oauth2?.expires_at;
  if (typeof at === "number" && Number.isFinite(at) && at > 0) {
    return new Date(at * 1000);
  }
  return null;
}

/**
 * One-time connect with raw credentials. Returns tokens + profile id for
 * persistence. Throws GarminAuthError on bad credentials / MFA challenges
 * (message preserved for UI display).
 */
export async function connectGarmin(
  username: string,
  password: string,
): Promise<{ tokens: IGarminTokens; garminUserId: string | null; displayName: string | null }> {
  const client = new GarminConnect();
  try {
    await client.login(username, password);
  } catch (err) {
    throw new GarminAuthError(
      err instanceof Error ? err.message : "Garmin login failed.",
    );
  }
  const tokens = client.exportToken();

  let garminUserId: string | null = null;
  let displayName: string | null = null;
  try {
    const profile = await client.getUserProfile();
    garminUserId = profile?.id != null ? String(profile.id) : null;
    displayName =
      profile?.displayName ?? profile?.fullName ?? null;
  } catch {
    // Profile is a nicety; tokens are the point. Sync will surface real auth
    // failures on first use.
  }
  return { tokens, garminUserId, displayName };
}

/** Persists (or refreshes) a user's token pair after connect or sync. */
export async function saveGarminTokens(
  userId: string,
  tokens: IGarminTokens,
  extra: { garminUserId?: string | null; username?: string | null } = {},
): Promise<void> {
  await prisma.garminConnection.upsert({
    where: { userId },
    create: {
      userId,
      garminUserId: extra.garminUserId ?? null,
      username: extra.username ?? null,
      tokenJson: JSON.stringify(tokens),
      expiresAt: expiresAtFrom(tokens),
    },
    update: {
      tokenJson: JSON.stringify(tokens),
      expiresAt: expiresAtFrom(tokens),
      ...(extra.garminUserId !== undefined ? { garminUserId: extra.garminUserId } : {}),
      ...(extra.username !== undefined ? { username: extra.username } : {}),
    },
  });
}

/** Loads an authenticated client from stored tokens. Throws GarminAuthError. */
export async function loadClient(userId: string): Promise<GarminConnect> {
  const connection = await prisma.garminConnection.findUnique({ where: { userId } });
  if (!connection) {
    throw new GarminAuthError("No Garmin connection. Connect Garmin first.");
  }
  const tokens = parseStoredTokens(connection.tokenJson);
  const client = new GarminConnect();
  client.loadToken(tokens.oauth1, tokens.oauth2);
  return client;
}

/**
 * Runs fn with an authenticated client, then re-exports + saves tokens
 * (refresh may rotate them mid-sync). Saved in a finally so a rotated pair
 * is never lost when the sync itself throws. Save failures are logged, not
 * swallowed — a lost rotation bricks the connection into 401s.
 * Do not run concurrent Garmin syncs for one user (last-writer-wins on
 * rotated refresh tokens); the job route is the single entry point.
 */
export async function withGarminClient<T>(
  userId: string,
  fn: (client: GarminConnect) => Promise<T>,
): Promise<T> {
  const client = await loadClient(userId);
  try {
    return await fn(client);
  } catch (err) {
    if (err instanceof GarminAuthError) throw err;
    const msg = err instanceof Error ? err.message : "";
    if (/401|unauthorized|forbidden|mfa|login|token/i.test(msg)) {
      throw new GarminAuthError(
        "Garmin session expired or needs re-authentication. Please reconnect.",
      );
    }
    throw err;
  } finally {
    try {
      await saveGarminTokens(userId, client.exportToken());
    } catch (err) {
      console.error("Garmin token re-export failed:", err);
    }
  }
}

/** Paginated activity listing (newest first). */
export async function listGarminActivities(
  client: GarminConnect,
  start: number,
  limit: number,
): Promise<IActivity[]> {
  return client.getActivities(start, limit);
}

/**
 * Downloads an activity's original FIT file and returns its bytes.
 * The library only writes to disk, so stage in the OS temp dir, extract the
 * first .fit from the zip, and clean up unconditionally. activityId is
 * validated (not cast) — a bad id fails loudly instead of degrading to a
 * silent summary-only row.
 */
export async function downloadFitBytes(
  client: GarminConnect,
  activityId: number | string,
): Promise<Uint8Array> {
  const id = typeof activityId === "string" ? Number(activityId) : activityId;
  if (!Number.isFinite(id)) {
    throw new Error(`Invalid Garmin activity id: ${String(activityId)}`);
  }
  const dir = mkdtempSync(join(tmpdir(), "runloop-garmin-"));
  try {
    await client.downloadOriginalActivityData({ activityId: id }, dir);
    const files = readdirSync(dir, { recursive: true });
    const names: string[] = files.filter((f): f is string => typeof f === "string");
    const fitRel = names.find((f) => f.toLowerCase().endsWith(".fit"));
    if (fitRel) {
      const raw = readFileSync(join(dir, fitRel));
      if (raw.byteLength > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Downloaded .fit exceeds size cap (${raw.byteLength} bytes)`);
      }
      return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    }
    const zipRel = names.find((f) => f.toLowerCase().endsWith(".zip"));
    if (!zipRel) throw new Error("Download contained no .fit or .zip");
    const zipRaw = readFileSync(join(dir, zipRel));
    if (zipRaw.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Downloaded .zip exceeds size cap (${zipRaw.byteLength} bytes)`);
    }
    const entries = extractZip(
      new Uint8Array(zipRaw.buffer, zipRaw.byteOffset, zipRaw.byteLength),
    );
    const fit = entries.find((e) => e.name.toLowerCase().endsWith(".fit"));
    if (!fit) throw new Error("ZIP contained no .fit file");
    return fit.data;
  } finally {
    // rmSync itself must never mask the original error (e.g. file locks).
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.error("Garmin temp cleanup failed:", err);
    }
  }
}
