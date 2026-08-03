# Pending Manual Steps

Everything below is outside what code in this repo can do — either it
needs DDL access to the live Supabase project (no Management API token or
direct Postgres connection string exists in this environment, only the
REST API via the anon/service-role keys), or it needs an authenticated
Supabase CLI session, or it's a Supabase dashboard-only setting.

Run the SQL sections in order — later ones depend on earlier ones existing.

---

## 1. Supabase Auth dashboard settings

1. **Authentication → Providers → Email → "Confirm email"** — **turn this
   OFF for now.** Founder-directed change, 2026-07-28: the email
   verification gate (comanager-logic §1) is temporarily disabled so
   owners land in the dashboard immediately after signing up, no
   confirmation step. This is the actual mechanism — nothing in the app
   code can override this setting either way, since Supabase's own
   `signUp()`/`signInWithPassword()` enforce it server-side. The code
   already adapts to whichever way this is set (see
   `app/owner/register/actions.ts`), so flipping it back ON later to
   re-enable comanager-logic §1's gate needs no code change.

2. **Authentication → Email Templates → "Confirm signup" — no longer
   required, but optional.** Earlier guidance here said this template
   *must* be edited to link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`.
   That's no longer true: `registerOwner` now passes `emailRedirectTo`, and
   `app/auth/confirm/page.tsx` was rewritten (as a Client Component, not a
   server route — see comanager-bug-log BUG #017) to handle whatever the
   **default**, unedited template sends: a URL hash fragment
   (`#access_token=...&refresh_token=...`). Verified end-to-end by
   following the actual redirect chain of a real generated link and
   confirming it lands on the owner dashboard. You can leave this template
   at its default. If you *do* still want to customize it to the
   `token_hash`/`type` query-string format instead, that also still works —
   the page handles both, plus a `code` param, in one place.

---

## 2. Schema migrations — run in the Supabase SQL Editor, in this order

### 2.1 — Food safety standard requirement flags (from Phase 2) — ✅ DONE

`food_safety_standards` was missing columns that `comanager-logic` §5
already assumed existed (independent photo/note requirements, same as
tasks). **Confirmed applied 2026-07-29** — verified live: the Food Safety
page (both owner and branch-manager) loads without the column-missing
error, and a real standard row with these columns renders correctly.

```sql
alter table public.food_safety_standards
  add column if not exists requires_photo boolean not null default false,
  add column if not exists requires_note boolean not null default false;
```

### 2.2 — Add 'missed' to food_safety_submissions.result (from Phase 4)

`comanager-logic` §4 requires the midnight job to flip overdue pending
slots to `'missed'` for both tables, but this table's `result` enum only
allowed `pending`/`pass`/`fail`. Deliberately not reusing `fail` — a
missed check (never done) and a failed reading (done, out of range) are
different events that the alert/acknowledge flow should be able to tell
apart.

```sql
alter table public.food_safety_submissions
  drop constraint food_safety_submissions_result_check;

alter table public.food_safety_submissions
  add constraint food_safety_submissions_result_check
  check (result in ('pending', 'pass', 'fail', 'missed'));
```

**✅ DONE — confirmed applied 2026-08-01** via direct `supabase db query`
access (newly available in this environment; this file was stale until
now — it said "not yet run" based on a 2026-07-29 check, but the
constraint was applied at some point after that without this file being
updated). Confirmed directly: `pg_get_constraintdef` for
`food_safety_submissions_result_check` includes `missed` in the allowed
values.

### 2.3 — Idempotency constraints for slot generation (from Phase 4)

The `generate-daily-slots` Edge Function upserts with `ON CONFLICT DO
NOTHING` so re-running it for the same day never duplicates or resets an
already-generated slot. This requires unique constraints that don't exist
yet:

```sql
alter table public.task_submissions
  add constraint task_submissions_task_id_branch_id_due_date_key
  unique (task_id, branch_id, due_date);

alter table public.food_safety_submissions
  add constraint food_safety_submissions_standard_id_branch_id_due_date_key
  unique (standard_id, branch_id, due_date);
```

**✅ DONE — confirmed applied 2026-08-01** via direct `supabase db query`
access (this file was stale — it said "not yet run" based on a
2026-07-29 check). Confirmed directly: both
`task_submissions_task_id_branch_id_due_date_key` and
`food_safety_submissions_standard_id_branch_id_due_date_key` exist in
`pg_constraint`.

> If either `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE` fails with a
> duplicate-key error, it means two rows already exist for the same
> `(task_id, branch_id, due_date)` (or the food-safety equivalent) —
> deduplicate those rows first, then re-run.

### 2.4 — Branch cap trigger (2026-07-29 decision)

Branch creation is now hard-capped at `subscriptions.branches_count` —
previously a genuinely open question (re-checked comanager-logic and
comanager-context, neither answered it), now resolved: blocked until
upgrade, not auto-billed. Same 3-layer pattern as the manager cap.

