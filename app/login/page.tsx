import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { safeNextPath } from "./next";
import { LoginForm } from "./LoginForm";

// Login is the first thing a visitor sees (middleware redirects logged-out
// visitors here). A holder of a *valid* session is sent onward (honoring a
// safe ?next= deep link); everyone else gets the bare login form with no app
// chrome (the root layout renders children chromeless when logged out).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) {
    const { next } = await searchParams;
    redirect(safeNextPath(next));
  }

  return <LoginForm />;
}
