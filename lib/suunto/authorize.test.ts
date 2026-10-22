import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

// client.ts pulls in lib/prisma at module load, whose DATABASE_URL guard
// throws without a connection string — but no connection is ever opened by
// these pure URL tests, so a dummy value suffices (restored afterwards).
const savedDbUrl = process.env.DATABASE_URL;
let buildAuthorizeUrl: (userId: string) => string;
let verifyOAuthState: (state: string | null) => string | null;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://localhost:5432/runloop_test";
  ({ buildAuthorizeUrl, verifyOAuthState } = await import("./client"));
});

afterAll(() => {
  if (savedDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDbUrl;
});

// Dummy, non-secret values — env shape only, never real credentials.
const TEST_ENV = {
  SESSION_SECRET: "x".repeat(64),
  SUUNTO_CLIENT_ID: "test-client-id",
  SUUNTO_CLIENT_SECRET: "test-client-secret",
  SUUNTO_SUBSCRIPTION_KEY: "test-subscription-key",
  SUUNTO_REDIRECT_URI: "http://localhost:3000/api/suunto/callback",
} as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  savedEnv.SUUNTO_OAUTH_BASE_URL = process.env.SUUNTO_OAUTH_BASE_URL;
  delete process.env.SUUNTO_OAUTH_BASE_URL;
});

afterEach(() => {
  for (const k of Object.keys({ ...TEST_ENV, SUUNTO_OAUTH_BASE_URL: "" })) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("buildAuthorizeUrl", () => {
  it("matches oauth2-api.yaml: oauth host, /oauth/authorize, response_type/client_id/redirect_uri", () => {
    const url = new URL(buildAuthorizeUrl("user-123"));
    expect(url.origin).toBe("https://cloudapi-oauth.suunto.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/suunto/callback",
    );
  });

  it("sends no scope parameter (the spec defines none)", () => {
    const url = new URL(buildAuthorizeUrl("user-123"));
    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("binds state to the user (verified by the callback)", () => {
    const url = new URL(buildAuthorizeUrl("user-123"));
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(verifyOAuthState(state)).toBe("user-123");
  });

  it("trims a copy-pasted client id so Suunto never sees padding", () => {
    process.env.SUUNTO_CLIENT_ID = "  test-client-id  ";
    const url = new URL(buildAuthorizeUrl("user-123"));
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
  });
});