```sql
create or replace function public.enforce_branch_cap()
returns trigger
language plpgsql
security definer
as $$
declare
  active_count int;
  allowed_count int;
begin
  if new.is_active = true then
    select count(*) into active_count
    from public.branches
    where owner_id = new.owner_id
      and is_active = true
      and id <> new.id;

    select branches_count into allowed_count
    from public.subscriptions
    where owner_id = new.owner_id;

    if allowed_count is not null and active_count >= allowed_count then
      raise exception 'Branch limit reached for this subscription (% of % branches used)', active_count, allowed_count;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_branch_cap
before insert or update on public.branches
for each row
execute function public.enforce_branch_cap();
```

**✅ DONE — confirmed applied 2026-08-01** via direct `supabase db query`
access (this file was stale — said "not yet run"). Confirmed directly:
`trg_enforce_branch_cap` exists in `pg_trigger`, and the function's body
already includes the `pg_advisory_xact_lock` addition from §6.2 below —
both were applied together at some point.

### 2.5 — CRITICAL: fix cross-owner RLS data leak (BUG#019, 2026-07-29) — run before 2.6

**Found during live verification of the branch-cap/checklist work**: a
brand-new test owner account (0 branches, 0 managers, just registered)
immediately showed two pre-existing tasks ("Opening Checklist", "Opening
Checklist (copy)" — the exact test tasks mentioned in §2.6 below,
belonging to a *different* owner) on its own Tasks page. Root cause: the
`"manager reads applicable {tasks|fs standards|schedule_events}"` RLS
policies check only `branch_id = my_branch_id() or branch_id is null`,
with no ownership check on the `is null` arm. Since Postgres OR's all
permissive `select` policies on a table together, this `is null` arm
matches *every* owner's globally-scoped rows for *every other* owner too
— any owner or branch manager on the platform can currently read any other
owner's "all branches" tasks, food-safety standards, and schedule events.
See comanager-bug-log BUG #019 for the full writeup. This is a genuine
multi-tenant data isolation break — treat as higher priority than the
other items in this file.

```sql
create or replace function public.my_owner_id()
returns uuid
language sql
security definer
stable
as $$
  select case
    when public.my_role() = 'owner' then auth.uid()
    else (select owner_id from public.branches where id = public.my_branch_id())
  end;
$$;

drop policy "manager reads applicable tasks" on public.tasks;
create policy "manager reads applicable tasks"
  on public.tasks for select
  using (
    branch_id = public.my_branch_id()
    or (branch_id is null and owner_id = public.my_owner_id())
  );

drop policy "manager reads applicable fs standards" on public.food_safety_standards;
create policy "manager reads applicable fs standards"
  on public.food_safety_standards for select
  using (
    branch_id = public.my_branch_id()
    or (branch_id is null and owner_id = public.my_owner_id())
  );

drop policy "manager reads applicable schedule_events" on public.schedule_events;
create policy "manager reads applicable schedule_events"
  on public.schedule_events for select
  using (
    branch_id = public.my_branch_id()
    or (branch_id is null and owner_id = public.my_owner_id())
  );
```

**✅ DONE — confirmed applied 2026-08-01** via direct `supabase db query`
access (this file was stale — said "not yet run"). Confirmed directly:
`my_owner_id()` exists, and the `"manager reads applicable tasks"` policy
on `public.tasks` already references it in its `USING` clause.

### 2.6 — Tasks-as-checklists: task_items + task_item_submissions (2026-07-29 decision)

Resolved a real conflict between comanager-context (flat tasks schema)
and comanager-design-match (task cards showing item counts, managers
expanding to see individual items) — a task is now a checklist. Per-item
submission requirements (founder's explicit choice over the simpler
once-per-task option). **Run this whole block as one transaction** — it
drops columns with live data (test task rows currently have
`requires_photo`/etc. set at the task level) and adds two new tables in
the same migration:

