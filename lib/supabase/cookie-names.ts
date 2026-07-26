// Shared between client.ts and server.ts so the browser and server clients
// for the same panel always agree on the cookie name — if these ever drift
// apart, sessions silently fail to sync between client and server.
export const SUPABASE_COOKIE_NAMES = {
  branchManager: "sb-branch-manager-auth",
  owner: "sb-owner-auth",
  admin: "sb-admin-auth",
} as const;
