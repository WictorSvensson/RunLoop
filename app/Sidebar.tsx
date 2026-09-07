import Link from "next/link";
import { displayNameFromEmail } from "@/lib/format";
import { BrandMark } from "./Brand";
import { SidebarNav } from "./SidebarNav";

type Props = {
  user: { email: string };
  showCheckInReminder: boolean;
};

// Server Component: static chrome (brand, athlete switcher, sync status)
// plus the one interactive piece (SidebarNav) that needs client-side route
// awareness. Rendered once by app/(dashboard)/layout.tsx, so it persists
// across client-side navigations instead of remounting per page.
export function Sidebar({ user, showCheckInReminder }: Props) {
  const displayName = displayNameFromEmail(user.email);

  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <BrandMark /> runloop
      </Link>
      <div className="athlete-switcher">
        <div className="avatar">{displayName.charAt(0)}</div>
        <div>
          <strong>{displayName}&apos;s loop</strong>
          <span>Personal space</span>
        </div>
        <span className="chevron">⌄</span>
      </div>
      <SidebarNav showCheckInReminder={showCheckInReminder} />
      <div className="sidebar-bottom">
        <button className="nav-item" type="button">
          <span className="nav-icon">⚙</span>Settings
        </button>
        <div className="sync-status">
          <span className="status-pulse" />
          Last synced just now
        </div>
      </div>
    </aside>
  );
}
