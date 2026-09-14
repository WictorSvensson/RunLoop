import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";

// GET /api/auth/me — session user for client components.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user });
}
