"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseOwner } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";

interface Subscription {
  status: "trialing" | "active" | "cancelled" | "expired";
  branches_count: number;
  price_per_branch_sar: number;
  trial_ends_at: string;
  moyasar_token: string | null;
}

const TRIAL_LENGTH_DAYS = 14;

// Routing per comanager-context: account + subscription both live at
// /owner/settings — there's no separate /owner/billing route.
export default function OwnerSettingsPage() {
  const { loading, profile, client } = usePanelAuth(supabaseOwner, "owner", "/owner/login");

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [branchCount, setBranchCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);
  const [showPaymentNotice, setShowPaymentNotice] = useState(false);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    const [{ data: subData }, { count }] = await Promise.all([
      client
        .from("subscriptions")
        .select("status, branches_count, price_per_branch_sar, trial_ends_at, moyasar_token")
        .single(),
      client.from("branches").select("id", { count: "exact", head: true }).eq("is_active", true),
    ]);
    setSubscription(subData ?? null);
    setBranchCount(count ?? 0);
    setDataLoading(false);
  }, [client]);

  useEffect(() => {
    if (!loading && profile) loadData();
  }, [loading, profile, loadData]);

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  if (dataLoading) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  if (!subscription) {
    return <main className="p-8 text-sm text-red-ink">No subscription found for this account.</main>;
  }

  // Use the actual current branch count for pricing display — the
  // signup-time branches_count on the subscription row can drift as
  // branches are added/removed later (comanager-context: open question on
  // proration, not resolved yet — this just displays today's real number).
  const effectiveBranchCount = branchCount || subscription.branches_count;
  const monthlyTotal = effectiveBranchCount * subscription.price_per_branch_sar;
  const managersIncluded = effectiveBranchCount * 2;

  const trialEndsAt = new Date(subscription.trial_ends_at);
  const now = new Date();
  const daysLeft = Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  const trialProgress = Math.min(100, Math.max(0, ((TRIAL_LENGTH_DAYS - daysLeft) / TRIAL_LENGTH_DAYS) * 100));

  return (
    <main className="p-8">
      <h1 className="font-display text-2xl">Billing</h1>

      {subscription.status === "trialing" && (
        <div className="mt-4 rounded-lg bg-card p-4 shadow-sm">
          <p className="font-display text-sm">Free trial — {daysLeft} day{daysLeft === 1 ? "" : "s"} left</p>
          <div className="mt-2 h-2 w-full rounded-pill bg-ink/10">
            <div className="h-2 rounded-pill bg-accent" style={{ width: `${trialProgress}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink/60">
            Add a payment method before your trial ends to keep your account active.
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg bg-card p-4 shadow-sm">
          <h2 className="font-display text-lg">
            {subscription.price_per_branch_sar} SAR <span className="text-sm font-normal">per branch/month</span>
          </h2>
          <ul className="mt-3 flex flex-col gap-1 text-sm text-ink/70">
            <li>✓ 2 managers per branch included</li>
            <li>✓ Real-time dashboard</li>
            <li>✓ Unlimited checklists and logs</li>
          </ul>
        </div>

        <div className="rounded-lg bg-card p-4 shadow-sm">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink/60">Branches</dt>
              <dd className="font-mono">{effectiveBranchCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink/60">Managers included</dt>
              <dd className="font-mono">{managersIncluded}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink/60">Next invoice</dt>
              <dd className="font-mono">{monthlyTotal} SAR</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-card p-4 shadow-sm">
        <h2 className="font-display text-lg">Payment method</h2>
        <p className="mt-2 text-sm text-ink/70">
          {subscription.moyasar_token ? "Card on file" : "No payment method on file"}
        </p>
        <button
          onClick={() => setShowPaymentNotice(true)}
          className="mt-3 rounded border px-4 py-2 text-sm"
        >
          Update payment method
        </button>
        {showPaymentNotice && (
          <p className="mt-2 rounded bg-amber/16 p-2 text-xs text-amber-ink">
            Payment integration (Moyasar) isn&apos;t connected yet — this is a UI placeholder only.
          </p>
        )}
      </div>
    </main>
  );
}
