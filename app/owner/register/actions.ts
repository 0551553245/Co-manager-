"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseOwnerServer } from "@/lib/supabase/server";
import { createServiceRoleClient, type ServiceRoleClient } from "@/lib/supabase/service-role";

export interface RegisterState {
  error?: string;
}

// handle_new_user (comanager-schema.sql) creates the matching public.users
// row inside the same trigger chain as the auth.users insert, so by the
// time signUp() resolves it should already be visible — but a live
// registration hit a subscriptions_owner_id_fkey violation immediately
// after a successful signUp(), meaning that row wasn't visible yet to this
// query. Root cause unconfirmed (a clean-room reproduction succeeded, no
// orphaned auth.users rows were found) — this polls defensively rather
// than assuming it was a one-off, since handle_new_user's blanket
// exception handler (comanager-bug-log BUG #015) could also silently
// swallow a real failure here, not just the manager-cap case it was
// originally flagged for. See BUG #018.
async function waitForUserProfile(
  admin: ServiceRoleClient,
  userId: string,
  attempts = 5,
  delayMs = 200,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const { data } = await admin.from("users").select("id").eq("id", userId).maybeSingle();
    if (data) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

// comanager-logic §1: restaurant name, owner name, email, phone, branch
// count. No card required — 14-day free trial starts immediately at
// signup, independent of email confirmation (which only gates *reaching
// the dashboard*, not the trial clock — see comanager-logic §1).
//
// Password + confirmPassword aren't listed in comanager-logic's field list
// (an apparent oversight there — comanager-auth's login flow requires
// signInWithPassword, which needs a password to exist). Added here as the
// obvious necessary field; comanager-logic should be updated to list it.
export async function registerOwner(
  _prevState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const restaurantName = String(formData.get("restaurantName") ?? "").trim();
  const restaurantNameAr = String(formData.get("restaurantNameAr") ?? "").trim();
  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const branchCount = Number(formData.get("branchCount"));

  if (!restaurantName || !ownerName || !email || !phone) {
    return { error: "Please fill in all required fields." };
  }
  if (!Number.isInteger(branchCount) || branchCount < 1) {
    return { error: "Branch count must be at least 1." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  // With emailRedirectTo set, Supabase's default "Confirm signup" template
  // (still using {{ .ConfirmationURL }}, unedited) redirects here with the
  // session in a URL hash fragment (#access_token=...&refresh_token=...) —
  // confirmed by following the actual redirect chain. That's why
  // app/auth/confirm is a Client Component page, not a server route:
  // fragments never reach the server at all.
  const headersList = headers();
  const origin =
    headersList.get("origin") ??
    `${headersList.get("x-forwarded-proto") ?? "http"}://${headersList.get("host")}`;

  const supabase = supabaseOwnerServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm`,
      data: {
        role: "owner",
        name: ownerName,
        restaurant_name: restaurantName,
        restaurant_name_ar: restaurantNameAr || null,
        phone,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }
  if (!data.user) {
    return { error: "Something went wrong creating your account. Please try again." };
  }

  // No RLS policy lets an owner insert their own subscriptions row (and no
  // session exists yet pre-confirmation anyway), so this runs privileged,
  // server-side, right after signup completes.
  const admin = createServiceRoleClient();

  const profileReady = await waitForUserProfile(admin, data.user.id);
  if (!profileReady) {
    console.error(
      `handle_new_user never created a public.users row for ${data.user.id} after 5 retries — likely a silently swallowed trigger exception, see BUG #018.`,
    );
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: "Something went wrong creating your account. Please try again." };
  }

  const { error: subscriptionError } = await admin.from("subscriptions").insert({
    owner_id: data.user.id,
    status: "trialing",
    branches_count: branchCount,
    price_per_branch_sar: 50,
  });

  if (subscriptionError) {
    console.error("Failed to create trial subscription row:", subscriptionError);
    // An owner with no subscription row is broken state, not a usable
    // account — roll back rather than leave it half-created.
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: "Something went wrong setting up your trial. Please try again." };
  }

  redirect("/owner/register/check-email");
}
