"use server";

// Calls the deployed generate-daily-slots edge function in its scoped
// mode (see supabase/functions/generate-daily-slots/index.ts) right after
// an owner creates a task/standard, or reactivates one — so a branch
// manager sees today's slot immediately instead of waiting for the next
// midnight cron run. Reuses the exact same slot-creation logic the cron
// already runs; this file only triggers it, it never duplicates it.
//
// CRON_SECRET must be set as a server-only env var in this app's own
// deployment (Vercel), matching the same value already configured as a
// Supabase Edge Function secret (see PENDING_MANUAL_STEPS.md) — it's a
// different place to set the same value, not a different secret.
//
// Deliberately fails soft: if this call fails for any reason (missing
// env var, function unreachable, etc.), the task/standard creation itself
// must still succeed — the nightly cron is the fallback that guarantees
// the slot exists by tomorrow regardless. Never let this block or roll
// back the caller's own database write.
async function callScopedSlotGeneration(body: { taskId?: string; standardId?: string }): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!supabaseUrl || !cronSecret) {
    console.error("generate-immediate-slot: NEXT_PUBLIC_SUPABASE_URL or CRON_SECRET not set — skipping immediate slot generation, nightly cron will still cover it.");
    return;
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/generate-daily-slots`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cronSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("generate-immediate-slot: edge function returned", res.status, await res.text());
    }
  } catch (err) {
    console.error("generate-immediate-slot: request failed", err);
  }
}

export async function generateImmediateTaskSlot(taskId: string): Promise<void> {
  await callScopedSlotGeneration({ taskId });
}

export async function generateImmediateStandardSlot(standardId: string): Promise<void> {
  await callScopedSlotGeneration({ standardId });
}
