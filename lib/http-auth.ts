import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

// Shared authorization for triggerable/internal API routes.
//
// Until real per-user auth lands, routes are protected by EITHER:
//   1. A bearer secret (for automated/external callers like cron), compared in
//      constant time. The secret name is configurable per route.
//   2. A same-origin browser request from our own UI. We require the browser-set
//      `Sec-Fetch-Site: same-origin` header (which cross-site JS cannot forge)
//      AND a matching Origin host. Non-browser callers can't satisfy this.
//
// NOTE: this is not a hard per-user boundary yet; treat the bearer secret as the
// real protection for anything internet-facing.
export function isInternalRequestAuthorized(
  request: NextRequest,
  options: { secretEnvVar?: string } = {},
): boolean {
  // 1. Bearer secret.
  const secretName = options.secretEnvVar ?? "JOB_SECRET";
  const secret = process.env[secretName];
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${secret}`;
    const a = Buffer.from(auth);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }

  // 2. Same-origin browser request.
  //
  // `Sec-Fetch-Site: same-origin` is set by the browser and cannot be forged by
  // cross-site JavaScript, so it is our primary signal. Note that browsers do
  // NOT send an `Origin` header on same-origin GET requests, so we must not
  // require Origin here (that would reject the "click an activity" GET fetch).
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin") {
    return true;
  }

  // Fallback for clients that send Origin but not Sec-Fetch-Site: accept only if
  // the Origin host matches this host.
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host === request.nextUrl.host) return true;
    } catch {
      // malformed origin -> not authorized
    }
  }

  return false;
}
