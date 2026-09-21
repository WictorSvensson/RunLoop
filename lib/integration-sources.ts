// Canonical training-data integration sources. Plain strings (not a Prisma
// enum) so adding a future source (COROS, Strava, …) needs no schema change:
// one array entry + one Profile row. Pure module (no prisma import) so unit
// tests can import it without a database.
export const INTEGRATION_SOURCES = ["GARMIN", "SUUNTO"] as const;

export type IntegrationSource = (typeof INTEGRATION_SOURCES)[number];

export function isIntegrationSource(value: unknown): value is IntegrationSource {
  return (
    typeof value === "string" &&
    (INTEGRATION_SOURCES as readonly string[]).includes(value)
  );
}
