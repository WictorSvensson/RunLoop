import { prisma } from "@/lib/prisma";
import {
  INTEGRATION_SOURCES,
  isIntegrationSource,
  type IntegrationSource,
} from "@/lib/integration-sources";

export { INTEGRATION_SOURCES, isIntegrationSource, type IntegrationSource };

// Absence of a row means enabled — existing users keep working with zero
// backfill, and OFF only ever blocks future syncs/uploads (never deletes
// tokens or activities).
export async function isIntegrationEnabled(
  userId: string,
  source: IntegrationSource,
): Promise<boolean> {
  const row = await prisma.integrationSetting.findUnique({
    where: { userId_source: { userId, source } },
    select: { enabled: true },
  });
  return row?.enabled ?? true;
}

export async function setIntegrationEnabled(
  userId: string,
  source: IntegrationSource,
  enabled: boolean,
): Promise<{ source: IntegrationSource; enabled: boolean }> {
  const row = await prisma.integrationSetting.upsert({
    where: { userId_source: { userId, source } },
    create: { userId, source, enabled },
    update: { enabled },
    select: { source: true, enabled: true },
  });
  return { source: row.source as IntegrationSource, enabled: row.enabled };
}

// Batch read for the Profile page: returns enabled state for every known
// source (missing rows default to true) so the page needs a single query.
// Built from INTEGRATION_SOURCES so a new source is picked up automatically.
export async function getIntegrationStates(
  userId: string,
): Promise<Record<IntegrationSource, boolean>> {
  const rows = await prisma.integrationSetting.findMany({
    where: { userId },
    select: { source: true, enabled: true },
  });
  const states = Object.fromEntries(
    INTEGRATION_SOURCES.map((source) => [source, true]),
  ) as Record<IntegrationSource, boolean>;
  for (const row of rows) {
    if (isIntegrationSource(row.source)) {
      states[row.source] = row.enabled;
    }
  }
  return states;
}
