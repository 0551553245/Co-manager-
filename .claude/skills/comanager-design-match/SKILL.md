---
name: comanager-design-match
description: Screen-by-screen inventory of the actual Co Manager UI screens (from the design mockups), reconciled against comanager-logic and comanager-context. This is the ground truth for what each screen contains and how it behaves. Load this alongside comanager-design when building any specific page — comanager-design has the tokens (colors/fonts/radius), this file has the actual screen layouts and component patterns. Triggers on: dashboard, tasks page, food safety page, schedule page, branches page, managers page, billing page, reports page, building a screen, matching the mockup.
---

# Co Manager — Design Match (Screen Inventory)

> Extracted from 12 real screenshots on 2026-07-26. Where the screenshot
> conflicted with an already-locked decision, the conflict was resolved
> with the founder and is recorded below — always trust the resolution,
> not the raw screenshot, where they disagree.

## ⚠️ Resolved Conflicts (do NOT build the mockup's version on these points)

| Screen showed | Actually confirmed | Source of truth |
|---|---|---|
| "Invited" status on a pending manager row | No invite flow exists — direct-create only, every manager is just ACTIVE | comanager-logic §2 |
| "Free trial — 9 days left" WITH a card already on file | Correct as shown: free trial, **no card required at signup**, card added before trial ends | comanager-logic §1 |
| Manager dashboard "Shift ends: 22:00" + shift progress ring | Mockup filler, not a real feature — managers don't have scheduled shift times in this product | Ignore entirely — don't build a shift system |
| A "device toggle" icon (desktop/mobile) in every screen's header | Almost certainly a Claude Design preview artifact, not a real product control | Don't build this into the actual app unless told otherwise |
| Task cards showing "6 items"/"8 items", manager expanding a task to see "individual checklist items" | This wasn't a mockup artifact — it was correct, and the schema was wrong. **A task is a checklist** with ordered `task_items`, each with its own requires_photo/note/value flags (per-item, not once-per-task — founder's explicit choice). Resolved 2026-07-29; comanager-context and comanager-schema.sql updated. | comanager-context tasks/task_items schema |

---

## Owner Panel Screens

### Dashboard (`/owner/dashboard`)
- Header: "Dashboard" + a **LIVE** badge, subtitle "Live view across every branch"
- 4 stat cards with colored top border: Completed today (green), Pending (amber), Missed (red), Active branches (green)
- "Daily progress" — bar chart Mon–Sun, bar color reflects that day's completion level (dark green = high, amber = lower)
- "Completion by category" — horizontal progress bars per category (Tasks/Food Safety/Schedule) with % label
- "Next events" list (upcoming schedule items across branches)
- "Recent activity" — live feed, e.g. "Ahmed Al-Sayed completed 'Opening Checklist' — Olaya · 09:12", "Sara Noor logged Hot Holding reading — Corniche (Fail)". This is the Realtime feed from comanager-logic §6 — every task/food-safety submission across the owner's branches should appear here as it happens.
- Branch filter dropdown ("All branches") in the top right of most owner pages, not just dashboard.

### Branches (`/owner/branches`)
- Grid of branch cards: name, address, a completion % badge (colored by the same gradient threshold as Reports), **"Managers: X/2"** (directly surfaces the cap from comanager-logic §2), and a compact dot-stat row: `8✓ · 2• · 0✗` (completed / pending / missed counts, inline).
- "+ Add branch" top right.

### Managers (`/owner/managers`)
- Simple table: Name, Branch, Email, Status.
- **Status column only ever shows ACTIVE** — no "Invited" state (see resolved conflicts above).
- Header subtitle: "Up to 2 managers per branch." — reinforces the cap directly in the UI copy.
- "+ Add manager" — this triggers the direct-create flow (temp password generated, credentials modal shown to owner) from comanager-auth.

