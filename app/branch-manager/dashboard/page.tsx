"use client";

import { supabaseBranchManager } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { LogoutButton } from "@/components/auth/LogoutButton";

// Placeholder only — proves login/logout works end-to-end. The real
// dashboard ("Today's tasks", food safety ring, next event) is
// comanager-design-match's Branch Manager Dashboard screen, a later phase.
export default function BranchManagerDashboardPage() {
  const { loading, profile, client } = usePanelAuth(
    supabaseBranchManager,
    "branch_manager",
    "/branch-manager/login",
  );

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  return (
    <main className="p-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">Good shift, {profile.name}</h1>
        <LogoutButton client={client} loginPath="/branch-manager/login" />
      </div>
      <p className="mt-2 text-sm text-ink/70">Placeholder dashboard.</p>
    </main>
  );
}
