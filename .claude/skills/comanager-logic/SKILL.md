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
- **[TEMPORARILY DISABLED, 2026-07-28 — founder-directed, not a locked-rule
  change.]** This gate is currently OFF (Supabase's "Confirm email" setting
  turned off — see PENDING_MANUAL_STEPS.md) so owners land in the dashboard
  immediately after signup. `app/owner/register/actions.ts` already adapts
  to whichever way that setting is: re-enabling it is a Supabase dashboard
  toggle, not a code change. Don't "fix" the code to re-add gating logic —
  there isn't any to add; the gate lives entirely in that one Supabase
  setting.

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

**Branch cap — hard-capped at `subscriptions.branches_count` (confirmed
2026-07-29):** this was genuinely unanswered here and in comanager-context
until now — don't assume either way in future work without re-checking
this note is still current. Creating a branch beyond `branches_count` is
**blocked**, not auto-billed: show "Upgrade your plan to add more
branches." `branches_count` only changes via an explicit paid upgrade
(Phase 5, not built yet) — it never auto-increments when a branch is
added. Same 3-layer enforcement as the manager cap below (UI, app, DB
trigger `enforce_branch_cap`). Proration on a mid-cycle upgrade and
refund/credit on branch removal are still open — see comanager-context.

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
     **For tasks (2026-07-29, since a task is now a checklist):** also
     generates one `task_item_submissions` row per active `task_item` on
     that task, nested under the `task_submissions` row just created —
     same pre-created-slot philosophy, one level deeper.
   - Only on **Monday** (Riyadh time): also generates slots for weekly tasks/standards.
   - Only on the **1st of the month** (Riyadh time): also generates slots
     for monthly tasks/standards.
3. A second part of the same job (or a separate one) flips any `pending`
   slot whose due date has fully passed into `status: 'missed'` — this is
   what makes a task "automatically missed" without anyone manually marking
   it. For tasks, this flips both the parent `task_submissions` row AND any
   still-`pending` child `task_item_submissions` rows under it to `'missed'`.
4. When a manager submits an item, that specific pre-created
   `task_item_submissions` row updates from `pending` → `completed` (or
   `pass`/`fail`/`missed` for food safety) — never insert a new row for a
   submission that already has a pending slot waiting. Once **every** item
   under a `task_submissions` row is `completed`, that parent row's own
   `status` rolls up to `'completed'` too (comanager-conventions has the
   exact query pattern for this rollup check).

**Do not build a version where "due" is calculated live with no stored
row** — that was rejected specifically to preserve missed-day history.

**Immediate same-day slot generation (added 2026-08-01):** in addition to
the nightly cron above, creating a new task/standard, or reactivating one
that was `is_active: false`, immediately generates *today's* pending
slot for it right then — so a branch manager sees it without waiting
until the next midnight run. Founder-directed: a brand-new task
shouldn't be invisible to managers for up to 24 hours. This reuses the
exact same slot-creation logic as the cron (see
`supabase/functions/generate-daily-slots/index.ts`'s scoped
`{ taskId }` / `{ standardId }` mode) via a server-side call from
`lib/slots/generate-immediate-slot.ts` — never a second, separately
maintained copy of the generation logic. Deliberately ignores the
frequency gate (a weekly task created on a Tuesday still gets an
immediate slot today, even though the *nightly* cron would normally only
generate a weekly task's slot on Mondays) — the frequency gate governs
whether an *existing* task gets a *new recurring* slot on a given day,
not whether a brand-new/reactivated one gets its first slot at all. Only
covers creation and reactivation, not edits to an already-active
task/standard — edits already apply going forward only per Section 7,
and an active task always already has today's slot (either from a prior
day's cron run or from this same immediate-generation path), so there's
nothing to backfill on a plain edit. Fails soft: if the immediate call
doesn't go through for any reason (missing `CRON_SECRET` in the app's own
env, function unreachable), the create/reactivate action still succeeds —
the nightly cron remains the guaranteed fallback that catches it by the
next day regardless.

---

## 5. Submission Requirements (set once at creation)

