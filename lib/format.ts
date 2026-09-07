// Shared formatting helpers for activity/training data. Used by both server
// components (dashboard) and client components (ActivityList) so the two
// never drift apart. Pin locale + timeZone everywhere dates are formatted so
// SSR and client render identical text (avoids hydration mismatches).

export function formatDistance(meters: number | null): string {
  if (meters == null) return "—";
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function formatPace(metersPerSecond: number | null): string {
  if (!metersPerSecond || metersPerSecond <= 0) return "—";
  return formatPaceFromSecPerKm(1000 / metersPerSecond);
}

// Same mm:ss formatting as formatPace, but for values already expressed as
// seconds/km (e.g. lib/dashboard/aggregate.ts's pace-trend helpers), rather
// than meters/second.
export function formatPaceFromSecPerKm(secPerKm: number | null): string {
  if (!secPerKm || secPerKm <= 0) return "—";
  let m = Math.floor(secPerKm / 60);
  let s = Math.round(secPerKm % 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatHr(bpm: number | null): string {
  if (bpm == null) return "";
  return `${Math.round(bpm)} bpm`;
}

export function formatDate(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function toneFor(type: string | null): string {
  const t = (type ?? "").toLowerCase();
  if (t.includes("trail") || t.includes("long")) return "long";
  if (t.includes("walk") || t.includes("hike")) return "recovery";
  return "easy";
}

// Best-effort display name until real auth/profile fields exist — falls back
// to the local part of the account email rather than a hardcoded name. Used
// by the shared dashboard chrome (Sidebar/Topbar) as well as the Dashboard
// page's greeting copy.
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}
