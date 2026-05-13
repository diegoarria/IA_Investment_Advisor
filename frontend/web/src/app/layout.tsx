import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IA Investment Advisor",
  description: "Tu mentor de inversiones inteligente — aprende a pensar como un inversionista profesional",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
