---
name: comanager-auth
description: Authentication system for Co Manager. Load when working on login, logout, sessions, manager account creation, or any auth bug. Always read comanager-context first for the schema and role model. Triggers on: login, logout, session, profile, auth, manager account, password, register, Profile not found, Invalid email, Database error saving new user.
---

# Co Manager — Authentication

Read `comanager-context` first. This file covers HOW to implement auth, not
the schema or business rules — those live in comanager-context only.

## Account Creation

**Branch Manager — created by the Owner, never self-registers, no invite codes**
1. Owner types the manager's email AND password directly into the Add
   Manager form (founder decision, 2026-07-29 — replaces the earlier
   auto-generated-temp-password flow). No minimum length/complexity rule
   is enforced; the owner already knows the password they typed, so there's
   no hand-off step afterward.
2. Server-side action calls `admin.auth.admin.createUser()` (service-role
   client, never a browser-side `signUp()`) with the manager's email, the
   owner-provided password, `email_confirm: true`, and metadata:
   `role: 'branch_manager'`, `name`, `branch_id`. Deliberately not
   `supabaseOwner.auth.signUp()` — a public `signUp()` would inherit the
   project's global "Confirm email" setting (which owner registration
   needs ON), forcing the manager to click a confirmation email link
   before their first login. `admin.createUser()` sets `email_confirm`
   explicitly regardless of that project-wide setting, and never creates a
   browser session in the owner's own tab, so there's no risk of it
   overwriting the owner's session either.
3. Immediately upsert into `public.users`: `id = authData.user.id`, `role`,
   `name`, `branch_id`, `is_active: true` — `onConflict: 'id'`,
   `ignoreDuplicates: false`. This step is not optional — skipping it is the
   #1 cause of "Profile not found" on first login.
4. Update `branches.manager_id = authData.user.id`.
5. Show the owner a simple "Manager created" confirmation — no password
   hand-off screen needed anymore, since the owner already knows what they
   typed.

**Owner** — self-registers at `/owner/register`, starts on a free trial.

**Super Admin** — created directly in Supabase, not through any UI. Login
route not linked anywhere public.

## Login (same pattern, all three panels)
1. `supabase.auth.signInWithPassword()` on the panel-specific client.
2. Get user ID from the session.
3. Fetch profile: `SELECT * FROM public.users WHERE id = userId`.
4. Verify `role` matches the panel being logged into.
5. Verify `is_active = true`.
6. Pass → redirect to that panel's dashboard.

## Logout
Each panel signs out **only its own client**. Never call signOut on all
three at once — that logs people out of panels they weren't even using.

## Non-negotiable rules (each one caused a real production bug last time)

- **Never** call `localStorage.clear()` or `sessionStorage.clear()` anywhere
  in the auth flow — it destroys valid sessions on slow connections.
- Session-check timeouts must be at least 8 seconds before redirecting to
  login on a missing user — shorter timeouts fail on slow connections.
- Any temporary Supabase client used for manager creation (signing up a
  manager from the owner's session) MUST use `persistSession: false` and a
  unique `storageKey` (e.g. `'comanager-temp-signup'`). Without this, the
  temp client silently overwrites the owner's session and logs the owner out.
- Branch Manager auth context must expose the full `profile` object
  (including `branch_id`), not just `user` + `signOut`. Every page needs
  `branchId` from `profile.branch_id` — never sourced any other way.

## Diagnosing "Profile not found"
Run this SQL:
```sql
SELECT a.id AS auth_id, u.id AS profile_id, u.branch_id
FROM auth.users a
LEFT JOIN public.users u ON u.id = a.id
WHERE a.email = 'the email';
```
If `auth_id` ≠ `profile_id`, that's the cause. Fix by updating
`public.users.id` to match `auth_id` (drop the FK constraint temporarily if needed).

## Safe trigger function
The `handle_new_user` trigger must have `EXCEPTION WHEN OTHERS THEN RETURN new`
so it can never crash and silently break signup. It should upsert into
`public.users` using the auth UUID as `id`, reading `role`, `name`,
`branch_id` from `raw_user_meta_data`, with `ON CONFLICT (id) DO UPDATE`.

## Common bugs and fixes
| Symptom | Cause | Fix |
|---|---|---|
| "Database error saving new user" | Trigger crashed | Add exception handler to `handle_new_user` |
| "Profile not found" | `auth.users.id` ≠ `public.users.id` | Run diagnosis SQL above |
| "Account is inactive" | `is_active = false` | `UPDATE public.users SET is_active = true WHERE email = '...'` |
| "Invalid email or password" | Wrong creds, or auth account never created | Check `auth.users` directly |
