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
  requires_photo boolean not null default false,
  requires_note boolean not null default false,
  requires_value boolean not null default false,
  value_min numeric,
  value_max numeric,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.task_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  submitted_by uuid references public.users(id),
  status text not null default 'pending' check (status in ('pending','completed','missed')),
  photo_url text,
  note text,
  value_entered numeric,
  due_date date not null,
  submitted_at timestamptz
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
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.food_safety_submissions (
  id uuid primary key default gen_random_uuid(),
  standard_id uuid not null references public.food_safety_standards(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  submitted_by uuid references public.users(id),
  result text not null default 'pending' check (result in ('pending','pass','fail')),
  actual_value numeric,
  corrective_note text,
  photo_url text,
  due_date date not null,
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.users(id),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id),
  resolve_note text
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
  insert into public.users (id, email, role, name, branch_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'owner'),
    coalesce(new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'branch_id','')::uuid
  )
  on conflict (id) do update set
    role = excluded.role,
    name = excluded.name,
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

create or replace function public.my_role()
returns text
language sql
security definer
stable
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.my_branch_id()
returns uuid
language sql
security definer
stable
as $$
  select branch_id from public.users where id = auth.uid();
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

-- ------------------------------------------------------------
-- 5. ROW LEVEL SECURITY — enable on every data table
-- ------------------------------------------------------------

alter table public.users enable row level security;
alter table public.branches enable row level security;
alter table public.tasks enable row level security;
alter table public.task_submissions enable row level security;
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

create policy "manager reads applicable tasks"
  on public.tasks for select
  using (branch_id = public.my_branch_id() or branch_id is null);

-- ---- task_submissions ----
create policy "super admin full access to task_submissions"
  on public.task_submissions for all
  using (public.my_role() = 'super_admin');

create policy "owner reads submissions for own branches"
  on public.task_submissions for select
  using (public.is_my_branch(branch_id));

create policy "manager manages own branch submissions"
  on public.task_submissions for all
  using (branch_id = public.my_branch_id())
  with check (branch_id = public.my_branch_id());

-- ---- food_safety_standards ----
create policy "super admin full access to fs standards"
  on public.food_safety_standards for all
  using (public.my_role() = 'super_admin');

create policy "owner manages own fs standards"
  on public.food_safety_standards for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "manager reads applicable fs standards"
  on public.food_safety_standards for select
  using (branch_id = public.my_branch_id() or branch_id is null);

-- ---- food_safety_submissions ----
create policy "super admin full access to fs submissions"
  on public.food_safety_submissions for all
  using (public.my_role() = 'super_admin');

create policy "owner reads and acknowledges fs submissions for own branches"
  on public.food_safety_submissions for all
  using (public.is_my_branch(branch_id))
  with check (public.is_my_branch(branch_id));

create policy "manager manages own branch fs submissions"
  on public.food_safety_submissions for all
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

create policy "manager reads applicable schedule_events"
  on public.schedule_events for select
  using (branch_id = public.my_branch_id() or branch_id is null);

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