Each **food-safety standard** has these boolean flags, chosen by the owner
when creating it — this is what "owner chooses the submission method" means:
```
requires_photo: boolean
requires_note: boolean
requires_value: boolean   (numeric, e.g. temperature)
```

**For tasks (changed 2026-07-29 — see the checklist model in
comanager-context):** these three flags live on `task_items`, not on
`tasks` itself — **per item**, not once for the whole task. A single
task/checklist can freely mix items with different requirements (e.g. one
item just a checkbox, another requiring a photo).

If **all three are false** (for a food-safety standard, or for an
individual task item), it's checkbox-only — the manager just marks it
done/pass with no additional proof required. Any combination of the three
can be true at once (e.g. a food safety check might require both a photo
AND a temperature value).

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

## 9. Work Shifts (NEW — decided 2026-08-05, not yet built)

This REVERSES the earlier "don't build a shift system" call documented
in comanager-design-match's Resolved Conflicts table (the mockup-filler
"Shift ends: 22:00" ring was correctly ignored THEN, but shifts are now
a real, deliberately-scoped feature being added now, as of this
decision). Update that Resolved Conflicts entry to reflect this reversal
rather than leaving it looking contradictory.

Optional, per-branch feature. A branch with zero shifts defined behaves
exactly as before this feature existed — no filtering, no switcher UI,
full backward compatibility required.

- Shifts are owner-defined, per branch — custom name + start/end time
  (e.g. "Morning" 6am-3pm, "Evening" 3pm-11pm). Not a fixed global enum.
- Tasks/standards get an optional shift tag: unscoped (applies to every
  shift the branch has, if any) or scoped to one specific shift - same
  pattern as the existing branch_id null="all branches" scoping, one
  more layer.
- A task scoped to "both/all shifts" needs a SEPARATE submission slot
  per shift, not one shared slot - e.g. a twice-daily temperature check
  generates two rows for that day, one per shift. This changes slot
  generation (§4): for each active task/standard, expand across every
  shift it applies to (all of the branch's shifts if unscoped, else just
  the one), not just across branches.
- Managers are NOT permanently assigned to a shift. A manager can work
  either shift on different days. They declare which shift they're on
  via a simple manual switcher (e.g. tap "Morning" or "Evening" on their
  dashboard) - this is mutable state on their own profile, not a real
  scheduling system. Their "today's tasks" list filters to submissions
  matching their currently-selected shift (plus any shift-agnostic ones,
  for branches with no shifts configured).
- Shift handover: a simple text note (no photo) the outgoing shift's
  manager can leave, surfaced prominently to the next shift's manager -
  e.g. shown when they select/switch into a shift. One handover note per
  branch per shift per day is the simplest model - don't over-engineer
  into a full messaging thread.
- Reporting implication to consider when building: Reports/Dashboard
  numbers should still make sense whether or not shifts are in use -
  don't force shift-breakdown UI onto branches that don't use shifts.
- Single-shift edge case: if a branch has exactly ONE shift configured,
  treat it the same as zero shifts for UI purposes - hide the shift
  switcher and handover-note UI entirely (a single-option switcher is
  pointless friction). Only show shift UI when a branch has 2+ active
  shifts. The task/standard "which shift" tag can still exist in the
  data model for a 1-shift branch (auto-assigned to that one shift),
  it's just invisible in the manager's UI.
- Where shifts get configured: inside the owner's Branches page, when
  editing a specific branch - a new "Shifts" section within that
  branch's edit view, not a separate top-level sidebar page. Shifts are
  branch-specific config, same category as the branch's name/address/
  manager-cap already shown there. Deliberately not adding a 9th sidebar
  item for a feature some restaurants won't use at all.

---

## Summary Checklist (use this before building any related feature)

- [ ] Does this touch manager creation/removal? → cap enforced in UI, app, AND database
- [ ] Does this touch any restaurant data table? → RLS policy exists and is scoped correctly
- [ ] Does this touch task/food-safety frequency? → uses the pre-created slot model, Riyadh midnight boundary
- [ ] Does this touch creation of task/standard/event? → single screen, minimal fields, advanced options collapsed
- [ ] Does this touch the owner dashboard? → Realtime scoped to all of that owner's branches
