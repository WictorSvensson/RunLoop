"use client";

import { useState } from "react";

// The check-in modal is kept as a small client island so the dashboard page
// itself can be an async Server Component. Persistence is not wired up yet —
// no Server Action / route exists for DailyCheckin writes (see app/check-in/page.tsx,
// which has the same limitation). Closing on "Save" mirrors that existing stub.
export function CheckInModal() {
  const [open, setOpen] = useState(false);
  const [energy, setEnergy] = useState(4);

  return (
    <>
      <button className="checkin-button" onClick={() => setOpen(true)}>
        <span>+</span> Daily check-in
      </button>

      {open && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            className="checkin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkin-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
            <p className="eyebrow">
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
            <h2 id="checkin-title">How are you feeling today?</h2>
            <p className="modal-copy">
              A quick pulse check. No scores, no judgement.
            </p>
            <label>
              Weight
              <input placeholder="75.2 kg" />
            </label>
            <label>
              Sleep
              <input placeholder="7h 12m" />
            </label>
            <label>
              Energy
              <div className="choice-row">
                {[1, 2, 3, 4, 5].map((number) => (
                  <button
                    key={number}
                    type="button"
                    className={number === energy ? "selected" : ""}
                    onClick={() => setEnergy(number)}
                  >
                    {number}
                  </button>
                ))}
              </div>
            </label>
            <button className="save-button" onClick={() => setOpen(false)}>
              Save check-in
            </button>
          </div>
        </div>
      )}
    </>
  );
}
