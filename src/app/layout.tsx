import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-dv-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "SafeFare AI",
    template: "%s · SafeFare AI",
  },
  description: "SafeFare AI — AI-powered fleet intelligence and driver safety (demo with sample data).",
};

export const viewport: Viewport = {
  themeColor: "#f0eff5",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
