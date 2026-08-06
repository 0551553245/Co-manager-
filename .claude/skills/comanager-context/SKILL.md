---
name: comanager-context
description: Master reference for Co Manager — a restaurant operations SaaS built for the Saudi Arabian market. This is the SINGLE SOURCE OF TRUTH for schema, business rules, panels, and routing. Load this skill FIRST, before any other Co Manager skill, whenever building pages, fixing bugs, writing database queries, or making any architectural decision. Triggers on any mention of Co Manager, branch manager, restaurant owner, super admin panel, tasks, food safety, schedule, subscriptions, Supabase schema, or any of the three panels.
---

# Co Manager — Master Project Reference

> This file is the ONLY place business rules and schema live. If any other
> skill file disagrees with this one, THIS FILE WINS and the other file is
> out of date and must be fixed immediately — never silently ignored.

## What Is Co Manager

Co Manager is a **restaurant operations SaaS** for the Saudi Arabian market.
It helps restaurant owners monitor and control their branches remotely, and
helps branch managers execute their daily work through a structured digital
system — replacing WhatsApp-based checklists and food-safety logs.

Bilingual: Arabic / English, full RTL support required everywhere.

---

## The Three Panels

### 1. Branch Manager — `/branch-manager/`
- Executes tasks, submits food safety checks, views schedule, uploads photo evidence.
- Cannot create tasks, change standards, see other branches, or access settings.
- Only ever sees data scoped to their own `branch_id`.

### 2. Restaurant Owner — `/owner/`
- Creates and assigns tasks, sets food safety standards, configures checklists,
  views reports across their own branches, manages branch managers, manages billing.
- Cannot see other owners' data or touch Super Admin settings.

### 3. Super Admin — `/admin/`
- Platform operator only. Manages all restaurant owners, handles subscriptions,
  views platform-wide analytics, creates owner accounts if needed.
- No restrictions — highest permission level.
- Login route is not linked anywhere in the public UI.

## Permission Model (never violate this)

```
Super Admin
    └── sees/manages ALL owners and their data
        Restaurant Owner
            └── sees/manages ONLY their own branches and managers
                Branch Manager
                    └── sees/executes ONLY their own assigned tasks and checks
```

Every API call and query must enforce this. No exceptions, no "just for now."

---

## Tech Stack (LOCKED — decided 2026-07-26)

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 14+ (App Router) | SEO matters a lot for the public marketing site; needs server rendering, not a client-only SPA |
| Language | TypeScript | Catches column-name mismatches (e.g. `status` vs `result`) at compile time — directly prevents the most common bug class from the previous build |
| Styling | Tailwind CSS | |
| Backend | Supabase (Postgres, Auth, Realtime, Storage) | |
| Real-time | Supabase Realtime (`postgres_changes`) | |
| Photo storage | Cloudinary | |
| Payments | Moyasar (Saudi market: mada, Apple Pay, cards) | |
| Deploy | Vercel (frontend) + Supabase (backend) | |

Structure: public marketing pages (`/`, `/pricing`, `/faq`) as server-rendered
routes for SEO; the three app panels (`/branch-manager`, `/owner`, `/admin`)
as authenticated routes that don't need SEO — same codebase, one route-group
split, not two separate projects.

Primary dev workflow: the founder builds directly via Cursor / Claude Code,
not through Claude Design for final implementation.

---

## Database Schema (LOCKED — do not invent columns, check here first)

### users
```
id, email, password_hash, role (super_admin | owner | branch_manager),
name, name_ar, restaurant_name, restaurant_name_ar, phone, avatar_url,
is_active, current_shift_id (→ branch_shifts, NULLABLE), created_at
```
> `restaurant_name`/`restaurant_name_ar` (owner role only) added 2026-07-26
> during Phase 1 auth build — the signup form collects a restaurant name
> distinct from the owner's own name, and the schema had nowhere to put it.
>
> `current_shift_id` added 2026-08-05/06 for Work Shifts (comanager-logic
> §9) — a branch manager's mutable, manually-selected "which shift am I
> working right now" state. Deliberately not a `role`/`branch_id`-style
> static field: it's expected to change mid-session from the manager's own
> action on the Dashboard. **Write access is column-scoped, not just
> RLS-scoped** — `authenticated` had a pre-existing blanket table-wide
> `UPDATE` grant on `users` (Supabase default) with zero UPDATE RLS
> policies at the time this was added, so a plain `for update using (id =
> auth.uid())` policy alone would have let a manager rewrite their own
> `role`/`branch_id`/`is_active` too. Fixed via `REVOKE UPDATE ON
> public.users FROM authenticated; GRANT UPDATE (current_shift_id) ON
> public.users TO authenticated;` alongside the RLS policy — the only
> column a manager's own session can ever write on this table. Read
> access uses ordinary RLS (no column restriction needed for SELECT here).

