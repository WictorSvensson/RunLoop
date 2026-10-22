"use client";

import { useState } from "react";
import { GarminSync } from "./GarminSync";
import { SuuntoSync } from "./SuuntoSync";
import { SuuntoUpload } from "./SuuntoUpload";
import { IntegrationToggle } from "./IntegrationToggle";

interface Props {
  garminEnabledInitial: boolean;
  suuntoEnabledInitial: boolean;
  isGarminConnected: boolean;
  garminStatusText: string;
  defaultUsername?: string;
  isSuuntoConnected: boolean;
  suuntoStatusText: string;
  suuntoNotice?: string | null;
}

// Client wrapper for the Profile Connections list. Each connection is a
// single row: name + description left, toggle with its action buttons
// (sync buttons, upload picker) stacked right. Controls only render while
// that integration is on; a toggled-off integration folds its "off" state
// into the row's description line — no extra rows, no dead buttons.
// Server-provided initials come from IntegrationSetting rows (missing =
// enabled).
export function ConnectionsSection({
  garminEnabledInitial,
  suuntoEnabledInitial,
  isGarminConnected,
  garminStatusText,
  defaultUsername,
  isSuuntoConnected,
  suuntoStatusText,
  suuntoNotice,
}: Props) {
  const [garminEnabled, setGarminEnabled] = useState(garminEnabledInitial);
  const [suuntoEnabled, setSuuntoEnabled] = useState(suuntoEnabledInitial);

  return (
    <div className="connection-list">
      <div className="connection-row">
        <div>
          <strong>Garmin</strong>
          <span>
            {garminEnabled
              ? garminStatusText
              : `${garminStatusText} · sync off — tokens & history kept`}
          </span>
        </div>
        <div className="connection-actions">
          <IntegrationToggle
            source="GARMIN"
            enabled={garminEnabled}
            label="Garmin sync"
            onChange={setGarminEnabled}
          />
          {garminEnabled && (
            <GarminSync
              isConnected={isGarminConnected}
              defaultUsername={defaultUsername}
              onReconnected={() => setGarminEnabled(true)}
            />
          )}
        </div>
      </div>
      <div className="connection-row">
        <div>
          <strong>Suunto</strong>
          <span>
            {suuntoEnabled
              ? suuntoStatusText
              : `${suuntoStatusText} · sync & uploads off — tokens & history kept`}
          </span>
          {suuntoNotice && <span>{suuntoNotice}</span>}
        </div>
        <div className="connection-actions">
          <IntegrationToggle
            source="SUUNTO"
            enabled={suuntoEnabled}
            label="Suunto sync & uploads"
            onChange={setSuuntoEnabled}
          />
          {suuntoEnabled && (
            <>
              <SuuntoSync isConnected={isSuuntoConnected} />
              <SuuntoUpload />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
