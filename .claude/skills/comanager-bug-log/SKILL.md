---
name: comanager-bug-log
description: >
  MANDATORY — Read this before writing ANY code for Co Manager.
  Contains every bug that has been fixed, plus bugs known from the prior
  Scoop/OpsPilot build that are seeded here because Co Manager shares the
  same schema and stack risk areas. If you are about to write code that
  matches a WRONG example below — STOP and use the CORRECT pattern instead.
  When you fix a new bug, add it to this file immediately, in the same turn
  as the fix, using the format at the bottom. Logging is the last step of
  the fix, not an optional follow-up.
---

# CO MANAGER BUG LOG — Permanent Memory

> This file is Claude Code's memory for this project. A bug fixed once must
> never be fixed twice. Read every section before writing any code that
> touches auth, real-time, task/food-safety data, or column names.
>
> Entries marked **[SEEDED]** are carried over from the Scoop/OpsPilot
> lineage (same schema, same stack risk areas) — not yet re-triggered in
> Co Manager, but the exact same trap exists here, so treat them as live.
> Entries without that tag were found in THIS project.

---

## ⚠️ HOW TO USE THIS FILE

1. Read the entire file before writing code — especially before touching
   auth, real-time subscriptions, or any `task_submissions` /
   `food_safety_submissions` query.
2. If your code matches any WRONG example → stop, use CORRECT instead.
3. When you fix a new bug → add it at the bottom immediately, same turn,
   using the template at the end of this file. Never skip this step.
4. Never delete or "clean up" old entries — they exist to prevent
   regressions, including ones that haven't happened yet in this project.
5. If a SEEDED entry turns out not to apply (e.g. framework difference),
   don't delete it — mark it `[NOT APPLICABLE — Next.js App Router handles
   this]` with one line of reasoning, so the decision is recorded instead
   of silently vanishing.

---

## 🔴 CRITICAL — Auth & Session

### BUG #001 — Logout on Page Refresh [SEEDED]
**Severity:** CRITICAL (recurred 3 times in prior build)
**Area:** Session-check / protected route logic, all 3 panels

**WRONG:**
```ts
// Short timeout + clearing storage destroys session on slow connections
setTimeout(() => {
  if (!user) {
    localStorage.clear()       // ← DESTROYS Supabase session
    sessionStorage.clear()     // ← DESTROYS Supabase session
    router.push('/login')
  }
}, 3000) // ← too short, slow connections fail
```

**CORRECT:**
```ts
setTimeout(() => {
  if (!user) {
    router.push('/login') // only redirect, never clear storage
  }
}, 8000) // minimum 8s — see comanager-auth
```

**Rule:** NEVER call `localStorage.clear()` / `sessionStorage.clear()` anywhere
in the auth flow. NEVER use a session-check timeout shorter than 8 seconds.
(Also stated in comanager-auth — this is the enforcement record.)

---

### BUG #002 — Manager Creation Logs Out Owner [SEEDED]
**Severity:** CRITICAL
**Area:** Owner → Managers → "Add manager" flow

**WRONG:**
```ts
// Temp client shares storage with the owner's session — overwrites it
const supabaseTemp = createClient(url, key)
```

**CORRECT:**
```ts
const supabaseTemp = createClient(url, key, {
  auth: {
    persistSession: false,
    storageKey: 'comanager-temp-signup', // unique, never collides
  },
})
```

**Rule:** Any temporary Supabase client used for manager creation MUST use
`persistSession: false` and a unique `storageKey`. (See comanager-auth.)

**[Phase 1 update, 2026-07-26]** Co Manager's actual manager-creation flow
(`app/owner/managers/actions.ts`) ended up server-side — a Server Action
using `auth.admin.createUser()` with `email_confirm: true` via a
service-role client, not a browser-side temp client calling `signUp()`.
This was necessary because Supabase's "Confirm email" setting is global:
owner registration needs it ON (comanager-logic §1's verification gate),
but a manager created via public `signUp()` would then also need to click
an email link before their first login, breaking "hand off password, log
in immediately, no invite flow." `admin.createUser()` sidesteps this by
setting the confirmation flag explicitly regardless of the project-wide
setting. Since this path never creates a browser session at all, the
specific risk this bug describes (a temp client's `signUp()` call
overwriting the owner's session in storage) does not apply to it — mark
this mitigation **[NOT APPLICABLE to server-side manager creation]**. The
underlying rule still stands for any future browser-side temp-client usage
elsewhere in the app.

---

## 🔴 CRITICAL — Data Isolation

### BUG #003 — RLS Skipped in Favor of App-Level Filtering [SEEDED]
**Severity:** CRITICAL
**Area:** Any query against `branches`, `tasks`, `task_submissions`,
`food_safety_standards`, `food_safety_submissions`, `schedule_events`

**WRONG:**
```ts
// Relying only on app code to scope the query
const { data } = await supabase
  .from('tasks')
  .select('*')
  .eq('branch_id', branchId) // no RLS backing this — bypassable
