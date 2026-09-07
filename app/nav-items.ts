// Single source of truth for the dashboard's primary navigation. Shared by
// SidebarNav (active-state highlighting) and Topbar (breadcrumb label), so
// the two can never drift out of sync the way the 5 duplicated per-page
// arrays used to.
export const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: "⌂" },
  { label: "Daily check-in", href: "/check-in", icon: "✧" },
  { label: "Training", href: "/training", icon: "◒" },
  { label: "Analytics", href: "/analytics", icon: "◌" },
  { label: "Coach", href: "/coach", icon: "◈" },
] as const;
