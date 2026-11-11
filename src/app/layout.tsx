import type { Metadata, Viewport } from "next";
// Plus Jakarta Sans is self-hosted from @fontsource-variable (weights 200–800). It replaces
// next/font/google, whose Turbopack loader failed to resolve. See docs/plus-jakarta-sans-font-fix-report.md.
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SafeFare AI",
    template: "%s · SafeFare AI",
  },
  description: "SafeFare AI — AI-powered fleet intelligence and driver safety.",
};

export const viewport: Viewport = {
  themeColor: "#f7f8fc",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
