import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { supabaseOwnerServer } from "@/lib/supabase/server";

// comanager-logic §1: email verification happens once, at signup only —
// this route is that one-time confirmation step. Only owners self-register
// via email (managers/admins never get here), so it always establishes an
// owner-panel session.
//
// REQUIRES a manual Supabase dashboard change: the "Confirm signup" email
// template must link here instead of the default ConfirmationURL —
// {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup
// This is an Authentication → Email Templates setting in the Supabase
// project dashboard; it cannot be configured from this codebase.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (token_hash && type) {
    const supabase = supabaseOwnerServer();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) {
      redirect("/owner/dashboard");
    }
  }

  redirect("/owner/register?error=confirmation_failed");
}
