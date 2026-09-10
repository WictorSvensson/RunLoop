"use client";

import { useActionState } from "react";
import { generateCoachBrief, type GenerateActionState } from "./actions";

// NOTE: the initial state must be defined in this client module — plain
// values imported from a `"use server"` module are stripped and arrive as
// undefined on the client.
const INITIAL_STATE: GenerateActionState = { ok: false, message: "" };

interface Props {
  configured: boolean;
  hasBrief: boolean;
}

export function GenerateButton({ configured, hasBrief }: Props) {
  const [state, formAction, isPending] = useActionState(
    generateCoachBrief,
    INITIAL_STATE,
  );

  return (
    <div className="coach-generate">
      <form action={formAction}>
        <button
          className="checkin-button"
          type="submit"
          disabled={isPending || !configured}
          aria-busy={isPending}
        >
          {isPending
            ? "Generating…"
            : hasBrief
              ? "Generate new analysis"
              : "Generate analysis"}
        </button>
      </form>
      {!configured && (
        <p className="subtle">
          AI coaching is not configured. Set FOUNDRY_ENDPOINT, FOUNDRY_API_KEY
          and FOUNDRY_DEPLOYMENT.
        </p>
      )}
      {state.message && (
        <p
          className={state.ok ? "generate-success" : "field-error"}
          role="status"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
