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
- Grid of task cards: title, scope ("All branches · 6 items" or "Corniche — Jeddah · 8 items"), a **circular % ring** whose color follows the same red/amber/green gradient threshold as Reports (comanager-context Reporting Rules) — this confirms the gradient applies per-card, not just in aggregate charts.
- Frequency badge (DAILY/WEEKLY/MONTHLY) + submission-requirement badges (Photo/Note/Number) — directly reflects the `requires_photo`/`requires_note`/`requires_value` flags from comanager-logic §5.
- A **7-segment history strip** under each card — a compact row of small marks representing recent cycles' completion (color-coded: filled dark = completed, amber = partial/pending, gray = empty/not yet due). This is new — not previously in the schema. Needs a lightweight query: last 7 `task_submissions` rows for that task, ordered by due_date.
- "Duplicate" button per card (clone a task's settings as a starting point for a new one).
- "+ New task" opens the low-friction creation modal (comanager-logic §7).

### Food Safety (`/owner/food-safety`)
- Alert banner when there are unresolved failures: "N unresolved food-safety failures", showing branch/standard/submitter/time for the most recent, a "View all" link, and an **Acknowledge** button — matches comanager-logic's fail-state flow exactly.
- "Standards" section: cards per standard (name, range, Duplicate button).
- "Recent readings" — a table, branches as rows, standards as columns, Pass/Fail cells color-coded (green/red). Toggle between "Log" (chronological) and "By branch" (grid, as shown) views.

### Schedule (`/owner/schedule`)
- Full calendar (Month/Week/Day toggle), color-coded event blocks by type (Training=green, Inspection=amber, Audit=red, Meeting=neutral).
- "+ Add shift/event" opens the same low-friction creation modal pattern (comanager-logic §7) — the calendar display itself is naturally more complex than the modal that creates entries; that's fine, the simplicity rule applies to creation, not to the calendar view itself.

### Reports (`/owner/reports`)
- Branch filter + Day/Week/Month/3-Months toggle (comanager-context Reporting Rules — Month/3-Months must aggregate, never plot raw daily points).
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
- Accordion-style cards, one per task, expandable to show individual checklist items.
- **Color-coded by urgency, not just pass/fail**: a task at 0% (not started) shows in red/pink — this is a different semantic use of red than "failed" elsewhere in the app (which is reserved for food-safety fails). Treat this as "needs attention" urgency coloring specific to the manager's own task list, separate from the pass/fail red used in Food Safety.
- Expanded item shows a checkbox plus, conditionally, an "Add photo" button (if `requires_photo`) or an "Add a note..." input (if `requires_note`) — directly reflects the submission-requirement flags.

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
