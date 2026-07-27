"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseOwner } from "@/lib/supabase/client";

// comanager-logic §1: email verification happens once, at signup only —
// this page is that one-time confirmation step. Only owners self-register
// via email, so it always establishes an owner-panel session.
//
// MUST be a Client Component, not a Route Handler. Supabase's hosted
// verify endpoint (what the default "Confirm signup" template's
// {{ .ConfirmationURL }} points to) redirects here with the session in a
// URL HASH FRAGMENT — #access_token=...&refresh_token=...&type=signup —
// confirmed by following the actual redirect chain. Fragments are never
// sent to the server at all (the browser strips them before the request
// leaves the client), so a server-side route can never see them, no
// matter how it's written. A `code` query param (PKCE-style exchange) or
// `token_hash`+`type` (only if the email template is manually customized
// to link with those instead) are handled here too, for the same reason:
// only client-side code can see all three possible formats in one place.
export default function AuthConfirmPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const client = supabaseOwner();
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const searchParams = new URLSearchParams(window.location.search);

      const hashError = hashParams.get("error_description");
      if (hashError) {
        setError(hashError);
        router.push("/owner/register?error=confirmation_failed");
        return;
      }

      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const code = searchParams.get("code");
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type") as EmailOtpType | null;

      let confirmError: string | null;
      if (accessToken && refreshToken) {
        const { error } = await client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        confirmError = error?.message ?? null;
      } else if (code) {
        const { error } = await client.auth.exchangeCodeForSession(code);
        confirmError = error?.message ?? null;
      } else if (tokenHash && type) {
        const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
        confirmError = error?.message ?? null;
      } else {
        confirmError = "No confirmation token found in the URL.";
      }

      if (confirmError) {
        setError(confirmError);
        router.push("/owner/register?error=confirmation_failed");
        return;
      }

      router.push("/owner/dashboard");
    })();
  }, [router]);

  return (
    <main className="p-8 text-center text-sm text-ink/60">
      {error ? `Confirmation failed: ${error}` : "Confirming your account..."}
    </main>
  );
}
