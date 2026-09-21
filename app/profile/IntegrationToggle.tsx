"use client";

import { useState } from "react";
import type { IntegrationSource } from "@/lib/integrations";

interface Props {
  source: IntegrationSource;
  enabled: boolean;
  label: string;
  onChange?: (enabled: boolean) => void;
}

// Generic on/off switch for one training-data integration. Shared by every
// source (Garmin, Suunto, future Coros/…) — new integrations reuse it as-is
// with just a different `source` prop. Fully controlled by the parent
// (single source of truth, so server-driven changes like a Garmin reconnect
// re-enabling the integration always render correctly). Optimistic flip with
// rollback on failure; persists via PATCH /api/integrations.
export function IntegrationToggle({ source, enabled, label, onChange }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    if (pending) return;
    const next = !enabled;
    onChange?.(next);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, enabled: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        // Roll back the optimistic flip so the switch never lies.
        onChange?.(!next);
        setError(data.error ?? "Could not save. Please try again.");
      }
    } catch {
      onChange?.(!next);
      setError("Could not save. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="integration-toggle-wrap">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        className={`integration-toggle${enabled ? " is-on" : ""}`}
        onClick={flip}
        disabled={pending}
        title={enabled ? `Turn ${label} off` : `Turn ${label} on`}
      >
        <span className="integration-toggle-knob" aria-hidden="true" />
      </button>
      {error && (
        <span className="integration-toggle-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
