"use client";

import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

interface LogoutButtonProps {
  client: SupabaseClient;
  loginPath: string;
}

// Signs out only the client instance passed in. Never call this with more
// than one panel's client, and never wire it up to sign out all three at
// once — comanager-auth: "each panel signs out only its own client. Never
// call signOut on all three at once — that logs people out of panels they
// weren't even using."
export function LogoutButton({ client, loginPath }: LogoutButtonProps) {
  const router = useRouter();

  async function handleLogout() {
    await client.auth.signOut();
    router.push(loginPath);
    router.refresh();
  }

  return (
    <button onClick={handleLogout} className="rounded border px-4 py-2 text-sm">
      Log out
    </button>
  );
}
