# Pending Manual Steps

Everything below is outside what code in this repo can do — either it
needs DDL access to the live Supabase project (no Management API token or
direct Postgres connection string exists in this environment, only the
REST API via the anon/service-role keys), or it needs an authenticated
Supabase CLI session, or it's a Supabase dashboard-only setting.

Run the SQL sections in order — later ones depend on earlier ones existing.

---

## 1. Supabase Auth dashboard settings

These should already be done (Phase 1 registration/login was verified
working against them), but are listed here for completeness/in case
anything gets reset:

1. **Authentication → Providers → Email → "Confirm email"** must be
   **enabled**. This is what makes the owner email-verification gate
   (comanager-logic §1) actually block first login until confirmed.

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

### 2.1 — Food safety standard requirement flags (from Phase 2)

`food_safety_standards` was missing columns that `comanager-logic` §5
already assumed existed (independent photo/note requirements, same as
tasks):

```sql
alter table public.food_safety_standards
  add column if not exists requires_photo boolean not null default false,
  add column if not exists requires_note boolean not null default false;
```

**Confirmed not yet run** — the live DB errors with `column
food_safety_standards.requires_photo does not exist` as of the last check
this session.

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

**Confirmed not yet run.** The exact constraint name
(`food_safety_submissions_result_check`) was verified directly against
the live DB this session (Postgres's default auto-generated name for an
inline column check constraint) — if this errors with "constraint does
not exist", the constraint was renamed or already dropped; check
`\d food_safety_submissions` in `psql` or the Table Editor's constraints
view before re-running.

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

**Confirmed not yet run** — attempting the Edge Function's upsert against
the live DB this session failed with `there is no unique or exclusion
constraint matching the ON CONFLICT specification`, confirming these
don't exist yet.

> If either `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE` fails with a
> duplicate-key error, it means two rows already exist for the same
> `(task_id, branch_id, due_date)` (or the food-safety equivalent) —
> deduplicate those rows first, then re-run.

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

Run from the repo root (`C:\Co-Manager`):

```bash
supabase link --project-ref zxssngjlspdjglofegni
supabase functions deploy generate-daily-slots
```

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

## 4. Not blocking today, but needed before real use

- **Cloudinary credentials.** `requires_photo` is currently stubbed
  everywhere (Branch Manager Tasks and Food Safety submission forms) — the
  UI gates submission on a file being selected, but nothing is actually
  uploaded, and `photo_url` stays `null`. Once you have a Cloudinary cloud
  name + upload preset (or API key/secret), that wiring still needs to be
  built — it was explicitly deferred, not yet started.
- **Moyasar credentials/integration** — Phase 5, not started at all. The
  Billing page (`/owner/settings`) is a UI shell only.
