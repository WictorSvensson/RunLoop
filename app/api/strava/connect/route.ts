import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import {
  stravaConfig,
  STRAVA_AUTHORIZE_URL,
  STRAVA_SCOPE,
} from "@/lib/strava/config";

// GET /api/strava/connect
// Kicks off the OAuth flow by redirecting the user to Strava's consent screen.
export async function GET() {
  // CSRF protection: random state we verify on the callback.
  const state = randomBytes(16).toString("hex");

  const authorizeUrl = new URL(STRAVA_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", stravaConfig.clientId);
  authorizeUrl.searchParams.set("redirect_uri", stravaConfig.redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("approval_prompt", "auto");
  authorizeUrl.searchParams.set("scope", STRAVA_SCOPE);
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set("strava_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes
  });
  return response;
}
