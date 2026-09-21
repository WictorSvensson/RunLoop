import { describe, it, expect } from "vitest";
import { INTEGRATION_SOURCES, isIntegrationSource } from "@/lib/integration-sources";

describe("isIntegrationSource", () => {
  it("accepts the known sources", () => {
    for (const source of INTEGRATION_SOURCES) {
      expect(isIntegrationSource(source)).toBe(true);
    }
  });

  it("rejects unknown, empty, and non-string values", () => {
    expect(isIntegrationSource("STRAVA")).toBe(false);
    expect(isIntegrationSource("garmin")).toBe(false);
    expect(isIntegrationSource("")).toBe(false);
    expect(isIntegrationSource(null)).toBe(false);
    expect(isIntegrationSource(undefined)).toBe(false);
    expect(isIntegrationSource(42)).toBe(false);
  });

  it("stays in sync with the Activity sources used by importers", () => {
    // Importers persist Activity.source as "GARMIN"/"SUUNTO" — the toggle
    // allowlist must cover exactly those values.
    expect([...INTEGRATION_SOURCES].sort()).toEqual(["GARMIN", "SUUNTO"]);
  });
});
