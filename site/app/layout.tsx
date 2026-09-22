import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "學生成績與 AI 學習建議｜環境預覽",
  description: "classroom-aigrade-tzk Phase 0 基礎環境預覽，尚未開放成績查詢。",
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
