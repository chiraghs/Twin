import type { Metadata, Viewport } from "next";
// Fonts are self-hosted from open-source packages (OFL): no request to a font CDN.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { mobileNoticeBootScript } from "@/components/shell/mobile-boot";
import { themeBootScript } from "@/components/theme-boot";

export const metadata: Metadata = {
  title: "Twin AI — Agentic Industrial Digital Twin",
  description:
    "Create your factory's digital twin. Let AI understand its operations, predict what could go wrong, simulate better decisions, and act before losses happen.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070b14" },
    { media: "(prefers-color-scheme: light)", color: "#f3f5f9" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript + mobileNoticeBootScript }} />
      </head>
      <body className="min-h-screen bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
