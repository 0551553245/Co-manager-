import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ServiceRoleClient = SupabaseClient;

// Full admin access — bypasses Postgres RLS entirely via the service_role
// key. This is NOT the same thing as `supabaseAdmin` in client.ts/server.ts
// (that's the Super Admin PANEL's client, authenticated as a real user and
// still subject to RLS). This client has no user session at all and no RLS
// checks apply to anything it does — never import it into a Client
// Component, never let SUPABASE_SERVICE_ROLE_KEY reach the browser.
//
// Reserved for privileged server-side operations a normal user's RLS
// permissions can't cover: owner-creates-manager (needs auth.admin.createUser),
// and creating the trial subscriptions row at signup (no session/RLS policy
// exists for the owner to do this themselves before email confirmation).
export function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