### branches
```
id, owner_id (→ users), manager_id (→ users), name, name_ar,
address, address_ar, city, phone, is_active, created_at
```

### tasks
```
id, branch_id (→ branches, NULLABLE — null means global task for all branches),
shift_id (→ branch_shifts, NULLABLE), created_by (→ users), title, title_ar,
description, description_ar, category, frequency (daily | weekly | monthly),
is_active (boolean, must be true on insert), created_at
```
> **A task is a checklist, not a flat unit** — founder decision, 2026-07-29,
> resolving a real conflict this doc had with comanager-design-match (which
> showed "6 items"/"expand to see individual checklist items" against a
> flat schema). `requires_photo`/`requires_note`/`requires_value`/
> `value_min`/`value_max` moved OFF this table onto `task_items` — the
> founder chose **per-item** requirements over the simpler once-per-task
> option. Every task should have at least one active `task_item` (enforced
> app-side, not a DB constraint).
>
> `shift_id` added 2026-08-05 for Work Shifts (comanager-logic §9) — NULL
> means "applies to every shift the branch has" (mirrors the existing
> `branch_id: null` = "all branches" convention, one dimension deeper).
> Non-null requires `branch_id` to also be non-null — a shift-scoped task
> only makes sense for one specific branch, enforced by a CHECK constraint
> (`tasks_shift_requires_branch`) plus a trigger
> (`enforce_shift_branch_match`) that rejects a `shift_id` belonging to a
> different branch than the row's own `branch_id`.

### task_items
```
id, task_id (→ tasks), title, title_ar, sort_order,
requires_photo (boolean), requires_note (boolean), requires_value (boolean),
value_min, value_max, is_active (boolean), created_at
```
> Added 2026-07-29. Ordered checklist items belonging to a task — each
> with its own independent submission-requirement flags, same semantics
> as comanager-logic §5 but at item granularity now instead of task
> granularity.

