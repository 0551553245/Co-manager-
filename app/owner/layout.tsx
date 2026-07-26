// Restaurant Owner panel — /owner/login, /register, /dashboard, /branches,
// /tasks, /food-safety, /schedule, /reports, /managers, /settings. Scoped
// to the owner's own branches only (comanager-context §Permission Model).
// Plain folder (not a route group) so the URL keeps its /owner prefix.
export default function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
