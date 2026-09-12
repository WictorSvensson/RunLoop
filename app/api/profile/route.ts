import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/current-user";

// PATCH /api/profile { displayName, email, weightKg, timezone }
// All fields optional; empty strings clear nullable fields.
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

  const { displayName, email, weightKg, timezone } =
    (body as Record<string, unknown>) ?? {};

  const data: {
    displayName?: string | null;
    email?: string | null;
    weightKg?: number | null;
    timezone?: string | null;
  } = {};

  if (displayName !== undefined) {
    if (typeof displayName !== "string") {
      return NextResponse.json({ error: "Invalid display name." }, { status: 400 });
    }
    const trimmed = displayName.trim();
    if (trimmed.length > 60) {
      return NextResponse.json({ error: "Display name is too long." }, { status: 400 });
    }
    data.displayName = trimmed === "" ? null : trimmed;
  }

  if (email !== undefined) {
    if (typeof email !== "string") {
      return NextResponse.json({ error: "Invalid email." }, { status: 400 });
    }
    // Canonical lowercase so Foo@example.com and foo@example.com cannot
    // coexist as distinct rows (Postgres unique is case-sensitive).
    const trimmed = email.trim().toLowerCase();
    if (trimmed !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
    }
    data.email = trimmed === "" ? null : trimmed;
  }

  if (weightKg !== undefined) {
    if (weightKg === null || weightKg === "") {
      data.weightKg = null;
    } else {
      const num = typeof weightKg === "string" ? Number(weightKg) : weightKg;
      if (typeof num !== "number" || !Number.isFinite(num) || num <= 0 || num > 500) {
        return NextResponse.json({ error: "Invalid weight." }, { status: 400 });
      }
      data.weightKg = num;
    }
  }

  if (timezone !== undefined) {
    if (typeof timezone !== "string") {
      return NextResponse.json({ error: "Invalid timezone." }, { status: 400 });
    }
    const trimmed = timezone.trim();
    if (trimmed === "") {
      data.timezone = null;
    } else if (trimmed.length > 60 || !isKnownTimezone(trimmed)) {
      return NextResponse.json({ error: "Unknown timezone." }, { status: 400 });
    } else {
      data.timezone = trimmed;
    }
  }

  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: { id: true, username: true, displayName: true, email: true, weightKg: true, timezone: true },
    });
    return NextResponse.json({ user: updated });
  } catch (err) {
    // P2002: email already taken by another user.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
    }
    throw err;
  }
}

// IANA timezone check so garbage ("Mars/Olympus") never persists and breaks
// future scheduling/display logic that trusts the field.
function isKnownTimezone(value: string): boolean {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      return (Intl.supportedValuesOf("timeZone") as string[]).includes(value);
    }
  } catch {
    // Fall through to the Intl.DateTimeFormat probe below.
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
