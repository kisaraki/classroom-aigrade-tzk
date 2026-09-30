import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "成績與學習建議",
  description: "查詢已發布的評量成績與學習建議。",
  robots: { index: false, follow: false, noarchive: true },
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
