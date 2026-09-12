<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# RunLoop — Agent Reference

Concise, non-obvious context to avoid re-discovering it via exploration each session. For product philosophy/design direction see `Runloop — Project Brief for VS Code Copilot.md` (tech-stack section there is stale, see note in that file). For analysis-engine design principles see `Docs/RUNLOOP_ANALYSIS_ENGINE_SPEC.md` — read it before building any analytics/coaching feature.

## Ask before architectural changes

Don't introduce new architectural patterns, folder structures, or shared
abstractions speculatively (i.e. because they *might* be useful later) —
propose the approach and get explicit sign-off first. This includes: new
top-level folders, Next.js route groups, new shared component/layout
layers, new dependencies, or restructuring existing file layout. Prefer
the smallest change that satisfies the actual ask; if a bigger refactor
seems warranted, say so and ask rather than just doing it.

(This bit us once: a Next.js route group `app/(dashboard)/` was added
"for future flexibility" to opt routes into a shared layout, without
being asked, then had to be undone once it became clear the speculative
future need it hedged against wasn't actually planned.)

## Stack & commands

- Next.js 16 (App Router) + TypeScript + Prisma + local Postgres (docker-compose). **Not** Supabase, despite what older docs say.
- Prisma client import path is `@/generated/prisma/client` (custom `output` in `schema.prisma`), **not** `@prisma/client`.
- `.env` from `.env.example`; `npm run db:up` starts Postgres (container `runloop-postgres`), `npm run db:migrate` applies migrations.
- `npm run dev` / `build` / `lint` / `test` (vitest). `npx tsc --noEmit` for typecheck.
- Prisma schema: `prisma/schema.prisma`. Migrations in `prisma/migrations/`. Also check `prisma.config.ts` if touching the Prisma CLI.

## Directory map

- `app/` — pages (Dashboard `page.tsx`, `analytics/`, `training/`, `check-in/`, `coach/`, `login/`, `profile/`), plus `app/api/*/route.ts` for API routes. Shared chrome lives in `app/layout.tsx` + `Sidebar.tsx`/`Topbar.tsx`/`nav-items.ts`.
- `lib/` — `auth.ts` (scrypt passwords + signed session cookies), `current-user.ts` (cached `getCurrentUser()`), `prisma.ts` (client singleton), `format.ts` (shared formatters), `activity-detail.ts` (activity DTOs + DB detail/coverage readers), `dashboard/aggregate.ts` (pure aggregation math + tests), `running-types.ts` (activity-type filter), `garmin/` (Garmin Connect client + import), `http-auth.ts` (internal route auth).

## Established conventions

- **Server Components fetch data directly via Prisma** in an `async function Page()` — no client-side fetching for initial page data. Reference implementations: `app/training/page.tsx`, `app/page.tsx`, `app/analytics/page.tsx`. Interactive bits are split into small `"use client"` components that receive server-fetched data as props (e.g. `app/training/ActivityList.tsx`, `app/CheckInModal.tsx`).
- **Auth is real (username + password).** `lib/auth.ts` holds scrypt hashing and the signed `runloop_session` cookie (`SESSION_SECRET`); `lib/current-user.ts`'s cached `getCurrentUser()` returns `null` when logged out. `middleware.ts` redirects logged-out visitors to `/login` (the layout renders bare children for them); every protected page redirects and every API route 401s on `null`. Always scope Prisma queries by `user.id`.
- **DTO conversion at the client boundary.** Prisma models can contain `Date` (and other non-JSON-safe shapes) which aren't serializable to Client Components. Follow `lib/activity-detail.ts`'s `toActivityDTO()` pattern for any new data shape crossing that boundary.
- **Don't duplicate formatting/aggregation logic.** Use `lib/format.ts` (`formatDistance`, `formatDuration`, `formatPace`/`formatPaceFromSecPerKm`, `formatDate`, `toneFor`) and `lib/dashboard/aggregate.ts` (`bucketWeeklyVolume`, `computeThisWeekStats`, `computeConsistency`, `computePaceTrend`, `computeVolumeChange`, `windowStartUTC`, `startOfWeekUTC`) instead of reimplementing. These are pure functions with unit tests in `lib/dashboard/aggregate.test.ts`.
- **Running-only filter.** `lib/running-types.ts`'s `RUNNING_TYPES` (`Run`/`TrailRun`/`VirtualRun`) is applied on Dashboard and Analytics queries — providers also sync rides/swims/etc. The Training page intentionally does NOT filter (shows full history).
- **No fabricated precision or interpretation.** Per `Docs/RUNLOOP_ANALYSIS_ENGINE_SPEC.md` §2.4/§28: never invent "confidence" scores, "patterns", or metrics not backed by real computation (e.g. no fake "easy pace" without real workout classification). Prefer honest empty/"not enough data yet" states, and gate any earlier-vs-later comparison behind a minimum sample size (see `MIN_RUNS_PER_HALF` in `app/analytics/page.tsx`) rather than presenting a single data point as a trend.
- Pages needing live DB state on every request must set `export const dynamic = "force-dynamic";` or Next may statically prerender them at build time with stale data (bit us on both `/` and `/analytics`).

## CSS gotcha (important — has caused two shipped bugs)

`.app-shell` sets a global dark theme (`color: #f4f2e9` cream, dark background). Any **new light-background card/panel** added under `.app-shell` must explicitly re-assert `color: var(--ink)` — and critically, so must any of its descendant elements that have their own pre-existing explicit color rule elsewhere in `globals.css` (e.g. `.activity-detail strong`, `.activity-value`), since a rule that directly targets an element always wins over an inherited value, regardless of the inherited rule's specificity. Grep for the element's existing color rules before assuming an ancestor-level override is enough.

**Always visually verify CSS changes** (e.g. via a Playwright screenshot) rather than relying on reading the CSS source — this exact low-contrast/invisible-text bug was not obvious from source review alone and shipped twice in one session before being caught visually.

## Testing & quality gates

- Vitest, colocated `*.test.ts` files. Reference style: `lib/dashboard/aggregate.test.ts` (fixed `NOW` constant for determinism, `makeActivity()` factory for minimal Prisma-shaped fixtures).
- Before considering any change done: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, and `npx next build` must all pass. For UI/CSS changes, also do a visual check (screenshot) against the real dev server/DB, not just static analysis.

