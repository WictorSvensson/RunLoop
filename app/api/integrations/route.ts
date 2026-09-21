import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import {
  isIntegrationSource,
  setIntegrationEnabled,
} from "@/lib/integrations";

// PATCH /api/integrations { source: "GARMIN" | "SUUNTO", enabled: boolean }
// Per-user on/off switch. Upserts the IntegrationSetting row; missing rows
// read as enabled elsewhere, so toggling on after off (or never touching
// the toggle) both just work. Scoped by session user id.
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { source, enabled } = (body ?? {}) as {
    source?: unknown;
    enabled?: unknown;
  };
  if (!isIntegrationSource(source)) {
    return NextResponse.json(
      { error: "Unknown integration source." },
      { status: 400 },
    );
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json(
      { error: "Enabled must be true or false." },
      { status: 400 },
    );
  }

  const result = await setIntegrationEnabled(user.id, source, enabled);
  return NextResponse.json({ ok: true, ...result });
}
