import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// FIT-download quota must abort the sync gracefully: the Suunto gateway
// reports rate limits as 401 + "Rate limit is exceeded (RateLimitExceeded)"
// (sometimes 429), and a FIT 401 must NOT trigger a token refresh. Expected:
// partial progress already saved via upserts is kept, no further FITs are
// attempted, lastSyncedAt is NOT advanced past the unprocessed rows, and the
// result carries rateLimited:true (+ Retry-After seconds when sent) so the
// job route answers 429 instead of 500.
const store = vi.hoisted(() => ({
  tokenJson: null as string | null,
  activities: new Map<string, { id: string }>(),
  connectionUpdates: 0,
  activityIdSeq: 0,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    suuntoConnection: {
      findUnique: async () => (store.tokenJson ? { tokenJson: store.tokenJson } : null),
      upsert: async (args: { create: { tokenJson: string }; update: { tokenJson: string } }) => {
        store.tokenJson = args.update?.tokenJson ?? args.create.tokenJson;
        return {};
      },
      update: async () => {
        store.connectionUpdates++;
        return {};
      },
    },
    activity: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      upsert: async (args: {
        where: { userId_source_externalId: { externalId: string } };
      }) => {
        const key = args.where.userId_source_externalId.externalId;
        const row = { id: `activity-${++store.activityIdSeq}` };
        store.activities.set(key, row);
        return row;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        activityLap: { deleteMany: async () => ({}), createMany: async () => ({}) },
        activityStream: { upsert: async () => ({}) },
      }),
  },
}));

import { importSuuntoActivities } from "./import";

const TEST_ENV = {
  DATABASE_URL: "postgresql://localhost:5432/runloop_test",
  SESSION_SECRET: "x".repeat(64),
  SUUNTO_CLIENT_ID: "test-client-id",
  SUUNTO_CLIENT_SECRET: "test-client-secret",
  SUUNTO_SUBSCRIPTION_KEY: "test-subscription-key",
  SUUNTO_REDIRECT_URI: "http://localhost:3000/api/suunto/callback",
} as const;

const savedEnv: Record<string, string | undefined> = {};

// Newest-first import order is enforced by the importer (list order is
// untrusted), so wkey-1 imports, wkey-2 hits quota, wkey-3 is never attempted.
function workout(key: string, startTime: number) {
  return {
    workoutKey: key,
    workoutName: `Run ${key}`,
    activityId: 11,
    startTime,
    totalTime: 3600,
    totalDistance: 10000,
  };
}

function listResponse(workouts: unknown[]) {
  return Response.json({ error: null, metadata: {}, payload: workouts });
}

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  store.tokenJson = JSON.stringify({
    access_token: "at-1",
    refresh_token: "rt-1",
    obtained_at_ms: Date.now(),
    expires_in: 86400,
  });
  store.activities.clear();
  store.connectionUpdates = 0;
  store.activityIdSeq = 0;
});

afterEach(() => {
  for (const k of Object.keys(TEST_ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Suunto FIT rate-limit aborts gracefully with partial progress", () => {
  it("401 + RateLimitExceeded on the 2nd FIT keeps row 1, skips row 3, advances no watermark", async () => {
    const fetchedHrefs: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        fetchedHrefs.push(href);
        if (href.includes("/oauth/token")) throw new Error("token endpoint must not be hit on quota");
        if (href.includes("/fit")) {
          if (href.includes("wkey-2")) {
            return new Response("Rate limit is exceeded (RateLimitExceeded)", { status: 401 });
          }
          return new Response(new Uint8Array([0x01, 0x02, 0x03]));
        }
        if (href.includes("/v3/workouts")) {
          // Deliberately unsorted: the importer sorts newest-first itself.
          return listResponse([
            workout("wkey-3", 1750000000),
            workout("wkey-1", 1750200000),
            workout("wkey-2", 1750100000),
          ]);
        }
        throw new Error(`unexpected fetch: ${href}`);
      }),
    );

    const result = await importSuuntoActivities("user-1", { fullResync: true });

    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterSeconds).toBeNull();
    expect(result.imported).toBe(1);
    expect(result.pagesFetched).toBe(1);
    // Partial progress: only the pre-quota row was saved.
    expect([...store.activities.keys()]).toEqual(["wkey-1"]);
    // No further FITs after quota (wkey-3 never attempted) and no refresh.
    expect(fetchedHrefs.some((h) => h.includes("wkey-3") && h.includes("/fit"))).toBe(false);
    expect(fetchedHrefs.some((h) => h.includes("/oauth/token"))).toBe(false);
    // Watermark untouched so the next run resumes at the unprocessed rows.
    expect(store.connectionUpdates).toBe(0);
  });

  it("429 + Retry-After on a FIT propagates the wait hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        if (href.includes("/fit")) {
          return new Response("slow down", { status: 429, headers: { "retry-after": "45" } });
        }
        if (href.includes("/v3/workouts")) return listResponse([workout("wkey-9", 1750200000)]);
        throw new Error(`unexpected fetch: ${href}`);
      }),
    );

    const result = await importSuuntoActivities("user-1", { fullResync: true });

    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterSeconds).toBe(45);
    expect(result.imported).toBe(0);
    expect(store.connectionUpdates).toBe(0);
  });
});
