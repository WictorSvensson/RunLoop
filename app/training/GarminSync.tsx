"use client";

import { useState } from "react";

interface Props {
  isConnected: boolean;
  username?: string | null;
  status?: string;
  defaultUsername?: string;
}

// Client-side controls for connecting Garmin (unofficial API) and
// triggering an import. Rendered on the Training page next to StravaSync —
// a user connects whichever brand(s) they own.
export function GarminSync({ isConnected, username, status, defaultUsername }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [email, setEmail] = useState(defaultUsername ?? "");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(bannerFor(status));

  async function handleConnect(event: React.FormEvent) {
    event.preventDefault();
    setConnecting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/garmin/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Could not connect to Garmin.");
      } else {
        // Password stays in memory only — clear it the moment login succeeds.
        setPassword("");
        setMessage(
          `Garmin connected${data.displayName ? ` (${data.displayName})` : ""}. Click “Sync now” to import.`,
        );
      }
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      // Password is memory-only: clear it on failure too, not just success.
      setPassword("");
      setConnecting(false);
    }
  }

  async function handleSync(full: boolean) {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/jobs/garmin-import${full ? "?full=1" : ""}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Sync failed. Please try again.");
      } else {
        const a = data.activities;
        setMessage(
          `Synced ${a.imported} new, ${a.updated} updated (${a.duplicates} duplicates skipped, FIT on ${a.fitMerged}).`,
        );
      }
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="strava-sync">
      {isConnected ? (
        <div>
          <button
            className="checkin-button"
            onClick={() => handleSync(false)}
            disabled={syncing}
          >
            {syncing ? "Syncing…" : "Sync Garmin now"}
          </button>{" "}
          <button
            className="checkin-button"
            onClick={() => handleSync(true)}
            disabled={syncing}
            title="Whole history + past year of health (slow first run)"
          >
            {syncing ? "Syncing…" : "Full Garmin resync"}
          </button>
          {username && <p className="subtle">Connected as {username}.</p>}
        </div>
      ) : (
        <form onSubmit={handleConnect}>
          <p className="subtle">Connect Garmin (unofficial API — password is used once, never stored).</p>
          <input
            type="email"
            placeholder="Garmin email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />{" "}
          <input
            type="password"
            placeholder="Garmin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />{" "}
          <button className="checkin-button" type="submit" disabled={connecting}>
            {connecting ? "Connecting…" : "Connect Garmin"}
          </button>
        </form>
      )}
      {message && <p className="strava-sync-message subtle">{message}</p>}
    </div>
  );
}

function bannerFor(status?: string): string | null {
  switch (status) {
    case "connected":
      return "Garmin connected. Click “Sync now” to import your activities.";
    case "error":
      return "Something went wrong connecting to Garmin. Please try again.";
    default:
      return null;
  }
}
