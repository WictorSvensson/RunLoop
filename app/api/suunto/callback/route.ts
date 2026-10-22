import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  saveSuuntoTokens,
  suuntoUserFromJwt,
  verifyOAuthState,
  SuuntoAuthError,
} from "@/lib/suunto/client";
import { setIntegrationEnabled } from "@/lib/integrations";

// GET /api/suunto/callback?code=…&state=… — Suunto redirects here after the
// user authorizes. `state` (signed in /api/suunto/connect, 10-min TTL)
// identifies the user — this cross-site navigation cannot satisfy the
// same-origin internal gate, so the HMAC-bound state IS the authorization.
// Success saves tokens, re-enables the SUUNTO integration, and lands on
// Profile; every failure lands on Profile too, with a generic reason code
// (never tokens, codes, or endpoint detail in the URL).
export const dynamic = "force-dynamic";

function profileRedirect(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL("/profile", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  if (error) {
    return profileRedirect(request, { suunto: "denied" });
  }

  let userId: string | null = null;
  try {
    userId = verifyOAuthState(state);
  } catch {
    userId = null;
  }
  if (!userId || !code) {
    return profileRedirect(request, { suunto: "expired" });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const suuntoUserId = suuntoUserFromJwt(tokens.access_token);
    await saveSuuntoTokens(userId, tokens, { suuntoUserId, username: suuntoUserId });
    // A fresh connect implies the user wants Suunto sync on — clear a
    // previous toggle-off so sync works immediately without a second click.
    await setIntegrationEnabled(userId, "SUUNTO", true);
    return profileRedirect(request, { suunto: "connected" });
  } catch (err) {
    if (err instanceof SuuntoAuthError) {
      console.warn("Suunto callback token exchange failed:", err.message);
    } else {
      console.error("Suunto callback failed:", err);
    }
    return profileRedirect(request, { suunto: "failed" });
  }
}
