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

### Reports (`/owner/reports`)
- **"Needs Attention" (added 2026-08-05, founder-confirmed)** — cards/list
  section at the very top of the page, above the branch filter and the
  Day/Week/Month/3-Months toggle (not just above the charts) — visually
  signals that it doesn't respond to either control below it. Two card
  types, both red-accented (`border-l-4 border-red`), shown together in
  one grid:
  - **Underperforming branches**: any branch below the 80% completion
    threshold (comanager-logic §7) **today** — always today, never scoped
    by the range toggle (that toggle explores history; this is "what's
    wrong right now"). A branch with zero submissions due today is
    excluded, not flagged at 0% — nothing due isn't underperformance
    (same reasoning as BUG#029's denominator fix). Sorted worst-first.
    **Clicking a branch card sets the page's own branch filter** to that
    branch (scrolls nothing, just filters the charts below) rather than
    navigating away.
  - **Unresolved food-safety failures**: identical definition to the Food
    Safety page's own alert banner (`result='fail' AND acknowledged_at IS
    NULL`), same 30-day lookback window for consistency, capped at 5 cards
    with a "+N more — view all" card linking to `/owner/food-safety` if
    there are more. **Clicking a failure card navigates to
    `/owner/food-safety`** (a real page link, unlike the branch cards).
  - Empty state: a green/success-tinted "Nothing needs attention today."
    banner, not just an absent section — confirms the check ran rather
    than looking broken/missing.
- Branch filter + Day/Week/Month/3-Months toggle (comanager-context Reporting Rules — Month/3-Months must aggregate, never plot raw daily points). **Confirmed already fully built and working as specified** (re-verified 2026-08-05) — Month buckets by week, 3-Months buckets by month, never raw daily points; no changes needed here.
- Two trend line charts: Completion rate, Food-safety pass rate.
- "By-branch comparison" — horizontal bar chart, toggle between Completion% and Pass rate%, bars colored by the gradient threshold (green ≥80%, amber below — matches the 80% underperformance threshold from comanager-logic §7... actually §Reporting Rules in comanager-context).
- "Completion by task category" — bar chart per category.
- "Day-of-week pattern (last 10 weeks)" — a GitHub-style heatmap, intensity by completion level. New pattern, not previously documented — needs a query grouping submissions by day-of-week over a rolling 10-week window.

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
