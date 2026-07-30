"use client";

import { supabaseOwner } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { PanelAuthProvider } from "@/lib/auth/panel-auth-context";
import { OwnerSidebar } from "@/components/owner/OwnerSidebar";

// Wraps every authenticated owner page (dashboard, branches, tasks,
// food-safety, schedule, reports, managers, settings) with a shared
// sidebar — a route group so /owner/login and /owner/register (public,
// pre-auth) stay outside it without changing any URL.
//
// usePanelAuth runs exactly once here per session, not once per page —
// every page below reads the result via PanelAuthProvider/
// usePanelAuthContext instead of calling usePanelAuth itself (see
// panel-auth-context.tsx).
export default function AuthenticatedOwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = usePanelAuth(supabaseOwner, "owner", "/owner/login");

  return (
    <div className="flex min-h-screen">
      <OwnerSidebar profile={auth.profile} client={auth.client} />
      <div className="min-w-0 flex-1">
        <PanelAuthProvider value={auth}>{children}</PanelAuthProvider>
      </div>
    </div>
  );
}
