import { NextRequest, NextResponse } from "next/server";

// Route gate: the login page is the first thing a visitor sees.
// Middleware only checks cookie *presence* (edge-safe); the actual HMAC
// verification happens in lib/auth on the server. Forged/expired cookies fail
// there and pages render/redirect accordingly.
//
// NOTE: this middleware deliberately does NOT redirect cookie-holders away
// from /login. The login page itself (server-side) redirects only holders of
// a *valid* session. Redirecting on mere presence here would loop forever
// for forged/expired cookies: / -> page -> /login -> / -> ...
const PROTECTED_PREFIXES = ["/training", "/check-in", "/analytics", "/coach", "/profile"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("runloop_session");

  const isProtected =
    pathname === "/" || PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isProtected && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/training/:path*", "/check-in/:path*", "/analytics/:path*", "/coach/:path*", "/profile/:path*"],
};
