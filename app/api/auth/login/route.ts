import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  normalizeUsername,
  signSessionValue,
  verifyDummyPassword,
  verifyPassword,
} from "@/lib/auth";

// POST /api/auth/login { username, password }
// Case-insensitive username match. Sets a signed persistent session cookie.
// Note: no rate limiting yet (2-user local app) — add throttling before any
// internet exposure.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { username, password } =
    (body as { username?: unknown; password?: unknown }) ?? {};

  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "Username and password are required." },
      { status: 400 },
    );
  }

  const canonical = normalizeUsername(username);
  // Length caps double as a CPU-DoS guard (scrypt cost scales with input).
  if (!canonical || canonical.length > 64 || !password || password.length > 256) {
    return NextResponse.json(
      { error: "Username and password are required." },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { username: canonical },
  });

  // Generic error to avoid leaking which usernames exist. Unknown users pay
  // for a dummy scrypt verification so both paths cost the same (no timing
  // oracle for username enumeration).
  if (!user) {
    await verifyDummyPassword(password);
    return NextResponse.json(
      { error: "Invalid username or password." },
      { status: 401 },
    );
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json(
      { error: "Invalid username or password." },
      { status: 401 },
    );
  }

  const expiresAtMs = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const response = NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
    },
  });
  response.cookies.set(SESSION_COOKIE, signSessionValue(user.id, expiresAtMs), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
