// Centralized Garmin Connect (unofficial API) configuration.
// The password is NEVER an env var and NEVER stored: it is supplied once at
// connect time (form / one-off CLI) and traded for tokens immediately.

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const garminConfig = {
  /** Login email hint for single-user dev (defaults the connect form). */
  get username(): string | undefined {
    return optional("GARMIN_USERNAME");
  },
};

// Duplicate-match windows, re-exported from the canonical definition in
// lib/analysis/duplicate.ts — one source of truth, not three literal copies.
export { DUP_START_WINDOW_S as GARMIN_DUP_START_WINDOW_S } from "@/lib/analysis/duplicate";
export { DUP_ELAPSED_TOLERANCE_S as GARMIN_DUP_ELAPSED_TOLERANCE_S } from "@/lib/analysis/duplicate";
