"use client";

import { useState } from "react";

    const navItems = ["Dashboard", "Daily check-in", "Training", "Analytics", "Coach"];
    const bars = [42, 58, 48, 76, 52, 70, 35];

    function ArrowUpRight() {
      return <span aria-hidden="true" className="arrow">↗</span>;
    }

  export default function Home() {
      const activeNav = "Dashboard";
      const [checkInOpen, setCheckInOpen] = useState(false);

      return (
        <main className="app-shell">
          <aside className="sidebar">
            <div className="brand"><span className="brand-mark">r</span> runloop</div>
            <div className="athlete-switcher"><div className="avatar">K</div><div><strong>Kevin&apos;s loop</strong><span>Personal space</span></div><span className="chevron">⌄</span></div>
            <nav className="main-nav" aria-label="Main navigation"><span className="nav-label">Workspace</span>{navItems.map((item, index) => <a key={item} className={`nav-item ${activeNav === item ? "active" : ""}`} href={index === 0 ? "/" : `/${["", "check-in", "training", "analytics", "coach"][index]}`}><span className="nav-icon">{["⌂", "✧", "◒", "◌", "◈"][index]}</span>{item}{item === "Daily check-in" && <span className="nav-dot" />}</a>)}</nav>
            <div className="sidebar-bottom"><button className="nav-item"><span className="nav-icon">⚙</span>Settings</button><div className="sync-status"><span className="status-pulse" />Last synced just now</div></div>
          </aside>

          <section className="content">
            <header className="topbar"><div className="mobile-brand"><span className="brand-mark">r</span> runloop</div><div className="breadcrumb"><span>Workspace</span><b>/</b>{activeNav}</div><div className="top-actions"><button className="icon-button" aria-label="Notifications">♧<span className="notification-dot" /></button><div className="top-avatar">K</div></div></header>
            <div className="dashboard-wrap">
              <div className="welcome-row"><div><p className="eyebrow">Tuesday, September 4, 2026</p><h1>Good evening, Kevin<span className="accent-dot">.</span></h1><p className="subtle">You&apos;re building consistency.</p></div><button className="checkin-button" onClick={() => setCheckInOpen(true)}><span>+</span> Daily check-in</button></div>

              <section className="week-hero panel-grain"><div className="section-heading"><div><p className="eyebrow light">Current rhythm</p><h2>This week</h2></div><button className="text-button">View training <ArrowUpRight /></button></div><div className="week-stats"><div className="big-stat"><strong>32.4 <span>km</span></strong><small>Distance</small></div><div className="big-stat"><strong>4 <span>runs</span></strong><small>Frequency</small></div><div className="big-stat"><strong>2<span className="muted-number">h 47m</span></strong><small>Time moving</small></div><div className="big-stat quiet"><strong>0 <span>sessions</span></strong><small>Quality work</small></div></div><div className="week-chart"><div className="chart-lines"><i /><i /><i /></div>{bars.map((height, index) => <div className="bar-group" key={index}><div className={`bar ${index === 3 ? "highlight" : ""}`} style={{ height: `${height}%` }} /><span>{["M", "T", "W", "T", "F", "S", "S"][index]}</span></div>)}</div></section>

              <div className="content-grid"><section className="recovery-section"><div className="section-heading"><div><p className="eyebrow">The basics</p><h2>Recovery</h2></div><button className="text-button dark-text">Open check-in <ArrowUpRight /></button></div><div className="recovery-grid"><div className="metric-card"><span className="metric-label">Weight</span><strong>75.2 <em>kg</em></strong><span className="metric-note teal">↓ 0.4 kg this month</span></div><div className="metric-card"><span className="metric-label">Sleep</span><strong>7<em>h</em> 12<em>m</em></strong><span className="metric-note">Last night · Good</span></div><div className="metric-card"><span className="metric-label">Energy</span><strong>8<em>/10</em></strong><div className="energy-dots"><i /><i /><i /><i /><i /><i /><i className="soft" /><i className="soft" /><i className="soft" /><i className="soft" /></div></div><div className="metric-card"><span className="metric-label">Symptoms</span><strong className="clear-state">Clear</strong><span className="metric-note">No active concerns</span></div></div></section>
                <section className="recent-section"><div className="section-heading"><div><p className="eyebrow">Your last movement</p><h2>Recent training</h2></div><button className="round-arrow" aria-label="View all training"><ArrowUpRight /></button></div><div className="activity-list"><div className="activity-row"><div className="activity-icon easy">∿</div><div className="activity-detail"><strong>Easy run</strong><span>Today · 8.2 km · 46m 18s</span></div><span className="activity-value">5:39<span>/km</span></span></div><div className="activity-row"><div className="activity-icon long">↗</div><div className="activity-detail"><strong>Long run</strong><span>Sunday · 14.6 km · 1h 21m</span></div><span className="activity-value">5:34<span>/km</span></span></div><div className="activity-row"><div className="activity-icon recovery">◌</div><div className="activity-detail"><strong>Recovery run</strong><span>Friday · 5.1 km · 31m 42s</span></div><span className="activity-value">6:13<span>/km</span></span></div></div></section></div>

              <section className="coach-card"><div className="coach-symbol">✦</div><div className="coach-copy"><p className="eyebrow light">Coach observation <span className="confidence">High confidence</span></p><h2>Your easy running has been remarkably consistent over the last three weeks.</h2><p>Let&apos;s keep resisting the urge to add intensity. The shape of your week is doing good work.</p></div><button className="coach-link">See the thinking <ArrowUpRight /></button></section><footer><span>Runloop / Personal training intelligence</span><span>Data is yours, always.</span></footer>
            </div>
          </section>

          {checkInOpen && <div className="modal-backdrop" role="presentation" onClick={() => setCheckInOpen(false)}><div className="checkin-modal" role="dialog" aria-modal="true" aria-labelledby="checkin-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setCheckInOpen(false)} aria-label="Close">×</button><p className="eyebrow">Tuesday, September 4</p><h2 id="checkin-title">How are you feeling today?</h2><p className="modal-copy">A quick pulse check. No scores, no judgement.</p><label>Weight<input placeholder="75.2 kg" /></label><label>Sleep<input placeholder="7h 12m" /></label><label>Energy<div className="choice-row">{[1, 2, 3, 4, 5].map((number) => <button key={number} className={number === 4 ? "selected" : ""}>{number}</button>)}</div></label><button className="save-button" onClick={() => setCheckInOpen(false)}>Save check-in</button></div></div>}
        </main>
      );
}
