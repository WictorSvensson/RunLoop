import { describe, expect, it, beforeEach } from "vitest";
import {
  hashPassword,
  normalizeUsername,
  signSessionValue,
  verifyDummyPassword,
  verifyPassword,
  verifySessionValue,
} from "./auth-crypto";

// Pure-function coverage for the session auth core (lib/auth-crypto.ts).
// getCurrentUser() is intentionally untested here — it needs request cookies
// + Postgres; the live curl checks in manual QA cover it.

beforeEach(() => {
  process.env.SESSION_SECRET = "test_secret_that_is_long_enough_0123456789";
});

describe("normalizeUsername", () => {
  it("lowercases and trims for case-insensitive login", () => {
    expect(normalizeUsername("Wictor")).toBe("wictor");
    expect(normalizeUsername("  KEVIN  ")).toBe("kevin");
    expect(normalizeUsername("wictor")).toBe("wictor");
  });
});

describe("hashPassword / verifyPassword", () => {
  it("round-trips a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("wic");
    expect(await verifyPassword("wic", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("salts uniquely: same password hashes differently", async () => {
    expect(await hashPassword("wic")).not.toBe(await hashPassword("wic"));
  });

  it("rejects malformed and placeholder hashes without throwing", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
    // Migration backfill shape (short salt/key) must never verify.
    expect(await verifyPassword("anything", "migrated:unusable")).toBe(false);
  });
});

describe("verifyDummyPassword", () => {
  it("never verifies (anti-enumeration timing equalizer)", async () => {
    await expect(verifyDummyPassword("wic")).resolves.toBeUndefined();
  });
});

describe("signSessionValue / verifySessionValue", () => {
  it("round-trips a session before expiry", () => {
    const value = signSessionValue("user_123", Date.now() + 60_000);
    expect(verifySessionValue(value)).toEqual({ userId: "user_123" });
  });

  it("rejects expired sessions", () => {
    const value = signSessionValue("user_123", Date.now() - 1_000);
    expect(verifySessionValue(value)).toBeNull();
  });

  it("rejects tampered payloads and signatures", () => {
    const value = signSessionValue("user_123", Date.now() + 60_000);
    const [payload, sig] = value.split(".");
    expect(verifySessionValue(`${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
    expect(verifySessionValue(`tampered.${sig}`)).toBeNull();
    expect(verifySessionValue("garbage")).toBeNull();
    expect(verifySessionValue("")).toBeNull();
  });

  it("rejects sessions signed with a different secret", () => {
    const value = signSessionValue("user_123", Date.now() + 60_000);
    process.env.SESSION_SECRET = "a_totally_different_test_secret_0123456789";
    expect(verifySessionValue(value)).toBeNull();
  });
});
