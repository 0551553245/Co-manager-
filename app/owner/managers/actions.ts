"use server";

import { supabaseOwnerServer } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateTempPassword } from "@/lib/auth/generate-temp-password";

export interface CreateManagerResult {
  error?: string;
  email?: string;
  tempPassword?: string;
}

// comanager-auth direct-create flow, adapted to run server-side (see
// comanager-bug-log BUG#002 note): generate temp password → create the
// auth user with the email pre-confirmed → the existing handle_new_user
// trigger upserts public.users from the metadata → assign the branch →
// hand back credentials for the one-time modal.
export async function createManager(formData: FormData): Promise<CreateManagerResult> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const branchId = String(formData.get("branchId") ?? "").trim();

  if (!name || !email || !branchId) {
    return { error: "Please fill in all fields." };
  }

  const owner = supabaseOwnerServer();

  // RLS on `branches` ("owner manages own branches") only returns a row if
  // owner_id = auth.uid() — this is both the auth check AND the ownership
  // check in one query, no separate manual comparison needed.
  const { data: branch, error: branchError } = await owner
    .from("branches")
    .select("id")
    .eq("id", branchId)
    .single();

  if (branchError || !branch) {
    return { error: "Branch not found." };
  }

  // App-level cap pre-check — layer 2 of 3 (comanager-logic §2). The
  // database trigger (enforce_manager_cap, comanager-schema.sql) is layer 3
  // and the one that actually matters; this is a fast, clean-error fast
  // path for the normal (non-racing) case.
  const { count, error: countError } = await owner
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", branchId)
    .eq("role", "branch_manager")
    .eq("is_active", true);

  if (countError) {
    return { error: "Could not verify manager count. Please try again." };
  }
  if ((count ?? 0) >= 2) {
    return { error: "This branch already has 2 active managers." };
  }

  const tempPassword = generateTempPassword();
  const admin = createServiceRoleClient();

  // admin.createUser with email_confirm:true — deliberately not a public
  // signUp() call. Managers get handed a password directly and must be
  // able to log in immediately (comanager-auth: no invite flow); a public
  // signUp() would trigger Supabase's project-wide email-confirmation
  // requirement (needed for owner registration) and block the manager's
  // first login on a confirmation email they never see.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      role: "branch_manager",
      name,
      branch_id: branchId,
    },
  });

  if (createError || !created.user) {
    return { error: createError?.message ?? "Could not create the manager account." };
  }

  const { error: branchUpdateError } = await owner
    .from("branches")
    .update({ manager_id: created.user.id })
    .eq("id", branchId);

  if (branchUpdateError) {
    console.error("Failed to set branches.manager_id:", branchUpdateError);
    return {
      error: "Manager account created, but assigning it to the branch failed. Please try again.",
    };
  }

  return { email, tempPassword };
}
