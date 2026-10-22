import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { importSuuntoActivities } from "@/lib/suunto/import";
import { importSuuntoHealth } from "@/lib/suunto/health";
import { SuuntoAuthError, SuuntoRateLimitError, isSuuntoRateLimitFailure } from "@/lib/suunto/client";
import { isIntegrationEnabled } from "@/lib/integrations";
import { isInternalRequestAuthorized } from "@/lib/http-auth";

// POST /api/jobs/suunto-import
// Triggerable Suunto Cloud API sync: activities (incremental by default,
// ?full=1 for whole history) plus recent 24/7 health (?healthDays=N,
// default 14; ?full=1 raises it to 365). Same auth as other job routes:
// Bearer JOB_SECRET or same-origin browser request, plus session user.
export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const fullResync = params.get("full") === "1";
  // ?limit=N caps rows processed — diagnostics (e.g. reproduce a FIT failure
  // on 2 workouts in seconds instead of a long full sync). Health sync
  // is skipped on limited runs to keep them fast and focused.
  const limitRaw = params.get("limit");
  const limit = limitRaw !== null ? Math.floor(Number(limitRaw)) : null;
  const maxActivities = limit !== null && Number.isInteger(limit) && limit > 0 ? limit : null;
  if (limitRaw !== null && maxActivities === null) {
    return NextResponse.json({ error: "?limit must be a positive integer." }, { status: 400 });
  }
  const healthDays = params.has("healthDays")
    ? Number(params.get("healthDays"))
    : fullResync
      ? 365
      : 14;

  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    // Toggled-off integrations keep tokens + history but block future syncs.
    if (!(await isIntegrationEnabled(user.id, "SUUNTO"))) {
      return NextResponse.json(
        { error: "Suunto sync is turned off. Toggle it on in Profile to sync." },
        { status: 403 },
      );
    }
    const activities = await importSuuntoActivities(user.id, { fullResync, maxActivities: maxActivities ?? undefined });
    const health =
      maxActivities !== null
        ? { daysChecked: 0, sleepFilled: 0, restingHrFilled: 0, hrvFilled: 0, degraded: false, sleepWindowsFailed: 0, rateLimited: false, retryAfterSeconds: null as number | null, skipped: "limited run" }
        : await importSuuntoHealth(user.id, {
            daysBack: Number.isInteger(healthDays) && healthDays >= 0 ? healthDays : 14,
            fullResync,
          });
    // Quota (10 calls/min, 200/week) is not auth: partial progress is saved
    // (upserts), so report 429 with counts so far — never reconnect:true.
    // Staging via ?limit=N keeps each run under the per-minute budget.
    if (activities.rateLimited || health.rateLimited) {
      const retryAfterSeconds =
        activities.retryAfterSeconds ?? health.retryAfterSeconds ?? null;
      const done = `Partial progress saved (${activities.imported} new, ${activities.updated} updated).`;
      const wait =
        retryAfterSeconds !== null
          ? ` Wait at least ${retryAfterSeconds}s, then retry.`
          : " Wait a minute, then retry.";
      return NextResponse.json(
        {
          error:
            `Suunto API quota exceeded (10 calls/min, 200/week). ${done}${wait} ` +
            "Stage the sync in small batches with ?limit=N (e.g. ?limit=5).",
          rateLimited: true,
          ...(retryAfterSeconds !== null ? { retryAfterSeconds } : {}),
          activities,
          health,
        },
        {
          status: 429,
          ...(retryAfterSeconds !== null
            ? { headers: { "Retry-After": String(retryAfterSeconds) } }
            : {}),
        },
      );
    }
    return NextResponse.json({ ok: true, activities, health });
  } catch (err) {
    // A rate-limit that escaped the graceful path (e.g. a quota-shaped
    // failure thrown outside the import loops, or a message-shaped error
    // that is not a SuuntoRateLimitError instance — the gateway reuses 401
    // for quota) is still quota — 429 with staging guidance, no refresh
    // was attempted and reconnect must stay false.
    if (err instanceof SuuntoRateLimitError || isSuuntoRateLimitFailure(err)) {
      const retryAfterSeconds =
        err instanceof SuuntoRateLimitError && typeof err.retryAfterSeconds === "number"
          ? err.retryAfterSeconds
          : null;
      return NextResponse.json(
        {
          error:
            "Suunto API quota exceeded (10 calls/min, 200/week). Wait a minute, then retry " +
            "with a smaller batch (?limit=N, e.g. ?limit=5)." +
            (retryAfterSeconds !== null ? ` Retry after ${retryAfterSeconds}s.` : ""),
          rateLimited: true,
          ...(retryAfterSeconds !== null ? { retryAfterSeconds } : {}),
        },
        {
          status: 429,
          ...(retryAfterSeconds !== null
            ? { headers: { "Retry-After": String(retryAfterSeconds) } }
            : {}),
        },
      );
    }
    if (err instanceof SuuntoAuthError) {
      // reconnect:true lets the client offer a one-click re-authorize
      // (the stored grant is dead — a plain retry cannot help).
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("Suunto import failed:", err);
    return NextResponse.json({ error: "Import failed. Please try again." }, { status: 500 });
  }
}
