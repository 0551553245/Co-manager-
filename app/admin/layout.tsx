// Super Admin panel — /admin/login (unlisted, never linked publicly),
// /dashboard, /restaurants, /subscriptions, /analytics, /settings.
// No data restrictions (comanager-context §Permission Model). Plain folder
// (not a route group) so the URL keeps its /admin prefix.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
