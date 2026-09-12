import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { garminConfig } from "@/lib/garmin/config";
import { ProfileForm } from "./ProfileForm";
import { SuuntoUpload } from "./SuuntoUpload";
import { GarminSync } from "./GarminSync";

// Live DB state on every load: the profile form's initial values and the
// Garmin connection status must never be statically prerendered.
export const dynamic = "force-dynamic";

// User profile: personal info plus every wearable connection control.
// Garmin connects/syncs here; Suunto history arrives via export-zip upload
// (<SuuntoUpload /> → /api/suunto/upload), idempotent on the filename stem
// so re-uploads only add new workouts.
export default async function ProfilePage() {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) redirect("/login");

  const [user, garminConnection] = await Promise.all([
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
  ]);
  if (!user) redirect("/login");

  const displayName = user.displayName ?? user.username;
  const isGarminConnected = garminConnection !== null;

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
        <div className="connection-list">
          <div className="connection-row">
            <div>
              <strong>Garmin</strong>
              <span>
                {garminConnection
                  ? `Connected${garminConnection.username ? ` as ${garminConnection.username}` : ""}${garminConnection.lastSyncedAt ? ` · last synced ${garminConnection.lastSyncedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : ""}`
                  : "Not connected"}
              </span>
            </div>
            <GarminSync
              isConnected={isGarminConnected}
              username={garminConnection?.username}
              defaultUsername={garminConfig.username}
            />
          </div>
          <SuuntoUpload />
        </div>
      </section>
    </div>
  );
}
