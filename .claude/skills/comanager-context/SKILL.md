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
is_active, created_at
```
> `restaurant_name`/`restaurant_name_ar` (owner role only) added 2026-07-26
> during Phase 1 auth build — the signup form collects a restaurant name
> distinct from the owner's own name, and the schema had nowhere to put it.

### branches
```
id, owner_id (→ users), manager_id (→ users), name, name_ar,
address, address_ar, city, phone, is_active, created_at
```

### tasks
```
id, branch_id (→ branches, NULLABLE — null means global task for all branches),
created_by (→ users), title, title_ar, description, description_ar,
category, frequency (daily | weekly | monthly),
requires_photo (boolean), requires_note (boolean), requires_value (boolean),
value_min, value_max, is_active (boolean, must be true on insert), created_at
```

### task_submissions
```
id, task_id (→ tasks), submitted_by (→ users), branch_id (→ branches),
status (completed | pending | missed),
photo_url, note, value_entered, submitted_at, due_date
```
> Column is `note` (not notes), `value_entered` (not numeric_value),
> `submitted_at` (not submission_date — that column does not exist).

### food_safety_standards
```
id, branch_id (→ branches, NULLABLE for global standards), created_by (→ users),
title, title_ar, description, description_ar, check_frequency,
temperature_min, temperature_max, is_active (boolean, must be true on insert),
created_at
```

### food_safety_submissions
```
id, standard_id (→ food_safety_standards), submitted_by (→ users),
branch_id (→ branches), result (pass | fail | pending),
actual_value, corrective_note, photo_url, submitted_at
```
> Column is `result` (NOT status — that column does not exist).
> Column is `actual_value` (not value), `corrective_note` (not note).

### schedule_events
```
id, branch_id (→ branches), created_by (→ users) — NOT owner_id, that column
does not exist, title, title_ar, description, start_time, end_time,
event_type, assigned_to (→ users), created_at
```

### notifications
```
id, user_id (→ users), title, title_ar, body, body_ar,
type, is_read, related_id, created_at
```

### subscriptions
```
id, owner_id (→ users), status (active | cancelled | expired),
branches_count, price_per_branch_sar (default 50), billing_cycle_start,
billing_cycle_end, moyasar_token, created_at
```
> Pricing model: **50 SAR per branch per month**, includes up to 2 branch
> managers per branch. Not a fixed tier (basic/pro/enterprise) — that model
> is retired. Trial: 14 days, read-only lockout for the owner if no card is
> added by the end of trial (see comanager-logic §1 for exact scope). Open
> questions still to lock before building billing UI: proration on
> off-cycle branch additions, and refund/credit behavior on branch removal.

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
- **Chart granularity**: the Day/Week/Month/3-Months toggle must change how
  data is *grouped*, not just the date range. Month and 3-Month views must
  aggregate (weekly or monthly buckets) — never plot raw daily data points,
  it's unreadable at that range.

## Open UX Questions (unresolved — decide before building these screens)
- **Task editing flow**: creation exists ("three fields, one button") but
  editing an existing task's name/frequency/items was never designed.
- **Food safety fail-state (owner side)**: when a manager submits a failed
  reading, does it need distinct flagging in the log, a link to which
  manager/branch, and an acknowledge/resolve action for the owner? Not yet answered.

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
