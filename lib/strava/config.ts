// Centralized, validated access to Strava-related environment variables.
// Keeping this in one place means the rest of the code never touches
// process.env directly and we fail fast with a clear message if misconfigured.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to your .env file (see .env.example).`,
    );
  }
  return value;
}

export const stravaConfig = {
  get clientId(): string {
    return required("STRAVA_CLIENT_ID");
  },
  get clientSecret(): string {
    return required("STRAVA_CLIENT_SECRET");
  },
  get redirectUri(): string {
    return required("STRAVA_REDIRECT_URI");
  },
};

// Scope we request. `activity:read_all` is required to read private activities;
// `read` alone would exclude them. See Strava OAuth docs.
export const STRAVA_SCOPE = "activity:read_all";

// Strava OAuth + API endpoints.
export const STRAVA_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
export const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
export const STRAVA_API_BASE = "https://www.strava.com/api/v3";
