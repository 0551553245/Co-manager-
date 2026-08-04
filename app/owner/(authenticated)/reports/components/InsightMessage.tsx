export function InsightMessage({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="mt-2 text-sm text-ink/70">{text}</p>;
}
