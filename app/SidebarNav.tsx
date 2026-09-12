"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";

// Client component so it can read the current route (usePathname) to
// highlight the active link — this is the one piece of the sidebar that
// actually needs to be interactive/per-navigation; everything else in
// Sidebar.tsx stays a plain Server Component.
export function SidebarNav({ showCheckInReminder }: { showCheckInReminder: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="main-nav route-nav" aria-label="Main navigation">
      <span className="nav-label">Workspace</span>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          className={`nav-item ${pathname === item.href ? "active" : ""}`}
          href={item.href}
        >
          <span className="nav-icon">{item.icon}</span>
          {item.label}
          {item.label === "Daily check-in" && showCheckInReminder && (
            <span className="nav-dot" />
          )}
        </Link>
      ))}
    </nav>
  );
}