### Tasks (`/owner/tasks`)
- Grid of task cards: title, scope ("All branches · 6 items" or "Corniche — Jeddah · 8 items") — **"N items" is the count of that task's active `task_items`** (resolved 2026-07-29, see Resolved Conflicts above), a **circular % ring** whose color follows the same red/amber/green gradient threshold as Reports (comanager-context Reporting Rules) — this confirms the gradient applies per-card, not just in aggregate charts.
- Frequency badge (DAILY/WEEKLY/MONTHLY). Submission-requirement badges (Photo/Note/Number) are now **per item**, shown when expanding the card to its item list — not on the collapsed card itself, since different items on the same task can have different requirements (comanager-logic §5).
- A **7-segment history strip** under each card — a compact row of small marks representing recent cycles' completion (color-coded: filled dark = completed, amber = partial/pending, gray = empty/not yet due). Still one strip per task (per `task_submissions` row, the rollup), not per item.
- "Duplicate" button per card (clone a task's settings AND its items as a starting point for a new one).
- "+ New task" opens the low-friction creation modal (comanager-logic §7) — items are added within that same modal (title + per-item requirement toggles, reorderable), not a separate screen.

**Submission detail accordion (added 2026-08-04, founder-confirmed):**
clicking anywhere on a task card (other than its Edit/Duplicate/Deactivate
buttons, which stop propagation) expands it downward in place — no
separate page — to show that task's actual **today's** completed
`task_item_submissions` (photo/note/value evidence + plain "done"
checkmarks for checkbox-only items), fetched on demand only for the
expanded card, not prefetched for every card on the page.
- **Scope: today only** — not the 7-day history-strip window. The strip
  stays a glance-level trend; this accordion is a same-day drill-down.
- **"All branches" tasks: grouped by branch** — a bold branch-name
  sub-header per branch with activity today, mirroring the Food Safety
  page's existing "By branch" grouping pattern above. A branch with no
  completed items today doesn't get an empty group shown. A
  single-branch task shows a flat list, no branch header (redundant —
  there's only one branch).
- **Row layout: compact** — primary line is the item title plus its
  evidence inline (photo thumbnail / value chip / note snippet / "✓
  Done" for a plain checkbox item — a single item can show more than one
  of these at once, since requires_photo/note/value are independent
  per-item flags, comanager-logic §5); a smaller gray secondary line
  underneath has manager name and time only
  (`toLocaleTimeString` HH:mm, same convention as Schedule's event
  times) — branch is never repeated per row, since the branch grouping
  header (all-branches tasks) or the card's own scope label
  (single-branch tasks) already conveys it.
- Empty state: "No submissions yet today." — same wording style as other
  empty states in this app (e.g. Branch Manager Tasks' "Nothing due
  today.").

### Food Safety (`/owner/food-safety`)
- Alert banner when there are unresolved failures: "N unresolved food-safety failures", showing branch/standard/submitter/time for the most recent, a "View all" link, and an **Acknowledge** button — matches comanager-logic's fail-state flow exactly.
- "Standards" section: cards per standard (name, range, Duplicate button).
- "Recent readings" — a table, branches as rows, standards as columns, Pass/Fail cells color-coded (green/red). Toggle between "Log" (chronological) and "By branch" (grid, as shown) views.

### Schedule (`/owner/schedule`)
- Full calendar (Month/Week/Day toggle), color-coded event blocks by type (Training=green, Inspection=amber, Audit=red, Meeting=neutral).
- "+ Add shift/event" opens the same low-friction creation modal pattern (comanager-logic §7) — the calendar display itself is naturally more complex than the modal that creates entries; that's fine, the simplicity rule applies to creation, not to the calendar view itself.

### Reports (`/owner/reports`) — full rebuild, 2026-08-05, founder-specified brief

> Supersedes every earlier version of this section (the trend-line-pair +
> by-branch-comparison + category-bar + day-of-week-heatmap layout, and
> the original "Needs Attention" placement note) — do not build the old
> version, and do not keep both documented. Four founder decisions locked
> this build (asked via AskUserQuestion before any code was written):
> keep the app's existing **light** theme (not the brief's literal "dark
> charcoal" language — the brief's own "use the existing design system"
> instruction wins), **no new npm dependencies** (custom SVG charts +
> CSS/Tailwind transitions, matching this app's zero-chart-library
> precedent), **keep Needs Attention** (scoped to "All Branches" only —
> see below), **English-only** (the app has zero i18n infrastructure
> anywhere else; building real Arabic text for just this one page would
> be inconsistent — layout still avoids hardcoding assumptions that would
> obviously break under a future RTL pass, but no translation/toggle
> exists yet).

**Terminology mapping** (brief's marketing language → real schema entity,
used consistently in UI copy even though the underlying table names
differ): "Task Group" = a `tasks` row (a checklist, per the 2026-07-29
task/task_items schema). "Food Safety Reference" = a `food_safety_standards`
row.

**No "Overdue" state anywhere** — the schema only has
`pending`/`completed`/`missed` for tasks and `pending`/`pass`/`fail`/`missed`
for food safety (the midnight cron flips overdue `pending` → `missed`,
comanager-logic §4). Every chart/table/KPI that might elsewhere be
described as tracking "overdue" uses `missed` instead; there is no
separate overdue concept to build.

**Header**: title "Reports", supporting text "Track task completion and
food safety performance across your branches." No second summary/repeat
of the title below it.

**Global filters**, directly below the header:
- Branch filter (select): "All Branches" (default) + each active branch.
- Time range filter (pill toggle): **7 Days / 30 Days / 3 Months**
  (default 30 Days) — replaces the old Day/Week/Month/3-Months toggle.
  7/30 Days bucket trend charts by day; 3 Months buckets by week (still
  never raw daily points at that range, per comanager-context Reporting
  Rules, now updated to reference these three options).
- Both filters apply to every KPI/chart/table on the page (Needs
  Attention is the sole, deliberate exception — see below). Changing
  either preserves the other's current value. No full-page reload; a
  brief, localized loading state only.

**Needs Attention** — kept from the prior build, but now **only rendered
when Branch filter = "All Branches"** (its cross-branch "which branch
needs help today" purpose is moot once one branch is already selected —
hiding it there avoids showing a redundant single-row list). Otherwise
unchanged from the original design: underperforming branches (below 80%
today, comanager-logic §7, branches with nothing due excluded rather than
flagged at 0%) + unresolved food-safety failures (`result='fail' AND
acknowledged_at IS NULL`, 30-day window, capped at 5 with "+N more — view
all"). Positioned directly below the KPI row, above "Tasks Performance".
Deliberately independent of the time-range filter too (always "today"),
same reasoning as before.

**Top KPI row** — exactly 4 cards, no more, no fewer:
1. **Task Completion Rate** — `completed / total` of in-range
   `task_submissions` (total = every row regardless of status, same
   BUG#029 denominator convention as the rest of the app), shown as a %,
   with a percentage-point delta vs. the immediately preceding equivalent
   window (e.g. 30-Days range compares `[today-59, today-30)` against
   `[today-29, today]`).
2. **Food Safety Compliance** — `pass / (pass+fail+missed)` of in-range
   `food_safety_submissions` (pending excluded from the denominator, same
   convention the old trend chart already used), same delta pattern.
3. **Missed Tasks** — raw count of `task_submissions` with
   `status='missed'` in range (a count, not a rate — replaces the
   schema-impossible "Overdue Tasks"/"Average Completion Time" cards from
   the original brief). Delta shown as an absolute count difference
   ("+3"/"-2"), not a percentage (a % change on a raw count is often
   undefined/meaningless when the prior period was 0). Warning (red)
   styling when the count **increased** vs. the prior period; neutral
   when flat or decreased — ties the "high" warning to trend direction
   rather than an invented absolute threshold nowhere in the spec.
4. **Unresolved Food Safety Failures** — count of
   `food_safety_submissions` with `result='fail' AND acknowledged_at IS
   NULL` whose `due_date` falls in the selected range (this KPI, unlike
   Needs Attention, *does* respect the range/branch filters — "all data
   on the page must match both selected filters" per the brief). Same
   absolute-delta + trend-direction warning styling as Missed Tasks.

**"Tasks Performance" section** (heading + "See how all operational task
groups are performing over time."):
- **Chart 1 — Task Completion Trend**: multi-series line, Completed vs.
  Missed (no third "Overdue" series — 2 series only), bucketed per the
  range (day for 7/30 Days, week for 3 Months). Generated one-line insight
  above/below comparing current-vs-previous-period completion rate (e.g.
  "Task completion improved by 6% compared with the previous period."),
  only rendered when both periods have real data to compare.
- **Chart 2 — Task Group Performance**: horizontal bars, one per active
  task (scoped by the branch filter via its actual `task_submissions`
  rows, not by filtering the `tasks` table directly — a global task with
  no submissions for the filtered branch naturally drops out on its own).
  Value = completion rate. Default sort: worst-first. A small "Needs
  attention" / "Best performing" toggle flips the sort direction. Shows
  the first 8–10 with a "View all" action (opens the full list in the
  table below, does not horizontally scroll the chart). Clicking a bar
  highlights the matching table row (does not navigate).
- **Tasks detail table**: Task Group / Total Tasks / Completed / Missed /
  Completion Rate. Sortable (default: completion rate ascending),
  searchable by name, row click opens `ReportDetailsDrawer` (daily
  history, manager completion records via `submitted_by` → `users.name`,
  recent missed tasks) — the drawer adds detail, it never just re-renders
  the chart.

**"Food Safety Performance" section** (heading + "Track compliance across
all food safety references."):
- **Chart 3 — Food Safety Compliance Trend**: multi-series line, Passed /
  Failed / Missed (3 series — these are literally 3 of the 4 real
  `result` enum values; `pending` is the 4th and isn't graphed, same as
  it was never graphed before). One generated insight sentence when the
  data supports it (e.g. naming whichever standard contributed the most
  fails during a decline).
- **Chart 4 — Food Safety Reference Performance**: horizontal bars, one
  per active standard, value = compliance rate, worst-first default,
  same 8–10 cap + "View all", same bar-click-highlights-table-row
  behavior as Chart 2.
- **Food Safety detail table**: Food Safety Reference / Total Inspections
  / Passed / Failed / Missed / Compliance Rate. Same sortable/searchable/
  drawer behavior as the Tasks table; drawer may show historical results,
  recent failed/missed inspections, and `corrective_note`/`photo_url`
  evidence when present (via the shared `PhotoLightbox`, not a new photo
  viewer).

**Layout**: desktop — line chart ~65% / bar chart ~35% width per section,
table full-width below. Tablet — chart pair stacks vertically. Mobile —
everything stacks, tables become expandable stacked cards, no horizontal
page scroll.

**States**: skeleton loading (KPI cards, chart shapes, table rows — never
a blank page); empty state with a clear message + a "change the time
range" secondary action, distinct copy for "no task groups yet"/"no fs
references yet" (explaining they'll appear automatically once created —
never asking the owner to manually add them, per Data Synchronization);
error state with a Retry action that preserves the current filters.

**Exactly 4 primary charts, no pie/donut/radar/decorative charts, no
per-task-group or per-standard individual charts** — the two bar charts
are the only per-entity visualization, and they're capped/paginated via
the table rather than one chart each.

### Billing (`/owner/billing`)
- Current plan card: "50 SAR per branch/month" + feature checklist (2 managers/branch, real-time dashboard, unlimited checklists/logs).
- Right column: Branches count, Managers included (branches × 2), Next invoice amount.
- **Free trial banner** with days-remaining progress bar (confirmed real — see resolved conflicts).
- Payment method display + "Update payment method" — card is added here, not required at signup.

---

## Branch Manager Panel Screens

### Dashboard (`/branch-manager/dashboard`)
- Personalized greeting: "Good shift, {first name}" — use the manager's actual first name from their profile.
- **Ignore the "shift progress"/"shift end time" card** — confirmed mockup filler, not a real feature. Replace with something meaningful (e.g. overall today's completion) when actually building this screen.
- "Today's tasks" — list with per-task progress (X/Y items).
- "Food safety due" — ring chart + Pass/Fail/Pending counts with colored dots.
- "Next scheduled event" card.

### Tasks (`/branch-manager/tasks`)
- Accordion-style cards, one per task (per `task_submissions` row), expandable to show its individual checklist items (its `task_items`, each with its own `task_item_submissions` row for this cycle) — resolved 2026-07-29, this is a real per-item list now, not a flat single-submission task.
- **Color-coded by urgency, not just pass/fail**: a task at 0% (no items done) shows in red/pink — this is a different semantic use of red than "failed" elsewhere in the app (which is reserved for food-safety fails). Treat this as "needs attention" urgency coloring specific to the manager's own task list, separate from the pass/fail red used in Food Safety.
- Each expanded item shows a checkbox plus, conditionally, an "Add photo" button (if that item's own `requires_photo`) or an "Add a note..." input (if `requires_note`) — the requirement flags are per-item now, so different items on the same task can show different controls.
- The parent task card's own status only becomes "done" once every item underneath it is submitted (client-side rollup after each item submission — see comanager-logic §4).

### Food Safety (`/branch-manager/food-safety`)
- One card per standard: name, range, a reading input, Submit button.
- Subtitle: "Enter a reading — pass/fail is calculated automatically" — reinforces that pass/fail is never manually chosen, always derived from the value against the standard's range.

### Schedule (`/branch-manager/schedule`)
- Simple list (not a calendar) — "Events set by your owner for this branch," read-only, day/date + type badge + title + time range.

---

## Component Patterns to Formalize (add to comanager-design once confirmed)

- **Gradient ring/badge**: same red→amber→green threshold logic used consistently across Owner Tasks cards, Branches cards, and Reports bars — one shared component, not reimplemented per screen.
- **Dot-stat row**: `N✓ · N• · N✗` compact inline summary — used on Branches cards, worth reusing anywhere a compact per-branch summary is needed.
- **7-segment history strip**: needs its own small component, used on Tasks cards.
- **Avatar**: 2-letter initials in a colored circle (top right of every authenticated screen) — same component across both panels.
- **Alert banner**: red-tinted, left-icon, title + detail line + action button — used for the food-safety fail alert, likely reusable for other "needs attention" banners later.
- **Submission detail accordion**: click-to-expand-in-place card → today's completed-item evidence rows, grouped by branch only when the task is scoped to "all branches" — used on Owner Tasks cards; likely reusable on Owner Food Safety's standard cards later if the founder wants the same drill-down there.
- **Photo lightbox** (added 2026-08-04, founder-confirmed, shared component `components/PhotoLightbox.tsx`): every submitted-photo link across both panels opens in-app instead of a new tab — dark overlay (`bg-ink/80`) behind a large centered image (`max-h-[85vh]`, `rounded-xl` per the design system's 20px larger-modal radius), close via an X button (top-right, `rounded-xl bg-card`), clicking the overlay outside the image, or Escape. **Identical everywhere, photo only, no caption** — the item/date/submitter context already lives on the row the click came from, and duplicating it inside the modal was explicitly rejected in favor of keeping one simple component with zero per-panel variants. Replaces the plain `<a target="_blank">`/`<img>` links that used to be at:
  - Owner Tasks accordion (`SubmissionRow`'s 📷 icon)
  - Branch Manager Tasks' expanded completed-item view ("View photo")
  - Branch Manager Food Safety's `ReadingCard` completed-reading view ("View photo")
  Owner Food Safety does not currently show submitted photos anywhere (its "Recent readings" table has no photo column), so there was nothing to convert there.
- **Side drawer** (added 2026-08-05, `ReportDetailsDrawer` on Reports): the app's first slide-in-from-the-right panel — every existing modal (TaskModal, StandardModal, manager-created confirmation) is a centered overlay, not a drawer. Used for row/bar-click "more detail" on the Reports tables/charts; likely reusable anywhere else a "drill into this one row without leaving the page" need comes up later.
