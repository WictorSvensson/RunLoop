import { cache } from "react";
import { prisma } from "@/lib/prisma";

// TEMPORARY: the app has no authentication yet. Until real auth lands, every
// request operates as a single "dev" user. Centralizing this here means the
// rest of the code already depends on a userId, so swapping in real auth later
// is a one-file change.
const DEV_USER_EMAIL = "dev@runloop.local";

// Wrapped in React's cache() so multiple Server Components in the same
// request (e.g. the dashboard layout's sidebar AND a page's own data
// fetching) share one upsert instead of each hitting Postgres separately.
export const getOrCreateCurrentUser = cache(async function getOrCreateCurrentUser() {
  return prisma.user.upsert({
    where: { email: DEV_USER_EMAIL },
    create: { email: DEV_USER_EMAIL },
    update: {},
  });
});
