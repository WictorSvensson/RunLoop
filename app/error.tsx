"use client";

// Root error boundary. Currently the most likely trigger is a database
// outage (every page in this app reads from Postgres via Prisma with no
// fallback), so this gives a friendly message instead of Next's default
// crash screen.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="app-shell">
      <section className="content">
        <div className="dashboard-wrap">
          <section className="coach-card">
            <div className="coach-header">
              <p className="eyebrow">Something went wrong</p>
            </div>
            <div className="coach-copy">
              <h2>We couldn&apos;t load your training data.</h2>
              <p>
                This usually means the database is unreachable. If you&apos;re
                running locally, make sure Postgres is up (
                <code>npm run db:up</code>) and try again.
              </p>
            </div>
            <div className="coach-actions">
              <button className="coach-primary" onClick={() => reset()}>
                Try again
              </button>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
