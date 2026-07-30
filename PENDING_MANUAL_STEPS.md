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

**Confirmed still not run (re-checked 2026-07-29 with a real insert, not
just a query)** — inserting a test row with `result: 'missed'` was
rejected with `violates check constraint
"food_safety_submissions_result_check"`. The exact constraint name was
verified directly against the live DB (Postgres's default auto-generated
name for an inline column check constraint) — if this errors with
"constraint does not exist", the constraint was renamed or already
dropped; check `\d food_safety_submissions` in `psql` or the Table
Editor's constraints view before re-running.

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

**Confirmed still not run (re-checked 2026-07-29)** — inserting two rows
with the same `(task_id, branch_id, due_date)` was allowed (no rejection),
confirming this constraint doesn't exist yet.

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

**Not yet run.** The app-level pre-check (layer 2) will be built alongside
this, but this trigger is the layer that actually matters — don't skip it
even after the app-level check ships.

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

**Not yet run.** `my_owner_id()` must exist before §2.6 runs, since the new
`task_items` table's own RLS policy (below) also uses it — that's why this
section is now numbered ahead of the tasks-as-checklists migration.

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

**Not yet run — blocks the new Tasks UI entirely until applied.** After
running this, any existing test task rows will have no items yet (their
old requires_* values are gone) — either delete the old test tasks
("Opening Checklist" / "Closing Checklist") and recreate them with real
items through the new UI, or manually insert a `task_items` row for each
via the SQL Editor so they have at least one item.

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

**Not yet run.** After running, re-verify with the same raw-REST DELETE
test as a signed-in branch manager against any of the three tables — it
should now come back `403`/empty instead of `200`. The app itself needs no
code change: it never called INSERT or DELETE on these tables from the
manager side to begin with (confirmed by reading
`app/branch-manager/(authenticated)/tasks/page.tsx` and the food-safety
equivalent — both only ever `.update()` an existing pre-created row).

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

**Not yet run.**

---

## 7. Not blocking today, but needed before real use

- **Cloudinary credentials.** `requires_photo` is currently stubbed
  everywhere (Branch Manager Tasks and Food Safety submission forms) — the
  UI gates submission on a file being selected, but nothing is actually
  uploaded, and `photo_url` stays `null`. Once you have a Cloudinary cloud
  name + upload preset (or API key/secret), that wiring still needs to be
  built — it was explicitly deferred, not yet started.
- **Moyasar credentials/integration** — Phase 5, not started at all. The
  Billing page (`/owner/settings`) is a UI shell only.
