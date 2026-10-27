import type { Metadata } from "next";
import { Newsreader, Hanken_Grotesk } from "next/font/google";

// MY NUVOS (Nuvos Consulting) — deliberately its own font pairing, distinct
// from the investing app's DM Sans/Inter (see app/layout.tsx): a serif
// display face for an "executive program" feel over a clean sans for UI,
// matching the approved design prototype (claude.ai/artifact/XyPsEnLiQCvJA6C4AetdUf).
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "My Nuvos — Nuvos Consulting",
  description: "Portal privado del Programa de Educación en Inversión",
};

// Scopes the navy/ivory/champagne palette as CSS custom properties under
// this route only — the root layout's --bg/--card/--accent tokens (the
// investing app's dark fintech theme) are left completely untouched.
const PALETTE: React.CSSProperties = {
  ["--c-navy" as string]: "#0E1E3A",
  ["--c-navy-2" as string]: "#16294C",
  ["--c-ivory" as string]: "#FAF7F1",
  ["--c-ivory-2" as string]: "#F2ECDF",
  ["--c-paper" as string]: "#FFFFFF",
  ["--c-champagne" as string]: "#C7A86B",
  ["--c-champagne-2" as string]: "#B3915A",
  ["--c-ink" as string]: "#16213C",
  ["--c-ink-soft" as string]: "#5B6477",
  ["--c-line" as string]: "rgba(14,30,58,0.12)",
  ["--c-line-strong" as string]: "rgba(14,30,58,0.22)",
  fontFamily: "var(--font-sans), system-ui, sans-serif",
  background: "var(--c-ivory)",
  minHeight: "100vh",
};

export default function ConsultingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${newsreader.variable} ${hanken.variable}`} style={PALETTE}>
      {children}
    </div>
  );
}
