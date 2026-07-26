"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROFILE_COLUMNS, type Profile, type UserRole } from "./types";

// BUG #001 (comanager-bug-log): never redirect to login sooner than this —
// shorter timeouts falsely log people out on slow connections.
const SESSION_CHECK_TIMEOUT_MS = 8000;

// Protects a panel's authenticated pages: waits for a session, fetches the
// full profile (comanager-auth: the auth context must expose the full
// profile, including branch_id, not just user + signOut), and verifies
// role + is_active — matching the same checks comanager-auth requires at
// login, re-applied here so a deactivated/wrong-role session doesn't keep
// working between page loads.
export function usePanelAuth(
  createClient: () => SupabaseClient,
  expectedRole: UserRole,
  loginPath: string,
) {
  const client = useMemo(createClient, [createClient]);
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let settled = false;

    const bail = () => {
      if (settled) return;
      settled = true;
      router.push(loginPath);
    };

    const timeout = setTimeout(bail, SESSION_CHECK_TIMEOUT_MS);

    (async () => {
      const { data: sessionData } = await client.auth.getSession();
      if (settled) return;

      if (!sessionData.session) {
        clearTimeout(timeout);
        bail();
        return;
      }

      const { data: profileData, error } = await client
        .from("users")
        .select(PROFILE_COLUMNS)
        .eq("id", sessionData.session.user.id)
        .single();

      if (settled) return;
      clearTimeout(timeout);

      if (error || !profileData || profileData.role !== expectedRole || !profileData.is_active) {
        settled = true;
        await client.auth.signOut(); // only this panel's client — never all three
        router.push(loginPath);
        return;
      }

      settled = true;
      setProfile(profileData as Profile);
      setLoading(false);
    })();

    return () => {
      settled = true;
      clearTimeout(timeout);
    };
  }, [client, expectedRole, loginPath, router]);

  return { loading, profile, client };
}
