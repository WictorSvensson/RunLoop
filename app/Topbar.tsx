"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";
import { BrandMark } from "./Brand";
import { LogoutButton } from "./components/LogoutButton";

type Props = {
  user: { username: string; displayName: string | null };
};

// Client component: breadcrumb label is derived from the current route via
// usePathname() + NAV_ITEMS, so no page needs to pass its own title down —
// one less thing for each page to duplicate/get out of sync.
export function Topbar({ user }: Props) {
  const pathname = usePathname();
  const activeLabel =
    NAV_ITEMS.find((item) => item.href === pathname)?.label ?? "Dashboard";
  const displayName = user.displayName ?? user.username;
  const avatarInitial = displayName.charAt(0).toUpperCase();

  return (
    <header className="topbar">
      <Link className="mobile-brand" href="/">
        <BrandMark /> runloop
      </Link>
      <div className="breadcrumb">
        <span>Workspace</span>
        <b>/</b>
        {activeLabel}
      </div>
      <div className="top-actions">
        <button className="icon-button" aria-label="Notifications" type="button">
          ♧<span className="notification-dot" />
        </button>
        <LogoutButton />
        <div className="top-avatar">{avatarInitial}</div>
      </div>
    </header>
  );
}
