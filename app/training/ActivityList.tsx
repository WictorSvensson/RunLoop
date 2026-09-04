"use client";

import { useRef, useState } from "react";
import type { ActivityDTO } from "@/lib/strava/enrich";

// ---------------------------------------------------------------------------
// Formatting helpers (client-side; mirror the server formatters).
// ---------------------------------------------------------------------------
function formatDistance(meters: number | null): string {
  if (meters == null) return "—";
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatPace(metersPerSecond: number | null): string {
  if (!metersPerSecond || metersPerSecond <= 0) return "—";
  const secPerKm = 1000 / metersPerSecond;
  let m = Math.floor(secPerKm / 60);
  let s = Math.round(secPerKm % 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatHr(bpm: number | null): string {
  if (bpm == null) return "";
  return `${Math.round(bpm)} bpm`;
}

function formatDate(iso: string): string {
  // Pin locale + timezone so the server and client render identical text
  // (otherwise SSR uses the server's locale/UTC and the browser uses the user's,
  // causing a hydration mismatch).
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function toneFor(type: string | null): string {
  const t = (type ?? "").toLowerCase();
  if (t.includes("trail") || t.includes("long")) return "long";
  if (t.includes("walk") || t.includes("hike")) return "recovery";
  return "easy";
}

// One row + its expandable detail panel.
function ActivityRow({ activity }: { activity: ActivityDTO }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ActivityDTO | null>(
    activity.detailFetched ? activity : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false); // synchronous guard against double-fetch
  const panelId = `activity-panel-${activity.id}`;

  const tone = toneFor(activity.type);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Fetch detail on first open only. useRef guard is synchronous, so a rapid
    // double-click can't start two fetches before state updates commit.
    if (next && detail === null && !inFlight.current) {
      inFlight.current = true;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/activities/${activity.id}`);
        const data = await res.json();
        if (!res.ok) setError(data.error ?? "Could not load details.");
        else setDetail(data.activity as ActivityDTO);
      } catch {
        setError("Could not reach the server.");
      } finally {
        setLoading(false);
        inFlight.current = false;
      }
    }
  }

  return (
    <div className={`activity-item ${open ? "open" : ""}`}>
      <button
        className="table-row activity-row-button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <div className="activity-detail">
          <div className={`activity-icon ${tone}`}>
            {tone === "long" ? "↗" : tone === "recovery" ? "◌" : "∿"}
          </div>
          <div>
            <strong>{activity.name ?? activity.type ?? "Run"}</strong>
            <span>{formatDate(activity.startDate)}</span>
          </div>
        </div>
        <span>{formatDistance(activity.distance)}</span>
        <span>{formatDuration(activity.movingTime)}</span>
        <span>
          {formatPace(activity.averageSpeed)}{" "}
          <small>{formatHr(activity.averageHeartrate)}</small>
        </span>
      </button>

      {open && (
        <div className="activity-panel" id={panelId} role="region">
          {loading && <p className="subtle">Loading details from Strava…</p>}
          {error && <p className="subtle activity-panel-error">{error}</p>}
          {detail && !loading && <ActivityDetailPanel detail={detail} />}
        </div>
      )}
    </div>
  );
}

function ActivityDetailPanel({ detail }: { detail: ActivityDTO }) {
  const stats: { label: string; value: string }[] = [];

  if (detail.totalElevationGain != null)
    stats.push({ label: "Elevation", value: `${Math.round(detail.totalElevationGain)} m` });
  if (detail.maxHeartrate != null)
    stats.push({ label: "Max HR", value: `${Math.round(detail.maxHeartrate)} bpm` });
  if (detail.averageCadence != null)
    stats.push({ label: "Cadence", value: `${Math.round(detail.averageCadence)} spm` });
  if (detail.averageWatts != null)
    stats.push({ label: "Avg power", value: `${Math.round(detail.averageWatts)} W` });
  if (detail.maxWatts != null)
    stats.push({ label: "Max power", value: `${detail.maxWatts} W` });
  if (detail.calories != null)
    stats.push({ label: "Calories", value: `${Math.round(detail.calories)}` });
  if (detail.averageTemp != null)
    stats.push({ label: "Temp", value: `${detail.averageTemp}°C` });
  if (detail.elapsedTime != null)
    stats.push({ label: "Elapsed", value: formatDuration(detail.elapsedTime) });

  return (
    <div className="activity-panel-inner">
      {stats.length > 0 ? (
        <div className="activity-stats">
          {stats.map((s) => (
            <div key={s.label}>
              <span>{s.label}</span>
              <strong>{s.value}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="subtle">No extra details available for this activity.</p>
      )}

      {detail.gearName && (
        <p className="subtle activity-panel-meta">Shoes: {detail.gearName}</p>
      )}
      {detail.deviceName && (
        <p className="subtle activity-panel-meta">Recorded with {detail.deviceName}</p>
      )}
      {detail.description && (
        <p className="activity-panel-description">{detail.description}</p>
      )}
    </div>
  );
}

export function ActivityList({ activities }: { activities: ActivityDTO[] }) {
  return (
    <div className="activity-table">
      <div className="table-header">
        <span>Activity</span>
        <span>Distance</span>
        <span>Duration</span>
        <span>Pace / HR</span>
      </div>
      {activities.map((activity) => (
        <ActivityRow key={activity.id} activity={activity} />
      ))}
    </div>
  );
}
