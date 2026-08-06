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

### BUG #019 — Cross-Owner Data Leak on Globally-Scoped Tasks/Standards/Events
**Severity:** CRITICAL
**Area/File:** `comanager-schema.sql` RLS policies for `tasks`,
`food_safety_standards`, `schedule_events`

**Found during:** live browser verification (2026-07-29) of the branch-cap
and tasks-as-checklists work — a brand-new test owner account (freshly
registered, 0 branches, 0 managers) immediately showed two pre-existing
tasks ("Opening Checklist", "Opening Checklist (copy)") on its Tasks page
that it never created. Traced to the RLS policy, not app code.

**The problem:** `"manager reads applicable {tasks|fs standards|schedule
events}"` is a separate PERMISSIVE `for select` policy alongside `"owner
manages own {table}"` (a `for all` policy scoped to `owner_id =
auth.uid()`). Postgres OR's all permissive policies together for a given
command — so a row is visible if it satisfies EITHER policy. The manager
policy's `branch_id is null` arm has no ownership check at all, and
`my_branch_id()` returns NULL for every owner (owners have no `branch_id`
on their `users` row), so `branch_id = my_branch_id()` never matches for
an owner but `branch_id is null` always does. Net effect: every owner (and
every branch manager) on the entire platform could `select` every OTHER
owner's globally-scoped ("all branches") tasks, food-safety standards, and
schedule events — a real multi-tenant data isolation break, not just a
theoretical one (reproduced live).

**WRONG:**
```sql
create policy "manager reads applicable tasks"
  on public.tasks for select
  using (branch_id = public.my_branch_id() or branch_id is null);
  -- the `or branch_id is null` arm matches ANY owner's global tasks,
  -- for ANY other authenticated user, since it never checks owner_id
```

**CORRECT:**
```sql
create or replace function public.my_owner_id()
returns uuid language sql security definer stable as $$
  select case
    when public.my_role() = 'owner' then auth.uid()
    else (select owner_id from public.branches where id = public.my_branch_id())
  end;
$$;

create policy "manager reads applicable tasks"
  on public.tasks for select
  using (
    branch_id = public.my_branch_id()
    or (branch_id is null and owner_id = public.my_owner_id())
  );
```

**Rule:** Any RLS policy with a `branch_id is null` (or similarly
"global-scope") arm MUST also check ownership on that arm — `is null`
alone is never sufficient, because NULL matches across every tenant, not
just the current one. When auditing multi-tenant RLS, check each
PERMISSIVE policy on a table together (they OR together for the same
command), not just each policy in isolation — a narrow-looking policy on
one row's `using` clause can still widen what's visible when combined
with a sibling policy for the same command. Applies to `tasks`,
`food_safety_standards`, and `schedule_events` identically; fixed in all
three in the same pass. **✅ Confirmed applied to the live DB 2026-08-01**
via direct `supabase db query` access — `my_owner_id()` exists and the
`"manager reads applicable tasks"` policy references it (see
PENDING_MANUAL_STEPS.md §2.5).

---

### BUG #020 — Untrimmed Login Input Causes False "Invalid Email or Password"
**Severity:** HIGH
**Area/File:** `lib/auth/use-login-form.ts` (shared by all 3 panel login pages)

**Found during:** investigating a founder report of a branch manager
login failing with "Invalid email or password" using credentials that
had just been created and shown in the `/owner/managers` "Manager
created" modal. Verified the account itself was fine: `signInWithPassword`
against the raw Auth API succeeded (200) with the exact stored
credentials, `email_confirmed_at` was set, and the matching `public.users`
row had `role='branch_manager'` and `is_active=true` — the account was
never the problem. Isolated the actual cause empirically: hitting the
Auth API directly with the same correct password plus one trailing space
or newline reproduced the exact same generic failure
(`400 Invalid login credentials`) that the app shows as "Invalid email or
password." `createManager` (`app/owner/(authenticated)/managers/actions.ts`)
already `.trim().toLowerCase()`s the email before creating the account, so
the stored credentials are clean — the gap is entirely on the login side.

**The problem:** the credentials-created modal
(`app/owner/(authenticated)/managers/page.tsx`) displays the email and
password in two separate stacked `<p>` tags — a well-known copy/paste
footgun where selecting across block-level elements (e.g. via
triple-click, or a drag-select that runs slightly long) can include a
trailing newline in the clipboard. `use-login-form.ts` then passed
whatever the input held straight into `signInWithPassword` with no
trimming, so a single stray trailing space or newline picked up during
copy-paste silently produces a generic "wrong credentials" error — even
though the account, password, and role are all completely correct —
and there's no way for the person logging in to tell the difference.

**WRONG:**
```ts
const { data, error: signInError } = await client.auth.signInWithPassword({
  email,
  password,
});
```

**CORRECT:**
```ts
const { data, error: signInError } = await client.auth.signInWithPassword({
  email: email.trim(),
  password: password.trim(),
});
```

**Rule:** Always trim login input (email and password) before calling
`signInWithPassword` — GoTrue does an exact string match on both fields,
so a single stray whitespace character (very easy to introduce via
copy-paste from a credentials-display UI, especially one using
stacked block-level elements rather than a single copyable field) causes
a real login failure that's indistinguishable from a genuinely wrong
password. When diagnosing a report like this, verify the account itself
first (raw Auth API + `email_confirmed_at` + `public.users` role/
is_active) before assuming the reported credentials are actually what
was typed/pasted — a clean account plus a reproducible whitespace-only
failure mode is strong evidence of this exact bug, not a data problem.

---

### BUG #021 — Deployed Edge Function 401s on Its Own CRON_SECRET Check
**Severity:** HIGH
**Area/File:** `supabase/config.toml` (new), `supabase/functions/generate-daily-slots/`, `PENDING_MANUAL_STEPS.md` §3.2

**Found during:** the founder deployed `generate-daily-slots` and called it
with the documented `Authorization: Bearer <CRON_SECRET>` header, but got
`401 Unauthorized` before ever reaching the function's own auth check
(the one in `index.ts` comparing against `CRON_SECRET` and returning its
own `401` with body `"Unauthorized"`) — the response had no body at all,
which is the platform's own rejection, not ours.

**The problem:** Supabase's platform-level JWT verification is **on by
default** for every deployed Edge Function and runs *before* the
function's code executes at all. It expects the `Authorization` header to
carry a valid Supabase-issued JWT (anon key, service-role key, or a user
session token) — our `CRON_SECRET` is an arbitrary shared secret, not a
JWT, so the platform itself rejects it with `401` regardless of what
`index.ts` does. This repo never had a `supabase/config.toml`, so there
was nothing telling the CLI to disable that check for this specific
function, and the deploy command documented in `PENDING_MANUAL_STEPS.md`
didn't pass `--no-verify-jwt` either.

**WRONG:**
```bash
supabase functions deploy generate-daily-slots
# platform-level JWT verification stays on; any call with a
# non-JWT Authorization header (like our CRON_SECRET) 401s before
# index.ts's own check ever runs
```

**CORRECT:**
```toml
# supabase/config.toml — scoped to just this function, not global
[functions.generate-daily-slots]
verify_jwt = false
```
```bash
supabase functions deploy generate-daily-slots --no-verify-jwt
```

**Rule:** Any Edge Function whose caller isn't a Supabase-authenticated
client (cron jobs, webhooks, server-to-server calls using a custom shared
secret) needs `verify_jwt = false` for that specific function in
`supabase/config.toml` (and/or `--no-verify-jwt` on deploy) — otherwise
the platform's own JWT check rejects the request before your function's
code, including its own auth logic, ever runs. Never set this globally;
scope it per-function so any future function meant to be called from an
authenticated browser client keeps real JWT verification on.

---

### BUG #022 — Duplicate sort_order When Editing a Task With Mixed Existing/New Items
**Severity:** MEDIUM
**Area/File:** `app/owner/(authenticated)/tasks/page.tsx` — `handleEdit`, `insertItems`

**Found during:** full regression pass (2026-07-29) — edited an existing
3-item task, removed one item and added a new one in the same save, then
checked `task_items.sort_order` directly in the DB. Two rows had
`sort_order = 0`.

**The problem:** `handleEdit` reconciles items in two separate groups —
existing items (have an `id`, go through an `update`) and new items (no
`id`, go through `insertItems`) — and computed each group's `sort_order`
from that group's OWN index via `.map((it, index) => ...)`, not from the
item's actual position in the full `values.items` array as arranged in
the form. Both groups independently start counting from 0, so whenever
both existing and new items are present after an edit, their `sort_order`
values collide instead of reflecting the real combined order. Doesn't
break `handleCreate` (there, every item is "new" so the whole array's
index already is the combined order) — only shows up on edit.

**WRONG:**
```ts
const updates = values.items
  .filter((it) => !!it.id)
  .map((it, index) => // index within the existing-only subset
    client.from("task_items").update({ sort_order: index, ... }).eq("id", it.id));

const newItems = values.items.filter((it) => !it.id);
insertItems(taskId, newItems); // insertItems assigns sort_order from
                                // ITS OWN array's index too — 0-based again
```

**CORRECT:**
```ts
// Compute index from the ONE combined array first, then split
const itemsWithIndex = values.items.map((item, sortOrder) => ({ item, sortOrder }));

const updates = itemsWithIndex
  .filter((x) => !!x.item.id)
  .map(({ item: it, sortOrder }) =>
    client.from("task_items").update({ sort_order: sortOrder, ... }).eq("id", it.id));

const newEntries = itemsWithIndex.filter(({ item }) => !item.id);
insertItems(taskId, newEntries); // insertItems now takes { item, sortOrder }
                                  // pairs and uses the passed sortOrder directly
```

