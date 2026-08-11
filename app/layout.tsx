import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "任务看板",
  description: "个人需求、BUG 与客服任务看板",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
