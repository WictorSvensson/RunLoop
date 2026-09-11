import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { connectGarmin, saveGarminTokens, GarminAuthError } from "@/lib/garmin/client";
import { isInternalRequestAuthorized } from "@/lib/http-auth";

// POST /api/garmin/connect { username, password }
// One-time credential exchange: logs into Garmin Connect, persists only the
// exported token pair, and never stores or logs the password. Same-origin or
// JOB_SECRET authorized like the import jobs.
export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || username.length === 0 || typeof password !== "string" || password.length === 0) {
    return NextResponse.json(
      { error: "Garmin email and password are required." },
      { status: 400 },
    );
  }

  try {
    const user = await getOrCreateCurrentUser();
    const { tokens, garminUserId, displayName } = await connectGarmin(username, password);
    await saveGarminTokens(user.id, tokens, { garminUserId, username });
    return NextResponse.json({ ok: true, displayName });
  } catch (err) {
    if (err instanceof GarminAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("Garmin connect failed:", err);
    return NextResponse.json({ error: "Could not connect to Garmin." }, { status: 500 });
  }
}
