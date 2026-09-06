"use client";

import { useState } from "react";
import Image from "next/image";

    const navItems = ["Dashboard", "Daily check-in", "Training", "Analytics", "Coach"];
    // ----------------------------------------------------
    // MOCK ANALYTICS — UI PROTOTYPE ONLY
    // TODO: Replace these values with RunLoop analysis API
    // TODO: Replace mock weekly running time when real moving-time data is available.
    // ----------------------------------------------------
    const trainingBlockWeeks = [
      { label: "W1", volume: "31", height: 73, status: "completed" },
      { label: "W2", volume: "34", height: 80, status: "completed" },
      { label: "W3", volume: "36", height: 85, status: "completed" },
      { label: "W4", volume: "38", height: 89, status: "completed" },
      { label: "W5", volume: "42.6", height: 100, status: "current" },
      { label: "W6", volume: "—", height: 8, status: "future" },
      { label: "W7", volume: "—", height: 8, status: "future" },
      { label: "W8", volume: "—", height: 8, status: "future" },
    ];

    const aerobicTrend = [72, 67, 70, 57, 59, 48, 42, 31];
    const thresholdMetrics = [
      { duration: "3 min", pace: "4:02/km", change: "↑ 0:07", trend: "improving" },
      { duration: "6 min", pace: "4:08/km", change: "↑ 0:05", trend: "improving" },
      { duration: "10 min", pace: "4:13/km", change: "→ 0:01", trend: "steady" },
    ];

    function ArrowUpRight() {
      return <span aria-hidden="true" className="arrow">↗</span>;
    }

    function TrendLine() {
      const points = aerobicTrend.map((value, index) => `${index * 100 / (aerobicTrend.length - 1)},${value}`).join(" ");
      return <svg className="trend-line" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Improving eight-week aerobic efficiency trend"><polyline points={points} /></svg>;
    }

  export default function Home() {
      const activeNav = "Dashboard";
      const [checkInOpen, setCheckInOpen] = useState(false);

      return (
        <main className="app-shell">
          <aside className="sidebar">
            <div className="brand"><Image className="brand-mark" src="/Runloop%20Logo.png" alt="" width={30} height={30} priority /> runloop</div>
            <div className="athlete-switcher"><div className="avatar">K</div><div><strong>Kevin&apos;s loop</strong><span>Personal space</span></div><span className="chevron">⌄</span></div>
            <nav className="main-nav" aria-label="Main navigation"><span className="nav-label">Workspace</span>{navItems.map((item, index) => <a key={item} className={`nav-item ${activeNav === item ? "active" : ""}`} href={index === 0 ? "/" : `/${["", "check-in", "training", "analytics", "coach"][index]}`}><span className="nav-icon">{["⌂", "✧", "◒", "◌", "◈"][index]}</span>{item}{item === "Daily check-in" && <span className="nav-dot" />}</a>)}</nav>
            <div className="sidebar-bottom"><button className="nav-item"><span className="nav-icon">⚙</span>Settings</button><div className="sync-status"><span className="status-pulse" />Last synced just now</div></div>
          </aside>

          <section className="content">
            <header className="topbar"><div className="mobile-brand"><Image className="brand-mark" src="/Runloop%20Logo.png" alt="" width={30} height={30} priority /> runloop</div><div className="breadcrumb"><span>Workspace</span><b>/</b>{activeNav}</div><div className="top-actions"><button className="icon-button" aria-label="Notifications">♧<span className="notification-dot" /></button><div className="top-avatar">K</div></div></header>
            <div className="dashboard-wrap">
              <div className="welcome-row"><div><p className="eyebrow">Tuesday, September 4, 2026</p><h1>Good evening, Kevin<span className="accent-dot">.</span></h1><p className="subtle">Week 5 of your 8-week training block</p><p className="training-status">ON TRACK <span>·</span> Aerobic fitness improving</p></div><button className="checkin-button" onClick={() => setCheckInOpen(true)}><span>+</span> Daily check-in</button></div>

              <section className="week-hero training-block-panel"><div className="training-block-header"><p className="eyebrow light">Current training block</p><span className="training-block-week">Week 5 / 8</span></div><div className="week-stats training-block-stats"><div className="big-stat training-block-stat"><strong>42.6 <span>km</span></strong><small>This week</small></div><div className="big-stat training-block-stat"><strong>5 <span>runs</span></strong><small>Frequency</small></div><div className="big-stat training-block-stat"><strong>3h 54m</strong><small>Running time</small></div><div className="big-stat training-block-stat"><strong>138 <span>bpm</span></strong><small>Avg HR</small></div></div><div className="training-block-chart" aria-label="Eight-week training volume"><div className="training-chart-grid"><i /><i /><i /></div>{trainingBlockWeeks.map((week) => <div className={`training-week ${week.status}`} key={week.label}><span className="training-volume">{week.volume}{week.volume !== "—" && <small> km</small>}</span><div className="training-bar" style={{ height: `${week.height}%` }} /><span className="training-week-label">{week.label}</span></div>)}</div><div className="training-block-summary"><div><span>8-week avg</span><strong>38.2 km/week</strong></div><div><span>Current week</span><strong>+11.5% <em>vs recent average</em></strong></div></div></section>

              <div className="analysis-grid">
                <section className="analysis-panel aerobic-panel"><div className="analysis-heading"><div><p className="eyebrow">Aerobic efficiency</p><h2>8 week trend</h2></div><span className="analysis-period">W1 — W8</span></div><div className="analysis-primary"><strong>136 <small>bpm</small></strong><span>Adjusted avg HR</span><b>Improving</b></div><div className="analysis-secondary"><div><span>HR drift</span><strong>2.8%</strong></div><p>Normalized for comparable effort and conditions</p></div><div className="trend-line-wrap"><div className="trend-axis"><span>lower drift</span><span>W8</span></div><TrendLine /></div></section>
                <section className="analysis-panel threshold-panel"><div className="analysis-heading"><div><p className="eyebrow">Threshold development</p><h2>8 week trend</h2></div><span className="analysis-period">PACE / KM</span></div><div className="threshold-list">{thresholdMetrics.map((metric) => <div className="threshold-row" key={metric.duration}><span>{metric.duration}</span><strong>{metric.pace}</strong><b className={metric.trend}>{metric.change}</b><i className={`micro-trend ${metric.trend}`} /></div>)}</div></section>
              </div>

              <div className="supporting-grid"><section className="recovery-section"><div className="section-heading"><p className="eyebrow">Recovery</p><span className="supporting-state">Recovery normal</span></div><div className="recovery-grid compact-recovery"><div className="metric-card"><span className="metric-label">Sleep</span><strong>7<em>h</em> 12<em>m</em></strong></div><div className="metric-card"><span className="metric-label">Energy</span><strong>8<em>/10</em></strong></div><div className="metric-card"><span className="metric-label">Symptoms</span><strong className="clear-state">Clear</strong></div></div></section>
                <section className="recent-section"><div className="section-heading"><div><p className="eyebrow">Your last movement</p><h2>Recent training</h2></div><button className="round-arrow" aria-label="View all training"><ArrowUpRight /></button></div><div className="activity-list"><div className="activity-row"><div className="activity-icon easy">∿</div><div className="activity-detail"><strong>Easy run</strong><span>Today · 8.2 km · 46m 18s</span></div><span className="activity-value">5:39<span>/km</span></span></div><div className="activity-row"><div className="activity-icon long">↗</div><div className="activity-detail"><strong>Long run</strong><span>Sunday · 14.6 km · 1h 21m</span></div><span className="activity-value">5:34<span>/km</span></span></div><div className="activity-row"><div className="activity-icon recovery">◌</div><div className="activity-detail"><strong>Recovery run</strong><span>Friday · 5.1 km · 31m 42s</span></div><span className="activity-value">6:13<span>/km</span></span></div></div></section></div>

              {/* TODO: Replace mock coach briefing with generated coaching analysis */}
              <section className="coach-card"><div className="coach-header"><p className="eyebrow">RunLoop Coach</p><span className="confidence">High confidence</span></div><div className="coach-copy"><p className="coach-kicker">Observation / interpretation</p><h2>Your training is moving in the right direction.</h2><p>Your mileage has increased gradually while aerobic efficiency and shorter threshold efforts continue to improve. Your 10-minute threshold pace, however, has remained essentially unchanged.</p></div><div className="recommendation"><p className="coach-kicker">This week</p><strong>Hold volume around 40–43 km and prioritize extending threshold duration rather than adding more mileage.</strong></div><div className="evidence-row"><span className="positive">Volume ↑</span><span className="positive">HR drift ↓</span><span className="positive">3 min ↑</span><span className="positive">6 min ↑</span><span>10 min →</span></div><div className="coach-actions"><button className="coach-primary">Ask RunLoop</button><a href="/coach" className="coach-link">Full analysis <ArrowUpRight /></a></div></section><footer><span>Runloop / Personal training intelligence</span><span>Data is yours, always.</span></footer>
            </div>
          </section>

          {checkInOpen && <div className="modal-backdrop" role="presentation" onClick={() => setCheckInOpen(false)}><div className="checkin-modal" role="dialog" aria-modal="true" aria-labelledby="checkin-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setCheckInOpen(false)} aria-label="Close">×</button><p className="eyebrow">Tuesday, September 4</p><h2 id="checkin-title">How are you feeling today?</h2><p className="modal-copy">A quick pulse check. No scores, no judgement.</p><label>Weight<input placeholder="75.2 kg" /></label><label>Sleep<input placeholder="7h 12m" /></label><label>Energy<div className="choice-row">{[1, 2, 3, 4, 5].map((number) => <button key={number} className={number === 4 ? "selected" : ""}>{number}</button>)}</div></label><button className="save-button" onClick={() => setCheckInOpen(false)}>Save check-in</button></div></div>}
        </main>
      );
}
