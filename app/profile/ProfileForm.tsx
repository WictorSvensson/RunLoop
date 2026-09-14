"use client";

import { useState } from "react";

type Initial = {
  displayName: string;
  email: string;
  weightKg: string;
  timezone: string;
};

// Client form for the basics-only profile (display name, email, weight,
// timezone). Empty fields clear the stored value.
export function ProfileForm({ initial }: { initial: Initial }) {
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof Initial>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus(null);
    setPending(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: form.displayName,
          email: form.email,
          weightKg: form.weightKg.trim() === "" ? null : form.weightKg,
          timezone: form.timezone,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus({ kind: "error", text: data.error ?? "Could not save. Please try again." });
        return;
      }
      setStatus({ kind: "ok", text: "Profile saved." });
    } catch {
      setStatus({ kind: "error", text: "Could not save. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="checkin-form profile-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          Display name
          <input
            value={form.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            placeholder="Wictor"
            maxLength={60}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label>
          Weight (kg)
          <input
            inputMode="decimal"
            value={form.weightKg}
            onChange={(e) => set("weightKg", e.target.value)}
            placeholder="75.2"
          />
        </label>
        <label>
          Timezone
          <input
            value={form.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            placeholder="Europe/Stockholm"
            maxLength={60}
          />
        </label>
      </div>
      <div className="form-footer">
        <span>
          {status ? (
            <span className={status.kind === "ok" ? "save-ok" : "save-error"}>{status.text}</span>
          ) : (
            "Your info stays in your loop."
          )}
        </span>
        <button className="save-button" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}