```sql
begin;

-- New: ordered checklist items belonging to a task
create table public.task_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  title_ar text,
  sort_order int not null default 0,
  requires_photo boolean not null default false,
  requires_note boolean not null default false,
  requires_value boolean not null default false,
  value_min numeric,
  value_max numeric,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- requires_photo/note/value/value_min/value_max move OFF tasks onto
-- task_items — this DROPS existing values on any live task rows.
alter table public.tasks
  drop column if exists requires_photo,
  drop column if exists requires_note,
  drop column if exists requires_value,
  drop column if exists value_min,
  drop column if exists value_max;

-- task_submissions loses its own photo_url/note/value_entered — those
-- move to the new item-level table below. This DROPS existing values on
-- any live submission rows (test data only, expected).
alter table public.task_submissions
  drop column if exists photo_url,
  drop column if exists note,
  drop column if exists value_entered;

-- New: one row per task_item per cycle, nested under its parent
-- task_submissions row
create table public.task_item_submissions (
  id uuid primary key default gen_random_uuid(),
  task_submission_id uuid not null references public.task_submissions(id) on delete cascade,
  item_id uuid not null references public.task_items(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','completed','missed')),
  photo_url text,
  note text,
  value_entered numeric,
  submitted_at timestamptz,
  submitted_by uuid references public.users(id),
  unique (task_submission_id, item_id)
);

alter table public.task_items enable row level security;
alter table public.task_item_submissions enable row level security;

create policy "super admin full access to task_items"
  on public.task_items for all
  using (public.my_role() = 'super_admin');

create policy "owner manages own task_items"
  on public.task_items for all
  using (exists (select 1 from public.tasks t where t.id = task_items.task_id and t.owner_id = auth.uid()))
  with check (exists (select 1 from public.tasks t where t.id = task_items.task_id and t.owner_id = auth.uid()));

create policy "manager reads applicable task_items"
  on public.task_items for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_items.task_id
        and (
          t.branch_id = public.my_branch_id()
          or (t.branch_id is null and t.owner_id = public.my_owner_id())
        )
    )
  );

create policy "super admin full access to task_item_submissions"
  on public.task_item_submissions for all
  using (public.my_role() = 'super_admin');

create policy "owner reads own branch task_item_submissions"
  on public.task_item_submissions for select
  using (
    exists (
      select 1 from public.task_submissions ts
      where ts.id = task_item_submissions.task_submission_id
        and public.is_my_branch(ts.branch_id)
    )
  );

create policy "manager manages own branch task_item_submissions"
  on public.task_item_submissions for all
  using (
    exists (
      select 1 from public.task_submissions ts
      where ts.id = task_item_submissions.task_submission_id
        and ts.branch_id = public.my_branch_id()
    )
  )
  with check (
    exists (
      select 1 from public.task_submissions ts
      where ts.id = task_item_submissions.task_submission_id
        and ts.branch_id = public.my_branch_id()
    )
  );

commit;
```

