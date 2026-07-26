---
name: comanager-logic
description: THE CORE LOGIC of Co Manager — signup flow, recurring task/food-safety slot generation, branch manager lifecycle and caps, authentication/data-isolation enforcement, live dashboard data, and the low-friction creation UX rules. This is the master reference for HOW the app actually behaves, not just what tables exist. Load this skill for ANY work touching signup, manager creation/removal, task or food-safety recurrence, the owner dashboard, or authentication/permissions. Read comanager-context first for schema and comanager-auth for login/session mechanics — this file is the business logic layer that ties them together.
---

# Co Manager — Core App Logic

> This is the master flow document. comanager-context holds schema/tech
> stack, comanager-auth holds login/session mechanics, comanager-conventions
> holds coding patterns. This file is HOW the product actually behaves.
> If this file and comanager-context's business-rules section ever disagree,
> THIS FILE WINS — context should only summarize and link here.

Scale target: up to 100 restaurant owners, each with their own branches and
managers. This is comfortably within Supabase's standard tier — no special
infrastructure needed, but every rule below must still be enforced correctly
since auth/data-isolation bugs are the stated top risk for this rebuild.

---

## 1. Owner Signup Flow

**Fields collected:** restaurant name, owner name, email, phone number,
number of branches (quantity selector, no fixed max).

**Pricing shown live during signup:** `branch_count × 50 SAR/month`, with a
note that each branch includes up to 2 branch managers.

**Email verification — once, at signup only:**
- Signup is **gated** on verifying the email — the owner cannot complete
  registration / reach the dashboard for the first time until they verify.
- After that first verification, **normal login never re-checks
  verification status.** Do not add a "please verify" gate to the login flow.

**Phone number** is collected as contact info — no verification requirement
stated, treat as a plain field unless told otherwise.

**Billing — free trial, no card required upfront:**
- Owner completes signup (restaurant name, owner name, email, phone, branch
  count) and starts on a **free trial immediately — no payment method
  required to sign up.**
