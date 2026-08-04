import type { ReactNode } from "react";

export function ReportSection({
  title,
  supportingText,
  children,
}: {
  title: string;
  supportingText: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl">{title}</h2>
      <p className="mt-1 text-sm text-ink/60">{supportingText}</p>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}