**✅ DONE — confirmed applied 2026-08-01** via direct `supabase db query`
access (this file was badly stale — said "not yet run, blocks the Tasks
UI entirely," but the Tasks UI has clearly been working against
`task_items`/`task_item_submissions` throughout every session since, which
wouldn't be possible otherwise). Confirmed directly: both tables exist,
and `tasks.requires_photo` / `task_submissions.photo_url` no longer exist
(the columns this migration drops).

---

## 3. Deploy and schedule the slot-generation Edge Function (from Phase 4)

The function itself already exists in this repo at
`supabase/functions/generate-daily-slots/index.ts`. Deploying and
scheduling it requires the Supabase CLI authenticated as you — no CLI
session or Management API token exists in this environment.

### 3.1 — Install and authenticate the CLI (skip if already done)

```bash
npm install -g supabase
supabase login
```

### 3.2 — Link this repo to the live project and deploy the function

**2026-07-29 fix:** the original command below (no `--no-verify-jwt`) causes
a `401 Unauthorized` on every call, including from pg_cron in step 3.5 —
Supabase's platform-level JWT verification is ON by default for every
deployed Edge Function and runs *before* the function's own code, so it
rejects the `CRON_SECRET` bearer token as an invalid JWT before
`index.ts`'s own `Authorization` check ever executes. `supabase/config.toml`
now has `verify_jwt = false` scoped to just this function (repo source of
truth, so this doesn't regress on the next deploy), and `--no-verify-jwt` is
added to the command below as a belt-and-suspenders flag — pass both.

Run from the repo root (`C:\Co-Manager`):

```bash
supabase link --project-ref zxssngjlspdjglofegni
supabase functions deploy generate-daily-slots --no-verify-jwt
```

**If you already deployed without this** (i.e. you're seeing the 401 right
now): just re-run that same command — redeploying overwrites the previous
version, no separate "undo" step needed.

### 3.3 — Set the function's shared secret

Pick any random string yourself (e.g. generate one with
`openssl rand -hex 32`, or any password manager) and set it as a secret —
this is what stops anyone else from hitting the function's public URL and
triggering slot generation:

```bash
supabase secrets set CRON_SECRET=<paste-your-random-string-here>
```

Keep that exact string — you need to paste it again in step 3.5 below.

### 3.4 — Enable the required Postgres extensions

In the Supabase SQL Editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

(Or via Dashboard → Database → Extensions → search "pg_cron" and
"pg_net" → Enable, if you prefer the UI.)

### 3.5 — Schedule the daily cron job

In the Supabase SQL Editor — replace `<same CRON_SECRET value>` with the
exact string you set in step 3.3:

```sql
select cron.schedule(
  'generate-daily-slots',
  '0 21 * * *', -- 21:00 UTC = 00:00 Asia/Riyadh (UTC+3, no DST)
  $$
  select net.http_post(
    url := 'https://zxssngjlspdjglofegni.supabase.co/functions/v1/generate-daily-slots',
    headers := jsonb_build_object('Authorization', 'Bearer <same CRON_SECRET value>'),
    body := '{}'::jsonb
  );
  $$
);
```

### 3.6 — Verify it worked

You can trigger the function manually once, right after deploying, to
confirm it runs before waiting for the schedule:

```bash
curl -X POST https://zxssngjlspdjglofegni.supabase.co/functions/v1/generate-daily-slots \
  -H "Authorization: Bearer <same CRON_SECRET value>"
```

A working response looks like:

```json
{"ok":true,"riyadhToday":"2026-07-28","frequenciesGenerated":["daily"],"taskSlotsAttempted":N,"foodSafetySlotsAttempted":N}
```

To check the schedule itself later:

```sql
select * from cron.job where jobname = 'generate-daily-slots';
select * from cron.job_run_details order by start_time desc limit 5;
```

---

## 4. CRITICAL: Enable Realtime replication for live-update tables (BUG#023, 2026-07-29)

**Found during a full regression pass**: submitted a food-safety reading as
a branch manager with the owner's Dashboard open in a separate tab (no
manual refresh) — the "Pending" count and "Recent activity" feed never
updated. Root-caused with a standalone Node script that subscribed
directly to Supabase Realtime (bypassing the browser/React app entirely),
triggered a real `UPDATE` via the service-role client, and confirmed
**zero `postgres_changes` events were delivered** — reproduced for both
`food_safety_submissions` and `task_submissions`. The app's own
`useRealtimeTable` hook (`lib/supabase/use-realtime.ts`) is written
correctly (`event: "*"`, unique channel names, cleanup on unmount — see
comanager-bug-log BUG#009/010/011) — this is not an app-code bug. Tables
are simply never delivered to Postgres's logical-replication publication
that Supabase Realtime reads from, which is a one-time project setup step,
not something that happens automatically just because RLS exists on the
table.

Run this in the Supabase SQL Editor — every table any page currently
subscribes to via `useRealtimeTable`:

```sql
alter publication supabase_realtime add table
  public.task_submissions,
  public.task_item_submissions,
  public.food_safety_submissions,
  public.schedule_events;
```

(Equivalent Dashboard path: Database → Replication → click into the
`supabase_realtime` publication → toggle these 4 tables on, if you prefer
the UI over SQL.)

**Not yet run.** After running it, re-test: open the owner Dashboard in
one tab, submit a task or food-safety reading as a branch manager in
another (or an incognito window), and confirm the stat cards / Recent
Activity update within a second or two with no manual refresh. If it
still doesn't update, check `select * from pg_publication_tables where
pubname = 'supabase_realtime';` to confirm the 4 tables actually show up
there — a report of ambiguous "0 rows returned" from that same query
before running the `alter publication` above would confirm the diagnosis.

---

## 5. CRITICAL: Set environment variables in the Vercel dashboard (2026-07-30)

**Found during:** debugging "owner login gets stuck on the live site,
never redirects" — reproduced directly on
`https://co-manager-seven.vercel.app`. Root-caused by pulling the actual
deployed JS bundle (`_next/static/chunks/app/owner/login/page-*.js`) and
reading the compiled `makeBrowserClient` function: it still read
`a.env.NEXT_PUBLIC_SUPABASE_URL` as a live runtime property lookup,
instead of having the literal URL string baked in as a constant. Next.js
inlines `NEXT_PUBLIC_*` vars as string literals via webpack's
DefinePlugin *whenever they're present at build time* — the fact that
the deployed bundle still had a runtime lookup proves
`NEXT_PUBLIC_SUPABASE_URL` (and almost certainly
`NEXT_PUBLIC_SUPABASE_ANON_KEY` alongside it) was never set in Vercel's
own environment variables at all. `.env.local` is gitignored and never
deploys — Vercel needs every one of these configured separately in its
own dashboard, and this project's env vars have apparently never been
set there.

**What actually happened on click "Sign in":** `createClient()` calls
`createBrowserClient(undefined, undefined, ...)`, which throws
`"@supabase/ssr: Your project's URL and API key are required to create a
Supabase client!"` — confirmed live by instrumenting
`window.addEventListener('unhandledrejection', ...)` before submitting on
the real deployed site. `useLoginForm`'s `handleSubmit` had no
`try`/`catch` around this (fixed separately, see BUG#033 in
comanager-bug-log), so the
throw became a silently-swallowed unhandled rejection: `submitting` was
already `true`, and nothing ever set it back to `false` — the button was
stuck on "Signing in..." forever with zero visible error. That code fix
now surfaces a clear "Something went wrong. Please try again." message
instead, but it can't fix the *actual* missing env vars — that's Vercel
dashboard-only, outside anything in this repo.

**Not related to the `sin1` region change** or anything hardcoded to
localhost — checked both explicitly; neither was the cause.

### What to do

1. Vercel dashboard → this project → **Settings → Environment
   Variables**.
2. Add every variable from `.env.local.example`, scoped to at least
   **Production** (add to Preview/Development too if you want branch
   deploys and `vercel dev` to work the same way):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`
     (or the combined `CLOUDINARY_URL` — either format works, see
     `lib/cloudinary/upload-photo.ts`)
   - `NEXT_PUBLIC_SITE_URL` (recommended — e.g. `https://co-manager-seven.vercel.app`)
   Use the exact same values already in your local `.env.local`.
3. **Trigger a fresh deploy after adding them** — `NEXT_PUBLIC_*` vars are
   baked into the JS bundle at *build* time, not read at runtime. Adding
   them in the dashboard alone does not fix the already-built deployment;
   either click **Redeploy** on the latest deployment in Vercel, or push
   any new commit.
4. Only `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` were
   directly proven missing (via the bundle inspection above) — the
   server-only vars (`SUPABASE_SERVICE_ROLE_KEY`, `CLOUDINARY_*`) can't be
   checked the same way since they're never sent to the browser at all,
   but given none of them appear to have ever been configured, assume
   they're missing too and set all of them together. If they *are*
   missing, registration (`app/owner/register/actions.ts`) and photo
   upload (`lib/cloudinary/upload-photo.ts`) are very likely broken on
   the live site as well, for the identical reason.

**✅ DONE — confirmed 2026-08-01.** Re-verified live: login now redirects
correctly on `https://co-manager-seven.vercel.app`, and the deployed JS
bundle now has the real project URL baked in as a literal constant
(checked directly). Owner registration and Cloudinary upload weren't
independently re-tested, but login/data-fetching working end-to-end
confirms the client-side vars are correct now.

### 5.1 — CRITICAL: NEXT_PUBLIC_SUPABASE_ANON_KEY has a trailing newline in Vercel (2026-08-01)

**Found during:** re-testing the live site after 5.1 above was fixed —
"branch-manager dashboard doesn't update after a submission" turned out
to affect **both** panels equally on the live deployment (owner
dashboard too), while working correctly on localhost against the
identical Supabase project. Root-caused by instrumenting
`window.WebSocket` on a fresh tab: every Realtime connection attempt
immediately failed with `error` + `close(code: 1006)`. The connection URL
revealed why —

```
wss://<project>.supabase.co/realtime/v1/websocket?apikey=<...jwt...>%0A&vsn=2.0.0
```

— `%0A` is a URL-encoded newline sitting inside the `apikey` parameter.
The anon key value entered into Vercel has a literal trailing newline
character. Confirmed absent from the local `.env.local` copy of the same
key (checked byte-by-byte — no trailing whitespace on any of the 4 local
vars), so this was introduced specifically when pasting the value into
Vercel's dashboard, most likely via a copy method that includes a
trailing newline that isn't visible in the input field.

**Why this didn't also break login/data-fetching:** those go over HTTP
`Authorization: Bearer <key>` headers, where trailing whitespace gets
silently trimmed before the request is sent — Realtime's WebSocket
connection URL has no equivalent trimming, so the literal `\n` reaches
Supabase's validation and gets rejected outright. This is why REST calls
have worked fine in every test on the live site while Realtime has
silently never worked there at all.

### What to do

1. Vercel dashboard → this project → **Settings → Environment
   Variables** → edit `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Delete the existing value entirely and re-paste it carefully — select
   only the key text itself, not a trailing newline some copy methods
   append invisibly. If unsure, copy it from `.env.local` via a method
   you can verify doesn't include a trailing character (e.g. paste into
   a plain-text field first and check there's nothing after the last
   character).
3. **Redeploy** — same as any `NEXT_PUBLIC_*` change, this is baked in at
   build time.
4. **Verify**: open the live site, open DevTools console, paste this
   before navigating to any authenticated page, then log in:
   ```js
   const OrigWS = window.WebSocket;
   window.WebSocket = function(...args) {
     const ws = new OrigWS(...args);
     ws.addEventListener('open', () => console.log('REALTIME OK:', args[0]));
     ws.addEventListener('close', (e) => console.log('REALTIME FAILED:', e.code, args[0]));
     return ws;
   };
   ```
   Should log `REALTIME OK`, not `REALTIME FAILED: 1006`. Then do the
   real test: open the Dashboard in one tab, submit a task as a branch
   manager in another, confirm the first tab updates within a second or
   two with zero interaction.
5. Given this exact mistake likely happened once during initial setup,
   double-check the other values you pasted into Vercel around the same
   time for the same issue — trailing whitespace in
   `SUPABASE_SERVICE_ROLE_KEY` or the Cloudinary vars wouldn't be
   directly visible the way this one was (nothing exposes them to a
   URL query string the way Realtime does), so a working REST/upload
   flow doesn't rule it out the same way.

**✅ DONE — confirmed 2026-08-01.** Re-ran the exact verification method
above on the live site after the redeploy: confirmed the deployed chunk
hash changed (fresh build picked up the corrected value), the WebSocket
connection URL's `apikey` param no longer ends in `%0A`, the connection
opens successfully, and — the real test — completed a task in one tab
while a Dashboard sat idle in another; it updated live within about a
second with zero interaction, and the raw `postgres_changes` `UPDATE`
message for the exact changed row was captured over the wire. Realtime
is confirmed genuinely working end-to-end on the live deployment now.

---

## 6. Audit fixes #1 and #3 (2026-07-30) — run both, either order

### 6.1 — CRITICAL: narrow manager RLS from `for all` to `select`+`update` (audit finding #1)

**Verified live against the current, unpatched DB (2026-07-30):** signed in
as a real branch manager and sent a raw `DELETE
/rest/v1/task_submissions?id=eq.<row>` with nothing but that manager's own
session token — it succeeded (`200`, row deleted), even though the app UI
never exposes a delete action anywhere. Root cause: the three `"manager
manages own branch ..."` policies below are `for all`, so RLS grants
INSERT and DELETE on top of the SELECT/UPDATE the app actually uses —
comanager-context's permission model has managers "execute... only their
own assigned tasks," not create or destroy submission rows (those are
pre-created by the midnight cron / service-role only). A manager hitting
the REST API directly today can delete any submission row for their own
branch, destroying audit trail. (The row deleted during this test was
restored immediately via service-role insert — no data was lost.)

```sql
drop policy "manager manages own branch submissions" on public.task_submissions;
create policy "manager reads own branch submissions"
  on public.task_submissions for select
  using (branch_id = public.my_branch_id());
create policy "manager updates own branch submissions"
  on public.task_submissions for update
  using (branch_id = public.my_branch_id())
  with check (branch_id = public.my_branch_id());

drop policy "manager manages own branch task_item_submissions" on public.task_item_submissions;
create policy "manager reads own branch task_item_submissions"
  on public.task_item_submissions for select
  using (
    exists (
      select 1 from public.task_submissions ts
      where ts.id = task_item_submissions.task_submission_id
        and ts.branch_id = public.my_branch_id()
    )
  );
create policy "manager updates own branch task_item_submissions"
  on public.task_item_submissions for update
  using (
    exists (
      select 1 from public.task_submissions ts
      where ts.id = task_item_submissions.task_submission_id
        and ts.branch_id = public.my_branch_id()
    )
  )
  with check (
    exists (
      select 1 from public.task_submissions ts
      where ts.id = task_item_submissions.task_submission_id
        and ts.branch_id = public.my_branch_id()
    )
  );

drop policy "manager manages own branch fs submissions" on public.food_safety_submissions;
create policy "manager reads own branch fs submissions"
  on public.food_safety_submissions for select
  using (branch_id = public.my_branch_id());
create policy "manager updates own branch fs submissions"
  on public.food_safety_submissions for update
  using (branch_id = public.my_branch_id())
  with check (branch_id = public.my_branch_id());
```

**✅ DONE — confirmed applied 2026-08-01** via direct `supabase db query`
access (this file was stale — said "not yet run"). Confirmed directly:
the old `"manager manages own branch submissions"` (`for all`) policy no
longer exists on `task_submissions` — replaced by the narrower
select+update pair. The app itself needed no code change: it never called
INSERT or DELETE on these tables from the manager side to begin with
(confirmed by reading `app/branch-manager/(authenticated)/tasks/page.tsx`
and the food-safety equivalent — both only ever `.update()` an existing
pre-created row).

### 6.2 — Cap-enforcement TOCTOU race (audit finding #3)

**Not live-testable from this environment.** Reliably forcing two requests
to race inside the same Postgres transaction window isn't something a
script firing concurrent HTTP requests can guarantee (network/processing
jitter means they usually end up serialized anyway, which would look like
a "pass" whether or not the underlying gap exists) — so this is a
by-inspection fix, not one with live before/after proof like 6.1 got.
`enforce_branch_cap` and `enforce_manager_cap` both count existing active
rows and compare against the cap with no locking, so two concurrent
inserts (e.g. two open tabs creating a branch/manager at the same time)
can both read the same pre-insert count and both slip through, exceeding
the cap by one. `pg_advisory_xact_lock` serializes concurrent inserts for
the same owner/branch and auto-releases at transaction end either way —
correctly closes the gap even on a first-ever insert (unlike `select ...
for update`, which only locks rows that already exist, so it can't help
when the cap is being hit from zero).

```sql
create or replace function public.enforce_branch_cap()
returns trigger
language plpgsql
security definer
as $$
declare
  active_count int;
  allowed_count int;
begin
  if new.is_active = true then
    perform pg_advisory_xact_lock(1, hashtext(new.owner_id::text));

    select count(*) into active_count
    from public.branches
    where owner_id = new.owner_id
      and is_active = true
      and id <> new.id;

    select branches_count into allowed_count
    from public.subscriptions
    where owner_id = new.owner_id;

    if allowed_count is not null and active_count >= allowed_count then
      raise exception 'Branch limit reached for this subscription (% of % branches used)', active_count, allowed_count;
    end if;
  end if;
  return new;
end;
$$;
```

```sql
create or replace function public.enforce_manager_cap()
returns trigger
language plpgsql
security definer
as $$
declare
  active_count int;
begin
  if new.role = 'branch_manager' and new.is_active = true and new.branch_id is not null then
    perform pg_advisory_xact_lock(2, hashtext(new.branch_id::text));

    select count(*) into active_count
    from public.users
    where branch_id = new.branch_id
      and role = 'branch_manager'
      and is_active = true
      and id <> new.id;

    if active_count >= 2 then
      raise exception 'Manager limit reached for this branch (max 2 active managers)';
    end if;
  end if;
  return new;
end;
$$;
```

Both use `create or replace function` — the existing `create trigger`
statements already reference these functions by name, so no trigger needs
to be dropped or recreated, just re-running these two blocks updates the
logic the triggers call.

**✅ DONE — confirmed applied 2026-08-01** via direct `supabase db query`
access (this file was stale — said "not yet run"). Confirmed directly for
both functions individually: `enforce_branch_cap()` and
`enforce_manager_cap()` both have `pg_advisory_xact_lock` in their body.

### 6.3 — CRITICAL: my_role()/my_branch_id() never checked is_active (2026-07-30)

**Verified live against the current, unpatched DB:** signed in as a real,
active branch manager, confirmed their session could read their branch's
`task_submissions`, then deactivated that same account via service role
mid-session (simulating an owner clicking "Deactivate"), then retried the
*exact same* raw REST call with the *exact same, never-refreshed* access
token — it returned the same rows, unchanged, as if nothing had happened.
Root cause: `my_role()` and `my_branch_id()` — the two functions nearly
every RLS policy in this schema is built on — only ever checked
`id = auth.uid()`, never `is_active`. Deactivating a `public.users` row
doesn't revoke that user's Supabase Auth session (Supabase Auth has no
awareness that this app-level column even exists), so a fired/suspended
employee whose JWT hasn't separately expired could keep pulling live
operational data indefinitely via direct REST calls — `is_active` was
being enforced only by the app's own client-side `usePanelAuth` check,
never by RLS. Same class of gap as BUG#019/#024, just for account status
instead of ownership scoping.

```sql
create or replace function public.my_role()
returns text
language sql
security definer
stable
as $$
  select role from public.users where id = auth.uid() and is_active = true;
$$;

create or replace function public.my_branch_id()
returns uuid
language sql
security definer
stable
as $$
  select branch_id from public.users where id = auth.uid() and is_active = true;
$$;
```

`my_owner_id()` needs no change — it's built entirely out of these two
functions, so it already returns null for a deactivated caller once they
do. `create or replace function` again — no trigger or policy needs to be
touched individually, every policy built on `my_role()`/`my_branch_id()`
automatically stops matching for a deactivated user the moment this runs.

**Known residual gap, deliberately not fixed here:** owner-scoped
policies (`owner_id = auth.uid()` on `branches`, `tasks`, `task_items`,
`food_safety_standards`, `schedule_events`, `subscriptions`, and
`is_my_branch()`) check `auth.uid()` directly, not through
`my_role()`/`my_branch_id()` — so this fix does **not** close the
equivalent gap for a deactivated *owner* account. Left alone because
there's currently no in-app feature to deactivate an owner's own account
(only managers, via the owner's own "Deactivate" button) — flagging this
as a real, known, currently-theoretical gap rather than fixing it
unprompted, same as how this fix itself was flagged before being asked
for.

**✅ DONE — applied and confirmed 2026-08-01** via direct `supabase db
query` access (newly available in this environment). Re-ran the exact
live-deactivation test above after applying: before deactivation, the
same session returned 3 rows (`200`); after deactivation, the *same
never-refreshed token* returned an empty array (`200`, `[]`) instead of
the same unchanged rows. Also confirmed via `pg_get_functiondef` that
`my_role()`'s body now includes `and is_active = true`. Test account
restored to `is_active: true` immediately after.

---

## 7. Add CRON_SECRET to Vercel (2026-08-01, for immediate slot generation)

**New feature (not a bug fix):** creating a task/standard, or reactivating
one, now immediately generates today's pending slot via a scoped call to
`generate-daily-slots` — see comanager-logic §4 and
`lib/slots/generate-immediate-slot.ts`. Verified working end-to-end on
localhost (task creation, task reactivation, and standard creation all
confirmed generating a real slot immediately, visible on the
branch-manager side with zero manual trigger) using the `CRON_SECRET`
value already configured as a Supabase Edge Function secret.

That secret exists only on the Supabase side (Edge Function secrets) —
this app's own server (Vercel) also needs it, as a plain server-side env
var (never `NEXT_PUBLIC_*`), to authenticate its call to the function.

### What to do

1. Vercel dashboard → this project → **Settings → Environment Variables**
   → add `CRON_SECRET`, scoped to at least Production.
2. Use the **exact same value** already set via `supabase secrets set
   CRON_SECRET=...` (see §3.3 above) — this is the same secret in a
   second location, not a new one. If you don't have that value handy,
   it's readable from the already-scheduled cron job's stored command:
   ```sql
   select command from cron.job where jobname = 'generate-daily-slots';
   ```
   (the value appears literally inside the `Authorization` header string
   in that command).
3. Redeploy — server-only env vars still need a fresh deployment to be
   picked up by Vercel's functions, same as any other env var change.
4. **✅ DONE — confirmed live 2026-08-03.** Re-tested directly against
   `https://co-manager-seven.vercel.app` with a fresh, disposable owner
   account (registered a brand-new owner via the real `/owner/register`
   flow, added a branch, added a branch manager, created a task scoped to
   that branch — all through the actual live UI, headless-browser-driven,
   not direct DB writes). Confirmed via direct `supabase db query` access
   that a `task_submissions` row (`due_date` = today, `status: pending`)
   and its child `task_item_submissions` row existed within ~2 seconds of
   the task-creation click succeeding — and confirmed the branch manager's
   own `/branch-manager/tasks` page (and Dashboard) showed the new task
   immediately on first login/page load, with zero manual trigger,
   deactivate/reactivate step, or wait. `CRON_SECRET` and the other Vercel
   env vars from §5 are correctly set and working end-to-end on the live
   deployment. All test data (owner, branch, manager, task, and their auth
   accounts) was deleted afterward via the service-role key — nothing left
   behind in the live DB.

---

## 8. CRITICAL: Set Cloudinary credentials in the Vercel dashboard (2026-08-03)

**Found during:** a founder report that photo upload on the live site
shows "Photo upload isn't configured yet." for any item with
`requires_photo`. `lib/cloudinary/upload-photo.ts` (built earlier — this
is NOT the old "stubbed, not yet wired up" state; real Cloudinary upload
code exists and works locally) returns that exact string from exactly one
place: `getCloudinaryCredentials()` returned `null`, meaning neither the 3
separate vars (`CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/
`CLOUDINARY_API_SECRET`) nor the combined `CLOUDINARY_URL` resolved to a
usable credential set on the server that handled the request.

**Confirmed live, not just from the code:** ran the actual
`requires_photo` submission flow end-to-end against
`https://co-manager-seven.vercel.app` (disposable owner + branch + branch
manager, headless-browser-driven, real photo file) — the live server
action returned the exact string "Photo upload isn't configured yet.
Contact your restaurant owner." This proves the live deployment's
`getCloudinaryCredentials()` is returning `null` right now. Test data
deleted afterward.

**What this technique can't tell you, and why:** unlike
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` (BUG#033/#034),
Cloudinary's vars are deliberately **server-only** (never
`NEXT_PUBLIC_*` — comanager-bug-log's own reasoning: the API secret must
never reach the browser) — so they never get inlined into a client bundle
at build time, and there's no deployed JS to decompile the way the
Supabase URL bug was diagnosed. A behavioral test against the live
`uploadPhoto` Server Action is the closest equivalent (this file's own
"does the live server actually work" standard), but it can only prove
*that* the credential lookup is failing, not *why* — both "the vars were
simply never entered in Vercel" and "a value is present but malformed
(e.g. the exact BUG#034 trailing-newline mistake, just for a different
var this time)" produce the identical `null` result and the identical
user-facing message. Only checking directly in the Vercel dashboard (or
an authenticated `vercel env ls`, unavailable from this environment — no
cached CLI session, and completing the device-auth login flow needs a
human to open a browser) can distinguish the two.

### What to do

1. Vercel dashboard → this project → **Settings → Environment
   Variables**. Check whether `CLOUDINARY_URL` (or the 3 separate vars)
   exists at all for **Production**.
2. **If missing entirely:** add one of:
   - `CLOUDINARY_URL` — the combined form Cloudinary's own dashboard shows
     by default: `cloudinary://<API_KEY>:<API_SECRET>@<CLOUD_NAME>`
     (exactly the same value already in this repo's local `.env.local`
     for CLOUDINARY_URL — copy it from there if you want the same
     Cloudinary account dev and prod both use), **or**
   - the 3 separate vars: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
     `CLOUDINARY_API_SECRET` (the code checks these first, and falls back
     to parsing `CLOUDINARY_URL` only if any of the 3 is missing).
3. **If already present:** re-enter it rather than assuming a visual
   inspection is enough — this exact project already had one credential
   (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, BUG#034) silently broken for weeks by
   a trailing newline invisible in the dashboard's input field. Delete the
   existing value and re-paste carefully: copy `CLOUDINARY_URL` from
   `.env.local` (or wherever you're sourcing it) into a plain-text field
   first and confirm nothing follows the final character before pasting
   it into Vercel.
4. **Redeploy** — same as every other env var change in this file,
   `CLOUDINARY_*` is read server-side at request time (not baked into the
   client bundle at build time like `NEXT_PUBLIC_*`), but Vercel still
   only picks up env var changes on a fresh deployment, not on already-running
   serverless functions.
5. **Verify**: submit a `requires_photo` task/food-safety item on the live
   site as a real (or disposable test) branch manager. Success looks like
   the item completing with a `photo_url` that starts
   `https://res.cloudinary.com/...` (visible via "View photo" on the
   owner's Tasks accordion, or a direct DB check). If it still says "Photo
   upload isn't configured yet," the value is still missing or still
   malformed — check for the same trailing-whitespace mistake again, and
   also confirm the redeploy actually completed (check the deployment's
   build time against when you saved the env var).

## 9. Not blocking today, but needed before real use

- **Moyasar credentials/integration** — Phase 5, not started at all. The
  Billing page (`/owner/settings`) is a UI shell only.
