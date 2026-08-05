-- ============================================================
-- WORK SHIFTS — Stage 1: schema + slot-generation foundation
-- comanager-logic §9. Additive only; every existing branch (0 shifts)
-- must behave identically after this runs.
-- ============================================================

-- ------------------------------------------------------------
-- 1. NEW TABLES
-- ------------------------------------------------------------

create table public.branch_shifts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  name_ar text,
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Soft-delete only, same convention as branches/managers/tasks — a
-- deactivated shift's id stays valid forever for historical
-- task_submissions.shift_id / food_safety_submissions.shift_id rows
-- (exactly like a deactivated manager's id staying valid as
-- submitted_by elsewhere). The one real gap that soft-delete alone
-- doesn't cover: users.current_shift_id is live, mutable "state," not
-- history — if a manager currently has a shift selected and the owner
-- deactivates that specific shift (while the branch still has 2+ OTHER
-- active shifts, so the switcher stays visible), they'd otherwise be
-- stuck pointing at a dead shift with no path back except stale UI.
-- This resets it cleanly the moment a shift goes inactive.
create or replace function public.reset_current_shift_on_deactivate()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.is_active = false and old.is_active = true then
    update public.users set current_shift_id = null where current_shift_id = new.id;
  end if;
  return new;
end;
$$;

create trigger branch_shifts_reset_current_on_deactivate
  after update on public.branch_shifts
  for each row execute function public.reset_current_shift_on_deactivate();

-- One handover note per branch/shift/day — an upsertable note, never a
-- thread (comanager-logic §9: "don't over-engineer into a full
-- messaging thread").
create table public.shift_handovers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  shift_id uuid not null references public.branch_shifts(id) on delete cascade,
  handover_date date not null,
  note text not null,
  left_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  unique (branch_id, shift_id, handover_date)
);

-- ------------------------------------------------------------
-- 2. NEW COLUMNS
-- ------------------------------------------------------------

-- NULL = applies to every shift the branch has (mirrors branch_id null
-- = "all branches" — comanager-conventions' existing pattern, one more
-- layer).
alter table public.tasks
  add column shift_id uuid references public.branch_shifts(id) on delete set null;
alter table public.tasks
  add constraint tasks_shift_requires_branch check (shift_id is null or branch_id is not null);

alter table public.food_safety_standards
  add column shift_id uuid references public.branch_shifts(id) on delete set null;
alter table public.food_safety_standards
  add constraint fs_standards_shift_requires_branch check (shift_id is null or branch_id is not null);

-- Mutable state on the manager's own profile (comanager-logic §9) — not
-- a real scheduling assignment, just "which shift am I on right now."
alter table public.users
  add column current_shift_id uuid references public.branch_shifts(id) on delete set null;

-- ------------------------------------------------------------
-- 2b. Cross-branch integrity: a task/standard's shift_id must belong to
--     the SAME branch as its own branch_id. The FK on shift_id only
--     guarantees the shift row exists somewhere — it says nothing about
--     which branch it belongs to, so without this a task for Branch A
--     could silently be scoped to one of Branch B's shifts. This is the
--     real guarantee (same "DB is the layer that actually matters"
--     pattern already used for the branch/manager caps); Stage 2's app
--     code will also validate client-side for a friendlier error, but
--     that's UX, not the boundary.
-- ------------------------------------------------------------

create or replace function public.enforce_shift_branch_match()
returns trigger
language plpgsql
as $$
begin
  if new.shift_id is not null then
    if not exists (
      select 1 from public.branch_shifts
      where id = new.shift_id and branch_id = new.branch_id
    ) then
      raise exception 'shift_id must belong to the same branch as branch_id';
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_shift_branch_match
  before insert or update on public.tasks
  for each row execute function public.enforce_shift_branch_match();

create trigger fs_standards_shift_branch_match
  before insert or update on public.food_safety_standards
  for each row execute function public.enforce_shift_branch_match();

-- ------------------------------------------------------------
-- 3. task_submissions / food_safety_submissions — add shift_id and
--    rebuild uniqueness to be NULL-safe.
--
-- Postgres unique constraints never treat two NULLs as equal, so a
-- plain `unique (..., shift_id)` would silently stop deduplicating any
-- row where shift_id is NULL — i.e. every branch with zero shifts,
-- which is most branches. That would break the cron's
-- `ON CONFLICT DO NOTHING` idempotency (comanager-logic §4) for exactly
-- the branches this feature is supposed to leave untouched. Using a
-- COALESCE-to-sentinel expression index instead makes NULL behave like
-- any other value for uniqueness purposes.
-- ------------------------------------------------------------

alter table public.task_submissions
  add column shift_id uuid references public.branch_shifts(id) on delete set null;
alter table public.task_submissions
  drop constraint task_submissions_task_id_branch_id_due_date_key;
create unique index task_submissions_unique_slot on public.task_submissions (
  task_id, branch_id, due_date, coalesce(shift_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

alter table public.food_safety_submissions
  add column shift_id uuid references public.branch_shifts(id) on delete set null;
alter table public.food_safety_submissions
  drop constraint food_safety_submissions_standard_id_branch_id_due_date_key;
create unique index fs_submissions_unique_slot on public.food_safety_submissions (
  standard_id, branch_id, due_date, coalesce(shift_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- task_item_submissions needs no shift_id — it's keyed off its parent
-- task_submissions row, which already carries the shift distinction.

-- ------------------------------------------------------------
-- 4. RLS — same shapes as the existing tasks/task_submissions policies
-- ------------------------------------------------------------

alter table public.branch_shifts enable row level security;
alter table public.shift_handovers enable row level security;

create policy "super admin full access to branch_shifts"
  on public.branch_shifts for all
  using (public.my_role() = 'super_admin');

create policy "owner manages own branch_shifts"
  on public.branch_shifts for all
  using (public.is_my_branch(branch_id))
  with check (public.is_my_branch(branch_id));

create policy "manager reads own branch shifts"
  on public.branch_shifts for select
  using (branch_id = public.my_branch_id());

create policy "super admin full access to shift_handovers"
  on public.shift_handovers for all
  using (public.my_role() = 'super_admin');

-- Owners get read-only oversight visibility — they don't write handover
-- notes themselves.
create policy "owner reads own branch shift_handovers"
  on public.shift_handovers for select
  using (public.is_my_branch(branch_id));

-- Managers only ever upsert their own note through the app (BUG#024's
-- lesson: grant exactly the commands used, never `for all` "just in
-- case" — no delete policy at all, matching task_submissions/
-- food_safety_submissions' own manager policies).
create policy "manager reads own branch shift_handovers"
  on public.shift_handovers for select
  using (branch_id = public.my_branch_id());

create policy "manager inserts own branch shift_handovers"
  on public.shift_handovers for insert
  with check (branch_id = public.my_branch_id());

create policy "manager updates own branch shift_handovers"
  on public.shift_handovers for update
  using (branch_id = public.my_branch_id())
  with check (branch_id = public.my_branch_id());

-- ------------------------------------------------------------
-- 5. Realtime (BUG#023's lesson — RLS alone never delivers
--    postgres_changes events, the table must also be published)
-- ------------------------------------------------------------

alter publication supabase_realtime add table
  public.branch_shifts,
  public.shift_handovers;