### task_submissions
```
id, task_id (→ tasks), submitted_by (→ users), branch_id (→ branches),
shift_id (→ branch_shifts, NULLABLE),
shift_key (uuid, GENERATED ALWAYS AS coalesce(shift_id, '00000000-...') STORED),
status (completed | pending | missed), submitted_at, due_date
```
> Column is `submitted_at` (not submission_date — that column does not
> exist). Still one row per (task, branch, due_date), still pre-created by
> the midnight cron (comanager-logic §4 unchanged at this level) — but as
> of 2026-07-29 its `status` is a **rollup**: `completed` only once every
> child `task_item_submissions` row for that cycle is `completed`. No
> longer carries `photo_url`/`note`/`value_entered` directly (moved to the
> item-level table below, since requirements are per-item now).
>
> `shift_id`/`shift_key` added 2026-08-05 for Work Shifts. The row is now
> one per (task, branch, due_date, shift) once a task is shift-scoped or
> its branch has shifts at all — a both-shifts task gets one independent
> submission row per active shift (comanager-logic §9's expansion rule:
> 0 shifts → one `shift_id: null` row; a shift-scoped task → one row for
> that shift; an unscoped task on a branch with shifts → one row per
> active shift). `shift_key` exists purely so the uniqueness constraint
> and the edge function's `.upsert({ onConflict })` both work correctly —
> Postgres unique constraints treat NULL as never-equal-to-NULL, so a
> plain `unique(task_id, branch_id, due_date, shift_id)` would silently
> allow duplicate rows whenever `shift_id` is null (BUG#040). The real
> unique constraint (`task_submissions_unique_slot`) is on `(task_id,
> branch_id, due_date, shift_key)`.

### task_item_submissions
```
id, task_submission_id (→ task_submissions), item_id (→ task_items),
status (pending | completed | missed), photo_url, note, value_entered,
submitted_at, submitted_by (→ users)
```
> Added 2026-07-29. One row per `task_item` per cycle, nested under its
> parent `task_submissions` row — mirrors the pre-created-slot philosophy
> (comanager-logic §4) at item granularity. The midnight cron creates
> these alongside the parent row.

### food_safety_standards
```
id, branch_id (→ branches, NULLABLE for global standards),
shift_id (→ branch_shifts, NULLABLE), created_by (→ users),
title, title_ar, description, description_ar, check_frequency,
temperature_min, temperature_max, requires_photo, requires_note,
is_active (boolean, must be true on insert), created_at
```
> `requires_photo`/`requires_note` added 2026-07-27 during Phase 2 — was
> missing even though comanager-logic §5 already documented these as
> independent toggles for food-safety standards, same as tasks.
> `requires_value` has no column here: a reading is always required for a
> food-safety check (pass/fail is derived from it), so there's no
> checkbox-only case the way there is for tasks.
>
> `shift_id` added 2026-08-05 for Work Shifts — identical semantics to
> `tasks.shift_id` above (NULL = every shift the branch has; non-null
> requires `branch_id` non-null too, same CHECK/trigger pattern via
> `fs_standards_shift_requires_branch`/`enforce_shift_branch_match`).

### food_safety_submissions
```
id, standard_id (→ food_safety_standards), submitted_by (→ users),
branch_id (→ branches), shift_id (→ branch_shifts, NULLABLE),
shift_key (uuid, GENERATED ALWAYS AS coalesce(shift_id, '00000000-...') STORED),
result (pending | pass | fail | missed),
actual_value, corrective_note, photo_url, due_date, submitted_at
```
> Column is `result` (NOT status — that column does not exist).
> Column is `actual_value` (not value), `corrective_note` (not note).
> `missed` added 2026-07-27 during Phase 4 — comanager-logic §4 requires
> the midnight job to flip overdue pending slots to "missed" for both
> tasks and food safety; this enum didn't support it before. Deliberately
> a distinct value from `fail`: missed = never checked, fail = checked and
> out of range — different events for the alert/acknowledge flow.
>
> `shift_id`/`shift_key` added 2026-08-05 — identical mechanism to
> `task_submissions` above, same `shift_key` generated-column reason
> (BUG#040: PostgREST's `.upsert({ onConflict })` can only target a real
> named unique constraint on plain columns, not a `COALESCE(...)`
> expression index — the generated `shift_key` column exists purely to
> give the uniqueness check a real column to target). Real unique
> constraint: `fs_submissions_unique_slot` on `(standard_id, branch_id,
> due_date, shift_key)`.

### schedule_events
```
id, owner_id (→ users), branch_id (→ branches, NULLABLE — null means all
branches), created_by (→ users), title, title_ar, description, start_time,
end_time, event_type, assigned_to (→ users), created_at
```
> Corrected 2026-07-27 during Phase 2: this table DOES have `owner_id`
> directly (verified against the live DB) — the prior claim here that it
> didn't was copied from the old OpsPilot bug log (comanager-bug-log
> BUG #006) without re-checking against Co Manager's actual schema.sql,
> which already had it. See that bug log entry for the correction.

### branch_shifts
```
id, branch_id (→ branches), name, name_ar, start_time (time),
end_time (time), is_active, created_at
```
> Added 2026-08-05 for Work Shifts (comanager-logic §9). Owner-configured
> per branch, from Branches → Edit branch — not a separate sidebar page.
> "Deactivate" (not delete) is reversible and, per a dedicated trigger
> (`reset_current_shift_on_deactivate`), nulls any manager's
> `users.current_shift_id` that was pointing at a shift the moment it's
> deactivated — prevents an orphaned reference to a now-inactive shift.
> **A branch with 0 or 1 active shift is treated as having no shift
> feature at all for UI purposes** — the switcher, handover card, and
> shift-scoped filtering on the branch manager side only ever appear once
> a branch has 2+ active shifts (`lib/hooks/useBranchShifts.ts`'s
> `hasShiftUI`). This keeps every existing branch's behavior completely
> unchanged unless the owner deliberately opts in by adding a second
> shift.

### shift_handovers
```
id, branch_id (→ branches), shift_id (→ branch_shifts),
handover_date (date), note, left_by (→ users, NULLABLE),
left_by_name (text, NULLABLE), updated_at,
unique (branch_id, shift_id, handover_date)
```
> Added 2026-08-05 for Work Shifts. One note per (branch, shift, day) —
> upsertable, not a message thread (comanager-logic §9: "don't
> over-engineer into a full messaging thread"). A manager can only
> insert/update rows for their own branch (RLS scoped to
> `my_branch_id()`); owners get read-only visibility across their
> branches; no delete policy exists for either role.
>
> `left_by_name` added 2026-08-06 (BUG#042) as a **denormalized snapshot**
> of the writer's own name, written at the same time as `left_by` —
> deliberately not resolved via a `users` lookup at read time. RLS has no
> policy letting a branch manager read a co-worker's `users` row at all,
> and per BUG#019 (RLS is row-level, not column-level), a policy scoped
> "just enough" to expose a name would still expose that row's
> email/phone/role over raw REST. Denormalizing onto a row the writer
> already legitimately owns avoids widening `users` access at all — see
> BUG#042 for the full reasoning and the live raw-REST proof that a
> manager still cannot read a co-worker's `users` row.

### notifications
```
id, user_id (→ users), title, title_ar, body, body_ar,
type, is_read, related_id, created_at
```

### subscriptions
```
id, owner_id (→ users), status (trialing | active | cancelled | expired),
branches_count, price_per_branch_sar (default 50), trial_ends_at
(default now()+14 days), billing_cycle_start, billing_cycle_end,
moyasar_token, created_at
```
> `trialing` and `trial_ends_at` were missing from this list even though
> comanager-schema.sql and the live DB already had them (every fresh
> signup's row is `status='trialing'`) — this doc was out of sync with
> its own source of truth; fixed 2026-07-27 during Phase 2 pre-check.
> Pricing model: **50 SAR per branch per month**, includes up to 2 branch
> managers per branch. Not a fixed tier (basic/pro/enterprise) — that model
> is retired. Trial: 14 days, read-only lockout for the owner if no card is
> added by the end of trial (see comanager-logic §1 for exact scope).
>
> **Branch creation is hard-capped at `branches_count`** — founder decision,
> 2026-07-29 (previously an open question; this doc didn't answer it and
> neither did comanager-logic, confirmed by re-checking both before
> building). Creating a branch beyond the subscription's `branches_count`
> is blocked with an "Upgrade your plan to add more branches" message —
> `branches_count` only changes via an explicit paid upgrade, never
> auto-increments. Enforced in 3 layers (UI, app, DB trigger
> `enforce_branch_cap`), same pattern as the manager cap.
>
> Still genuinely open: proration on an upgrade mid-cycle, and
> refund/credit behavior on branch removal — neither resolved yet, don't
> assume either way when building the actual upgrade flow (Phase 5).

---

## Routing Structure

```
/                            → Landing / portal selector
/branch-manager/login        /branch-manager/dashboard
/branch-manager/tasks        /branch-manager/food-safety
/branch-manager/schedule     /branch-manager/profile

/owner/login                 /owner/register
/owner/dashboard             /owner/branches
/owner/tasks                 /owner/food-safety
/owner/schedule              /owner/reports
/owner/managers              /owner/settings (account + subscription)

/admin/login (unlisted)      /admin/dashboard
/admin/restaurants           /admin/subscriptions
/admin/analytics             /admin/settings
```

---

## Key Business Rules

**Full detail now lives in `comanager-logic` — signup flow, recurring
task/food-safety slot generation, manager cap enforcement, RLS-based data
isolation, dashboard live data, and the low-friction creation UX. Read that
skill for anything touching how the app actually behaves. Summary only below:**

1. Tasks and standards are owned by the **branch**, not the manager — if a
   manager leaves, the tasks/standards stay.
2. Task/food-safety slots are **pre-created each cycle** (not computed live)
   at Riyadh midnight — see comanager-logic Section 4.
3. Photo evidence → Cloudinary, only the URL is stored in Supabase.
4. Real-time updates via Supabase Realtime — when a manager submits, the
   owner sees it instantly without refreshing.
5. Subscription is per-branch (50 SAR/branch/month, 2 managers included per
   branch, hard-capped and enforced at DB level — see comanager-logic Section 2).
6. All business data persists to Supabase immediately — never local-only state.
7. `branch_id = null` on tasks/standards means "applies to all branches" —
   every query and every slot-generation run must account for this (see
   comanager-conventions for the query pattern, comanager-logic for generation).
8. Data isolation between restaurants is enforced via Postgres RLS, not just
   app-level filtering — see comanager-logic Section 3.
9. Work Shifts (added 2026-08-05/06) let an owner optionally define named
   shifts per branch; tasks/standards can be shift-scoped or left
   unscoped (applies to every shift); a branch manager manually declares
   which shift they're on. **A branch with fewer than 2 active shifts
   behaves exactly as it did before this feature existed** — see
   comanager-logic Section 9 for the full expansion/UI-visibility rules.

---

## Design System

*(Placeholder — to be filled in once the actual page designs are shared.
Do not invent colors, spacing, or component classes here. Once designs are
sent, this section gets replaced with the real tokens and a dedicated
comanager-design skill gets built from them.)*

---

## Confirmed Product Exclusions (do not build these)
- **No general staff/roster feature.** Only branch managers are tracked per
  branch (max 2). A previous design pass invented a "staff roster" with
  headcount and roles like "shift lead"/"line cook" — this is NOT part of
  Co Manager. Never add a staff table, staff roles, or headcount stats.

## Reporting Rules
- **Completion-rate color**: HSL interpolation (never RGB — it produces
  muddy browns) across three anchors: red at 0%, yellow at 50%, brand green
  at 100%. **80% is the underperformance threshold** — below it, a branch
  should visually flag as needing attention.
- **Chart granularity**: the Reports page's time-range toggle — **7 Days /
  30 Days / 3 Months** (changed 2026-08-05 from the earlier Day/Week/
  Month/3-Months set during the Reports full rebuild; see
  comanager-design-match for the current spec) — must change how data is
  *grouped*, not just the date range. 3 Months must aggregate into weekly
  buckets — never plot raw daily data points, it's unreadable at that range.

## Open UX Questions (unresolved — decide before building these screens)
- ~~Task editing flow~~ — **resolved**, was just stale here: comanager-logic
  §7 already specifies editing reuses the same low-friction modal,
  pre-filled, and edits apply going forward only (never rewrite submission
  history). Fixed 2026-07-27 during Phase 2 pre-check.
- **Food safety fail-state (owner side) — partially resolved.**
  comanager-design-match's Food Safety screen specifies an alert banner
  ("N unresolved food-safety failures", branch/standard/submitter/time for
  the most recent, a "View all" link, an Acknowledge button) —
  `food_safety_submissions.acknowledged_at`/`acknowledged_by` implement
  exactly this ("unresolved" = `result='fail' AND acknowledged_at IS NULL`).
  Still genuinely open: the schema also has `resolved_at`/`resolved_by`/
  `resolve_note` columns with no locked UI spec for a separate "resolve
  with a corrective note" flow beyond acknowledging — built Acknowledge
  only in Phase 2; Resolve is schema-ready but not yet designed.

## Current Project State

- Rebuild in progress. Fresh start, no legacy code carried over.
- Schema above is locked pre-build specifically to prevent the column-name
  drift that broke six files in the previous build.

---

## How to Use This Skill

Before building any feature, answer:
1. Which panel does this belong to?
2. What role permissions apply?
3. Which tables are involved? (check schema above — do not guess column names)
4. Does it need real-time updates? → see comanager-conventions
5. Does it need photo upload? → Cloudinary
6. Does it need Arabic support? → always yes, `_ar` fields, RTL

Never mix panel logic. Never skip role validation. Never store business data
only in React state. If another skill file contradicts this one, fix that
file — this one is the source of truth.
