// Public marketing site: "/", "/pricing", "/faq", etc.
// A route group (parens = not part of the URL) — kept SEO-friendly and
// server-rendered, separate from the three authenticated panels below.
// Routes: see comanager-context routing table.
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
