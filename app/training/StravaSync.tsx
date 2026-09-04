"use client";

import { useState } from "react";

interface Props {
  isConnected: boolean;
  status?: string;
}

// Client-side controls for connecting Strava and triggering an import.
// Rendered on the Training page.
export function StravaSync({ isConnected, status }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(bannerFor(status));

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/jobs/strava-import", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Sync failed. Please try again.");
      } else {
        setMessage(
          `Synced ${data.imported} new and ${data.updated} updated activities.`,
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
        <button
          className="checkin-button"
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      ) : (
        <a className="checkin-button" href="/api/strava/connect">
          Connect Strava
        </a>
      )}
      {message && <p className="strava-sync-message subtle">{message}</p>}
    </div>
  );
}

function bannerFor(status?: string): string | null {
  switch (status) {
    case "connected":
      return "Strava connected. Click “Sync now” to import your activities.";
    case "denied":
      return "Strava access was denied.";
    case "invalid_state":
      return "Security check failed. Please try connecting again.";
    case "no_code":
    case "error":
      return "Something went wrong connecting to Strava. Please try again.";
    default:
      return null;
  }
}
