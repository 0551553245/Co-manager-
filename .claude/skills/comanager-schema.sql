-- ============================================================
-- CO MANAGER — DATABASE SCHEMA + ROW LEVEL SECURITY
-- Generated from comanager-context (schema) and comanager-logic
-- (business rules) on 2026-07-26.
--
-- Run this in the Supabase SQL editor on a fresh project.
-- Read comanager-context and comanager-logic before changing anything
-- here — this file IS the schema those skills describe; keep them in sync.
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABLES
-- ------------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('super_admin','owner','branch_manager')),
  name text not null,
  name_ar text,
  restaurant_name text, -- owner role only; collected at /owner/register signup
  restaurant_name_ar text,
  phone text,
  avatar_url text,
  branch_id uuid, -- set only for branch_manager role, FK added after branches table exists
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  manager_id uuid references public.users(id) on delete set null,
  name text not null,
  name_ar text,
  address text,
  address_ar text,
  city text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- now that branches exists, add the deferred FK on users.branch_id
alter table public.users
  add constraint users_branch_id_fkey
  foreign key (branch_id) references public.branches(id) on delete set null;

-- A task is now a CHECKLIST (founder decision, 2026-07-29, resolving the
-- comanager-context/comanager-design-match conflict — design-match showed
-- "6 items" / "expand to see individual checklist items", the schema was
-- flat). requires_photo/requires_note/requires_value/value_min/value_max
-- moved OFF this table onto task_items — per-item requirements, not
-- per-task (founder's explicit choice: "matches the mockup more
-- literally" over the simpler once-per-task option).
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade, -- NULL = all branches
  created_by uuid not null references public.users(id),
  title text not null,
  title_ar text,
  description text,
  description_ar text,
  category text,
  frequency text not null check (frequency in ('daily','weekly','monthly')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Ordered checklist items belonging to a task. Every task should have at
-- least one active item (enforced at the application level — a
-- cross-table "at least one row" constraint isn't expressible as a simple
-- CHECK, would need a trigger, not worth it for this).
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

-- The per-cycle "shell" row — still one per (task, branch, due_date),
-- still pre-created by the midnight cron (comanager-logic §4 unchanged at
-- this level). Its status is now a ROLLUP: 'completed' only once every
-- child task_item_submissions row for this cycle is 'completed'. No
-- longer carries photo_url/note/value_entered directly — those live on
-- the item-level submissions now, since requirements are per-item.
create table public.task_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  submitted_by uuid references public.users(id),
  status text not null default 'pending' check (status in ('pending','completed','missed')),
  due_date date not null,
  submitted_at timestamptz,
  -- Added 2026-07-27 for Phase 4 slot generation: the daily cron upserts
  -- with ON CONFLICT DO NOTHING on this key so re-running it never
  -- duplicates or resets an already-generated slot.
  unique (task_id, branch_id, due_date)
);

-- One row per task_item per cycle, nested under its parent
-- task_submissions row — mirrors the same pre-created-slot philosophy at
-- item granularity. The midnight cron creates these alongside the parent
-- row (one per active task_item for that task).
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

create table public.food_safety_standards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade, -- NULL = all branches
  created_by uuid not null references public.users(id),
  title text not null,
  title_ar text,
  description text,
  description_ar text,
  check_frequency text not null check (check_frequency in ('daily','weekly','monthly')),
  temperature_min numeric,
  temperature_max numeric,
  -- requires_value has no column here — a reading is always required for a
  -- food-safety check (pass/fail is derived from it), unlike tasks where
  -- checkbox-only is valid. photo/note are genuinely independent toggles
  -- (comanager-logic §5: "a food safety check might require both a photo
  -- AND a temperature value") — added 2026-07-27 during Phase 2, they were
  -- missing even though comanager-logic already documented them.
  requires_photo boolean not null default false,
  requires_note boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.food_safety_submissions (
  id uuid primary key default gen_random_uuid(),
  standard_id uuid not null references public.food_safety_standards(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  submitted_by uuid references public.users(id),
  -- 'missed' added 2026-07-27 for Phase 4: comanager-logic §4 says the
  -- midnight job "flips any pending slot whose due date has fully passed
  -- into status: 'missed'" for BOTH tables — this table's enum didn't
  -- support it. Deliberately not reusing 'fail' for this: a missed check
  -- (never done) and a failed reading (done, out of range) are different
  -- events and the alert/acknowledge flow should be able to tell them apart.
  result text not null default 'pending' check (result in ('pending','pass','fail','missed')),
  actual_value numeric,
  corrective_note text,
  photo_url text,
  due_date date not null,
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.users(id),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id),
  resolve_note text,
  unique (standard_id, branch_id, due_date)
);

create table public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade, -- NULL = all branches
  created_by uuid not null references public.users(id),
  title text not null,
  title_ar text,
  description text,
  event_type text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  assigned_to uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  title_ar text,
  body text,
  body_ar text,
  type text,
  is_read boolean not null default false,
  related_id uuid,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'trialing' check (status in ('trialing','active','cancelled','expired')),
  branches_count int not null default 1,
  price_per_branch_sar numeric not null default 50,
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  billing_cycle_start timestamptz,
  billing_cycle_end timestamptz,
  moyasar_token text,
  created_at timestamptz not null default now()
);
-- Free trial starts immediately at signup, no card required.
-- trial_ends_at default of 14 days — confirm the actual trial length with
-- the founder before launch; the screenshot showed "9 days left" mid-trial,
-- not the starting length.

-- ------------------------------------------------------------
-- 1b. HARD CAP: branch creation capped at subscriptions.branches_count
-- Founder decision, 2026-07-29 (previously an open question, not in
-- comanager-logic): creating a branch beyond the subscription's
-- branches_count is BLOCKED, not auto-billed — the owner must upgrade
-- first. Same 3-layer pattern as the manager cap below (UI, app, DB) —
-- this trigger is the layer that actually matters.
-- ------------------------------------------------------------

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
    -- Fixed 2026-07-30 (audit finding #3, TOCTOU race): without this,
    -- two concurrent inserts for the same owner (e.g. two open tabs) can
    -- both run the count below before either commits, both see the same
    -- pre-insert count, and both slip through — exceeding the cap by one.
    -- An advisory lock keyed to the owner serializes concurrent creates;
    -- it's released automatically at transaction end either way. `1` is
    -- an arbitrary namespace constant so this never collides with the
    -- manager-cap lock below, which uses a different one.
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

create trigger trg_enforce_branch_cap
before insert or update on public.branches
for each row
execute function public.enforce_branch_cap();

-- ------------------------------------------------------------
-- 2. HARD CAP: max 2 active branch managers per branch
-- This is the database-level enforcement layer from comanager-logic §2 —
-- the layer that actually matters, not just UI/app checks.
-- ------------------------------------------------------------

create or replace function public.enforce_manager_cap()
returns trigger
language plpgsql
security definer
as $$
declare
  active_count int;
begin
  if new.role = 'branch_manager' and new.is_active = true and new.branch_id is not null then
    -- Fixed 2026-07-30 (audit finding #3, TOCTOU race) — same reasoning
    -- as enforce_branch_cap above, keyed to the branch instead of the
    -- owner. Namespace `2` (vs. `1` above) so the two caps' locks can
    -- never collide with each other even if their hashed keys did.
    perform pg_advisory_xact_lock(2, hashtext(new.branch_id::text));

    select count(*) into active_count
    from public.users
    where branch_id = new.branch_id
      and role = 'branch_manager'
      and is_active = true
      and id <> new.id;

    if active_count >= 2 then
      raise exception 'Branch already has 2 active managers';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_manager_cap
before insert or update on public.users
for each row
execute function public.enforce_manager_cap();

-- ------------------------------------------------------------
-- 3. SAFE handle_new_user TRIGGER (auth.users -> public.users)
-- Must never crash signup — see comanager-auth for why.
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.users (id, email, role, name, restaurant_name, restaurant_name_ar, phone, branch_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'owner'),
    coalesce(new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'restaurant_name',''),
    nullif(new.raw_user_meta_data->>'restaurant_name_ar',''),
    nullif(new.raw_user_meta_data->>'phone',''),
    nullif(new.raw_user_meta_data->>'branch_id','')::uuid
  )
  on conflict (id) do update set
    role = excluded.role,
    name = excluded.name,
    restaurant_name = excluded.restaurant_name,
    restaurant_name_ar = excluded.restaurant_name_ar,
    phone = excluded.phone,
    branch_id = excluded.branch_id;
  return new;
exception when others then
  return new; -- never let this trigger block signup
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 4. HELPER FUNCTIONS FOR RLS
-- SECURITY DEFINER + no RLS check inside, to avoid recursive RLS
-- evaluation when policies query public.users for the caller's own role.
-- ------------------------------------------------------------

-- Fixed 2026-07-30 (audit finding): neither function checked is_active,
-- so a deactivated user's still-valid Supabase Auth session (deactivation
-- doesn't revoke the JWT -- Supabase Auth has no idea public.users has an
-- is_active column at all) kept full RLS-level access to every policy
-- built on these two functions. Verified live: signed in as a real
-- manager, deactivated their account via service role mid-session,
-- retried an identical raw REST call with the exact same still-valid
-- access token -- it returned the same rows, unchanged, as if nothing
-- had happened. is_active was previously enforced only by the app's own
-- client-side usePanelAuth check (bypassable by hitting the REST API
-- directly, same class of gap as BUG#019/#024). Returning null for a
-- deactivated user here means every policy using these two functions
-- automatically stops matching for them -- no other policy needs to
-- change individually.
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

-- true if the given branch belongs to an owner_id equal to auth.uid()
create or replace function public.is_my_branch(check_branch_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.branches
    where id = check_branch_id and owner_id = auth.uid()
  );
$$;

-- The owner_id this user's data should be scoped to: the user's own id if
-- they ARE the owner, otherwise the owner_id of their assigned branch (for
-- branch managers). Added 2026-07-29 to fix BUG#019 — see comanager-bug-log
-- — the "manager reads applicable X" policies below used to check only
-- `branch_id is null`, with no ownership check at all, so every owner's
-- own globally-scoped (branch_id is null) tasks/standards/events leaked to
-- every OTHER owner's account too.
--
-- Needs no direct is_active check of its own (2026-07-30 fix, above) —
-- it's built entirely out of my_role()/my_branch_id(), both of which now
-- return null for a deactivated caller, so this already returns null for
-- them without any change here.
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

-- ------------------------------------------------------------
-- 5. ROW LEVEL SECURITY — enable on every data table
-- ------------------------------------------------------------

alter table public.users enable row level security;
alter table public.branches enable row level security;
alter table public.tasks enable row level security;
alter table public.task_items enable row level security;
alter table public.task_submissions enable row level security;
alter table public.task_item_submissions enable row level security;
alter table public.food_safety_standards enable row level security;
alter table public.food_safety_submissions enable row level security;
alter table public.schedule_events enable row level security;
alter table public.notifications enable row level security;
alter table public.subscriptions enable row level security;

-- ---- users ----
create policy "super admin full access to users"
  on public.users for all
  using (public.my_role() = 'super_admin');

create policy "owner sees self and their branch managers"
  on public.users for select
  using (
    id = auth.uid()
    or (public.my_role() = 'owner' and branch_id in (select id from public.branches where owner_id = auth.uid()))
  );

create policy "branch manager sees only self"
  on public.users for select
  using (id = auth.uid());

-- ---- branches ----
create policy "super admin full access to branches"
  on public.branches for all
  using (public.my_role() = 'super_admin');

create policy "owner manages own branches"
  on public.branches for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "manager reads own branch"
  on public.branches for select
  using (id = public.my_branch_id());

-- ---- tasks ----
create policy "super admin full access to tasks"
  on public.tasks for all
  using (public.my_role() = 'super_admin');

create policy "owner manages own tasks"
  on public.tasks for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Fixed 2026-07-29 (BUG#019): the branch_id-is-null arm used to have no
-- ownership check at all, leaking every owner's all-branches tasks to
-- every other owner's account. Now scoped to the manager's own owner.
create policy "manager reads applicable tasks"
  on public.tasks for select
  using (
    branch_id = public.my_branch_id()
    or (branch_id is null and owner_id = public.my_owner_id())
  );

-- ---- task_items ----
-- Scoped through the parent task, same shape as tasks' own policies.
create policy "super admin full access to task_items"
  on public.task_items for all
  using (public.my_role() = 'super_admin');

create policy "owner manages own task_items"
  on public.task_items for all
  using (exists (select 1 from public.tasks t where t.id = task_items.task_id and t.owner_id = auth.uid()))
  with check (exists (select 1 from public.tasks t where t.id = task_items.task_id and t.owner_id = auth.uid()));

-- Same BUG#019 leak pattern as tasks/fs standards/schedule_events would
-- apply here too if left as `t.branch_id is null` with no ownership
-- check — fixed inline before this table was ever applied live.
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

-- ---- task_submissions ----
create policy "super admin full access to task_submissions"
  on public.task_submissions for all
  using (public.my_role() = 'super_admin');

create policy "owner reads submissions for own branches"
  on public.task_submissions for select
  using (public.is_my_branch(branch_id));

-- Narrowed 2026-07-30 (audit finding #1): was `for all`, granting INSERT
-- and DELETE beyond what a manager should ever have — comanager-context's
-- permission model has managers "execute... only their own assigned
-- tasks," not destroy submission history. task_submissions rows are
-- pre-created by the midnight cron/service-role; a manager only ever
-- needs to read and update the status of an existing one.
create policy "manager reads own branch submissions"
  on public.task_submissions for select
  using (branch_id = public.my_branch_id());

create policy "manager updates own branch submissions"
  on public.task_submissions for update
  using (branch_id = public.my_branch_id())
  with check (branch_id = public.my_branch_id());

-- ---- task_item_submissions ----
-- Scoped through the parent task_submissions row's branch_id, same shape
-- as task_submissions' own policies.
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

-- Narrowed 2026-07-30 (audit finding #1) — same reasoning as
-- task_submissions above: select + update only, no insert/delete.
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

-- ---- food_safety_standards ----
create policy "super admin full access to fs standards"
  on public.food_safety_standards for all
  using (public.my_role() = 'super_admin');

create policy "owner manages own fs standards"
  on public.food_safety_standards for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Fixed 2026-07-29 (BUG#019) — same cross-owner leak fix as tasks above.
create policy "manager reads applicable fs standards"
  on public.food_safety_standards for select
  using (
    branch_id = public.my_branch_id()
    or (branch_id is null and owner_id = public.my_owner_id())
  );

-- ---- food_safety_submissions ----
create policy "super admin full access to fs submissions"
  on public.food_safety_submissions for all
  using (public.my_role() = 'super_admin');

create policy "owner reads and acknowledges fs submissions for own branches"
  on public.food_safety_submissions for all
  using (public.is_my_branch(branch_id))
  with check (public.is_my_branch(branch_id));

-- Narrowed 2026-07-30 (audit finding #1) — same reasoning as
-- task_submissions above: select + update only, no insert/delete.
create policy "manager reads own branch fs submissions"
  on public.food_safety_submissions for select
  using (branch_id = public.my_branch_id());

create policy "manager updates own branch fs submissions"
  on public.food_safety_submissions for update
  using (branch_id = public.my_branch_id())
  with check (branch_id = public.my_branch_id());

-- ---- schedule_events ----
create policy "super admin full access to schedule_events"
  on public.schedule_events for all
  using (public.my_role() = 'super_admin');

create policy "owner manages own schedule_events"
  on public.schedule_events for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Fixed 2026-07-29 (BUG#019) — same cross-owner leak fix as tasks above.
create policy "manager reads applicable schedule_events"
  on public.schedule_events for select
  using (
    branch_id = public.my_branch_id()
    or (branch_id is null and owner_id = public.my_owner_id())
  );

-- ---- notifications ----
create policy "users read own notifications"
  on public.notifications for select
  using (user_id = auth.uid());

create policy "users update own notifications (mark read)"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "super admin full access to notifications"
  on public.notifications for all
  using (public.my_role() = 'super_admin');

-- ---- subscriptions ----
create policy "owner reads own subscription"
  on public.subscriptions for select
  using (owner_id = auth.uid());

create policy "super admin full access to subscriptions"
  on public.subscriptions for all
  using (public.my_role() = 'super_admin');

-- ============================================================
-- NOT YET INCLUDED (build separately, see comanager-logic §4):
--   - The Riyadh-midnight cron job (pg_cron or Edge Function) that
--     pre-creates task_submissions / food_safety_submissions rows
--     for each due cycle, and flips overdue 'pending' rows to 'missed'.
--   - A payments/webhook handler for Moyasar to update `subscriptions`.
-- ============================================================
