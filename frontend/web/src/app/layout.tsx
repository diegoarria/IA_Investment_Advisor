import type { Metadata } from "next";
import { DM_Sans, Inter } from "next/font/google";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";
import NuvosGuide from "@/components/NuvosGuide";
import UpsellProvider from "@/components/UpsellProvider";
import FeedbackBanner from "@/components/FeedbackBanner";
import PostHogProvider from "@/components/PostHogProvider";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nuvos AI — Tu mentor de inversiones",
  description: "Aprende a pensar como un inversor profesional",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon-192.png", sizes: "192x192" },
    ],
    apple: "/logo.png",
    shortcut: "/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning className={`${dmSans.variable} ${inter.variable}`}>
      <body className="antialiased">
        <PostHogProvider>
          <ThemeProvider>
            {children}
            <NuvosGuide />
            <UpsellProvider />
            <FeedbackBanner />
          </ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
