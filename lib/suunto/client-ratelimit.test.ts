import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Rate-limit routing: Suunto's gateway reports quota as status 401 with body
// "Rate limit is exceeded (RateLimitExceeded)" (and sometimes 429), even on
// a freshly minted token — i.e. quota, not a dead grant. Must throw
// SuuntoRateLimitError (never SuuntoAuthError), must read false for
// isSuuntoAuthFailure, and withSuuntoClient must not burn more quota on a
// token refresh.
const store = vi.hoisted(() => ({ tokenJson: null as string | null }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    suuntoConnection: {
      findUnique: async () => (store.tokenJson ? { tokenJson: store.tokenJson } : null),
      upsert: async (args: { create: { tokenJson: string }; update: { tokenJson: string } }) => {
        store.tokenJson = args.update?.tokenJson ?? args.create.tokenJson;
        return {};
      },
    },
  },
}));

import {
  withSuuntoClient,
  SuuntoAuthError,
  SuuntoRateLimitError,
  isSuuntoAuthFailure,
  isSuuntoRateLimitFailure,
  listSuuntoWorkouts,
  type SuuntoCredentials,
} from "./client";

const TEST_ENV = {
  DATABASE_URL: "postgresql://localhost:5432/runloop_test",
  SESSION_SECRET: "x".repeat(64),
  SUUNTO_CLIENT_ID: "test-client-id",
  SUUNTO_CLIENT_SECRET: "test-client-secret",
  SUUNTO_SUBSCRIPTION_KEY: "test-subscription-key",
  SUUNTO_REDIRECT_URI: "http://localhost:3000/api/suunto/callback",
} as const;

const savedEnv: Record<string, string | undefined> = {};

const CREDS: SuuntoCredentials = {
  accessToken: "at-1",
  subscriptionKey: "test-subscription-key",
  apiBaseUrl: "https://cloudapi.suunto.com",
};

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
});

afterEach(() => {
  for (const k of Object.keys(TEST_ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Suunto rate-limit routing", () => {
  it("401 + RateLimitExceeded body throws SuuntoRateLimitError, not auth", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Rate limit is exceeded (RateLimitExceeded)", { status: 401 }),
      ),
    );
    const err = await listSuuntoWorkouts(
      CREDS,
      { offset: 0, limit: 50, sinceMs: null },
      "/v3/workouts",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SuuntoRateLimitError);
    expect(err).not.toBeInstanceOf(SuuntoAuthError);
    expect(isSuuntoRateLimitFailure(err)).toBe(true);
    expect(isSuuntoAuthFailure(err)).toBe(false);
  });

  it("bare 429 throws SuuntoRateLimitError, not auth", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("slow down", { status: 429 })),
    );
    const err = await listSuuntoWorkouts(
      CREDS,
      { offset: 0, limit: 50, sinceMs: null },
      "/v3/workouts",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SuuntoRateLimitError);
    expect(isSuuntoRateLimitFailure(err)).toBe(true);
    expect(isSuuntoAuthFailure(err)).toBe(false);
  });

  it("other 401s still throw SuuntoAuthError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 401 })),
    );
    const err = await listSuuntoWorkouts(
      CREDS,
      { offset: 0, limit: 50, sinceMs: null },
      "/v3/workouts",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SuuntoAuthError);
    expect(err).not.toBeInstanceOf(SuuntoRateLimitError);
    expect(isSuuntoAuthFailure(err)).toBe(true);
    expect(isSuuntoRateLimitFailure(err)).toBe(false);
  });

  it("withSuuntoClient does not call the token endpoint on quota", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (href.includes("/oauth/token")) {
        return Response.json({ access_token: "at-2", expires_in: 86400 });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      withSuuntoClient("user-1", async () => {
        throw new SuuntoRateLimitError("quota hit — wait, then retry with ?limit=N");
      }),
    ).rejects.toBeInstanceOf(SuuntoRateLimitError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
