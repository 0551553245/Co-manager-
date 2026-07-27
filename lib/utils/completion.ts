// comanager-conventions: never compute completion rate inline in a
// component; use shared utilities that handle divide-by-zero and branch
// filtering correctly. A completion rate is never allowed to render above
// 100%.

export interface ScopedDef {
  id: string;
  branch_id: string | null;
}

// Never use a raw array's length as the denominator for a single branch —
// global (branch_id: null) defs apply to every branch and must be counted
// in, per-branch defs only count for their own branch.
export function getExpectedForBranch(defs: ScopedDef[], branchId: string): number {
  return defs.filter((d) => d.branch_id === null || d.branch_id === branchId).length;
}

export function calcRate(completed: number, expected: number): number {
  if (expected <= 0) return 0;
  return Math.min(100, Math.round((completed / expected) * 100));
}

export function calcPending(expected: number, completed: number, missed: number): number {
  return Math.max(0, expected - completed - missed);
}

// comanager-context Reporting Rules: HSL interpolation (never RGB — it
// produces muddy browns), red at 0%, yellow/amber at 50%, brand green at
// 100%. Hues derived from the actual design tokens (comanager-design):
// red #E8697C ≈ 350°, amber #E0A23B ≈ 37°, brand green #013F32 ≈ 167°.
// RED_HUE is kept as -10 (equivalent to 350°) so the 0–50% leg sweeps the
// short way around the wheel (350° → 37° via 360/0, not backwards through
// green) instead of naively lerping the raw degree values.
const RED_HUE = -10;
const AMBER_HUE = 37;
const GREEN_HUE = 167;

function completionHue(percent: number): number {
  const p = Math.max(0, Math.min(100, percent));
  const hue =
    p <= 50
      ? RED_HUE + (AMBER_HUE - RED_HUE) * (p / 50)
      : AMBER_HUE + (GREEN_HUE - AMBER_HUE) * ((p - 50) / 50);
  return ((hue % 360) + 360) % 360;
}

export function completionColor(percent: number): string {
  return `hsl(${completionHue(percent).toFixed(0)}, 65%, 45%)`;
}

// comanager-design status-chip pattern: soft background at ~16% opacity of
// the status color, solid ink-toned text — never solid-fill badges.
export function completionBackgroundColor(percent: number): string {
  return `hsl(${completionHue(percent).toFixed(0)} 65% 45% / 0.16)`;
}

// comanager-context: 80% is the underperformance threshold — below it, a
// branch should visually flag as needing attention.
export const UNDERPERFORMING_THRESHOLD = 80;
