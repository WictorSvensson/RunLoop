import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

// POST /api/auth/logout — clears the session cookie.
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
