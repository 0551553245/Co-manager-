// Restaurant Owner panel — /owner/login, /register, /dashboard, /branches,
// /tasks, /food-safety, /schedule, /reports, /managers, /settings. Scoped
// to the owner's own branches only (comanager-context §Permission Model).
// Plain folder (not a route group) so the URL keeps its /owner prefix.
//
// Authenticated, per-user content — never statically prerendered. Without
// this, `next build` tries to prerender pages that call createBrowserClient
// at render time and fails when NEXT_PUBLIC_SUPABASE_* env vars aren't set
// at build time (normal before a real Supabase project is wired up).
export const dynamic = "force-dynamic";

export default function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
