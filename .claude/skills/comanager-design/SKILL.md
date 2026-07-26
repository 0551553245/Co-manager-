---
name: comanager-design
description: Design system for Co Manager — real colors, typography, spacing, and component patterns extracted directly from the exported design files (Manager Panel, Owner Panel, Admin Panel, Landing/Marketing pages). Load before building any UI. Triggers on: design, UI, component, style, color, layout, page, dashboard, card, button, form, sidebar, header, mockup, status badge.
---

# Co Manager — Design System

> Extracted directly from the design export on 2026-07-23. These are real
> values pulled from the files, not invented ones. If a future design pass
> changes any of this, re-extract from the source file — never hand-edit
> this list from memory.

## Brand Palette (verified in-use)

```
Deep forest green (primary):  #013F32
Deep green (darker variant):  #0A2B22
Chartreuse (accent):          #E7FE25
Near-white (page bg / cream): #FDFDFD
Near-black (ink/text):        #161616
Card background:              #FFFFFF
```

## Status / Semantic Colors (verified in-use)

```
Success / pass / completed:  bg #37B788 @ 16% opacity, text #1F5C54
Fail / missed / overdue:     bg #E8697C @ 16% opacity, text #9C3F26
Pending / awaiting:          bg #E0A23B @ 16% opacity, text #8A5D1E
```
Pattern for status chips/badges: soft background at ~16% opacity of the
status color, solid ink-toned text in the darker variant of that color —
never solid-fill badges.

## ⚠️ Known Issue — Dead/Misnamed CSS Variables (fix in rebuild)

The exported stylesheet defines these root variables, but they are **dead
code** — not referenced anywhere in actual component logic (which uses hex
directly) — and their names don't match their actual colors:

```
--blue:      #37B788   ← this is actually green/teal, NOT blue
--blue-ink:  #1F5C54   ← this is actually dark teal, NOT blue
--yellow:    #7C86E8   ← this is actually indigo/periwinkle, NOT yellow
--yellow-ink:#3C42A0   ← this is actually indigo, NOT yellow
```

**Do not carry these into Co Manager as-is.** Either rename them to match
their real color (`--teal`/`--indigo`) or drop them entirely and reference
the verified status colors above by their actual semantic name
(`--success`, `--fail`, `--pending`). This is the same class of bug as the
old `status` vs `result` column mismatch — a name that lies about what it
holds. Add this as a rule to comanager-conventions once confirmed.

## Correctly-named variables (safe to keep)

```
--accent:     #E7FE25   (chartreuse)
--accent-ink: #161616
--green:      #013F32   (primary brand green)
--green-deep: #0A2B22
--card:       #FFFFFF
--cream:      #FDFDFD   (near-white page background)
--ink:        #161616
--red:        #E8697C
--red-ink:    #9C3F26
--amber:      #E0A23B
--amber-ink:  #8A5D1E
```

## Typography

```
Display / headings:  'Baloo 2'
Monospace / status chips, numeric readouts: 'JetBrains Mono'
Body text: Inter, sans-serif (seen in Owner Panel form fields)
```

## Border Radius Scale (by frequency of use)

```
10px  — most common, standard control/input radius
18px  — cards
8px   — small controls
999px — pills / status chips (fully rounded)
20px  — larger cards/modals
7px, 12px, 14px, 9px, 16px — occasional, screen-specific
```

## Component Notes
- Status chips: `fontFamily: 'JetBrains Mono'`, `fontSize: 10px`,
  `fontWeight: 700`, `borderRadius: 999px`, `textTransform: uppercase`,
  padding `3px 9px`, background/text per the status color pattern above.
- Result readouts (e.g. numeric values): same mono font, `fontSize: 12px`,
  `fontWeight: 700`, `borderRadius: 10px`, padding `8px 12px`, centered text.
- Form controls (selects, dropdowns): `padding: 10px 12px`,
  `borderRadius: 10px`, `border: 0.5px solid var(--border)`,
  `background: var(--cream)`, `fontSize: 13.5px`, `fontFamily: Inter, sans-serif`.

## Panels Covered by This Export
- Manager Panel (branch manager, mobile-first)
- Owner Panel (+ print variant)
- Admin Panel (+ print variant) — internal/super-admin, login gated with
  "internal staff only" messaging
- Landing Page + Marketing sections (Hero, Features, Showcase, Trust/FAQ, Footer)

## Branding Note
All "Mudir" naming and dedicated logo/monogram exploration files were
removed from this export before use — Co Manager is the current and only
product name. If any future design export still contains "Mudir" text or
logo files, strip them the same way before treating the export as current.
