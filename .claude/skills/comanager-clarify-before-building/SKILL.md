---
name: comanager-clarify-before-building
description: >
  MANDATORY — Read this before starting any non-trivial Co Manager task
  (new page, new feature, schema change, new flow, or anything not fully
  specified by an existing skill). Before writing code, ask the founder
  clarifying questions using the checklist below — but only for what
  isn't already answered by comanager-context, comanager-logic,
  comanager-auth, comanager-conventions, comanager-design, or
  comanager-design-match. Never re-ask something already locked in those
  files. Skip this skill entirely for trivial tasks (see definition below).
---

# Co Manager — Clarify Before Building

> Purpose: catch missing detail BEFORE code gets written, not after. A
> vague request implemented with invented assumptions costs more time than
> one clarifying round-trip. This file is the checklist for that
> round-trip — it does not replace comanager-context/logic/auth as the
> source of truth, it just makes sure a new task is actually covered by
> them before building starts.

---

## Step 0 — Is this task trivial?

Skip this whole skill and just build if the task is:
- A one-line/small fix with a clear, unambiguous repro
- A typo, copy change, or style tweak
- Explicitly and completely specified already (e.g. "add a `created_at`
  column read-only display to the Branches card, right-aligned, small gray
  text" — nothing left to guess)
- A direct continuation of a task clarified earlier in this same session

Everything else — a new page, a new feature, a schema change, a new flow,
a vague one-liner like "add the reports page" — goes through Step 1.

---

## Step 1 — Check the other skills first

Before asking the founder anything, check whether the answer already
exists:
1. comanager-context — schema, routing, panels, permissions, tech stack
2. comanager-logic — signup, manager lifecycle, RLS, slot generation,
   submission requirements, dashboard realtime, low-friction creation UX
3. comanager-auth — account creation, login/logout, session rules
4. comanager-conventions — query/realtime/React coding patterns
5. comanager-design + comanager-design-match — tokens and exact screen
   layout/behavior, including the Resolved Conflicts table
6. comanager-bug-log — known failure modes for this exact area

If the answer is there, use it — do not ask about it. Only ask about what
genuinely isn't covered.

---

## Step 2 — Ask about what's actually missing

Group questions by category; only include a category if something in it
is genuinely unresolved for this specific task. Keep it to the smallest
set of questions that unblocks building — this is not a form to fill out
for its own sake.

**Scope**
- Which panel(s) does this touch — branch manager, owner, admin, or
  shared/marketing?
- Is this a new route, or a change to an existing one? (check the routing
  table in comanager-context first)

**Data**
- Which table(s) does this read/write? (check the locked schema first —
  never invent a column; if a new column is genuinely needed, flag that
  explicitly as a schema change and confirm before proceeding)
- Does this need a new RLS policy, or does an existing one already cover it?

**Behavior & edge cases**
- What should happen on: empty state, loading state, error state,
  permission-denied state?
- Does this interact with the pre-created-slot model (comanager-logic §4)
  or is it a simple CRUD screen?
- Any interaction with the trial/read-only-lockout state (comanager-logic
  §1)? — i.e. should this action be blocked when the owner is read-only?

**Real-time & i18n**
- Does this need a live Supabase Realtime subscription, or is a normal
  fetch enough?
- Arabic strings needed for all new UI text (`_ar` fields / translation
  keys) — confirm rather than skip.

**Explicitly out of scope**
- What should this task NOT include, if there's a risk of scope creep
  (e.g. "build task creation" should not silently also build task editing
  unless asked)?

---

## Step 3 — How to ask

Ask as a single, short, numbered list in plain chat — this environment
doesn't have interactive buttons. Example:

```
Before I build this, a few quick things:
1. Should the "Reports" page's branch filter default to "All branches" or
   remember the founder's last selection?
2. The by-branch comparison bars — toggle between Completion% and Pass
   rate%, per comanager-design-match. Should both be visible at once
   instead, or is the toggle correct?
3. Any read-only-lockout interaction here, or is Reports a view-only page
   anyway (so lockout is moot)?
```

Don't ask more than ~5 questions at once — if more than that is unresolved,
the task is probably too big to hand off as one request; say so and
suggest breaking it up instead of listing ten questions.

---

## Step 4 — After the answers come back

- If an answer resolves something that should have been locked in one of
  the other skills (a recurring decision, not a one-off), say so and
  suggest it gets added there — don't just use it once and let it evaporate.
- If an answer contradicts something already locked in comanager-context
  or comanager-logic, flag the conflict explicitly and ask which one wins
  — never silently override a locked decision with a new chat answer.

---

## What this skill is NOT for

- Not a substitute for reading comanager-context/logic/auth first — those
  are checked BEFORE asking, not instead of asking.
- Not a way to stall on trivial tasks — see Step 0.
- Not for mid-build technical questions (e.g. "which Tailwind class") —
  those get resolved by comanager-design, or just picked sensibly and
  noted, not escalated.
