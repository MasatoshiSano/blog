import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Tech Blog",
    template: "%s | Tech Blog",
  },
  description: "フロントエンド、バックエンド、インフラのテクノロジーブログ",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="flex min-h-screen flex-col bg-white text-gray-900">
        <Header />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
