"use client";

import { supabaseBranchManager } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { PanelAuthProvider } from "@/lib/auth/panel-auth-context";
import { BranchManagerSidebar } from "@/components/branch-manager/BranchManagerSidebar";

// Wraps every authenticated branch-manager page (dashboard, tasks,
// food-safety, schedule) with a shared sidebar — a route group so
// /branch-manager/login (public, pre-auth) stays outside it without
// changing any URL. Mirrors app/owner/(authenticated)/layout.tsx exactly.
//
// usePanelAuth runs exactly once here per session, not once per page —
// every page below reads the result via PanelAuthProvider/
// usePanelAuthContext instead of calling usePanelAuth itself (see
// panel-auth-context.tsx).
export default function AuthenticatedBranchManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = usePanelAuth(supabaseBranchManager, "branch_manager", "/branch-manager/login");

  return (
    <div className="flex min-h-screen">
      <BranchManagerSidebar profile={auth.profile} client={auth.client} />
      <div className="min-w-0 flex-1">
        <PanelAuthProvider value={auth}>{children}</PanelAuthProvider>
      </div>
    </div>
  );
}