```

**CORRECT:**
```ts
// App-level filter AND a matching RLS policy must both exist.
// RLS policy (run once, in the schema):
//   CREATE POLICY branch_manager_tasks ON tasks FOR SELECT
//   USING (branch_id = (SELECT branch_id FROM users WHERE id = auth.uid())
//          OR branch_id IS NULL);
const { data } = await supabase
  .from('tasks')
  .select('id, title, title_ar, frequency, branch_id')
  .eq('branch_id', branchId)
```

**Rule:** Every restaurant-data table needs an RLS policy BEFORE the first
page that queries it is written — not after. App-level filtering alone is
not a security boundary (see comanager-logic §3).

---

## 🔴 CRITICAL — Column Names (schema drift)

### BUG #004 — food_safety_submissions Using Wrong Column [SEEDED]
**Severity:** CRITICAL (caused silent bugs in 6 files last time)

**WRONG:**
```ts
.eq('status', 'pass')   // ← column does not exist on this table
.select('status')
```

**CORRECT:**
```ts
.eq('result', 'pass')   // ← 'result', not 'status'
.select('result')
```

**Rule:** `food_safety_submissions` uses `result` (pass | fail | pending),
never `status`. No exceptions. (See comanager-context schema.)

---

### BUG #005 — task_submissions Wrong Column Names [SEEDED]
**Severity:** HIGH

**WRONG:**
```ts
{ notes: 'text' }             // ← column is 'note', no s
{ numeric_value: 5.0 }        // ← column is 'value_entered'
.eq('submission_date', today) // ← column does not exist
```

**CORRECT:**
```ts
{ note: 'text' }
{ value_entered: 5.0 }
.gte('submitted_at', `${today}T00:00:00.000Z`)
.lte('submitted_at', `${today}T23:59:59.999Z`)
```

**Rule:** `task_submissions` real columns: `note`, `value_entered`,
`submitted_at`. `food_safety_submissions` real columns: `result`,
`actual_value`, `corrective_note`, `submitted_at`.

---

### BUG #006 — schedule_events Wrong Owner Column [SEEDED]
**Severity:** HIGH

**[NOT APPLICABLE to Co Manager — corrected 2026-07-27 during Phase 2.]**
Verified directly against the live DB: Co Manager's `schedule_events` DOES
have an `owner_id` column (`comanager-schema.sql` already had it — this
SEEDED entry was carried over from the old OpsPilot build, where the
column genuinely didn't exist, without re-checking it against the new
schema). `comanager-context`'s schema section was also wrong on this point
and has been fixed. Use `owner_id` directly for owner-scoped queries —
there's no need to join through `branches.owner_id` the way the old
(wrong-for-here) example below suggests.

**WRONG (for the OLD OpsPilot schema only, not Co Manager):**
```ts
.eq('owner_id', ownerId) // ← column does not exist on schedule_events
```

**CORRECT (for the OLD OpsPilot schema only, not Co Manager):**
```ts
.eq('created_by', userId) // schedule_events has created_by, not owner_id
```

**Rule (Co Manager, current):** `schedule_events` has both `owner_id` and
`created_by` — use `owner_id` to scope by owner, `created_by` to record
who actually created the event (may differ if a future flow lets managers
create events, though today only owners do).

---

## 🟠 HIGH — Query Patterns

### BUG #007 — Global Tasks/Standards Not Showing [SEEDED]
**Severity:** HIGH
**Area:** Any task/standard query (owner or branch manager side)

**WRONG:**
```ts
.eq('branch_id', branchId) // misses branch_id = null (global) rows
```

**CORRECT:**
```ts
.or(`branch_id.eq.${branchId},branch_id.is.null`)
```

**Rule:** ALWAYS use the `.or(branch_id.eq.X,branch_id.is.null)` pattern for
tasks and food_safety_standards queries. Never `.eq()` alone. (See
comanager-conventions.)

---

### BUG #008 — select('*') on Heavy Queries [SEEDED]
**Severity:** MEDIUM

**WRONG:**
```ts
.select('*')
```

**CORRECT:**
```ts
.select('id, title, title_ar, frequency, branch_id, requires_photo, requires_note, requires_value')
```

**Rule:** Never `.select('*')` on dashboard/list queries — specify columns.

---

## 🟠 HIGH — Real-Time

### BUG #009 — Async Real-Time Callbacks [SEEDED]
**Severity:** HIGH

**WRONG:**
```ts
.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_submissions' }, async () => {
  await fetchData() // async callback silently misbehaves
})
```

**CORRECT:**
```ts
.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_submissions' }, () => {
  fetchData() // sync callback; fetchData is async internally
})
```

**Rule:** Realtime `.on()` callbacks must never be declared `async`.

---

### BUG #010 — Real-Time Channels Not Unique [SEEDED]
**Severity:** HIGH

**WRONG:**
```ts
.channel('owner-dashboard')
```

**CORRECT:**
```ts
.channel(`owner-dashboard-${profile.id}`)
```

**Rule:** Every channel name must include a unique identifier
(`profile.id`, `branchId`, or `ownerId`) — see comanager-logic §6.

---

### BUG #011 — Real-Time Channels Missing Cleanup [SEEDED]
**Severity:** HIGH (memory leak)

**WRONG:**
```ts
useEffect(() => {
  const channel = supabase.channel('...').on(...).subscribe()
  // no cleanup
}, [])
```

**CORRECT:**
```ts
useEffect(() => {
  const channel = supabase.channel('...').on(...).subscribe()
  return () => { supabase.removeChannel(channel) }
}, [])
```

**Rule:** Every real-time subscription's `useEffect` must return a cleanup
that calls `supabase.removeChannel(channel)`.

---

## 🟡 MEDIUM — React / Next.js Specific

### BUG #012 — React Keys Using Array Index [SEEDED]
**Severity:** MEDIUM

**WRONG:**
```tsx
{tasks.map((task, i) => <div key={i}>...</div>)}
```

**CORRECT:**
```tsx
{tasks.map(task => <div key={task.id}>...</div>)}
```

**Rule:** Never use array index as a React key — always the real Supabase
UUID.

---

### BUG #013 — Photo/Note/Value Validation Not Enforced [SEEDED]
**Severity:** MEDIUM
**Area:** Branch manager task/food-safety submission

**WRONG:**
```ts
const handleSubmit = async () => {
  await insertSubmission() // no validation against requires_* flags
}
```

**CORRECT:**
```ts
const handleSubmit = async () => {
  if (task.requires_photo && !photoUrl) return setError(t('photo_required'))
  if (task.requires_note && !note.trim()) return setError(t('note_required'))
  if (task.requires_value && valueEntered == null) return setError(t('value_required'))
  await insertSubmission()
}
```

**Rule:** Always validate `requires_photo` / `requires_note` /
`requires_value` client-side before submission AND re-check server-side —
never trust the client alone.

---

## 🟢 [NOT APPLICABLE — adapted for this stack]

- **Old "no lazy loading" bug** — was React-SPA-specific (manual
  `React.lazy()` per route). Next.js App Router does route-based code
  splitting automatically. Not applicable here; do not re-add manual
  `lazy()` wrapping for page routes.

---

## 📋 SUMMARY — Column Name Rules

```
task_submissions:          note, value_entered, submitted_at, status
food_safety_submissions:   result (NOT status), actual_value, corrective_note, submitted_at
schedule_events:           created_by (NOT owner_id)
tasks / food_safety_standards: is_active must be true on every insert
```

## 📋 SUMMARY — Query Rules

```
Tasks/standards query:  ALWAYS .or('branch_id.eq.X,branch_id.is.null')
Date filter:            ALWAYS .gte(...T00:00:00.000Z).lte(...T23:59:59.999Z)
Column select:          NEVER select('*') on list/dashboard queries
React keys:             NEVER array index — always item.id
```

## 📋 SUMMARY — Auth / Real-Time Rules

```
Temp signup client:  persistSession: false + unique storageKey
Never:               localStorage.clear() / sessionStorage.clear() in auth flow
Session timeout:     minimum 8 seconds before redirecting to login
Channel names:       always include a unique ID
Callbacks:           never async
Cleanup:             always supabase.removeChannel(channel) on unmount
```

---

### BUG #014 — Phone Collected at Signup, Never Persisted
**Severity:** MEDIUM
**Area/File:** `handle_new_user` trigger, comanager-schema.sql

**WRONG:**
```sql
insert into public.users (id, email, role, name, branch_id)
values (new.id, new.email, ..., ..., ...)
-- phone is collected on the owner signup form but the trigger never
-- writes it anywhere, so it's silently dropped on every signup.
```

**CORRECT:**
```sql
insert into public.users (id, email, role, name, restaurant_name, restaurant_name_ar, phone, branch_id)
values (new.id, new.email, ..., ..., ..., ..., nullif(new.raw_user_meta_data->>'phone',''), ...)
```

**Rule:** Every field collected on a signup form must have a real column
write path in `handle_new_user` — check the trigger's insert list against
the actual form fields, not just against the schema's column list.

---

### BUG #015 — enforce_manager_cap's Exception Gets Swallowed by handle_new_user
**Severity:** HIGH (identified, NOT fixed — deferred, see below)
**Area/File:** `handle_new_user` + `enforce_manager_cap` triggers, comanager-schema.sql

**Found during:** Phase 1 auth build, while wiring `/owner/managers`
manager creation through `admin.createUser()`.

**The problem:** `enforce_manager_cap` is a `BEFORE INSERT OR UPDATE`
trigger on `public.users` that raises an exception when a branch would
exceed 2 active managers — this is supposed to be the DB-level guarantee
(comanager-logic §2: "the layer that actually matters"). But
`handle_new_user`'s insert into `public.users` fires that same trigger as
part of its own statement, and `handle_new_user` wraps its insert in
`EXCEPTION WHEN OTHERS THEN RETURN new` (required so a crash never blocks
signup — see BUG's own safe-trigger rule in comanager-auth). That blanket
handler also swallows a legitimate `enforce_manager_cap` violation: the
`auth.users` row already exists (created by the `admin.createUser()` /
`signUp()` call, which already committed before this trigger runs), but
the matching `public.users` row silently never gets created — producing
exactly a "Profile not found" orphaned account (comanager-auth's own
diagnosis section) instead of a clear, blocked creation.

**Why not fixed now:** out of scope for Phase 1 per explicit instruction
(DB trigger work excluded this phase). The app-level pre-check added in
`app/owner/managers/actions.ts` (count active managers before calling
`admin.createUser()`) prevents this from being hit in the normal
(non-racing) case, so it's not blocking today's flow — but it's a real gap
under concurrent requests or any direct-SQL/raw-insert path that bypasses
the app layer.

**Suggested fix (not applied):** either make `handle_new_user` re-raise
specific business-rule exceptions (e.g. check `SQLSTATE` and only swallow
genuinely unexpected errors), or have `enforce_manager_cap` run as an
`AFTER` trigger with its own transaction-level guarantee that isn't nested
inside `handle_new_user`'s exception scope.

**Rule:** A `SECURITY DEFINER` trigger with a blanket exception handler can
silently absorb a *different* trigger's legitimate business-rule violation
if both fire on the same statement — audit trigger chains on the same
table for this interaction, not just each trigger in isolation.

---

### BUG #016 — submitted_by Never Set on Task/Food-Safety Submission
**Severity:** HIGH
**Area/File:** `app/branch-manager/tasks/page.tsx`, `app/branch-manager/food-safety/page.tsx`

**Found during:** Phase 3 end-to-end testing — the Owner Dashboard's
Recent Activity feed showed "Someone completed 'Closing Checklist'"
instead of the manager's actual name.

**WRONG:**
```ts
await client.from("task_submissions").update({
  status: "completed",
  submitted_at: new Date().toISOString(),
  note: ...,
  value_entered: ...,
}).eq("id", submission.id);
// submitted_by is never set — stays whatever it was on the pre-created
// pending row (null), so nothing downstream can attribute the submission
// to a manager.
```

**CORRECT:**
```ts
await client.from("task_submissions").update({
  status: "completed",
  submitted_by: profile.id, // the authenticated manager's own id
  submitted_at: new Date().toISOString(),
  note: ...,
  value_entered: ...,
}).eq("id", submission.id);
```

**Rule:** Any submission-completing UPDATE (`task_submissions`,
`food_safety_submissions`) must set `submitted_by` to the authenticated
manager's own profile id — every downstream feature that attributes work
to a person (Recent Activity, food-safety fail alerts showing who
submitted, future manager performance views) depends on this being set at
submission time, not filled in later.

---

### BUG #017 — Email Confirmation Tokens Arrive as a URL Hash Fragment, Not a Query Param
**Severity:** CRITICAL
**Area/File:** `app/auth/confirm/` (was `route.ts`, now `page.tsx`), `app/owner/register/actions.ts`

**Found during:** adding `emailRedirectTo` to the owner `signUp()` call so
the default "Confirm signup" email template would work without needing a
manual template edit. Verified by generating a real signup link via the
admin API and following its actual redirect chain (`fetch(..., {redirect:
"manual"})` and reading the `Location` header) instead of assuming.

**The problem:** it's tempting to assume that because
`lib/supabase/client.ts`/`server.ts` set `flowType: "pkce"`, the
confirmation redirect would carry a `?code=` query param, handleable in a
server-side Route Handler via `exchangeCodeForSession(code)`. It doesn't.
Supabase's hosted `/auth/v1/verify` endpoint (what `{{ .ConfirmationURL }}`
points to) redirects with the session directly in a **URL hash
fragment** — `#access_token=...&refresh_token=...&type=signup` —
regardless of the client's configured `flowType`. Hash fragments are
never sent to the server by the browser at all (they're stripped before
the request leaves the client), so **no server-side Route Handler can
ever see this format, no matter how it's written.**

