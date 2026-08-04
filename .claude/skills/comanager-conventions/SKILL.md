---
name: comanager-conventions
description: Coding conventions for Co Manager — query patterns, real-time patterns, performance rules, and React patterns that MUST be followed from the first line of code. These exist because every rule here caused a real production bug in the previous build (Scop/OpsPilot). Load before writing ANY code. Triggers on: query, real-time, subscription, channel, performance, React key, lazy load, cache, validation.
---

# Co Manager — Coding Conventions

Read `comanager-context` first for schema/rules, `comanager-auth` for auth.
This file is the "how to write code" layer — every rule below was a real
bug in the previous build. Follow them from day one; do not wait to
rediscover them.

## Query Rules

- **Global vs branch-scoped rows**: any table where `branch_id` can be
  `null` (tasks, food_safety_standards) means "applies to all branches."
  ALWAYS query with:
  ```js
  .or(`branch_id.eq.${branchId},branch_id.is.null`)
  ```
  Never `.eq('branch_id', branchId)` alone — it silently drops global rows.

- **Per-branch expected counts**: when calculating "how many tasks apply to
  this branch," filter explicitly:
  ```js
  const expected = taskDefs.filter(t => t.branch_id === null || t.branch_id === branchId).length
  ```
  Never use the raw array length as a denominator for a single branch.

- **Date filtering**: use explicit UTC bounds, there is no `submission_date`
  column:
  ```js
  .gte('submitted_at', today + 'T00:00:00.000Z')
  .lte('submitted_at', today + 'T23:59:59.999Z')
  ```

- **Multiple independent queries on one page**: always `Promise.all()`, never
  sequential `await`.

- **Column selection**: never `.select('*')` on a query returning a list.
  Name only the columns actually used.

- **Rate/percentage math**: never compute completion rate inline in a
  component. Use shared utilities (`getExpectedForBranch`, `calcRate`,
  `calcPending`) that handle divide-by-zero and branch filtering correctly.
  A completion rate is never allowed to render above 100%.

## Real-Time Rules

- Callbacks passed to `.on('postgres_changes', ...)` must be **synchronous**
  wrappers — never `async () => await fetchData()`. Call a plain function
  that is async internally.
- Every channel name must include a unique identifier:
  `.channel(\`owner-dashboard-${profile.id}\`)` — generic names collide
  between concurrent users.
- Every subscription's `useEffect` must return
  `() => supabase.removeChannel(channel)`. No exceptions.
- Every real-time callback must invalidate any local cache before refetching,
  or the UI shows stale data despite the "live" update.

## Auth/Client Rules
(See comanager-auth for full detail — summarized here as it affects every page)
- One Supabase client per panel: `supabaseBranchManager`, `supabaseOwner`, `supabaseAdmin`.
- Never share one client across panels.
- Temp signup clients: `persistSession: false` + unique `storageKey`.
- Never `localStorage.clear()` / `sessionStorage.clear()` in auth flow.
- **Data isolation is enforced via Postgres RLS, not app-level filtering
  alone.** Every restaurant-data table has RLS policies scoped by role
  (see `comanager-schema.sql`). App-level `.eq('branch_id', x)` is still
  good practice for correctness/performance, but it is not the security
  boundary — RLS is. Never treat an app-level filter as sufficient
  protection for cross-restaurant data isolation.
- **The branch-manager cap (2 active per branch) is enforced by a database
  trigger** (`enforce_manager_cap` in `comanager-schema.sql`), not just a
  pre-check in application code. If you add any new path that creates or
  reactivates a branch_manager user, it goes through this same trigger —
  don't bypass it with a raw insert that skips validation.

## Validation Rules
- Before any task/food-safety submission, validate `requires_photo`,
  `requires_note`, `requires_value` against what was actually provided.
  Reject client-side before the insert, with a bilingual error message.
- Every insert into `tasks` or `food_safety_standards` must explicitly set
  `is_active: true`.

## React Rules
- Never use array index as a `key` — always the real Supabase UUID (`item.id`).
- Lazy-load every route-level page component with `React.lazy()` +
  `<Suspense>`. Never statically import all pages in the router file.
- Double-check Arabic/English string order in every ternary —
  `isArabic ? arabicText : englishText`, verified both ways, not assumed.

## Dev Environment
- Only one dev server running at a time.
- Remove all `console.log`; only `console.error` inside catch blocks is allowed in shipped code.
- Confirm delete/destructive actions with a proper modal, not `window.confirm`
  (breaks with mixed Arabic/English strings) — wrap in try/catch, and
  invalidate any cached list after a successful delete.

## Dependency Decisions

- **No charting/animation library — hand-built SVG + CSS/Tailwind
  transitions only (locked 2026-08-05, during the Reports page rebuild).**
  A founder brief explicitly named `recharts` and a `Motion`/`framer-motion`
  library for that rebuild. Considered it directly — asked the founder
  rather than guessing — and the founder chose to keep extending this
  app's existing hand-rolled SVG chart pattern (used everywhere else
  already) instead: zero new dependencies, and no reason to put an
  already-verified-working build at risk for a swap with no clear benefit
  at this app's scale (comanager-logic: ~100 owners). **This was a
  considered decision, not an oversight or something nobody thought
  of — do not silently revisit it.**
  **Rule:** if a future brief names a specific charting or animation
  library again, that's a conflict with this locked decision, not a green
  light — flag it and ask the founder before proceeding, same as any other
  locked-decision conflict in this project (comanager-context's own "THIS
  FILE WINS" framing: surface the conflict, never silently pick a side).
  Do not add the library just because a brief named it, and do not ignore
  a direct founder instruction to add it either — ask.

## Adding a new rule
When a new bug is found and fixed, add it here immediately in this format,
and never delete an existing entry:

```
### Rule — short description
**Why:** what broke
**Wrong:** the pattern that caused it
**Correct:** the fixed pattern
```
