"use client";

import { useCallback, useEffect, useState } from "react";
import { usePanelAuthContext } from "@/lib/auth/panel-auth-context";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";
import { calcPending, calcRate, completionBackgroundColor, completionColor } from "@/lib/utils/completion";
import { riyadhDateString } from "@/lib/utils/riyadh-date";
import { BranchModal, type BranchFormValues } from "./BranchModal";

interface Branch {
  id: string;
  name: string;
  name_ar: string | null;
  address: string | null;
  address_ar: string | null;
  city: string | null;
  phone: string | null;
  is_active: boolean;
}

type ModalState = { type: "create" } | { type: "edit"; branch: Branch } | null;

export default function BranchesPage() {
  const { loading, profile, client } = usePanelAuthContext();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [managerCounts, setManagerCounts] = useState<Record<string, number>>({});
  const [todaySubs, setTodaySubs] = useState<{ branch_id: string; status: string }[]>([]);
  const [branchesAllowed, setBranchesAllowed] = useState<number | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    const today = riyadhDateString();
    const [{ data: branchData }, { data: managerData }, { data: subData }, { data: subscription }] =
      await Promise.all([
        client
          .from("branches")
          .select("id, name, name_ar, address, address_ar, city, phone, is_active")
          .order("name"),
        client.from("users").select("branch_id").eq("role", "branch_manager").eq("is_active", true),
        client.from("task_submissions").select("branch_id, status").eq("due_date", today),
        client.from("subscriptions").select("branches_count").single(),
      ]);

    setBranches(branchData ?? []);
    const counts: Record<string, number> = {};
    (managerData ?? []).forEach((m) => {
      if (m.branch_id) counts[m.branch_id] = (counts[m.branch_id] ?? 0) + 1;
    });
    setManagerCounts(counts);
    setTodaySubs(subData ?? []);
    setBranchesAllowed(subscription?.branches_count ?? null);
    setDataLoading(false);
  }, [client]);

  useEffect(() => {
    if (!loading && profile) loadData();
  }, [loading, profile, loadData]);

  // Live-refresh when a manager submits somewhere (comanager-logic §6) —
  // dot-stats/completion badges here update without a manual refresh.
  useRealtimeTable(client, `owner-branches-${profile?.id ?? "anon"}`, "task_submissions", loadData);

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  // Denominator is today's actual task_submissions rows for this branch,
  // not the count of task definitions (audit finding, 2026-07-30): a task
  // definition can exist with no submission row yet generated for today
  // (a brand-new task before the next midnight slot-gen run, or — as in
  // this project until PENDING_MANUAL_STEPS.md §3 is run — every task,
  // always). Counting definitions as "expected" silently manufactured
  // phantom "pending" entries for slots that don't exist yet, verified
  // live: a task with zero submission rows for today inflated the pending
  // count and deflated the rate, even though the actual submission table
  // had no pending row at all. Every other page (owner Dashboard, branch-
  // manager Dashboard/Tasks) already uses actual submission-row counts —
  // this brings Branches in line with that.
  function branchStats(branchId: string) {
    const subs = todaySubs.filter((s) => s.branch_id === branchId);
    const completed = subs.filter((s) => s.status === "completed").length;
    const missed = subs.filter((s) => s.status === "missed").length;
    return {
      completed,
      missed,
      pending: calcPending(subs.length, completed, missed),
      rate: calcRate(completed, subs.length),
    };
  }

  async function handleCreate(values: BranchFormValues): Promise<string | void> {
    // Layer 2 of 3 (comanager-logic §1 branch cap, same pattern as the
    // manager cap in §2): fast, clean-error pre-check. The DB trigger
    // (enforce_branch_cap, comanager-schema.sql) is layer 3 and the one
    // that actually matters — this just avoids relying on it for the
    // normal (non-racing) case.
    const activeCount = branches.filter((b) => b.is_active).length;
    if (branchesAllowed !== null && activeCount >= branchesAllowed) {
      return "Upgrade your plan to add more branches.";
    }

    const { error } = await client.from("branches").insert({
      owner_id: profile!.id,
      name: values.name,
      name_ar: values.name_ar || null,
      address: values.address || null,
      address_ar: values.address_ar || null,
      city: values.city || null,
      phone: values.phone || null,
    });
    if (error) return error.message;
    setModal(null);
    await loadData();
  }

  async function handleEdit(branchId: string, values: BranchFormValues): Promise<string | void> {
    const { error } = await client
      .from("branches")
      .update({
        name: values.name,
        name_ar: values.name_ar || null,
        address: values.address || null,
        address_ar: values.address_ar || null,
        city: values.city || null,
        phone: values.phone || null,
      })
      .eq("id", branchId);
    if (error) return error.message;
    setModal(null);
    await loadData();
  }

  async function toggleActive(branch: Branch) {
    // Soft-delete only — branches.on-delete-cascade would wipe every
    // historical task/food-safety submission for this branch, so a hard
    // DELETE is never offered here, consistent with how managers are
    // deactivated rather than deleted (comanager-logic §2).
    await client.from("branches").update({ is_active: !branch.is_active }).eq("id", branch.id);
    await loadData();
  }

  const activeBranchCount = branches.filter((b) => b.is_active).length;
  const atBranchCap = branchesAllowed !== null && activeBranchCount >= branchesAllowed;

  return (
    <main className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl">Branches</h1>
          {branchesAllowed !== null && (
            <p className="text-sm text-ink/70">
              {activeBranchCount}/{branchesAllowed} branches on your plan
            </p>
          )}
        </div>
        <button
          onClick={() => setModal({ type: "create" })}
          disabled={atBranchCap}
          title={atBranchCap ? "Upgrade your plan to add more branches" : undefined}
          className="rounded bg-green px-4 py-2 text-sm text-cream disabled:opacity-60"
        >
          + Add branch
        </button>
      </div>

      {atBranchCap && (
        <p className="mt-4 rounded bg-amber/16 p-3 text-sm text-amber-ink">
          Upgrade your plan to add more branches.
        </p>
      )}

      {dataLoading ? (
        <p className="mt-6 text-sm text-ink/60">Loading...</p>
      ) : branches.length === 0 ? (
        <p className="mt-6 text-sm text-ink/60">No branches yet.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => {
            const stats = branchStats(b.id);
            const color = completionColor(stats.rate);
            const managers = managerCounts[b.id] ?? 0;
            return (
              <div key={b.id} className="rounded-lg bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <h3 className="font-display text-lg">{b.name}</h3>
                  <span
                    className="rounded-pill px-2 py-1 font-mono text-xs font-bold"
                    style={{ backgroundColor: completionBackgroundColor(stats.rate), color }}
                  >
                    {stats.rate}%
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink/70">
                  {[b.address, b.city].filter(Boolean).join(", ") || "No address set"}
                </p>
                <p className="mt-2 text-sm">Managers: {managers}/2</p>
                <p className="mt-1 font-mono text-xs text-ink/60">
                  {stats.completed}✓ · {stats.pending}• · {stats.missed}✗
                </p>
                {!b.is_active && (
                  <span className="mt-2 inline-block rounded-pill bg-red/16 px-2 py-1 font-mono text-xs uppercase text-red-ink">
                    Inactive
                  </span>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setModal({ type: "edit", branch: b })}
                    className="rounded border px-3 py-1 text-xs"
                  >
                    Edit
                  </button>
                  <button onClick={() => toggleActive(b)} className="rounded border px-3 py-1 text-xs">
                    {b.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal?.type === "create" && (
        <BranchModal
          title="Add branch"
          submitLabel="Create branch"
          onCancel={() => setModal(null)}
          onSubmit={handleCreate}
        />
      )}
      {modal?.type === "edit" && (
        <BranchModal
          title="Edit branch"
          submitLabel="Save changes"
          initial={modal.branch}
          onCancel={() => setModal(null)}
          onSubmit={(values) => handleEdit(modal.branch.id, values)}
        />
      )}
    </main>
  );
}
