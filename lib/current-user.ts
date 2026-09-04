import { prisma } from "@/lib/prisma";

// TEMPORARY: the app has no authentication yet. Until real auth lands, every
// request operates as a single "dev" user. Centralizing this here means the
// rest of the code already depends on a userId, so swapping in real auth later
// is a one-file change.
const DEV_USER_EMAIL = "dev@runloop.local";

export async function getOrCreateCurrentUser() {
  return prisma.user.upsert({
    where: { email: DEV_USER_EMAIL },
    create: { email: DEV_USER_EMAIL },
    update: {},
  });
}
