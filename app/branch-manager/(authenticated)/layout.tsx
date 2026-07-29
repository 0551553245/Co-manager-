"use client";

import { supabaseBranchManager } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { BranchManagerSidebar } from "@/components/branch-manager/BranchManagerSidebar";

// Wraps every authenticated branch-manager page (dashboard, tasks,
// food-safety, schedule) with a shared sidebar — a route group so
// /branch-manager/login (public, pre-auth) stays outside it without
// changing any URL. Mirrors app/owner/(authenticated)/layout.tsx exactly.
export default function AuthenticatedBranchManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, client } = usePanelAuth(
    supabaseBranchManager,
    "branch_manager",
    "/branch-manager/login",
  );

  return (
    <div className="flex min-h-screen">
      <BranchManagerSidebar profile={profile} client={client} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
