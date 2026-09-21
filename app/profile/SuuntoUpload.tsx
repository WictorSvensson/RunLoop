"use client";

import { useRef, useState } from "react";

type UploadResult = {
  imported: number;
  updated: number;
  skipped: number;
  byType: Record<string, number>;
  sleepDays: number;
};

type Status =
  | { kind: "idle" }
  | { kind: "uploading"; label: string }
  | { kind: "ok"; result: UploadResult }
  | { kind: "error"; text: string };

// Suunto history upload: the original export .zip from the Suunto app.
// Parsing + import run server-side (/api/suunto/upload); this component only
// collects the file and reports the summary. Re-uploads are idempotent
// (upsert on filename stem), so topping up later with a fresh export is safe.
// Rendered only while the Suunto toggle is on (the parent hides this whole
// block when off); the server also rejects uploads with a 403 when off.
export function SuuntoUpload() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setStatus({ kind: "error", text: "Choose the Suunto export .zip first." });
      return;
    }
    setStatus({ kind: "uploading", label: file.name });
    try {
      const form = new FormData();
      form.append("zip", file, file.name);
      const res = await fetch("/api/suunto/upload", { method: "POST", body: form });
      let data: (Partial<UploadResult> & { error?: string }) | null = null;
      try {
        data = (await res.json()) as Partial<UploadResult> & { error?: string };
      } catch {
        data = null;
      }
      if (!res.ok) {
        setStatus({ kind: "error", text: data?.error ?? "Upload failed. Please try again." });
        return;
      }
      setStatus({
        kind: "ok",
        result: {
          imported: data?.imported ?? 0,
          updated: data?.updated ?? 0,
          skipped: data?.skipped ?? 0,
          byType: data?.byType ?? {},
          sleepDays: data?.sleepDays ?? 0,
        },
      });
    } catch {
      setStatus({ kind: "error", text: "Upload failed. Please try again." });
    }
  }

  return (
    <div className="suunto-upload">
      <input
        ref={fileRef}
        id="suunto-zip"
        type="file"
        accept=".zip,application/zip"
        className="suunto-file-input"
        onChange={(e) => {
          setFileName(e.target.files?.[0]?.name ?? null);
          setStatus({ kind: "idle" });
        }}
      />
      {fileName && <p className="suunto-file-name">{fileName}</p>}
      <div className="suunto-actions">
        <label className="checkin-button connection-button suunto-pick" htmlFor="suunto-zip">
          Choose file
        </label>
        <button
          className="checkin-button"
          type="button"
          onClick={onUpload}
          disabled={status.kind === "uploading" || !fileName}
        >
          {status.kind === "uploading" ? "Uploading…" : "Upload & import"}
        </button>
      </div>
      {status.kind === "uploading" && (
        <p className="suunto-status">Importing {status.label} — this can take a while for large histories…</p>
      )}
      {status.kind === "error" && (
        <p className="suunto-status suunto-error" role="alert">
          {status.text}
        </p>
      )}
      {status.kind === "ok" && (
        <p className="suunto-status suunto-ok" role="status">
          Imported {status.result.imported} new · updated {status.result.updated} · skipped{" "}
          {status.result.skipped} · sleep days {status.result.sleepDays}.
        </p>
      )}
    </div>
  );
}