- The trial has a countdown (shown on the Billing screen — "Free trial, N
  days left"). Trial length is **14 days** (confirmed 2026-07-26). A payment
  method must be added **before the trial ends** to keep the account active;
  if no card is added by then, the owner account drops into **read-only
  access** (confirmed 2026-07-26): the owner can still log in and view all
  existing data (dashboard, branches, tasks, reports, etc.) but cannot
  create/edit/delete anything (tasks, standards, managers, branches,
  schedule events) until a payment method is added. Branch managers under
  a read-only owner should still be able to submit against
  already-existing pending slots — read-only blocks the owner's write
  actions, not the branch managers' daily submissions.
- Once a card is added and the trial ends (or the owner adds a card and
  chooses to start billing early), Moyasar charges `branch_count × 50 SAR`
  going forward.
- Do NOT gate signup completion on payment — this was corrected from an
  earlier draft that required checkout during signup; the confirmed flow is
  trial-first, card added later.

---

## 2. Branch Manager Lifecycle (AUTH-CRITICAL)

This is the area explicitly flagged as high-risk — treat every rule here as
a hard requirement, not a nice-to-have.

- **Confirmed: no invite-based flow.** The design mockups show an
  "Invited" status for a pending manager — this was a mockup artifact, not
  a real feature. Do not build an invite/accept flow. There is exactly one
  manager creation path: the direct-create flow above. Every manager row in
  the UI should only ever show `ACTIVE` (or be absent if deactivated) —
  never an "invited/pending" state.

- **Hard cap: 2 active managers per branch.** Enforce this in THREE places,
  not one:
  1. UI — disable/hide the "add manager" action once a branch has 2 active managers.
  2. Application code — check count server-side before calling `auth.signUp()`.
  3. **Database** — a Postgres check (trigger or constraint) that rejects
     the insert/upsert if it would exceed 2 active managers for that
     `branch_id`. This is the layer that actually matters — the other two
     are just UX, this one is the real guarantee.

- **Removing a manager**: set `is_active: false` on that user. This
  **permanently** blocks that account from logging in again — the login
  flow's `is_active` check (see comanager-auth) is what enforces this. Do
  not delete the row (preserves submission history/attribution).

- **Replacing a manager**: once a manager is deactivated, that branch's
  active-manager count drops below 2, so the owner CAN invite a new manager
  to fill the slot — same creation flow as any new manager, still capped at
  2 active at a time. The old (deactivated) account can never be
  reactivated or log in again; it's a dead account permanently.

---

## 3. Data Isolation (AUTH-CRITICAL)

**Branch managers must never see another restaurant's data. Ever.** This is
the single most important rule in the app.

- Enforce with **Postgres Row Level Security (RLS)**, not just filtered
  queries in application code. Every table containing restaurant data
  (`branches`, `tasks`, `task_submissions`, `food_safety_standards`,
  `food_safety_submissions`, `schedule_events`) needs RLS policies that
  check the requesting user's role and scope:
  - Branch manager: `WHERE branch_id = (their own branch_id from auth)`
  - Owner: `WHERE owner_id = (their own id, via branches.owner_id join)`
  - Super admin: no restriction
- **Why this matters**: application-level `.eq('branch_id', x)` filtering
  can be bypassed by anyone who calls the Supabase API directly with valid
  credentials but a different ID in the request. RLS is enforced by
  Postgres itself regardless of how the request arrives — this is the only
  reliable guarantee for "a manager can never see another restaurant's data."
- Write RLS policies before writing any page that queries these tables, not after.

---

## 4. Recurring Tasks & Food Safety — Slot Generation (LOCKED)

Decision: **pre-create a submission slot for every cycle**, not computed live.
This gives full history (a missed day shows up even if the manager never
touched it) at the cost of a scheduled job.

**How it works:**
1. Owner creates a task or food-safety standard **once**, setting:
   frequency (`daily` / `weekly` / `monthly`), scope (a specific
   `branch_id`, or `null` for all branches), and the submission requirement
   (see Section 5).
2. A scheduled job (Supabase Edge Function on a cron trigger, or `pg_cron`)
   runs at **Riyadh midnight (Asia/Riyadh, UTC+3 — i.e. 21:00 UTC the
   previous day)** and:
   - Every day: generates a `task_submissions` / `food_safety_submissions`
     row with `status: 'pending'` for every active daily task/standard, for
     every applicable branch (expand `branch_id: null` into one row per
     owner's branch — a global task still needs a per-branch slot).
   - Only on **Monday** (Riyadh time): also generates slots for weekly tasks/standards.
   - Only on the **1st of the month** (Riyadh time): also generates slots
     for monthly tasks/standards.
3. A second part of the same job (or a separate one) flips any `pending`
   slot whose due date has fully passed into `status: 'missed'` — this is
   what makes a task "automatically missed" without anyone manually marking it.
4. When a manager submits, that specific pre-created row updates from
   `pending` → `completed` (or `pass`/`fail` for food safety) — never insert
   a new row for a submission that already has a pending slot waiting.

**Do not build a version where "due" is calculated live with no stored
row** — that was rejected specifically to preserve missed-day history.

---

## 5. Submission Requirements (per task/standard, set once at creation)

Each task or food-safety standard has these boolean flags, chosen by the
owner when creating it — this is what "owner chooses the submission method"
means:
```
requires_photo: boolean
requires_note: boolean
requires_value: boolean   (numeric, e.g. temperature)
```
If **all three are false**, the item is checkbox-only — the manager just
marks it done/pass with no additional proof required. Any combination of
the three can be true at once (e.g. a food safety check might require both
a photo AND a temperature value).

---

## 6. Owner Dashboard — Live Data

- Owner's dashboard subscribes to Supabase Realtime scoped to **all
  branches under that owner** (join through `branches.owner_id`), not a
  single branch.
- Any `task_submissions` or `food_safety_submissions` insert/update from any
  of the owner's branches pushes an instant update to the dashboard — no
  refresh, no polling.
- See comanager-conventions for the exact channel-naming and cleanup rules
  (unique channel per owner, synchronous callback wrapper, cleanup on unmount).

---

## 7. Low-Friction Creation UX (task / food safety / schedule event)

Explicit requirement: creating any of these should take **as few screen
touches as possible.**

- Single modal/drawer, not a multi-step wizard.
- Default visible fields only: **title, frequency, submission requirement,
  scope (this branch / all branches)** — one screen, one button to save.
- Anything else (temperature min/max for food safety, detailed
  descriptions, per-language text) goes behind a collapsed "more options"
  toggle — visible on demand, not by default.
- This applies identically to: task creation, food-safety standard
  creation, and schedule event creation. Same pattern, same simplicity,
  every time — a founder who has to relearn the flow for each section is a
  failure of this rule.
- Editing follows the exact same lightweight modal, pre-filled — see the
  task-editing rule already defined in comanager-context (edits apply going
  forward only, never rewrite submission history).

---

## 8. Super Admin

- Completely separate, unlisted login route — never linked from the public
  marketing site or the owner/manager login pages.
- No signup flow — account created directly in the database.
- Full visibility across all owners/branches, no RLS restriction.

---

## Summary Checklist (use this before building any related feature)

- [ ] Does this touch manager creation/removal? → cap enforced in UI, app, AND database
- [ ] Does this touch any restaurant data table? → RLS policy exists and is scoped correctly
- [ ] Does this touch task/food-safety frequency? → uses the pre-created slot model, Riyadh midnight boundary
- [ ] Does this touch creation of task/standard/event? → single screen, minimal fields, advanced options collapsed
- [ ] Does this touch the owner dashboard? → Realtime scoped to all of that owner's branches
