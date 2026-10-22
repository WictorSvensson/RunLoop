import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Regression tests for the withSuuntoClient 401 refresh-and-retry:
// an expired access token with a live refresh token must sync
// transparently; only a dead grant surfaces "reconnect".
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
  isSuuntoAuthFailure,
  listSuuntoWorkouts,
  refreshSuuntoCredentials,
  type StoredSuuntoTokens,
} from "./client";

// Dummy, non-secret values — env shape only, never real credentials.
const TEST_ENV = {
  DATABASE_URL: "postgresql://localhost:5432/runloop_test",
  SESSION_SECRET: "x".repeat(64),
  SUUNTO_CLIENT_ID: "test-client-id",
  SUUNTO_CLIENT_SECRET: "test-client-secret",
  SUUNTO_SUBSCRIPTION_KEY: "test-subscription-key",
  SUUNTO_REDIRECT_URI: "http://localhost:3000/api/suunto/callback",
} as const;

const savedEnv: Record<string, string | undefined> = {};

function freshTokens(extra: Partial<StoredSuuntoTokens> = {}): StoredSuuntoTokens {
  return {
    access_token: "at-1",
    refresh_token: "rt-1",
    obtained_at_ms: Date.now(),
    expires_in: 86400,
    ...extra,
  };
}

/** Stubs only the OAuth token endpoint; the test injects fn directly. */
function stubTokenEndpoint(handler: (body: URLSearchParams) => Response) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (href.includes("/oauth/token")) {
      return handler(new URLSearchParams(init?.body as string));
    }
    throw new Error(`unexpected fetch: ${href}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  store.tokenJson = JSON.stringify(freshTokens());
});

afterEach(() => {
  for (const k of Object.keys(TEST_ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("withSuuntoClient 401 refresh-and-retry", () => {
  it("retries once with the refreshed token after a 401", async () => {
    const fetchMock = stubTokenEndpoint(
      () =>
        Response.json({ access_token: "at-2", refresh_token: "rt-2", expires_in: 86400 }),
    );
    const seen: string[] = [];
    let calls = 0;
    const result = await withSuuntoClient("user-1", async (creds) => {
      calls++;
      seen.push(creds.accessToken);
      if (calls === 1) {
        throw new SuuntoAuthError("Suunto rejected the request (401); the connection may need re-authorizing.");
      }
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(seen).toEqual(["at-1", "at-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.tokenJson as string).access_token).toBe("at-2");
  });

  it("also retries when stored expiry is unknown (old rows)", async () => {
    store.tokenJson = JSON.stringify({ access_token: "at-1", refresh_token: "rt-1" });
    stubTokenEndpoint(() => Response.json({ access_token: "at-2", expires_in: 86400 }));
    let calls = 0;
    const result = await withSuuntoClient("user-1", async () => {
      calls++;
      if (calls === 1) throw new Error("Suunto workout list failed (401): xyz");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("surfaces reconnect when the refresh itself fails", async () => {
    stubTokenEndpoint(
      () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );
    let calls = 0;
    await expect(
      withSuuntoClient("user-1", async () => {
        calls++;
        throw new SuuntoAuthError("Suunto rejected the request (401); the connection may need re-authorizing.");
      }),
    ).rejects.toThrowError(/Reconnect Suunto/);
    expect(calls).toBe(1);
  });

  it("surfaces reconnect when there is no refresh token", async () => {
    store.tokenJson = JSON.stringify(freshTokens({ refresh_token: undefined }));
    const fetchMock = stubTokenEndpoint(() => Response.json({ access_token: "at-2" }));
    await expect(
      withSuuntoClient("user-1", async () => {
        throw new SuuntoAuthError("Suunto rejected the request (401); the connection may need re-authorizing.");
      }),
    ).rejects.toThrowError(/Reconnect Suunto/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not refresh on non-auth errors", async () => {
    const fetchMock = stubTokenEndpoint(() => Response.json({ access_token: "at-2" }));
    await expect(
      withSuuntoClient("user-1", async () => {
        throw new Error("network down");
      }),
    ).rejects.toThrowError("network down");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("labels 401s with the failing call so list vs FIT is distinguishable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 401 })),
    );
    const creds = {
      accessToken: "at-1",
      subscriptionKey: "test-subscription-key",
      apiBaseUrl: "https://cloudapi.suunto.com",
    };
    const err = await listSuuntoWorkouts(
      creds,
      { offset: 0, limit: 50, sinceMs: null },
      "/v3/workouts",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SuuntoAuthError);
    expect((err as Error).message).toMatch(/workout list/);
    expect((err as Error).message).toMatch(/401/);
    expect(isSuuntoAuthFailure(err)).toBe(true);
    expect(isSuuntoAuthFailure(new Error("network down"))).toBe(false);
  });

  it("refreshSuuntoCredentials saves the fresh pair and returns fresh creds", async () => {
    stubTokenEndpoint(
      () => Response.json({ access_token: "at-9", refresh_token: "rt-9", expires_in: 86400 }),
    );
    const creds = await refreshSuuntoCredentials("user-1");
    expect(creds.accessToken).toBe("at-9");
    expect(creds.subscriptionKey).toBe("test-subscription-key");
    const stored = JSON.parse(store.tokenJson as string) as StoredSuuntoTokens;
    expect(stored.access_token).toBe("at-9");
    expect(stored.refresh_token).toBe("rt-9");
  });

  it("refreshSuuntoCredentials surfaces reconnect when the grant is dead", async () => {
    stubTokenEndpoint(
      () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );
    await expect(refreshSuuntoCredentials("user-1")).rejects.toThrowError(/Reconnect Suunto/);
  });
});