**Rule:** When splitting one ordered array into subsets for different
DB operations (update vs. insert, active vs. removed, etc.), compute any
value that depends on position (`sort_order`, rank, index) from the
ORIGINAL combined array before splitting — never re-derive it from a
subset's own enumeration, since each subset restarts at 0 independently
and positions collide the moment more than one subset is non-empty.

---

### BUG #023 — Realtime Never Fires: Tables Never Added to supabase_realtime Publication
**Severity:** CRITICAL
**Area/File:** Supabase project config (not app code) — affects every page using `useRealtimeTable`

**Found during:** full regression pass (2026-07-29) — had the owner
Dashboard open in one tab, submitted a food-safety reading as a branch
manager in another tab, and the Dashboard's stat cards / Recent Activity
never updated without a manual refresh. Verified the write itself
succeeded (`result: "pass"`, `submitted_by` set correctly in the DB) —
this ruled out "the submission failed" immediately. Root-caused with a
standalone Node script using `@supabase/supabase-js` directly (no
React/browser involved at all): subscribed to `postgres_changes` on
`food_safety_submissions`, got `SUBSCRIBED`, triggered a real `UPDATE` via
the service-role client, and received **zero events** after 8 seconds.
Repeated the identical test against `task_submissions` — same result.

**The problem:** `lib/supabase/use-realtime.ts` (the shared hook every
page uses) is correct — `event: "*"`, unique channel name per caller,
proper cleanup, synchronous callback wrapper (matches BUG#009/010/011's
rules exactly). The gap is entirely at the Supabase project level:
Postgres's logical-replication publication that Realtime reads from
(`supabase_realtime`) never had these tables added to it. This is a
one-time setup step (SQL `ALTER PUBLICATION ... ADD TABLE` or the
Dashboard's Database → Replication toggle) — it does **not** happen
automatically just because a table has RLS enabled, and nothing in this
project's history (schema file, PENDING_MANUAL_STEPS.md) ever asked for
it to be done. The entire "live updates without refresh" feature — the
whole point of the "LIVE" badge on the owner Dashboard — has likely never
actually worked for any table.

**WRONG (diagnosis to avoid):**
Assuming this is an app bug and rewriting `useRealtimeTable`, the
channel-name logic, or the callback wiring — none of that is broken. A
correct hook subscribed to a table that was never added to the
publication will reliably report `SUBSCRIBED` and then just... never
receive anything, with no error surfaced anywhere in the browser.

**CORRECT (this is a database configuration fix, not a code fix):**
```sql
alter publication supabase_realtime add table
  public.task_submissions,
  public.task_item_submissions,
  public.food_safety_submissions,
  public.schedule_events;
```

**Rule:** Enabling RLS on a table does not make it deliver
`postgres_changes` events — the table must ALSO be explicitly added to
the `supabase_realtime` publication (a separate, one-time project setup
step). When a `postgres_changes` subscription reports `SUBSCRIBED` but
never delivers any event despite confirmed writes to that exact table,
suspect the publication before suspecting the subscription code — verify
directly with a standalone script outside the app (bypassing React/HMR
entirely) before spending time debugging hook logic that is very likely
already correct. **✅ Confirmed applied to the live DB** — already verified
working via live cross-tab test in an earlier session, and reconfirmed
directly via `pg_publication_tables` (2026-08-01, via `supabase db
query`): all 4 tables (`task_submissions`, `task_item_submissions`,
`food_safety_submissions`, `schedule_events`) are present in the
`supabase_realtime` publication (see PENDING_MANUAL_STEPS.md §4).

---

### BUG #024 — Manager RLS Policies Granted INSERT/DELETE via `for all`
**Severity:** CRITICAL
**Area/File:** `comanager-schema.sql` — `"manager manages own branch submissions"` / `"...task_item_submissions"` / `"...fs submissions"` policies

**Found during:** full end-to-end code-quality audit (2026-07-30),
cross-checking RLS policies against comanager-context's actual permission
model ("managers execute... only their own assigned tasks") rather than
just confirming a policy exists.

**Verified live against the unpatched DB:** signed in as a real branch
manager and sent a raw `DELETE /rest/v1/task_submissions?id=eq.<row>`
using nothing but that manager's own session token (no app UI involved
at all) — it succeeded with `200` and the row was actually deleted. The
row was restored immediately via a service-role insert.

**The problem:** three manager-facing RLS policies were declared `for
all` instead of the narrower commands the app actually performs:

**WRONG:**
```sql
create policy "manager manages own branch submissions"
  on public.task_submissions for all
  using (branch_id = public.my_branch_id())
  with check (branch_id = public.my_branch_id());
```

