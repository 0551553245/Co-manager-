"use client";

import { supabaseOwner } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { OwnerSidebar } from "@/components/owner/OwnerSidebar";

// Wraps every authenticated owner page (dashboard, branches, tasks,
// food-safety, schedule, reports, managers, settings) with a shared
// sidebar — a route group so /owner/login and /owner/register (public,
// pre-auth) stay outside it without changing any URL.
export default function AuthenticatedOwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, client } = usePanelAuth(supabaseOwner, "owner", "/owner/login");

  return (
    <div className="flex min-h-screen">
      <OwnerSidebar profile={profile} client={client} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
