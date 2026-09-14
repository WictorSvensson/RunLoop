import Link from "next/link";
import { BrandMark } from "./Brand";
import { SidebarNav } from "./SidebarNav";

type Props = {
  user: { username: string; displayName: string | null };
  showCheckInReminder: boolean;
};

// Server Component: static chrome (brand, athlete switcher, sync status)
// plus the one interactive piece (SidebarNav) that needs client-side route
// awareness. Rendered once by the root layout, so it persists across
// client-side navigations instead of remounting per page.
export function Sidebar({ user, showCheckInReminder }: Props) {
  const displayName = user.displayName ?? user.username;

  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <BrandMark /> runloop
      </Link>
      <div className="athlete-switcher">
        <div className="avatar">{displayName.charAt(0).toUpperCase()}</div>
        <div>
          <strong>{displayName}&apos;s loop</strong>
          <span>Personal space</span>
        </div>
        <span className="chevron">⌄</span>
      </div>
      <SidebarNav showCheckInReminder={showCheckInReminder} />
      <div className="sidebar-bottom">
        <div className="sync-status">
          <span className="status-pulse" />
          Last synced just now
        </div>
      </div>
    </aside>
  );
}
