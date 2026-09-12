"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { safeNextPath } from "./next";

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      let data: { error?: string } = {};
      try {
        data = (await res.json()) as { error?: string };
      } catch {
        // Non-JSON failure — fall through to the generic error below.
      }
      if (!res.ok) {
        setError(data.error ?? "Could not log in. Please try again.");
        return;
      }
      router.push(safeNextPath(searchParams.get("next")));
      router.refresh();
    } catch {
      setError("Could not log in. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="brand">
          <Image
            className="brand-mark"
            src="/Runloop%20Logo.png"
            alt=""
            width={30}
            height={30}
            priority
          />
          runloop
        </div>
        <p className="eyebrow">Personal training intelligence</p>
        <h1>Welcome back.</h1>
        <p className="subtle">Log in to your loop.</p>
        <form className="login-form" onSubmit={onSubmit}>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              placeholder="Wictor"
              required
              maxLength={64}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••"
              required
              maxLength={256}
            />
          </label>
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button className="save-button" type="submit" disabled={pending}>
            {pending ? "Logging in…" : "Log in"}
          </button>
        </form>
      </div>
    </main>
  );
}

export function LoginForm() {
  return (
    <Suspense>
      <LoginFormInner />
    </Suspense>
  );
}
