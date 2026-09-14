import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  normalizeUsername,
  signSessionValue,
  verifyDummyPassword,
  verifyPassword,
  verifySessionValue,
  SESSION_MAX_AGE_SECONDS,
  hashPassword,
} from "@/lib/auth-crypto";

// Server-side auth entry point (session cookies + DB lookup). Pure crypto
// lives in auth-crypto.ts; this module re-exports it so callers can import
// everything from "@/lib/auth".
//
// Conscious limitation: sessions are stateless (no server-side store; only
// the user row is re-checked). Logout clears the browser cookie but cannot
// revoke a copied token before its 30-day expiry, and there is no throttling
// on the login route. Both are acceptable for a local 2-user app — revisit
// (server-side sessions/blocklist + rate limiting) before internet exposure.

export {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  hashPassword,
  normalizeUsername,
  signSessionValue,
  verifyDummyPassword,
  verifyPassword,
  verifySessionValue,
};

export type SessionUser = {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
};

// Uncached lookup. Prefer the React-cached wrapper in lib/current-user.ts —
// it is the single entry point for server components, actions, and routes.
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const session = verifySessionValue(raw);
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, username: true, displayName: true, email: true },
  });
  return user;
}
