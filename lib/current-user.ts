import { cache } from "react";
import { getCurrentUser as getSessionUser } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";

// Session-backed current user. Returns null when logged out — every caller
// must handle the null case (pages redirect to /login, API routes 401,
// server actions return an error state).
//
// Wrapped in React's cache() so multiple Server Components in the same
// request (e.g. the root layout's chrome AND a page's own data fetching)
// share one DB lookup instead of each hitting Postgres separately.
export const getCurrentUser = cache(async function getCurrentUser(): Promise<SessionUser | null> {
  return getSessionUser();
});

export type { SessionUser };
