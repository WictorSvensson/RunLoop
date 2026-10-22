"use client";

import { useState } from "react";

interface Props {
  isConnected: boolean;
}

// Client-side controls for Suunto Cloud API auto-sync (OAuth2). Rendered in
// the profile Connections section only while the Suunto toggle is on (the
// parent hides this whole block when off). Manual export-zip upload lives
// alongside in <SuuntoUpload /> — connecting here never removes it.
// Styling reuses the shared connection classes only (no new light cards,
// see the .app-shell dark-theme gotcha in AGENTS.md).
export function SuuntoSync({ isConnected }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Set when a sync fails with a dead grant: re-running the OAuth connect
  // flow overwrites the stored tokens (upsert in the callback), so this is
  // the Disconnect + Connect path in one click. Shown even while
  // `isConnected` — the row still exists, only the grant is dead.
  const [needsReconnect, setNeedsReconnect] = useState(false);
  // Distinct quota state: Suunto dev tier is 10 calls/min, 200/week and the
  // gateway reuses 401 for quota — this must never read as a dead grant.
  const [quotaHit, setQuotaHit] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  async function handleConnect() {
    setConnecting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/suunto/connect", { method: "POST" });
      const data = await res.json();
      if (!res.ok || typeof data.url !== "string") {
        setMessage(data.error ?? "Could not start Suunto connect.");
        setConnecting(false);
        return;
      }
      // Hand off to Suunto: the user authorizes there, then Suunto redirects
      // back to /api/suunto/callback which lands on Profile connected.
      window.location.href = data.url;
    } catch {
      setMessage("Could not reach the server. Please try again.");
      setConnecting(false);
    }
  }

  async function handleSync(full: boolean, limit: number | null = null) {
    setSyncing(true);
    setMessage(null);
    setNeedsReconnect(false);
    setQuotaHit(false);
    setRetryAfterSeconds(null);
    try {
      const params = new URLSearchParams();
      if (full) params.set("full", "1");
      if (limit !== null) params.set("limit", String(limit));
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/jobs/suunto-import${query}`, {
        method: "POST",
      });
      const data = await res.json();
      // Quota first: 429 or an explicit rateLimited flag means partial
      // progress was saved — stage the rest with ?limit=5. Never a
      // reconnect: quota is not a dead grant (the gateway reuses 401).
      const rateLimited =
        res.status === 429 ||
        data.rateLimited === true ||
        data.activities?.rateLimited === true ||
        data.health?.rateLimited === true;
      if (rateLimited) {
        const headerRetry = Number(res.headers.get("retry-after"));
        const retryAfter =
          typeof data.retryAfterSeconds === "number"
            ? data.retryAfterSeconds
            : typeof data.activities?.retryAfterSeconds === "number"
              ? data.activities.retryAfterSeconds
              : typeof data.health?.retryAfterSeconds === "number"
                ? data.health.retryAfterSeconds
                : Number.isFinite(headerRetry) && headerRetry > 0
                  ? Math.ceil(headerRetry)
                  : null;
        setQuotaHit(true);
        setRetryAfterSeconds(retryAfter);
        // needsReconnect stays false here by design.
        setMessage(
          `Suunto quota hit — partial progress saved. Wait ~${retryAfter ?? 60}s, then Sync next 5.`,
        );
        return;
      }
      if (!res.ok) {
        setMessage(data.error ?? "Sync failed. Please try again.");
        // 401 (or an explicit flag) means the stored grant is dead — offer
        // re-authorize inline instead of leaving the user with a dead Sync
        // button and no Connect button (Connect hides while `isConnected`).
        if (res.status === 401 || data.reconnect === true) {
          setNeedsReconnect(true);
        }
      } else {
        const a = data.activities;
        setMessage(
          `Synced ${a.imported} new, ${a.updated} updated (${a.duplicates} duplicates skipped, FIT on ${a.fitMerged}).` +
            (a.fitUnauthorized === true
              ? " Some workouts lack FIT detail: Suunto rejected the export even with a fresh token (check the API subscription/scopes in the Suunto API Zone, then Full resync)."
              : ""),
        );
      }
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="sync-controls">
      {isConnected ? (
        <div>
          <button
            className="checkin-button"
            onClick={() => handleSync(false)}
            disabled={syncing}
          >
            {syncing ? "Syncing…" : "Sync Suunto now"}
          </button>{" "}
          <button
            className="checkin-button"
            onClick={() => handleSync(true)}
            disabled={syncing}
            title="Whole history + past year of health (slow first run)"
          >
            {syncing ? "Syncing…" : "Full Suunto resync"}
          </button>
          {needsReconnect && (
            <button
              className="checkin-button"
              onClick={handleConnect}
              disabled={connecting}
              type="button"
              title="Re-authorize with Suunto (replaces the expired tokens)"
            >
              {connecting ? "Starting…" : "Reconnect Suunto"}
            </button>
          )}
          {quotaHit && (
            <button
              className="checkin-button"
              onClick={() => handleSync(false, 5)}
              disabled={syncing}
              type="button"
              title={
                retryAfterSeconds !== null
                  ? `Wait at least ${retryAfterSeconds}s after the quota hit, then continue in batches of 5`
                  : "Wait ~60s after the quota hit, then continue in batches of 5"
              }
            >
              {syncing ? "Syncing…" : "Sync next 5"}
            </button>
          )}
        </div>
      ) : (
        <div>
          <p className="subtle">Connect Suunto for automatic sync (OAuth — tokens stored, password never touches this app).</p>
          <button
            className="checkin-button"
            onClick={handleConnect}
            disabled={connecting}
            type="button"
          >
            {connecting ? "Starting…" : "Connect Suunto"}
          </button>
        </div>
      )}
      {message && <p className="sync-message subtle">{message}</p>}
    </div>
  );
}
