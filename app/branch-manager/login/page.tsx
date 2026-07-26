"use client";

import { supabaseBranchManager } from "@/lib/supabase/client";
import { useLoginForm } from "@/lib/auth/use-login-form";
import { LoginFormView } from "@/components/auth/LoginFormView";

// No self-registration or "forgot password" link here — comanager-auth:
// managers are created directly by their owner (no invite flow), who hands
// off credentials in person. There is no manager-facing signup path.
export default function BranchManagerLoginPage() {
  const { handleSubmit, ...formState } = useLoginForm(
    supabaseBranchManager,
    "branch_manager",
    "/branch-manager/dashboard",
  );

  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <h1 className="font-display text-2xl">Branch manager login</h1>
      <div className="mt-8">
        <LoginFormView {...formState} onSubmit={handleSubmit} />
      </div>
    </main>
  );
}
