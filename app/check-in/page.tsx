"use client";

import { useState } from "react";

export default function CheckInPage() {
  const [saved, setSaved] = useState(false);
  const [energy, setEnergy] = useState(4);
  const [sleepQuality, setSleepQuality] = useState("Good");
  const [soreness, setSoreness] = useState("None");
  const [symptoms, setSymptoms] = useState("None");

  return (
    <div className="route-wrap"><div className="route-intro"><p className="eyebrow">Tuesday, September 4, 2026</p><h1>How are you feeling today?</h1><p className="subtle">A quick pulse check. Less than a minute, and no scores, no judgement.</p></div><form className="checkin-form" onSubmit={(event) => { event.preventDefault(); setSaved(true); }}><div className="form-grid"><label>Weight<input defaultValue="75.2 kg" /></label><label>Sleep duration<input defaultValue="7h 12m" /></label></div><fieldset><legend>Sleep quality</legend><div className="option-row">{["Poor", "Okay", "Good", "Excellent"].map((option) => <button type="button" key={option} className={sleepQuality === option ? "selected" : ""} onClick={() => setSleepQuality(option)}>{option}</button>)}</div></fieldset><fieldset><legend>Energy</legend><div className="option-row compact">{[1, 2, 3, 4, 5].map((option) => <button type="button" key={option} className={energy === option ? "selected" : ""} onClick={() => setEnergy(option)}>{option}</button>)}</div></fieldset><div className="form-grid"><fieldset><legend>Soreness</legend><select value={soreness} onChange={(event) => setSoreness(event.target.value)}><option>None</option><option>Mild</option><option>Moderate</option><option>High</option></select></fieldset><fieldset><legend>Symptoms</legend><select value={symptoms} onChange={(event) => setSymptoms(event.target.value)}><option>None</option><option>Mild</option><option>Moderate</option><option>High</option></select></fieldset></div><label>Notes<textarea placeholder="Anything worth remembering?" rows={4} /></label><div className="form-footer"><span>{saved ? "Check-in saved locally" : "Your check-in stays private to you."}</span><button className="save-button" type="submit">Save check-in</button></div></form></div>
  );
}
