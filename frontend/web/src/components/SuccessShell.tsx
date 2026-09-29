"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// Shared layout for the post-payment screens (/premium-success,
// /upsell-success) — redesign 2026-09-28, same brand language as the
// Products page: centered card, emerald (or indigo/amber) gradient hero,
// theme-aware body.
export function SuccessShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 relative overflow-hidden" style={{ background: "var(--bg)" }}>
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[640px] h-[640px] rounded-full"
           style={{ background: "radial-gradient(circle, rgba(0,185,109,0.16), transparent 65%)" }} />
      <div className="relative w-full max-w-[460px] rounded-[28px] border overflow-hidden animate-fade-in-up"
           style={{ background: "var(--card)", borderColor: "rgba(0,212,126,0.3)", boxShadow: "0 30px 70px -30px rgba(0,185,109,0.5)" }}>
        {children}
      </div>
    </main>
  );
}

const TONES = {
  emerald: { bg: "linear-gradient(135deg, #0F3326 0%, #0A1C1D 55%, #080E16 100%)", glow: "rgba(0,232,135,0.24)", badge: "#00D47E", badgeFg: "#06120D", eyebrow: "#00D47E" },
  indigo:  { bg: "linear-gradient(135deg, #1E2256 0%, #11142E 55%, #0A0C1C 100%)", glow: "rgba(129,140,248,0.26)", badge: "#818CF8", badgeFg: "#0B0E22", eyebrow: "#A5B4FC" },
  amber:   { bg: "linear-gradient(135deg, #3A2A0C 0%, #1C150A 55%, #0E0B07 100%)", glow: "rgba(245,158,11,0.24)", badge: "#F59E0B", badgeFg: "#1a1003", eyebrow: "#FBBF24" },
  red:     { bg: "linear-gradient(135deg, #3A1212 0%, #1E0C0C 55%, #0F0808 100%)", glow: "rgba(248,113,113,0.22)", badge: "#F87171", badgeFg: "#1f0707", eyebrow: "#FCA5A5" },
} as const;

export function SuccessHero({ icon: Icon, eyebrow, title, subtitle, tagline, tone = "emerald" }: {
  icon: LucideIcon; eyebrow?: string; title: string; subtitle?: string; tagline?: string; tone?: keyof typeof TONES;
}) {
  const c = TONES[tone];
  return (
    <div className="relative overflow-hidden px-6 pt-9 pb-8 text-center" style={{ background: c.bg }}>
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full" style={{ background: `radial-gradient(circle, ${c.glow}, transparent 70%)` }} />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 -left-16 w-64 h-64 rounded-full" style={{ background: `radial-gradient(circle, ${c.glow}, transparent 70%)`, opacity: 0.6 }} />
      <div className="relative mx-auto w-[84px] h-[84px] rounded-full flex items-center justify-center" style={{ background: `${c.badge}26` }}>
        <span className="absolute inset-0 rounded-full animate-ping" style={{ background: `${c.badge}1f`, animationDuration: "2.4s" }} />
        <span className="relative w-16 h-16 rounded-full flex items-center justify-center" style={{ background: c.badge, boxShadow: `0 10px 30px -8px ${c.badge}` }}>
          <Icon className="w-8 h-8" style={{ color: c.badgeFg }} strokeWidth={2.6} />
        </span>
      </div>
      {eyebrow && (
        <p className="relative mt-5 text-[11px] font-extrabold uppercase tracking-[1.4px]" style={{ color: c.eyebrow }}>{eyebrow}</p>
      )}
      <h1 className={`relative ${eyebrow ? "mt-1.5" : "mt-5"} text-[26px] font-extrabold tracking-[-0.6px] leading-tight text-white`}>{title}</h1>
      {subtitle && <p className="relative mt-2 text-[14.5px] leading-relaxed" style={{ color: "rgba(255,255,255,0.72)" }}>{subtitle}</p>}
      {tagline && <p className="relative mt-3 text-[13px] font-semibold" style={{ color: c.eyebrow }}>{tagline}</p>}
    </div>
  );
}
