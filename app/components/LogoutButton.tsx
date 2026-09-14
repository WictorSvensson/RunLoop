"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Shared header logout button. Clears the session cookie, then lands on /login.
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onLogout() {
    if (pending) return;
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Cookie may already be gone — still send the user to login.
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      className="logout-button"
      type="button"
      onClick={onLogout}
      disabled={pending}
      aria-label="Log out"
      title="Log out"
    >
      {pending ? "…" : "Log out"}
    </button>
  );
}
