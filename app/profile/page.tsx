import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { garminConfig } from "@/lib/garmin/config";
import { getIntegrationStates } from "@/lib/integrations";
import { ProfileForm } from "./ProfileForm";
import { ConnectionsSection } from "./ConnectionsSection";

// Live DB state on every load: the profile form's initial values and the
// Garmin connection status must never be statically prerendered.
export const dynamic = "force-dynamic";

// User profile: personal info plus every wearable connection control.
// Garmin connects/syncs here; Suunto auto-syncs via Cloud API OAuth
// (<SuuntoSync /> → /api/suunto/connect + /api/jobs/suunto-import) while the
// manual export-zip upload (<SuuntoUpload /> → /api/suunto/upload) stays as
// a fallback, idempotent on the filename stem so re-uploads only add new
// workouts.
export default async function ProfilePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) redirect("/login");

  const [user, garminConnection, suuntoConnection, integrationStates] = await Promise.all([
    prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        username: true,
        displayName: true,
        email: true,
        weightKg: true,
        timezone: true,
      },
    }),
    prisma.garminConnection.findUnique({
      where: { userId: sessionUser.id },
      select: { username: true, lastSyncedAt: true },
    }),
    prisma.suuntoConnection.findUnique({
      where: { userId: sessionUser.id },
      select: { username: true, suuntoUserId: true, lastSyncedAt: true },
    }),
    getIntegrationStates(sessionUser.id),
  ]);
  if (!user) redirect("/login");

  const displayName = user.displayName ?? user.username;
  const isGarminConnected = garminConnection !== null;
  const garminStatusText = garminConnection
    ? `Connected${garminConnection.username ? ` as ${garminConnection.username}` : ""}${garminConnection.lastSyncedAt ? ` · last synced ${garminConnection.lastSyncedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : ""}`
    : "Not connected";

  const isSuuntoConnected = suuntoConnection !== null;
  const suuntoIdentity = suuntoConnection?.username ?? suuntoConnection?.suuntoUserId;
  const suuntoStatusText = suuntoConnection
    ? `Auto-sync connected${suuntoIdentity ? ` as ${suuntoIdentity}` : ""}${suuntoConnection.lastSyncedAt ? ` · last synced ${suuntoConnection.lastSyncedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : ""} · or upload your history export (.zip from the Suunto app).`
    : "Not connected · upload your history export (.zip from the Suunto app).";

  // OAuth callback feedback (/api/suunto/callback redirects here with a
  // generic reason code — never tokens or endpoint detail in the URL).
  const resolvedParams = searchParams ? await searchParams : undefined;
  const suuntoParam = resolvedParams?.suunto;
  const suuntoFlag = Array.isArray(suuntoParam) ? suuntoParam[0] : suuntoParam;
  const suuntoNotice =
    suuntoFlag === "connected"
      ? "Suunto connected. Click “Sync Suunto now” to import."
      : suuntoFlag === "denied"
        ? "Suunto authorization was denied — no tokens stored."
        : suuntoFlag === "expired"
          ? "Suunto connect expired. Please try connecting again."
          : suuntoFlag === "failed"
            ? "Suunto connect failed. Please try again."
            : null;

  return (
    <div className="route-wrap">
      <div className="route-intro">
        <p className="eyebrow">Your space</p>
        <h1>Profile</h1>
        <p className="subtle">
          Signed in as <strong>{displayName}</strong> (@{user.username}).
        </p>
      </div>

      <ProfileForm
        initial={{
          displayName: user.displayName ?? "",
          email: user.email ?? "",
          weightKg: user.weightKg != null ? String(user.weightKg) : "",
          timezone: user.timezone ?? "",
        }}
      />

      <section className="connections">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Wearables</p>
            <h2>Connections</h2>
          </div>
        </div>
        <ConnectionsSection
          garminEnabledInitial={integrationStates.GARMIN}
          suuntoEnabledInitial={integrationStates.SUUNTO}
          isGarminConnected={isGarminConnected}
          garminStatusText={garminStatusText}
          defaultUsername={garminConfig.username}
          isSuuntoConnected={isSuuntoConnected}
          suuntoStatusText={suuntoStatusText}
          suuntoNotice={suuntoNotice}
        />
      </section>
    </div>
  );
}
