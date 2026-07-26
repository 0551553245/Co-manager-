import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Co Manager",
  description: "Restaurant operations SaaS for the Saudi Arabian market.",
};

// Bilingual (Arabic/English) + RTL support is required everywhere per
// comanager-context, but lang/dir switching is app logic, not scaffolding —
// left as "en"/ltr here until the actual locale handling is built.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-cream text-ink font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
