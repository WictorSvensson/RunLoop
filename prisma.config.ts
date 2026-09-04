import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Read directly from process.env (not prisma's env() helper) so that
    // `prisma generate` during postinstall does not fail in environments
    // where DATABASE_URL is not yet set (e.g. clean CI/deploy installs).
    // Commands that actually touch the DB (migrate/studio) require it to be set.
    url: process.env.DATABASE_URL ?? "",
  },
});
