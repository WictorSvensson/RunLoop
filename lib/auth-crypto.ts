import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";

// Pure auth primitives: password hashing + signed session-cookie values.
// Deliberately free of next/headers and Prisma imports so this module is
// unit-testable in plain vitest (see auth-crypto.test.ts). Server code should
// import from "@/lib/auth" (which re-exports everything here) or the cached
// wrapper in "@/lib/current-user".

// ---------------------------------------------------------------------------
// Password hashing (Node scrypt, no extra dependencies).
// Stored format: "saltHex:hashHex" (32-byte salt, 64-byte key).
// Cost parameters are pinned explicitly so a Node upgrade cannot silently
// change hashing cost or break verification of existing hashes.
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

// Typed promisified scrypt (util.promisify loses the options overload).
function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, SCRYPT_OPTIONS, (err, key) => {
      if (err) reject(err);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(32);
  const key = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

// Dummy hash used to equalize login timing for unknown usernames (see the
// login route): a constant scrypt output so the "user not found" path costs
// the same as a real password verification. Matches the stored format.
const DUMMY_HASH_SALT = "0".repeat(64);
const DUMMY_HASH = `${DUMMY_HASH_SALT}:${"0".repeat(128)}`;

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    // Reject malformed/placeholder hashes (e.g. migration backfills): scrypt
    // with a zero-length key could otherwise compare as equal for any input.
    if (salt.length < 16 || expected.length < 32) return false;
    const actual = await scryptAsync(password, salt, SCRYPT_KEYLEN);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Constant-time dummy verification for unknown usernames (anti-enumeration). */
export async function verifyDummyPassword(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

// ---------------------------------------------------------------------------
// Session cookies.
//
// The cookie value is `payload.signature` where payload is
// base64url(`${userId}:${expiresAtMs}`) and signature is a base64url
// HMAC-SHA256 of the payload with SESSION_SECRET. Safe to parse without a DB:
// cuid() user ids never contain ":" and base64url never contains ".".
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "runloop_session";
// 30-day persistent session.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  // Fail closed and loud: a missing, placeholder, or short secret would make
  // session cookies forgeable (or break all sessions after rotation).
  if (
    !secret ||
    secret.length < 32 ||
    secret.toLowerCase().includes("change_me")
  ) {
    throw new Error(
      "SESSION_SECRET is missing, too short (<32 chars), or still a placeholder. Generate one with `openssl rand -hex 32` and set it in .env (see .env.example).",
    );
  }
  return secret;
}

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function b64urlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function signSessionValue(userId: string, expiresAtMs: number): string {
  const payload = b64urlEncode(`${userId}:${expiresAtMs}`);
  const sig = createHmac("sha256", getSessionSecret()).update(payload).digest();
  return `${payload}.${b64urlEncode(sig)}`;
}

export function verifySessionValue(value: string): { userId: string } | null {
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  let expected: Buffer;
  try {
    expected = createHmac("sha256", getSessionSecret()).update(payload).digest();
  } catch {
    return null;
  }
  let actual: Buffer;
  try {
    actual = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = b64urlDecode(payload).toString("utf8");
  } catch {
    return null;
  }
  const sep = decoded.lastIndexOf(":");
  if (sep <= 0) return null;
  const userId = decoded.slice(0, sep);
  const expiresAtMs = Number(decoded.slice(sep + 1));
  if (!userId || !Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
    return null;
  }
  return { userId };
}

/** Normalize usernames for case-insensitive login + storage. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
