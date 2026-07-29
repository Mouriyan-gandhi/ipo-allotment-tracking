import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "IPO Lock-in Tracker",
  description: "Lock-in expiry tracker for Indian Mainboard and SME IPOs",
};

/**
 * Runs before first paint so a light-mode user never sees a dark flash.
 * Falls back to the OS preference on first visit, then to dark.
 */
const NO_FLASH_THEME = `
try {
  var t = localStorage.getItem('ipo-theme');
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.dataset.theme = t;
} catch (e) {
  document.documentElement.dataset.theme = 'dark';
}
`.trim();

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
