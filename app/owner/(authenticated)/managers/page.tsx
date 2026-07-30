"use client";

import { useCallback, useEffect, useState } from "react";
import { usePanelAuthContext } from "@/lib/auth/panel-auth-context";
import { createManager, type CreateManagerResult } from "./actions";

interface Branch {
  id: string;
  name: string;
}

interface ManagerRow {
  id: string;
  name: string;
  email: string;
  branch_id: string | null;
}

export default function ManagersPage() {
  const { loading, profile, client } = usePanelAuthContext();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [managers, setManagers] = useState<ManagerRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    const [{ data: branchData }, { data: managerData }] = await Promise.all([
      client.from("branches").select("id, name").order("name"),
      client
        .from("users")
        .select("id, name, email, branch_id")
        .eq("role", "branch_manager")
        .eq("is_active", true),
    ]);
    setBranches(branchData ?? []);
    setManagers(managerData ?? []);
    setDataLoading(false);
  }, [client]);

  useEffect(() => {
    if (!loading && profile) {
      loadData();
    }
  }, [loading, profile, loadData]);

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  // comanager-logic §2 layer 1 (UI): disable adding a manager to a branch
  // that already has 2 active ones.
  const managerCountByBranch = managers.reduce<Record<string, number>>((acc, m) => {
    if (m.branch_id) acc[m.branch_id] = (acc[m.branch_id] ?? 0) + 1;
    return acc;
  }, {});
  const allBranchesAtCap =
    branches.length > 0 && branches.every((b) => (managerCountByBranch[b.id] ?? 0) >= 2);

  async function handleCreate(formData: FormData) {
    setSubmitting(true);
    setFormError(null);
    const result: CreateManagerResult = await createManager(formData);
    setSubmitting(false);

    if (result.error) {
      setFormError(result.error);
      return;
    }
    if (result.email) {
      setModalOpen(false);
      setCreatedEmail(result.email);
      await loadData();
    }
  }

  return (
    <main className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl">Managers</h1>
          <p className="text-sm text-ink/70">Up to 2 managers per branch.</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          disabled={allBranchesAtCap}
          title={allBranchesAtCap ? "Every branch already has 2 active managers" : undefined}
          className="rounded bg-green px-4 py-2 text-sm text-cream disabled:opacity-60"
        >
          + Add manager
        </button>
      </div>

      {dataLoading ? (
        <p className="mt-6 text-sm text-ink/60">Loading...</p>
      ) : (
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="text-left text-ink/60">
              <th className="pb-2">Name</th>
              <th className="pb-2">Branch</th>
              <th className="pb-2">Email</th>
              <th className="pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {managers.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="py-2">{m.name}</td>
                <td className="py-2">{branches.find((b) => b.id === m.branch_id)?.name ?? "—"}</td>
                <td className="py-2">{m.email}</td>
                <td className="py-2">
                  {/* Always ACTIVE — no invite/pending state exists (comanager-logic §2) */}
                  <span className="rounded-pill bg-success/16 px-2 py-1 font-mono text-xs uppercase text-success-ink">
                    Active
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-ink/40">
          <div className="w-full max-w-sm rounded-lg bg-card p-6">
            <h2 className="font-display text-lg">Add manager</h2>
            <form action={handleCreate} className="mt-4 flex flex-col gap-3">
              {formError && (
                <p className="rounded bg-red/16 p-2 text-sm text-red-ink">{formError}</p>
              )}
              <label className="flex flex-col gap-1 text-sm">
                Branch
                <select name="branchId" required className="rounded border p-2">
                  <option value="">Select a branch</option>
                  {branches.map((b) => {
                    const atCap = (managerCountByBranch[b.id] ?? 0) >= 2;
                    return (
                      <option key={b.id} value={b.id} disabled={atCap}>
                        {b.name}
                        {atCap ? " (2/2 managers)" : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Name
                <input name="name" required className="rounded border p-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Email
                <input type="email" name="email" required className="rounded border p-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Password
                {/* Owner sets this directly now (founder decision,
                    2026-07-29) — no auto-generated temp password, no
                    minimum length/complexity rule of our own. Deliberately
                    plain text, not masked: the owner has to relay this
                    exact password to the manager afterward, and a masked
                    typo here would bake in an unnoticed wrong password
                    (see BUG#020 for exactly this failure mode). */}
                <input type="text" name="password" required className="rounded border p-2" />
              </label>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded bg-green px-4 py-2 text-sm text-cream disabled:opacity-60"
                >
                  {submitting ? "Creating..." : "Create manager"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {createdEmail && (
        <div className="fixed inset-0 flex items-center justify-center bg-ink/40">
          <div className="w-full max-w-sm rounded-lg bg-card p-6">
            <h2 className="font-display text-lg">Manager created</h2>
            <p className="mt-2 text-sm text-ink/70">
              {createdEmail} can now log in with the password you set.
            </p>
            <button
              onClick={() => setCreatedEmail(null)}
              className="mt-4 w-full rounded bg-green py-2 text-sm text-cream"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