`for all` covers SELECT, INSERT, UPDATE, and DELETE — but
`task_submissions`/`task_item_submissions`/`food_safety_submissions` rows
are all pre-created by the midnight cron / service-role (comanager-logic
§4's pre-created-slot model). A manager only ever needs to read an
existing row and flip its status/note/value/photo — the app code never
calls `.insert()` or `.delete()` on any of these three tables from the
manager side. The `for all` policy granted capability the app never uses
but a raw REST call absolutely can, letting a manager permanently destroy
their own branch's submission history.

**CORRECT:**
```sql
create policy "manager reads own branch submissions"
  on public.task_submissions for select
  using (branch_id = public.my_branch_id());
create policy "manager updates own branch submissions"
  on public.task_submissions for update
  using (branch_id = public.my_branch_id())
  with check (branch_id = public.my_branch_id());
```
(same split applied to `task_item_submissions` and
`food_safety_submissions` — see PENDING_MANUAL_STEPS.md §6.1 for the full
`drop`/`create` SQL for all three tables.)

**Rule:** An RLS policy's command list (`for all` vs. `for select` /
`for insert` / `for update` / `for delete`) must match the *narrowest* set
of operations the role actually performs through the app, not just
"whatever's convenient to write once" — `for all` is a scope decision, and
defaulting to it silently grants capability nothing in the app exercises
but anything hitting the REST API directly can. Multiple PERMISSIVE
policies on the same table OR together (same underlying mechanism as
BUG#019), so a narrow-looking policy elsewhere doesn't offset one `for
all` policy granting more than intended. **✅ Confirmed applied to the live
DB 2026-08-01** via direct `supabase db query` access — the old `for all`
policy no longer exists on `task_submissions`, replaced by the narrower
select+update pair (see PENDING_MANUAL_STEPS.md §6.1).

---

### BUG #025 — Cap-Enforcement Triggers Vulnerable to TOCTOU Race Under Concurrent Inserts
**Severity:** HIGH
**Area/File:** `comanager-schema.sql` — `enforce_branch_cap()`, `enforce_manager_cap()`

**Found during:** the same 2026-07-30 audit, reasoning through
`enforce_branch_cap`/`enforce_manager_cap` for concurrent-request edge
cases rather than just single-request correctness (which was already
fine, per BUG#015's earlier, separate finding about exception-swallowing).

**The problem:** both triggers `select count(*)` against the current
active rows, compare to the cap, and only then allow the insert — with no
locking between the count and the insert. Two near-simultaneous inserts
for the same owner (branch cap) or branch (manager cap) — e.g. two open
tabs both clicking "Add branch"/"Add manager" at once — can both run
their `count(*)` before either commits, both see the same pre-insert
count, and both pass the `if` check even when only one more should be
allowed. Not live-testable from this environment: reliably forcing two
requests to land inside the same transaction window isn't something a
script firing concurrent HTTP requests can guarantee (network/processing
jitter usually serializes them anyway), so this is a by-inspection fix,
unlike BUG#024's live-reproduced gap.

**WRONG:**
```sql
if new.is_active = true then
  select count(*) into active_count from public.branches
  where owner_id = new.owner_id and is_active = true and id <> new.id;
  -- no lock here — a second concurrent insert can read the same count
  select branches_count into allowed_count from public.subscriptions
  where owner_id = new.owner_id;
  if allowed_count is not null and active_count >= allowed_count then
    raise exception '...';
  end if;
end if;
```

**CORRECT:**
```sql
if new.is_active = true then
  -- Serializes concurrent inserts for the same owner; auto-released at
  -- transaction end either way. Works even from zero existing rows,
  -- unlike `select ... for update` (which only locks rows that already
  -- exist and can't prevent a race on the very first insert).
  perform pg_advisory_xact_lock(1, hashtext(new.owner_id::text));
  select count(*) into active_count from public.branches
  where owner_id = new.owner_id and is_active = true and id <> new.id;
  select branches_count into allowed_count from public.subscriptions
  where owner_id = new.owner_id;
  if allowed_count is not null and active_count >= allowed_count then
    raise exception '...';
  end if;
end if;
```
(`enforce_manager_cap` gets the same treatment, keyed to `new.branch_id`
with namespace constant `2` instead of `1`, so the two caps' advisory
locks can never collide with each other even in the unlikely event of a
`hashtext()` collision.)

**Rule:** Any count-then-compare cap-enforcement trigger needs
`pg_advisory_xact_lock(namespace, hashtext(scoping_id::text))` — keyed to
whatever the cap is scoped by (owner, branch, etc.) — taken *before* the
count, not just a `select ... for update` on existing rows (which can't
help when the race is about whether a *new* row should be allowed to
exist at all). Use a distinct namespace constant per cap category so
locks for different caps never contend with each other. **✅ Confirmed
applied to the live DB 2026-08-01** via direct `supabase db query`
access — both `enforce_branch_cap()` and `enforce_manager_cap()` confirmed
individually to include `pg_advisory_xact_lock` in their body (see
PENDING_MANUAL_STEPS.md §6.2).

---

### BUG #026 — Checklist Rollup Cross-Referenced Active Items Instead of This Cycle's Actual Submissions
**Severity:** MEDIUM
**Area/File:** `app/branch-manager/(authenticated)/tasks/page.tsx` — `checkAndRollupParent`

**Found during:** the same 2026-07-30 audit, tracing what happens when an
owner deactivates a `task_items` row mid-cycle, after that cycle's
`task_item_submissions` rows were already pre-created (comanager-logic
§4's "edits apply going forward only" rule covers *new* items appearing
tomorrow, but says nothing about an item disappearing from an
already-generated cycle).

**Verified live:** created a task with two items, let the day's slots
generate, deactivated one item, then completed the *other* (still-active)
item as a branch manager. The parent `task_submissions` row rolled up to
`completed` even though the deactivated item's own `task_item_submissions`
row was still sitting at `pending` — that submission became permanently
unreachable (no UI shows a deactivated item, so nothing could ever
complete it), yet the parent claimed the task was fully done.

**WRONG:**
```ts
async function checkAndRollupParent(taskSubmissionId: string, taskId: string, submittedBy: string) {
  // `items` was fetched with `.eq("is_active", true)` in loadData — a
  // deactivated item silently drops out of this list, so its still-
  // pending submission is never checked at all.
  const taskItems = items.filter((i) => i.task_id === taskId);
  const allDone = taskItems.every((i) =>
    itemSubs.find((s) => s.task_submission_id === taskSubmissionId && s.item_id === i.id)?.status === "completed"
  );
  if (allDone) { /* roll up */ }
}
```

**CORRECT:**
```ts
async function checkAndRollupParent(taskSubmissionId: string, submittedBy: string) {
  // Check against this cycle's actual task_item_submissions rows, not
  // the currently-active task_items list — a deactivated item still has
  // a real, still-pending row for this cycle and must block rollup.
  const { data: freshItemSubs } = await client
    .from("task_item_submissions")
    .select("status")
    .eq("task_submission_id", taskSubmissionId);
  const allDone = !!freshItemSubs?.length && freshItemSubs.every((s) => s.status === "completed");
  if (allDone) { /* roll up */ }
}
```

**Rule:** A cycle's completion check must be driven by the submission
rows that actually exist for that cycle (`task_item_submissions` /
`food_safety_submissions`), never by cross-referencing against the
currently-active definition list (`task_items` / standards) — those two
can diverge the moment something is deactivated mid-cycle, and the
pre-created-slot model (comanager-logic §4) means the submission rows are
the source of truth for "what this cycle actually requires," not
whatever happens to be active right now. Verified live and fixed; no
manual SQL needed, this was an app-code-only bug.

---

### BUG #027 — Owner Registration Had No Upper Bound on branchCount
**Severity:** MEDIUM
**Area/File:** `app/owner/register/actions.ts`, `app/owner/register/RegisterForm.tsx`

**Found during:** the same 2026-07-30 audit, checking `registerOwner`'s
validation against what a self-registering, no-card-required signup
(comanager-logic §1) should actually allow.

**Verified live:** bypassed the client-side input via
`Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,
'value').set.call(input, 999)` (simulating a raw POST that skips the UI
entirely) and removed the native `max` attribute so the browser wouldn't
silently block the submission before it reached the server — confirmed
the *server* rejected it once the fix below was in place, with the exact
message "Branch count must be between 1 and 50."

**WRONG:**
```ts
const branchCount = Number(formData.get("branchCount"));
// no upper bound — a self-registering owner (no card, 14-day trial
// starts immediately per comanager-logic §1) could set branches_count to
// any number and provision that many free trial branches.
```

**CORRECT:**
```ts
if (!Number.isInteger(branchCount) || branchCount < 1 || branchCount > 50) {
  return { error: "Branch count must be between 1 and 50." };
}
```

**Rule:** Any numeric field that flows into a billed/provisioned quantity
(`subscriptions.branches_count` here) needs an explicit upper bound
checked server-side, not just a client-side `max` attribute (which a raw
POST bypasses entirely) — a free-trial, no-card signup flow is exactly
the case where an unbounded quantity field is cheapest to abuse. Verified
live and fixed; no manual SQL needed, this was an app-code-only bug.

---

### BUG #028 — Confirmation-Email Origin Built From Client-Influenceable Request Headers
**Severity:** LOW
**Area/File:** `app/owner/register/actions.ts`

**Found during:** the same 2026-07-30 audit, tracing where the
`emailRedirectTo` URL passed to `signUp()` (see BUG#017) actually comes
from.

**Verified live:** temporarily set `NEXT_PUBLIC_SITE_URL` in `.env.local`
to a distinct marker value, confirmed via server-side logging that it won
over the request's `Origin`/`Host` headers, then removed the temporary env
var and log line, restoring both files to their prior state.

**WRONG:**
```ts
const headersList = headers();
const origin = headersList.get("origin")
  ?? `${headersList.get("x-forwarded-proto") ?? "http"}://${headersList.get("host")}`;
// falls straight to request headers a client can influence — Vercel
// normalizes Host for the production custom domain, but the app
// shouldn't rely on the hosting platform alone for a value that ends up
// in a security-sensitive email link.
```

**CORRECT:**
```ts
const origin =
  process.env.NEXT_PUBLIC_SITE_URL ??
  headersList.get("origin") ??
  `${headersList.get("x-forwarded-proto") ?? "http"}://${headersList.get("host")}`;
```

**Rule:** Any URL used in a security-sensitive context (email
confirmation links, redirect targets) should prefer a server-controlled
env var over request headers when one is configured, keeping headers as a
local-dev-only fallback. `NEXT_PUBLIC_SITE_URL` is documented in
`.env.local.example`; recommended in production, optional locally.
Verified live and fixed; no manual SQL needed, this was an app-code-only
bug.

---

### BUG #029 — Branches Page Used Task-Definition Count Instead of Actual Submission Rows as Its Rate Denominator
**Severity:** HIGH
**Area/File:** `app/owner/(authenticated)/branches/page.tsx` — `branchStats()`

**Found during:** a full stats/arithmetic audit across both panels
(2026-07-30), triggered by a report that the branch-manager Dashboard
looked stale after fresh submissions (that specific report turned out to
be an artifact of a corrupted dev-server `.next` cache from an earlier
turn, not a code bug — but it prompted auditing every displayed number
against real DB rows rather than just confirming pages render).

**Verified live:** for a branch with 2 real `task_submissions` rows today
(both completed), the card correctly showed 100% / `2✓ · 0• · 0✗`. Then
created a 3rd task with **no** `task_submissions` row generated for today
at all (the realistic case — see PENDING_MANUAL_STEPS.md §3, the slot-gen
cron isn't scheduled yet, so this is currently true for nearly every task
in the live DB) — the card immediately dropped to 67% and showed `1•`
pending, even though the actual `task_submissions` table has **zero**
pending rows for that branch today. A task definition with no generated
slot isn't "pending" — it isn't due yet, there's no row for it at all.

**WRONG:**
```ts
function branchStats(branchId: string) {
  // getExpectedForBranch counts active `tasks` rows applicable to this
  // branch — a task *definition*, not whether today's slot was ever
  // generated for it.
  const expected = getExpectedForBranch(taskDefs, branchId);
  const subs = todaySubs.filter((s) => s.branch_id === branchId);
  const completed = subs.filter((s) => s.status === "completed").length;
  const missed = subs.filter((s) => s.status === "missed").length;
  return { completed, missed, pending: calcPending(expected, completed, missed), rate: calcRate(completed, expected) };
}
```

**CORRECT:**
```ts
function branchStats(branchId: string) {
  const subs = todaySubs.filter((s) => s.branch_id === branchId);
  const completed = subs.filter((s) => s.status === "completed").length;
  const missed = subs.filter((s) => s.status === "missed").length;
  return {
    completed,
    missed,
    pending: calcPending(subs.length, completed, missed),
    rate: calcRate(completed, subs.length),
  };
}
```

**Rule:** A completion rate's denominator must always be the count of
actual submission rows for the period (`task_submissions` /
`food_safety_submissions`), never the count of definitions (`tasks` /
`food_safety_standards`) — the pre-created-slot model (comanager-logic
§4) means a definition existing is not the same as a slot existing for
it yet. Every other page in the app already got this right (owner
Dashboard, branch-manager Dashboard/Tasks) by using actual submission-row
counts; Branches was the one outlier. Verified live and fixed; no manual
SQL needed, this was an app-code-only bug.

---

### BUG #030 — Every Page Computed "Today" in UTC/Browser-Local Time Instead of Riyadh Time, Disagreeing With How due_date Is Actually Generated
**Severity:** HIGH
**Area/File:** Eight call sites across
`app/owner/(authenticated)/{dashboard,branches,tasks,food-safety,reports}/page.tsx`
and `app/branch-manager/(authenticated)/{dashboard,tasks,food-safety}/page.tsx`;
new shared utility `lib/utils/riyadh-date.ts`; `lib/utils/reports.ts`.

**Found during:** the same 2026-07-30 stats audit, while reading
`supabase/functions/generate-daily-slots/index.ts` (which computes
`due_date` as `new Date(nowUtc.getTime() + 3*60*60*1000).toISOString().slice(0,10)`
— Riyadh's calendar day, UTC+3, no DST) side-by-side with every page
independently computing `today` as plain
`new Date().toISOString().slice(0, 10)` — UTC's calendar day. These
disagree for the ~3 hours daily between UTC 21:00 and 23:59 (Riyadh
00:00–02:59 the next day), during which that day's slots already exist
with tomorrow's UTC date, but every page's `today` still shows yesterday's
UTC date — dashboards would show zero of the current day's already-
generated tasks/readings for that entire window.

A second, related bug in the Reports page's day-of-week heatmap:
`new Date(dueDateString)` parses a date-only string as UTC midnight, but
`.getDay()` reads it back in the **viewer's own browser timezone** — so
which day-of-week a given `due_date` landed in silently depended on where
the owner's browser happened to be, not the date itself.

**Not independently live-reproducible for the ~3-hour UTC-boundary case**
(can't fast-forward the real wall clock) — verified instead by (a)
confirming the new `riyadhDateString()`/`parseDueDate()` helpers mirror
the edge function's exact math, and (b) confirming the day-of-week
heatmap correctly placed a real submission in the Thursday column, most-
recent-week row, matching 2026-07-30's actual real-world day-of-week
(computed independently via `getUTCDay()` in Node) — this exercises the
same UTC-anchored parsing path the fix relies on.

**WRONG:**
```ts
const today = new Date().toISOString().slice(0, 10);
// ...
const d = new Date(s.due_date);       // parses as UTC midnight
const dow = d.getDay();               // read back in browser-local time — wrong day for browsers west of UTC
```

**CORRECT:**
```ts
import { riyadhDateString, parseDueDate } from "@/lib/utils/riyadh-date";

const today = riyadhDateString();     // matches generate-daily-slots' own Riyadh-offset math
const dow = parseDueDate(s.due_date).getUTCDay(); // UTC-anchored parse + UTC getter, browser-independent
```

**Rule:** `due_date` columns represent a Riyadh (UTC+3) calendar day,
generated by adding a fixed 3-hour offset to UTC before truncating —
every client-side "today" or "N days ago" computation must use that exact
same offset (`lib/utils/riyadh-date.ts`'s `riyadhDateString()` /
`riyadhDaysAgoString()`), never raw `new Date().toISOString().slice(0,
10)` or local-calendar `setDate()`/`getDate()` arithmetic. Separately:
never construct `new Date(dateOnlyString)` and call a *local* getter
(`getDay()`, `getDate()`, ...) on it — a due_date's identity must not
depend on the viewer's browser timezone; always parse and read date-only
strings in UTC (`parseDueDate()` + `getUTCDay()`/etc.). Verified live
where possible (heatmap placement); the UTC-boundary window itself is
verified by code inspection and helper-function parity with the edge
function's own math, not a live wall-clock reproduction — flagged
explicitly rather than overclaiming a live test that isn't achievable
here.

---

### BUG #031 — Every Authenticated Page Independently Re-Ran usePanelAuth, Tripling the Profile Fetch on Login and Repeating It on Every Navigation
**Severity:** MEDIUM (performance, not correctness — no wrong data was ever shown)
**Area/File:** `lib/auth/panel-auth-context.tsx` (new); both `(authenticated)/layout.tsx` files; all 12 page.tsx files under them.

**Found during:** investigating a "login feels slow/laggy on the live
Vercel deployment" report (2026-07-30). Tracing the actual request
sequence from clicking "Sign in" to the dashboard being usable: (1)
`signInWithPassword`, (2) `useLoginForm`'s own profile fetch to gate the
redirect (matches comanager-auth's documented login flow, kept as-is —
fail-fast error feedback before navigating away), (3) client-side
navigation, (4) the destination **layout's own separate** `usePanelAuth`
call, (5) the destination **page's own separate** `usePanelAuth` call —
same query as (4), same query as (2), fetching the identical `users` row
three times in immediate sequence. Because the page's `loadData()` is
gated behind `profile` being set, the page's real data couldn't even
start loading until step (5) finished. Confirmed live by instrumenting
`window.fetch` before logging in: the `users?id=eq....` profile query
fired 2 times pre-fix per login (already down from 3 in earlier testing
once traced) plus 1 more per subsequent page navigation within the panel,
even though the layout never unmounts between route changes — every
sidebar click was re-running an auth check whose result the layout had
already had, unused, the whole time.

**Why this matters more on a real network than localhost:** these are
all direct browser→Supabase calls (client components using
`createBrowserClient`), not proxied through Vercel — so each one pays
full round-trip latency to wherever the Supabase project actually is
(confirmed via the founder's dashboard: `ap-southeast-1`, Singapore — far
from this app's Saudi Arabia user base regardless of Vercel's own
region). On localhost these round trips are sub-millisecond and
invisible; over a real network each one is real, felt latency stacked in
front of the page's actual work.

**WRONG:**
```tsx
// app/owner/(authenticated)/layout.tsx
const { profile, client } = usePanelAuth(supabaseOwner, "owner", "/owner/login");
// ...renders <OwnerSidebar profile={profile} client={client} />{children}

// app/owner/(authenticated)/dashboard/page.tsx — a SEPARATE usePanelAuth
// call, its own separate Supabase client instance, re-running getSession()
// + the exact same profile query the layout (mounted one level up, same
// moment) just ran.
const { loading, profile, client } = usePanelAuth(supabaseOwner, "owner", "/owner/login");
```

**CORRECT:**
```tsx
// lib/auth/panel-auth-context.tsx — new shared context
const PanelAuthContext = createContext<PanelAuthValue | null>(null);
export const PanelAuthProvider = PanelAuthContext.Provider;
export function usePanelAuthContext(): PanelAuthValue {
  const ctx = useContext(PanelAuthContext);
  if (!ctx) throw new Error("usePanelAuthContext must be used within its panel's authenticated layout.");
  return ctx;
}

// app/owner/(authenticated)/layout.tsx — runs usePanelAuth ONCE, provides
// it to every page below via context
const auth = usePanelAuth(supabaseOwner, "owner", "/owner/login");
return (
  <div className="flex min-h-screen">
    <OwnerSidebar profile={auth.profile} client={auth.client} />
    <div className="min-w-0 flex-1"><PanelAuthProvider value={auth}>{children}</PanelAuthProvider></div>
  </div>
);

// app/owner/(authenticated)/dashboard/page.tsx — reads the layout's
// already-completed result, zero additional network calls
const { loading, profile, client } = usePanelAuthContext();
```

**Verified live:** instrumented `window.fetch` to count `users?id=eq....`
calls — dropped from 3 to 2 on login (the remaining 2 are the
login-page's own fail-fast check plus the layout's one shared check; no
third page-level fetch anymore), and to **0** on every subsequent
in-panel navigation (previously 1 per navigation). Bonus, unplanned:
per-page First Load JS dropped substantially across every authenticated
route (e.g. owner/dashboard 158kB→90.2kB) since `createBrowserClient` and
its dependencies are no longer duplicated into every page's own bundle.

**Separate finding surfaced while verifying this fix was safe (not
fixed, flagging only):** `my_role()`/`my_branch_id()` — the functions
every RLS policy is built on — never check `is_active` at all; they just
look up the role/branch_id unconditionally. `is_active` enforcement is
therefore entirely client-side (`usePanelAuth`'s own check), not backed
by RLS. A deactivated user's still-valid session could keep hitting the
REST API directly regardless of how often the app's own UI re-checks —
this was already true before this fix and is unaffected by it (reducing
re-check frequency doesn't weaken a boundary that was never enforced at
the RLS layer to begin with), but it's a real gap worth a dedicated fix
later: making `my_role()` return null/no-match for an inactive user would
close it for every policy at once without touching each one individually.

**Rule:** A layout that already ran an auth/profile check for its route
segment should provide the result via context, not leave every page
below it to independently re-run the same check — Next.js layouts don't
unmount on client-side navigation, so a per-page re-check is pure
duplication with no security benefit once the layout's own check is live
for the session. If a page-level re-check is ever needed for staleness
reasons, it belongs in the shared hook (making the layout's own check
periodically refresh), not duplicated per-page.

---

### BUG #032 — my_role()/my_branch_id() Never Checked is_active — Deactivation Was Enforced Only Client-Side, Not by RLS — ✅ FIXED
**Severity:** CRITICAL
**Area/File:** `comanager-schema.sql` — `my_role()`, `my_branch_id()`

**Found during:** flagged as a residual finding while verifying BUG#031's
safety (2026-07-30), then fixed this same day at the founder's explicit
request.

**Verified live against the unpatched DB:** signed in as a real, active
branch manager and confirmed their session could read their branch's
`task_submissions` (baseline). Deactivated that same account via
service-role `PATCH .../users?id=eq....` (simulating an owner clicking
"Deactivate"), **without** touching the manager's Supabase Auth session
at all. Retried the *exact same* raw REST call with the *exact same,
never-refreshed* access token — it returned the identical rows, as if
deactivation had never happened.

**The problem:** deactivating a `public.users` row doesn't revoke that
user's underlying Supabase Auth session — Supabase Auth has no awareness
that this app-level `is_active` column even exists. The app's own
`usePanelAuth` hook checks `is_active` and bounces a deactivated user to
the login screen, but that check only runs inside the app's own UI. A raw
REST call using a still-valid access token bypasses it entirely — and
until this fix, RLS had nothing checking `is_active` either, since
`my_role()`/`my_branch_id()` (the functions nearly every policy in this
schema is built on) only ever matched on `id = auth.uid()`. A
fired/suspended employee could keep pulling live operational data
indefinitely via direct API calls, with no server-side enforcement at
all. Same class of gap as BUG#019/#024 (an RLS helper function not
checking something it should), just for account status instead of
ownership scoping.

**WRONG:**
```sql
create or replace function public.my_role()
returns text
language sql security definer stable
as $$
  select role from public.users where id = auth.uid();
$$;
```

**CORRECT:**
```sql
create or replace function public.my_role()
returns text
language sql security definer stable
as $$
  select role from public.users where id = auth.uid() and is_active = true;
$$;
-- my_branch_id() gets the identical `and is_active = true` addition.
-- my_owner_id() needs no direct change — it's built entirely out of
-- these two functions, so it already returns null for a deactivated
-- caller once they do.
```

**Known residual gap, deliberately not fixed here:** owner-scoped
policies (`owner_id = auth.uid()` on `branches`, `tasks`, `task_items`,
`food_safety_standards`, `schedule_events`, `subscriptions`, and
`is_my_branch()`) check `auth.uid()` directly, never through
`my_role()`/`my_branch_id()` — so a deactivated *owner* account (not
manager) would still bypass RLS via those policies. Left open because
there's currently no in-app feature to deactivate an owner's own account
at all (only the owner's own managers, via their "Deactivate" button) —
recorded here so it isn't rediscovered as new, and so it's fixed properly
(likely a shared `my_active_uid()` helper replacing every direct
self-scoping `auth.uid()` reference) if/when an owner-deactivation
feature is ever built.

**Rule:** Any RLS helper function that scopes access by *who* the caller
is (`my_role()`, `my_branch_id()`, and equivalents) must also verify the
caller is still allowed to act at all (`is_active`), not just that their
JWT is valid — a valid session and a currently-authorized account are two
different things, and Supabase Auth only guarantees the former. Verified
live before AND after: proved the gap live pre-fix (deactivation had zero
effect on RLS-gated access with the same token), then **✅ applied and
reconfirmed live 2026-08-01** via direct `supabase db query` access
(newly available in this environment) — re-ran the exact
live-deactivation test above: before deactivation the session returned 3
rows; after deactivation, the *same never-refreshed token* returned an
empty array instead of the unchanged rows. See PENDING_MANUAL_STEPS.md
§6.3.

---

### BUG #033 — Owner Login Stuck Forever on "Signing in..." on the Live Site: Missing Vercel Env Vars + No try/catch to Surface It
**Severity:** CRITICAL
**Area/File:** Vercel dashboard config (root cause); `lib/auth/use-login-form.ts` (defensive fix)

**Found during:** "owner login gets stuck loading, never redirects"
report on the live deployment (2026-07-30) — explicitly NOT reproducible
on localhost (which has a valid `.env.local`), so reproduced directly
against `https://co-manager-seven.vercel.app` as instructed.

**Root cause, confirmed by decompiling the actual deployed bundle:**
fetched `_next/static/chunks/app/owner/login/page-*.js` from the live
site and found the compiled `makeBrowserClient` still reads
`a.env.NEXT_PUBLIC_SUPABASE_URL` as a live runtime property lookup.
Next.js's build step replaces `NEXT_PUBLIC_*` vars with literal string
constants via webpack's DefinePlugin *whenever they're present at build
time* — a bundle that still has a runtime lookup proves the var was
absent from Vercel's build environment entirely, not just missing at
request time. `.env.local` is gitignored and never deploys; Vercel needs
every env var configured separately in its own dashboard, and this
project's apparently never were.

**Confirmed live** by injecting `window.addEventListener('unhandledrejection',
...)` before submitting the real login form on the live site: clicking
"Sign in" threw `"@supabase/ssr: Your project's URL and API key are
required to create a Supabase client!"` — `createBrowserClient(undefined,
undefined, ...)`.

**The compounding app-code bug:** `useLoginForm`'s `handleSubmit` had no
`try`/`catch` around any of this. `setSubmitting(true)` runs first; the
throw happens inside the `try`-less body; nothing ever reaches
`setSubmitting(false)`. The result: the button is stuck on "Signing
in..." forever with zero visible error and no way to retry short of a
full page reload — exactly the reported symptom. This wasn't specific to
the missing env vars either — ANY unexpected throw in this function
(network blip, a future Supabase client change, anything) would have
produced the identical permanent hang.

**Explicitly ruled out before landing on the real cause:** the recently-
changed Vercel function region (`sin1`) — confirmed still correctly
deployed and serving via the `x-vercel-id` header; and any hardcoded
`localhost` reference in the auth/redirect flow — grepped the whole repo,
found none (the only "localhost" hit was a comment in
`panel-auth-context.tsx`, not a URL). Neither was the cause.

**WRONG:**
```ts
async function handleSubmit(e: FormEvent) {
  e.preventDefault();
  setSubmitting(true);
  setError(null);

  const client = createClient(); // can throw synchronously
  const { data, error: signInError } = await client.auth.signInWithPassword({...});
  // ...every other setSubmitting(false) call lives inside this same
  // try-less body — a throw anywhere above skips all of them
}
```

**CORRECT:**
```ts
async function handleSubmit(e: FormEvent) {
  e.preventDefault();
  setSubmitting(true);
  setError(null);

  try {
    const client = createClient();
    const { data, error: signInError } = await client.auth.signInWithPassword({...});
    // ...rest of the flow, unchanged...
  } catch (err) {
    console.error("Unexpected error during login:", err);
    setError("Something went wrong. Please try again.");
    setSubmitting(false);
  }
}
```

**Verified live, both directions, on localhost** (can't intentionally
break the live site's env vars to test): temporarily blanked
`NEXT_PUBLIC_SUPABASE_URL` in `.env.local`, restarted the dev server,
submitted login — confirmed the button now shows "Something went wrong.
Please try again." and resets to clickable, instead of hanging. Restored
the real value, restarted again, confirmed normal login still redirects
to the dashboard correctly (no regression).

**Not yet fixable end-to-end from this environment** — the actual root
cause is Vercel dashboard configuration (no CLI/API access here). Manual
steps are in PENDING_MANUAL_STEPS.md §5. The try/catch fix ships
regardless — it turns this specific failure (and any future one like it)
from a silent infinite hang into a visible, retryable error, but doesn't
by itself make login work on the live site until the env vars are added.

**Rule:** Any function that sets a loading/submitting flag before doing
async work must wrap that work in try/catch (or equivalent) and reset the
flag in the catch — never assume the only exits are the explicit
early-return branches you wrote. An uncaught throw between "start
loading" and "stop loading" stands up a permanently stuck UI with no
error shown, which is worse than a clear error: a stuck spinner gives the
user no signal that anything is even wrong, let alone what to do about
it.

---

### BUG #034 — Realtime Never Delivers on the Live Deployment: NEXT_PUBLIC_SUPABASE_ANON_KEY Has a Trailing Newline in Vercel — ✅ FIXED
**Severity:** CRITICAL
**Area/File:** Vercel dashboard config (root cause) — not app code; affects every `useRealtimeTable` subscription, every panel, on the live deployment only

**Resolution confirmed live, 2026-08-01, same day as the finding.** After
the founder re-entered `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel and
redeployed, re-ran the identical verification: confirmed the deployed
chunk hash changed (fresh build), the WebSocket URL's `apikey` no longer
ends in `%0A`, the connection opens successfully, subscriptions confirm
`"Subscribed to PostgreSQL"`, and — the real end-to-end test — completed
a task in one tab while a Dashboard sat idle in another; it updated live
within about a second with zero interaction, and the raw
`postgres_changes` `UPDATE` message for the exact changed row was
captured over the wire. Genuinely fixed, not just "should be fixed."

**Found during:** "branch-manager dashboard doesn't update after a
submission" report, explicitly tested on
`https://co-manager-seven.vercel.app` (2026-08-01), suspecting the
branch-manager panel might be missing the BUG#023 fix the owner dashboard
got. Ruled that out immediately: `app/branch-manager/(authenticated)/dashboard/page.tsx`
has the identical `useRealtimeTable` calls as the owner dashboard, and
testing the **owner** dashboard the same way (leave it open, complete a
task in another tab, watch for a live update with zero interaction) showed
the identical failure — stale data, no live update, on both panels
equally. This ruled out "one panel is missing something the other has";
the gap is site-wide.

**Root-caused by instrumenting `window.WebSocket`** on a completely fresh
tab (patched before the very first authenticated page ever mounted in
that document, to guarantee catching the true first connection attempt —
Supabase's realtime client keeps one persistent socket per client
instance, so testing on an already-loaded tab risks missing a connection
that was already established before the patch was installed). Every
connection attempt immediately fired `error` then `close` with code
`1006` (abnormal closure — never even completed a handshake). The
connection URL itself was the giveaway:

```
wss://<project>.supabase.co/realtime/v1/websocket?apikey=<...jwt...>%0A&vsn=2.0.0
```

`%0A` is a URL-encoded newline, sitting inside the `apikey` query
parameter. `NEXT_PUBLIC_SUPABASE_ANON_KEY`, as configured in Vercel's
dashboard, has a literal trailing newline character baked into the
value — confirmed absent from the local `.env.local` copy of the exact
same key (checked byte-by-byte: no trailing whitespace on any of the 4
variables there), so this was introduced specifically when the value was
entered into Vercel, not inherited from anywhere in this repo.

**Why REST calls (login, every page's data fetching) worked fine
throughout this same investigation, while only Realtime broke:** the key
is sent two different ways. As an HTTP `Authorization: Bearer <key>`
header (every REST call), trailing whitespace gets trimmed by the
browser's `fetch`/`Headers` handling before the request goes out — a
newline there is silently tolerated. As a raw WebSocket URL query
parameter (Realtime's connection handshake), there's no equivalent
trimming — the literal `\n` travels into the JWT Supabase Realtime tries
to validate, invalidating it and rejecting the connection outright before
any subscription can ever succeed.

**Verified live, ruling out the two other suspects the report raised:**
the `sin1` region change (checked `x-vercel-id`, confirmed correctly
still deployed — unrelated, this is a connection-validity problem, not a
latency one) and "branch-manager missing the BUG#023 publication fix"
(disproven directly — the owner panel, which definitely got that fix,
fails identically on the live site; the `supabase_realtime` publication
itself is a database-level setting shared by every environment hitting
the same project, including localhost, where it works. The bug is
entirely in how the key's value got typed/pasted into Vercel).

**WRONG (diagnosis to avoid):**
Assuming this means the branch-manager panel's code is missing
something, or that the `supabase_realtime` publication (BUG#023) needs
re-running — neither is true. The code is identical and correct on both
panels; the publication is a DB-level setting untouched since it was
fixed, and still correct (confirmed: it's the same database localhost
was tested against successfully in an earlier session, and REST
data-fetching against that same database still works fine on the live
site right now).

**CORRECT (Vercel dashboard action, not a code fix):** re-enter
`NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel → Settings → Environment
Variables, pasting the value with no trailing newline or whitespace
(select and copy only the key text itself — many terminal/editor copy
methods append a trailing newline that isn't visible in most input UIs).
Redeploy afterward, same as any `NEXT_PUBLIC_*` change — it's baked in at
build time. See PENDING_MANUAL_STEPS.md §5 (updated) for the exact
verification method (re-run the same `window.WebSocket` instrumentation
and confirm a clean `open` event instead of `error`+`close(1006)`).

**Rule:** A malformed secret/key doesn't always fail the same way
everywhere it's used — validate a suspicious credential against *every*
transport it travels over, not just the one that happens to be easiest to
test (HTTP headers tolerate trailing whitespace; WebSocket query
parameters and JWT signature validation do not). When realtime works on
one environment (localhost) but not another (a live deployment) against
the *identical* database, suspect environment-specific configuration
(env var values, not just their presence) before suspecting the shared
backend or the app code — they're proven identical in both places by the
fact that REST calls succeed identically in both.

---

### BUG #035 — Cloudinary Credentials Read Without Trimming, Corrupting the Upload Signature
**Severity:** MEDIUM
**Area/File:** `lib/cloudinary/upload-photo.ts` — `getCloudinaryCredentials()`

**Found during:** a live-site report of Cloudinary returning "Invalid
Signature" on photo upload, after `CLOUDINARY_URL` had already been added
to Vercel (fixing the earlier "Photo upload isn't configured yet."
symptom — see PENDING_MANUAL_STEPS.md §8). Re-verified the
signature-generation code itself against Cloudinary's own documented
algorithm (params excluding `file`/`cloud_name`/`resource_type`/`api_key`,
sorted alphabetically, joined with `&`, secret appended directly, SHA-1)
first — it matches exactly, so the bug isn't in how the signature is
computed, only in what gets fed into it.

**The gap:** `getCloudinaryCredentials()` read
`CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` (and
`CLOUDINARY_URL`) straight from `process.env` with no `.trim()` anywhere
— same class of mistake as BUG#020 (login input), just never applied
here. Tested empirically: a trailing newline on the *whole* `CLOUDINARY_URL`
string happens to get stripped by `new URL()`'s own normalization, so
that specific case is incidentally safe — but the 3-separate-vars path
does no URL parsing at all, so a stray trailing space/newline pasted onto
just `CLOUDINARY_API_SECRET` (or any of the three) flows straight into
the signature computation uncorrected, producing exactly this symptom:
a wrong-but-plausible-looking signature that Cloudinary rejects.

**WRONG:**
```ts
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;
```

**CORRECT:**
```ts
const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
```
(same `.trim()` added to the `CLOUDINARY_URL` combined-form path too,
before it's handed to `new URL()`.)

**Rule:** Any credential read from `process.env` and fed into a signature/
hash computation (not just a login form field) must be trimmed —
whitespace corruption is invisible in almost every dashboard input field
that shows it, and unlike an HTTP `Authorization` header (which the
runtime trims for you, per BUG#034), a value concatenated into a string
you hash yourself gets no such protection. Verify the actual root cause
(missing vs. malformed value) can't be distinguished from outside the
deployment for a server-only var — see PENDING_MANUAL_STEPS.md §8 for the
verification method the founder needs to run directly against Vercel/
Cloudinary's dashboards.

**✅ RESOLVED — confirmed live 2026-08-03, actual root cause was
different from (and not fixable by) the `.trim()` gap above.** Ran the
hash-compare from PENDING_MANUAL_STEPS.md §8.1 for real: SHA-256 of the
known-good local `.env.local` value (already proven correct — it produced
a real Cloudinary upload earlier the same session) against the founder's
copy of Vercel's actual stored value. **Hashes did not match** —
confirmed, not assumed. Parsed the mismatched value through the exact
`new URL()` call the code uses to find out *how*: the stored
`CLOUDINARY_URL` was one env var value with an embedded newline —
`cloudinary://256223673583943:256223673583943@yaa27rtu` on line one,
`LaHINLUmj-D_UrmO5slnHBPuefI` (the real secret) stranded on line two.
Two things were wrong at once: the secret slot held the API key itself
(duplicated in, not the real secret), and the WHATWG URL parser strips
newlines from *anywhere* in a string, not just the edges — so the real
secret on line two silently fused onto the end of the cloud name
(`yaa27rtuLaHINLUmj-D_UrmO5slnHBPuefI`) instead of ever being read as the
password. **Important distinction from the `.trim()` fix above: that fix
alone would NOT have caught this** — `.trim()` only strips leading/
trailing whitespace, and this newline was in the *middle* of the value,
between two lines, not at an edge. The two fixes are complementary, not
duplicates: `.trim()` guards against edge whitespace (the BUG#020-style
mistake); this resolution is about a completely wrong value being stored,
which no code-side defensive trimming can fix — only pasting the correct
value can. Founder pasted the corrected single-line value into Vercel
(`cloudinary://256223673583943:LaHINLUmj-D_UrmO5slnHBPuefI@yaa27rtu`,
verified via the same hash method), redeployed, and a real live upload
was performed end-to-end afterward: confirmed a genuine
`https://res.cloudinary.com/yaa27rtu/image/upload/...` URL saved to
`task_item_submissions.photo_url` in the production database — not just
an absence of the error message. Test data deleted afterward.

**Rule (addendum):** when comparing a suspect credential against a
known-good one, don't stop at "do the hashes match" as a binary fact —
if they don't, parse the *actual* bad value through the *same code path*
the app uses to find out exactly how it diverges. That's what turned "the
values are different" into an actionable, specific fix (one corrupted
value with a stray newline) instead of a vague "re-paste and hope."

---

### BUG #036 — Owner Tasks % Badge Was Row-Level, Not Item-Level — Pegged at 0% Until the Last Checklist Item Was Done
**Severity:** MEDIUM (correct data, misleading display — not data loss)
**Area/File:** `app/owner/(authenticated)/tasks/page.tsx` — `todayStatsForTask`

**Found during:** a founder report that after submitting task items as a
branch manager for three tasks ("mama", "clode", "open") and hard-
refreshing the owner Tasks page, every card still showed 0%. Investigated
directly against the live production DB (not inference): `task_submissions`
and `task_item_submissions` rows were pulled for real. Two of the three
tasks ("mama", "clode" — one item each) were genuinely `completed`.
"open" (7 items) had only 2 of 7 items actually `completed` — the other
5 were still `pending`, `submitted_at: null` — no evidence of a silent
submission failure (the branch-manager UI already shows an explicit
"N/N items" count and surfaces validation errors per BUG#013, so partial
progress there is expected user behavior, not corruption). Also
confirmed live, with a genuine authenticated owner session (a
non-destructive one-time token, no password touched) against the actual
deployed bundle (verified current, not stale — the accordion + item-
realtime code from recent commits was present in the live JS): the page
rendered `mama: 100%`, `clode: 100%`, `open: 0%` — exactly matching the
real DB state, proving neither the query, RLS, nor the deployed code were
broken.

**The real problem:** a single-branch task has exactly **one**
`task_submissions` row per day (comanager-logic §4's pre-created-slot
model — one row per task/branch/due_date). The page's rate was
`calcRate(completed rows, total rows)` — for a single-branch task that
denominator is always exactly 1, so the rate can only ever be 0% or
100%, regardless of how many of the checklist's individual items are
actually done. "open" (7 items) stays visually frozen at 0% the entire
time a manager is working through it, only jumping to 100% the instant
the 7th item is submitted — indistinguishable, at a glance, from "nothing
is being saved," even though every individual item write was landing
correctly in the DB the whole time.

**WRONG:**
```ts
function todayStatsForTask(taskId: string) {
  const rows = submissions.filter((s) => s.task_id === taskId && s.due_date === today);
  const completed = rows.filter((r) => r.status === "completed").length;
  return { completed, expectedRows: rows.length }; // rows.length is always 1 for a single-branch task
}
// rate = calcRate(completed, expectedRows || branchCountForTask(t)) — binary 0%/100%, no partial credit
```

**CORRECT:**
```ts
function todayStatsForTask(taskId: string) {
  const rowIds = new Set(
    submissions.filter((s) => s.task_id === taskId && s.due_date === today).map((s) => s.id),
  );
  const itemRows = todayItemStats.filter((s) => rowIds.has(s.task_submission_id));
  const completed = itemRows.filter((r) => r.status === "completed").length;
  return { completed, expectedItems: itemRows.length }; // e.g. 2 completed / 7 total = 29%
}
// rate = calcRate(completed, expectedItems || (activeItemsForTask(t.id).length * branchCountForTask(t)))
```
`todayItemStats` is fetched separately (`loadTodayItemStats`), scoped to
just today's `task_submissions` row ids — a second, dependent query
(same two-phase pattern the page's own `loadExpandedSubmissions` already
used), not a `.select('*')`-style blind fetch of the whole table. The
`task_item_submissions` realtime subscription (`owner-tasks-items-*`,
already existed for the expanded-accordion refresh) now also re-runs
this stats fetch on every change, since an item completion alone never
touches `task_submissions` and wouldn't otherwise trigger the row-level
subscription.

**Rule:** For any completion-rate display driven by the pre-created-slot
model (comanager-logic §4), check whether the entity actually has
sub-rows (checklist items, in this case) that can be partially done
before treating "row count" as a meaningful denominator — a row-level
rate is only informative when a row can't itself be partially complete.
A single-branch task's row is binary by construction (comanager-logic
§4's own rollup rule: complete only once every item is done), so a
row-level percentage for anything with more than one item is
architecturally incapable of showing partial progress, not just
occasionally wrong. This is a deliberate, asked-and-confirmed change
(the founder chose item-level over adding a separate progress label or
leaving it as-is) — Branches' and Reports' completion rates were left as
row-level intentionally, since those already operate at the
one-item-implicit-per-submission granularity of tasks/standards as a
whole rather than a single task's own checklist.

---

### BUG #037 — Schedule Month View Showed Every Event One Day Later Than Its Actual Date
**Severity:** MEDIUM (display-only, no data corruption)
**Area/File:** `app/owner/(authenticated)/schedule/page.tsx` — `eventsOnDay()`

**Found during:** a full end-to-end QA pass on the live site (2026-08-05),
creating real schedule events across all 4 branches and checking every
screen against the actual data. Verified with a clean reproduction: 4
events all actually stored for the same date (confirmed via the page's own
Day view, which lists `8/5/2026` for all 4) rendered in the **Aug 6** cell
in Month view — one day forward, every time, for every event.

**The problem:** `eventsOnDay(day)` bucketed the locally-built grid `day`
via `day.toISOString().slice(0, 10)` before comparing against the
UTC-stored `start_time`. `.toISOString()` on a `Date` built from local
year/month/day components (`new Date(year, month, date)`, the exact
pattern the month-grid loop uses) converts through UTC — for
`Asia/Riyadh` (UTC+3), the timezone every real Co Manager owner is in,
local midnight is UTC 21:00 the *previous* day, so the bucket key rolls
back a full calendar day before the comparison ever runs. Net effect:
every event compares as belonging to the day *after* the grid cell it's
actually being tested against, so it renders one cell later than reality.
Day/Week views were unaffected — they already compared via
`new Date(e.start_time).toDateString() === anchor.toDateString()`, a
local-to-local comparison with no UTC round-trip in the middle.

**WRONG:**
```ts
function eventsOnDay(day: Date) {
  const dayStr = day.toISOString().slice(0, 10); // rolls back a day for
                                                   // any positive UTC offset
  return events.filter((e) => e.start_time.slice(0, 10) === dayStr);
}
```

**CORRECT:**
```ts
function eventsOnDay(day: Date) {
  // Compare local calendar days on both sides — never .toISOString().slice(0,10)
  // on a locally-built Date. Same local-day comparison the Day/Week views
  // already used correctly.
  return events.filter((e) => new Date(e.start_time).toDateString() === day.toDateString());
}
```

**Rule:** Never call `.toISOString().slice(0, 10)` on a `Date` built from
local year/month/day components to get a comparison key — for any
positive UTC offset (Riyadh included) this silently shifts the date back
a day before the string comparison ever runs. When bucketing a
locally-constructed calendar day against a UTC-stored timestamp, compare
via `.toDateString()` on both sides (both evaluated in the same local
timezone) instead of round-tripping either one through UTC. Verified live
on the production site (`co-manager-seven.vercel.app/owner/schedule`,
Month view) against the existing multi-branch test account after
deploying the fix — all events now render on their correct date.

---

### BUG #038 — Owner Dashboard and Reports Pages Never Subscribed to task_item_submissions — Live Updates Stalled Until a Whole Multi-Item Task Finished
**Severity:** MEDIUM (realtime plumbing works overall — BUG#023/#034 not
reintroduced — this is a narrower granularity gap, not a full outage)
**Area/File:** `app/owner/(authenticated)/dashboard/page.tsx`,
`app/owner/(authenticated)/reports/page.tsx`

**Found during:** the same 2026-08-05 QA pass, proving realtime with a
controlled before/after test — owner Dashboard (and separately, Reports
with a branch filter applied) left open in one session, a branch manager
completing a 4-item checklist one item at a time in another, no manual
refresh at any point. Completing item 1, 2, or 3 of 4 produced **zero**
visible change on either page. Only completing the 4th (final) item — the
one that rolls the parent `task_submissions` row from `pending` to
`completed`, comanager-logic §4's rollup rule — triggered a live update
(stat cards, daily-progress bar, Recent Activity on Dashboard; KPIs and
charts, filter preserved, on Reports).

**The problem:** both pages call `useRealtimeTable` scoped to
`task_submissions` and `food_safety_submissions` only. Neither subscribed
to `task_item_submissions`. A single checklist item completing only
writes to `task_item_submissions` — the parent `task_submissions` row is
untouched until every item underneath it is done — so on these two pages
specifically, nothing ever fired until that last write happened to be the
row-flipping one. `app/owner/(authenticated)/tasks/page.tsx` already had
this exact subscription (added for BUG#036's item-level %-badge fix, its
`owner-tasks-items-*` channel) — Dashboard and Reports were just never
given the same one.

**WRONG:**
```ts
// Dashboard
useRealtimeTable(client, `owner-dashboard-${profile?.id ?? "anon"}`, "task_submissions", loadData);
useRealtimeTable(client, `owner-dashboard-fs-${profile?.id ?? "anon"}`, "food_safety_submissions", loadData);
// no task_item_submissions subscription — item-level writes never trigger loadData
```

**CORRECT:**
```ts
// Dashboard
useRealtimeTable(client, `owner-dashboard-${profile?.id ?? "anon"}`, "task_submissions", loadData);
useRealtimeTable(client, `owner-dashboard-fs-${profile?.id ?? "anon"}`, "food_safety_submissions", loadData);
useRealtimeTable(client, `owner-dashboard-items-${profile?.id ?? "anon"}`, "task_item_submissions", loadData);
```
(Reports got the same addition, routed through its existing debounced
`scheduleBackgroundReload` callback rather than a bare `loadData` — that
page already batches realtime-triggered refetches over a 1.5s window
since its query range can span up to ~180 days, per its own inline
comment; the new subscription reuses that same debounce, not a separate
one.)

**Rule:** Any page whose displayed data can change via
`task_item_submissions` (directly, or indirectly by that table's changes
eventually flipping a `task_submissions` row) needs its own realtime
subscription to that table, matching whatever refresh callback the page
already uses for `task_submissions` — don't assume the parent row's own
subscription is enough; the two tables change independently and a
multi-item checklist can sit mid-completion for an arbitrary amount of
time. Verified live: deployed the fix, repeated the identical partial-item
completion test against the production site's existing multi-branch test
account, and confirmed both pages now update within about a second of
each individual item being marked done, not just the last one.

---

### BUG #039 — "Completion by Category" Bucketed by an Unused tasks.category Field Instead of Tasks/Food Safety/Schedule
**Severity:** LOW (display-only, showed a technically-correct but
uninformative single "Uncategorized" row instead of being wrong data)
**Area/File:** `app/owner/(authenticated)/dashboard/page.tsx`

**Found during:** the same 2026-08-05 QA pass, comparing the Dashboard
against comanager-design-match's own spec for this exact widget: "per
category (Tasks/Food Safety/Schedule) with % label." The live widget
showed exactly one row, "Uncategorized," at whatever the overall task
completion rate happened to be.

**The problem:** the widget grouped today's `task_submissions` rows by
`tasks.category` — a real column, but one no task-creation UI anywhere in
the app ever exposes a way to set (comanager-logic §7's low-friction
creation modal has title/frequency/scope/items, no category field), so
every task's `category` was `null` and fell into a single "Uncategorized"
bucket. Food Safety and Schedule data were never read by this widget at
all, despite being named directly in the design spec as two of the three
rows it's supposed to show.

**Founder-clarified before fixing:** `schedule_events` has no
status/completion column at all (it's a plain calendar booking, not a
recurring submission) — asked the founder how to define a "Schedule
completion %" with no existing concept to reuse; confirmed: percentage of
today's events whose `end_time` has already passed.

**WRONG:**
```ts
const categoryOf = new Map(tasks.map((t) => [t.id, t.category ?? "Uncategorized"]));
const categoryBuckets = new Map<string, { completed: number; total: number }>();
todaySubs.forEach((s) => {
  const cat = categoryOf.get(s.task_id) ?? "Uncategorized"; // always "Uncategorized" —
  const b = categoryBuckets.get(cat) ?? { completed: 0, total: 0 }; // no UI ever sets tasks.category
  b.total += 1;
  if (s.status === "completed") b.completed += 1;
  categoryBuckets.set(cat, b);
});
const categoryRates = Array.from(categoryBuckets.entries()).map(([cat, v]) => ({
  category: cat,
  rate: calcRate(v.completed, v.total),
}));
```

**CORRECT:**
```ts
// Three fixed rows, matching comanager-design-match exactly, each computed
// from the feature area's own submission data — not a task-level field.
const todayFsSubs = fsSubs.filter((s) => s.due_date === today);
// "Completion" = a reading was submitted (pass or fail both count) — same
// submitted-vs-not semantic as Tasks, deliberately NOT the same number as
// Reports' separate "Food Safety Compliance" (pass-rate) KPI.
const fsCompletedToday = todayFsSubs.filter((s) => s.result === "pass" || s.result === "fail").length;
const now = new Date();
const scheduleCompletedToday = todaySchedule.filter((e) => new Date(e.end_time) < now).length;

const categoryRates = [
  { category: "Tasks", rate: calcRate(completedToday, todaySubs.length) },
  { category: "Food Safety", rate: calcRate(fsCompletedToday, todayFsSubs.length) },
  { category: "Schedule", rate: calcRate(scheduleCompletedToday, todaySchedule.length) },
];
```
`todaySchedule` is a new, separately-fetched state — `schedule_events`
rows whose `start_time` falls within today's *Riyadh* calendar day
(queried over a 1-day-buffered UTC window, then trimmed precisely via
`riyadhDateString()` equality, same two-step pattern
`lib/utils/riyadh-date.ts` documents — never a bare UTC-day query against
a Riyadh-local concept, per BUG#030).

**Rule:** When a widget's spec names specific categories, don't infer the
grouping key from whatever column happens to exist on the most
conveniently-already-fetched table — check whether that column actually
has a UI path to be populated before trusting it as a real dimension.
`tasks.category` existing in the schema was never evidence it was in use.
Verified live: deployed the fix, reloaded the Dashboard against the
production site's existing multi-branch test account, and confirmed all
three named rows (Tasks/Food Safety/Schedule) render with independently
correct percentages matching the actual submission/event data.

---

### BUG #040 — PostgREST Upsert onConflict Can't Target an Expression Index — Caught Before Deploy, Not Live
**Severity:** MEDIUM (would have broken slot-generation idempotency the
moment it ran against a branch with any active shift, but never actually
shipped in the broken form — caught by reasoning through the actual
request PostgREST builds, before writing any app code against it)
**Area/File:** `supabase/migrations/*_work_shifts*.sql`,
`supabase/functions/generate-daily-slots/index.ts` (Work Shifts,
comanager-logic §9)

**Found during:** planning the Work Shifts schema migration — extending
`task_submissions`'/`food_safety_submissions`' uniqueness to include a
new nullable `shift_id` column. Postgres unique constraints never treat
two NULLs as equal, so a plain `unique(..., shift_id)` would stop
deduplicating every row where `shift_id` is NULL (i.e. every branch with
zero shifts — most branches). The fix for *that* problem is
well-known — a `COALESCE(shift_id, sentinel)` unique expression index —
and was applied first, live, before this second issue was caught.

**The problem:** this codebase's slot generation never runs raw SQL
against Postgres — `generate-daily-slots/index.ts` upserts through
`@supabase/supabase-js`, which compiles `.upsert(rows, { onConflict:
"task_id,branch_id,due_date" })` into a PostgREST request, and
PostgREST's `on_conflict` query parameter only accepts a **plain
column-name list** matching a real, named unique constraint — it has no
mechanism to target an arbitrary expression (like
`COALESCE(shift_id, sentinel)`) the way a hand-written
`INSERT ... ON CONFLICT (col1, col2, COALESCE(...))` could in raw SQL.
An expression-index-based fix that is perfectly valid Postgres is
silently unusable from this app's only actual write path.

**WRONG:**
```sql
create unique index task_submissions_unique_slot on public.task_submissions (
  task_id, branch_id, due_date, coalesce(shift_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
```
```ts
// PostgREST's on_conflict can't reference the coalesce(...) expression —
// there is no column list that matches this index.
.upsert(taskRows, { onConflict: "task_id,branch_id,due_date,shift_id" })
```

**CORRECT:**
```sql
-- A real GENERATED ALWAYS column materializes the same NULL-safe value
-- as an ordinary, plain column — indexable and constraint-able the
-- normal way, and Postgres computes it automatically on every
-- insert/update, so the app never sends a value for it.
alter table public.task_submissions
  add column shift_key uuid generated always as (
    coalesce(shift_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) stored;
alter table public.task_submissions
  add constraint task_submissions_unique_slot unique (task_id, branch_id, due_date, shift_key);
```
```ts
.upsert(taskRows, { onConflict: "task_id,branch_id,due_date,shift_key" })
```

**Rule:** Any NULL-safe uniqueness fix (the `COALESCE(col, sentinel)`
expression-index pattern) that needs to be reachable through
`@supabase/supabase-js`'s `.upsert({ onConflict })` — as opposed to raw
SQL — must be materialized as a real `GENERATED ALWAYS ... STORED`
column with a plain named unique constraint on it, never a bare
expression index. PostgREST's `on_conflict` parameter is a column-name
list, not a SQL expression parser; confirm the actual write path (ORM/
REST helper vs. raw SQL) before assuming a Postgres-valid constraint
shape is reachable from it. Caught here by tracing through exactly what
`.upsert()` compiles to before deploying, not by a live failure — the
same rigor is worth applying any time a "correct in Postgres" fix is
about to be driven through a REST/ORM layer with its own narrower
surface.

---

### BUG #041 — Manager's Shift Selection Appeared to Reset on Every Page Navigation
**Severity:** HIGH (core Work Shifts interaction broken — a selection made on Dashboard was invisible on Tasks/Food Safety)
**Area/File:** `lib/hooks/useManagerShift.ts` (Work Shifts, comanager-logic §9)

**Found during:** live Stage 3 verification (2026-08-06) — selected
"Morning" on a manager's Dashboard (visibly took effect, task list
filtered correctly), then navigated to Tasks: the shift-scoped task was
gone, only the shift-agnostic one remained, as if no shift had ever been
selected.

**The problem:** `useManagerShift` seeded its `currentShiftId` state
from `profile.current_shift_id`, where `profile` comes from
`usePanelAuthContext()`. BUG#031's own fix made every branch-manager
page reuse the SAME `profile` object the panel layout fetched once at
session start, specifically to stop each page re-running the identical
auth query on every navigation. That optimization is correct for
`profile` as a whole, but `current_shift_id` is different from the rest
of the profile: unlike `branch_id`/`role`/`is_active`, it's expected to
change *during* the session, from user action, on a *different* page
than the one reading it. Dashboard's own hook instance updated its own
local state correctly when `selectShift` ran — the visible effect on
that page was real — but Tasks/Food Safety mount a brand-new
`useManagerShift` instance on navigation, and each one re-seeded itself
from the same stale `profile.current_shift_id` snapshot the layout had
fetched before the manager ever touched the switcher.

**WRONG:**
```ts
export function useManagerShift(client, profile, ready) {
  const [currentShiftId, setCurrentShiftIdState] = useState(profile?.current_shift_id ?? null);
  useEffect(() => {
    setCurrentShiftIdState(profile?.current_shift_id ?? null); // profile never actually changes mid-session
  }, [profile?.current_shift_id]);
  ...
}
```

**CORRECT:**
```ts
export function useManagerShift(client, profile, ready) {
  const [currentShiftId, setCurrentShiftIdState] = useState<string | null>(null);
  // Fetched directly, not derived from the cached profile snapshot — makes
  // every page's own hook instance independently correct against the
  // database, regardless of which page the shift was actually selected on.
  useEffect(() => {
    if (!ready || !profile) return;
    let cancelled = false;
    void client.from("users").select("current_shift_id").eq("id", profile.id).single()
      .then(({ data }) => { if (!cancelled) setCurrentShiftIdState(data?.current_shift_id ?? null); });
    return () => { cancelled = true; };
  }, [client, profile, ready]);
  ...
}
```

**Rule:** BUG#031's "fetch the profile once, share it via context" pattern is correct for genuinely static session data (role, branch_id, is_active) but must NOT be extended to a field that's expected to change mid-session from the user's own actions on a different page than the one reading it — that field needs its own fetch, independent of whatever cached snapshot the rest of the profile rides on. When adding a new mutable-during-session column to a profile-shaped object, ask specifically whether every consumer of it needs to observe changes made by a *different* mounted instance, not just whether the initial value is correct.

---

### BUG #042 — Handover Note Name Attribution Had No Read Path That Wasn't Either Broken or a Cross-Tenant RLS Risk
**Severity:** MEDIUM (feature gap, not a live leak — the attempted fix path never actually reached production)
**Area/File:** `app/branch-manager/(authenticated)/dashboard/ShiftPanel.tsx`, `shift_handovers` (Work Shifts, comanager-logic §9)

**Found during:** Stage 3 live verification (2026-08-06) — noted as a
non-blocking cosmetic gap and flagged to the founder rather than silently
left unexplained: `ShiftPanel` tried to resolve a handover note's author
by querying `public.users` for every branch manager on the branch, but
that query always silently returned zero rows (no RLS policy lets a
manager read a co-worker's `users` row at all), so the note rendered with
no name.

**The problem:** the tempting "just add a policy" fix is exactly the
shape BUG#019 already warned about — RLS is enforced per ROW, not per
column. A policy like `manager reads co-worker users rows on own branch`
would make the whole matched row selectable over raw REST, not just the
`name` the UI happens to display — a raw `select=id,name,email,phone` from
one manager's own session would then return a co-worker's email and phone
too, even though the UI only ever asked for `name`. Column-level `GRANT`
(the technique used for the Stage 3 `current_shift_id` write path) doesn't
fix this for `SELECT` the way it does for `UPDATE`, either — grants are
table-wide per role, and `authenticated` already needs broader `SELECT`
access to `users` for a manager's own profile fetch, an owner's manager
list, etc.; narrowing that grant to `(id, name)` would break those other
legitimate reads.

**WRONG:**
```ts
// Tries to resolve OTHER managers' names by reading their users rows —
// either silently returns nothing (no policy exists) or, if "fixed" by
// adding a policy scoped to the same branch, exposes every other column
// on that row too, since RLS can't restrict which columns a matched row
// reveals.
const { data: managers } = await client
  .from("users")
  .select("id, name")
  .eq("branch_id", branchId)
  .eq("role", "branch_manager");
```

**CORRECT:**
```sql
-- Denormalize the name onto the row the writer already has full
-- access to (their own shift_handovers upsert) instead of granting
-- any new read path into `users` at all.
alter table public.shift_handovers add column left_by_name text;
```
```ts
// ShiftPanel.tsx — written by the same manager saving their own note,
// using their own already-known name (never someone else's row):
await client.from("shift_handovers").upsert(
  { ..., left_by: managerId, left_by_name: managerName, ... },
  { onConflict: "branch_id,shift_id,handover_date" },
);
// Read side: use the snapshot column directly, no users query at all.
const { data: rows } = await client
  .from("shift_handovers")
  .select("id, shift_id, note, left_by, left_by_name")
  .eq("branch_id", branchId)
  .eq("handover_date", today);
```

**Rule:** When a UI needs to display one narrow fact about another
tenant's user (a name, in this case) and no RLS policy currently exposes
that user's row, check whether the fact can be **denormalized onto a row
the requester already legitimately writes** before adding any new SELECT
policy on `users` — RLS's row-level (not column-level) granularity means
"just let them read the name" is never actually narrow once it's a real
policy. Verified live 2026-08-06: (1) a co-worker's handover note now
shows their real name; (2) a raw REST `GET .../users?select=id,name,email,phone&name=eq.<co-worker>`
using the reading manager's own bearer token returns `[]` — confirmed
against the same manager's own row returning full data, proving the empty
result is RLS correctly blocking the *other* user's row, not a broken
query.

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