**WRONG:**
```ts
// app/auth/confirm/route.ts (a server Route Handler)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code"); // always null for this link format
  const token_hash = searchParams.get("token_hash"); // also null
  // ...never reaches the tokens that actually arrived in the #fragment
}
```

**CORRECT:**
```tsx
// app/auth/confirm/page.tsx — a Client Component, so window.location.hash
// is actually readable.
"use client";
useEffect(() => {
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  if (accessToken && refreshToken) {
    client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  }
}, []);
```

**Rule:** Any page handling a Supabase email-link redirect (confirmation,
magic link, recovery) must be a Client Component if it needs to read
`access_token`/`refresh_token` — check the *actual* redirect (via a real
generated link + `fetch(url, {redirect:"manual"})` and reading `Location`)
before assuming query-param vs. hash-fragment format. Never assume based
on `flowType` alone; the hosted email-verify endpoint behaves differently
from OAuth/PKCE redirects.

---

### BUG #018 — subscriptions Insert Hit owner_id FK Violation Right After signUp()
**Severity:** HIGH
**Area/File:** `app/owner/register/actions.ts`

**Found during:** live registration testing — the founder hit "Something
went wrong setting up your trial." Server logs showed the real error:

```
insert or update on table "subscriptions" violates foreign key constraint "subscriptions_owner_id_fkey"
Key (owner_id)=(...) is not present in table "users"
```

