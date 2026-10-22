import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { buildAuthorizeUrl, SuuntoAuthError } from "@/lib/suunto/client";
import { isInternalRequestAuthorized } from "@/lib/http-auth";

// POST /api/suunto/connect — starts the Suunto OAuth2 authorization-code
// flow: returns the Suunto authorize URL the browser should navigate to.
// The per-user `state` is signed server-side (SESSION_SECRET, 10-min TTL)
// and verified in /api/suunto/callback. Same-origin or JOB_SECRET
// authorized like the import jobs; the client secret never leaves the server.
export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    const url = buildAuthorizeUrl(user.id);
    // TEMPORARY debug for persistent Suunto 400 invalid_request client_id:
    // log URL shape only — host/path/param names, client_id length + prefix,
    // redirect_uri value (not secret). Never log full client_id, state, or
    // any secret. Remove once the 400 is resolved.
    try {
      const parsed = new URL(url);
      const clientId = parsed.searchParams.get("client_id") ?? "";
      console.log("Suunto authorize URL shape:", {
        host: parsed.host,
        path: parsed.pathname,
        params: [...parsed.searchParams.keys()],
        response_type: parsed.searchParams.get("response_type"),
        client_id_len: clientId.length,
        client_id_prefix: clientId.slice(0, 4),
        redirect_uri: parsed.searchParams.get("redirect_uri"),
        has_state: parsed.searchParams.has("state"),
        state_len: parsed.searchParams.get("state")?.length ?? 0,
      });
    } catch {
      console.log("Suunto authorize URL unparseable (should never happen).");
    }
    return NextResponse.json({ ok: true, url });
  } catch (err) {
    if (err instanceof SuuntoAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    // Fail-closed config (missing SUUNTO_* env) lands here — loud, not silent.
    console.error("Suunto connect failed:", err);
    const message =
      err instanceof Error && /SUUNTO_.*is not set/.test(err.message)
        ? "Suunto sync is not configured on this server (missing SUUNTO_* env). See .env.example."
        : "Could not start Suunto connect.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
