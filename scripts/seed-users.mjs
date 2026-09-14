// Seeds the two default users (Wictor / Kevin) with scrypt-hashed passwords.
// Run: npm run db:seed (after `npm run db:migrate`).
// Hash format matches lib/auth.ts: "saltHex:hashHex" (32-byte salt, 64-byte key).
//
// The pre-auth single "dev" user (dev@runloop.local) owned real training data
// (check-ins, activities, connections, briefs). That data is reassigned to
// Wictor before the dev row is deleted — nothing user-created is lost.
import { scrypt as scryptCb, randomBytes } from "crypto";
import { promisify } from "util";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

// Minimal .env loader (DATABASE_URL etc.) so `npm run db:seed` works without
// extra dependencies. Real env vars always win over .env entries.
function loadDotEnv() {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
    let value = trimmed.slice(trimmed.indexOf("=") + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const scrypt = promisify(scryptCb);

const USERS = [
  { username: "wictor", displayName: "Wictor", password: "wic" },
  { username: "kevin", displayName: "Kevin", password: "kev" },
];

// Every table with a userId FK. Connections are unique per user; activities
// and check-ins are unique per (user, key) — moving dev rows onto a fresh
// Wictor row cannot collide because Wictor starts empty.
const OWNED_TABLES = [
  "DailyCheckin",
  "Activity",
  "GarminConnection",
  "CoachBrief",
];

async function hashPassword(password) {
  const salt = randomBytes(32);
  // Pinned to match lib/auth-crypto.ts SCRYPT_OPTIONS — both sides must
  // change together so a Node default change cannot lock out seeded users.
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (const u of USERS) {
      const passwordHash = await hashPassword(u.password);
      // Password is set on INSERT only: re-running the seed must never reset
      // a changed password back to the weak dev default.
      await client.query(
        `INSERT INTO "User" (id, username, "passwordHash", "displayName", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
         ON CONFLICT (username) DO UPDATE SET
           "displayName" = EXCLUDED."displayName",
           "updatedAt" = NOW()`,
        [u.username, passwordHash, u.displayName],
      );
      console.log(`seeded user: ${u.username}`);
    }

    // Reassign pre-auth dev data to Wictor, then remove the dev user.
    const dev = await client.query(`SELECT id FROM "User" WHERE email = 'dev@runloop.local'`);
    if (dev.rowCount > 0) {
      const devId = dev.rows[0].id;
      const wictor = await client.query(`SELECT id FROM "User" WHERE username = 'wictor'`);
      const wictorId = wictor.rows[0].id;
      for (const table of OWNED_TABLES) {
        const res = await client.query(
          `UPDATE "${table}" SET "userId" = $1 WHERE "userId" = $2`,
          [wictorId, devId],
        );
        console.log(`moved ${res.rowCount} ${table} rows to wictor`);
      }
      await client.query(`DELETE FROM "User" WHERE id = $1`, [devId]);
      console.log("removed dev user");
    } else {
      console.log("no dev user found — nothing to migrate");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
