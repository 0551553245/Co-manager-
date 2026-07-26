"use client";

import { supabaseOwner } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { LogoutButton } from "@/components/auth/LogoutButton";

// Placeholder only — proves login/logout works end-to-end. The real
// dashboard (live stats, daily progress, recent activity feed) is
// comanager-design-match's Owner Dashboard screen, a later phase.
export default function OwnerDashboardPage() {
  const { loading, profile, client } = usePanelAuth(supabaseOwner, "owner", "/owner/login");

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  return (
    <main className="p-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">Welcome, {profile.name}</h1>
        <LogoutButton client={client} loginPath="/owner/login" />
      </div>
      <p className="mt-2 text-sm text-ink/70">
        {profile.restaurant_name ?? "Your restaurant"} — placeholder dashboard.
      </p>
    </main>
  );
}
