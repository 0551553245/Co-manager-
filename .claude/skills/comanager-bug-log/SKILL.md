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

**WRONG:**
```ts
.eq('owner_id', ownerId) // ← column does not exist on schedule_events
```

**CORRECT:**
```ts
.eq('created_by', userId) // schedule_events has created_by, not owner_id
```

**Rule:** `schedule_events` has `created_by`, never `owner_id`. To scope by
owner, join through `branches.owner_id`.

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
