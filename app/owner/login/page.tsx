"use client";

import Link from "next/link";
import { supabaseOwner } from "@/lib/supabase/client";
import { useLoginForm } from "@/lib/auth/use-login-form";
import { LoginFormView } from "@/components/auth/LoginFormView";

export default function OwnerLoginPage() {
  const { handleSubmit, ...formState } = useLoginForm(supabaseOwner, "owner", "/owner/dashboard");

  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <h1 className="font-display text-2xl">Owner login</h1>
      <div className="mt-8">
        <LoginFormView {...formState} onSubmit={handleSubmit} />
      </div>
      <p className="mt-4 text-sm">
        No account yet?{" "}
        <Link href="/owner/register" className="underline">
          Start your free trial
        </Link>
      </p>
    </main>
  );
}
