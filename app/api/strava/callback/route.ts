import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { exchangeCodeForTokens } from "@/lib/strava/client";

// GET /api/strava/callback?code=...&state=...&scope=...
// Strava redirects here after the user approves (or denies) access.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const trainingUrl = new URL("/training", request.nextUrl.origin);

  // User denied access, or Strava returned an error.
  const error = searchParams.get("error");
  if (error) {
    trainingUrl.searchParams.set("strava", "denied");
    return NextResponse.redirect(trainingUrl);
  }

  // Verify CSRF state against the cookie we set in /connect.
  const state = searchParams.get("state");
  const cookieState = request.cookies.get("strava_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) {
    trainingUrl.searchParams.set("strava", "invalid_state");
    return NextResponse.redirect(trainingUrl);
  }

  const code = searchParams.get("code");
  if (!code) {
    trainingUrl.searchParams.set("strava", "no_code");
    return NextResponse.redirect(trainingUrl);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const user = await getOrCreateCurrentUser();

    const athleteId = tokens.athlete?.id;
    if (!athleteId) {
      throw new Error("Strava did not return an athlete id");
    }

    const connectionData = {
      athleteId: BigInt(athleteId),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expires_at * 1000),
      scope: tokens.scope ?? null,
    };

    await prisma.stravaConnection.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...connectionData },
      update: connectionData,
    });

    trainingUrl.searchParams.set("strava", "connected");
  } catch {
    trainingUrl.searchParams.set("strava", "error");
  }

  const response = NextResponse.redirect(trainingUrl);
  response.cookies.delete("strava_oauth_state");
  return response;
}