**Investigation:** `handle_new_user` creates the matching `public.users`
row inside the same trigger chain as the `auth.users` insert, so by the
time `signUp()` resolves it should already be visible to any subsequent
query. A clean-room reproduction (calling `signUp()` directly, then
immediately querying `public.users` for the new id) succeeded without
issue, and no orphaned `auth.users` rows (with no matching `public.users`
row) were found anywhere in the project. **Root cause not conclusively
identified** — this was either a genuine one-off timing/visibility gap
between the trigger's commit and the next query seeing it, or a rare
silent failure inside `handle_new_user`'s blanket
`EXCEPTION WHEN OTHERS THEN RETURN new` handler (the same swallowing
mechanism already flagged in BUG #015, there scoped only to the
manager-cap trigger interaction — this incident suggests the risk is
broader: ANY unexpected error during that insert gets silently absorbed
for ANY signup, not just manager creation).

**WRONG:**
```ts
const { data } = await supabase.auth.signUp({ email, password, options: { data: {...} } });
// assumes the public.users row handle_new_user creates is already
// visible the instant signUp() resolves — inserts into subscriptions
// immediately, with no defense against it not being there yet.
await admin.from("subscriptions").insert({ owner_id: data.user.id, ... });
```

**CORRECT:**
```ts
const { data } = await supabase.auth.signUp({ email, password, options: { data: {...} } });

// Poll briefly before trusting the row exists — cheap insurance against
// a timing gap, and correctly distinguishes "not visible yet" from "the
// trigger silently failed" (the latter needs a clearer error + rollback,
// not a blind retry of the subscriptions insert).
const profileReady = await waitForUserProfile(admin, data.user.id); // 5 attempts, 200ms apart
if (!profileReady) {
  await admin.auth.admin.deleteUser(data.user.id);
  return { error: "Something went wrong creating your account. Please try again." };
}
await admin.from("subscriptions").insert({ owner_id: data.user.id, ... });
```

**Rule:** Never assume a value written by a database trigger fired as a
side effect of an Auth API call (`signUp`, `admin.createUser`) is
immediately visible to a *separate* subsequent query, even though in
principle the trigger runs inside the same committed transaction. Poll
briefly before depending on it, and treat "still not there after
retrying" as a distinct, more serious failure mode than "not there yet."

---

## ➕ HOW TO ADD A NEW BUG

When you fix a new bug, add it at the bottom of the relevant severity
section, in the same turn as the fix, using this format:

```
### BUG #XXX — Short Description
**Severity:** CRITICAL / HIGH / MEDIUM / LOW
**Area/File:** where this lives

**WRONG:**
\`\`\`ts
// the bad code that caused the bug
\`\`\`

**CORRECT:**
\`\`\`ts
// the fixed code that works
\`\`\`

**Rule:** One sentence summary of the rule to never break.
```

Do not mark it `[SEEDED]` — that tag is reserved for entries carried over
from the prior project's log.

---

*Seeded 2026-07-26 from the Scoop/OpsPilot bug log, filtered to entries
relevant to Co Manager's schema and Next.js/Supabase stack.*
