// Branch Manager panel — /branch-manager/login, /dashboard, /tasks,
// /food-safety, /schedule, /profile. Scoped to the manager's own branch_id
// only (comanager-context §Permission Model). Plain folder (not a route
// group) so the URL keeps its /branch-manager prefix.
export default function BranchManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
