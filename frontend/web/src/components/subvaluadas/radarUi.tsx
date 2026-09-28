"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// Nuvos Radar visual system — web twin of mobile's GlowCard / RingGauge /
// DiagRaisedBlock / DiagEyebrow / DiagIconDot (frontend/mobile/src/
// components/subvaluadas/companyDiagnosticShared.tsx). Diego, 2026-09-27:
// "igualito para web app, sin ninguna diferencia" — same radii, gradients,
// sizes and colors as the mobile redesign.

export const GOLD = "#D4A24C";
export const GOLD_LIGHT = "#F5C76B";

// Diagonal gradient from a faint tint of `tint` (or a white sheen) into the
// card color, hairline border, 24px radius, 20px padding.
export function GlowCard({
  children, tint, strong, className = "", style,
}: { children: ReactNode; tint?: string; strong?: boolean; className?: string; style?: CSSProperties }) {
  const from = tint ? `${tint}${strong ? "40" : "1c"}` : "rgba(255,255,255,0.05)";
  return (
    <div
      className={`rounded-3xl overflow-hidden p-5 ${className}`}
      style={{
        background: `linear-gradient(135deg, ${from} 0%, var(--card) 70%)`,
        border: `1px solid ${tint ? `${tint}${strong ? "66" : "33"}` : "var(--border)"}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Circular 0-100 gauge with a two-stop gradient stroke; children render in
// the center (the score + /100).
export function RingGauge({
  score, size = 112, stroke = 10, from = GOLD_LIGHT, to = GOLD, track = "rgba(127,127,127,0.18)", children,
}: { score: number; size?: number; stroke?: number; from?: string; to?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const id = `ring-${from}-${to}-${size}`.replace(/[^a-zA-Z0-9-]/g, "");
  return (
    <div className="relative flex flex-col items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={`url(#${id})`} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="relative flex flex-col items-center">{children}</div>
    </div>
  );
}

// Metric tile inside the diagnostic tabs: faint tint → raised surface.
export function RaisedTile({
  children, tint, className = "", style,
}: { children: ReactNode; tint?: string; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`rounded-2xl p-3.5 ${className}`}
      style={{
        background: `linear-gradient(135deg, ${tint ? `${tint}1f` : "rgba(255,255,255,0.05)"} 0%, var(--raised) 75%)`,
        border: `1px solid ${tint ? `${tint}33` : "var(--border)"}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Small uppercase section label.
export function Eyebrow({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <p className="text-[11px] font-black uppercase tracking-[0.8px] mb-2.5" style={{ color: color ?? "var(--muted)" }}>
      {children}
    </p>
  );
}

// Icon in a tinted circle.
export function IconDot({ children, color, size = 30 }: { children: ReactNode; color: string; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0"
      style={{ width: size, height: size, background: `${color}24`, color }}
    >
      {children}
    </div>
  );
}

// Icon in a tinted rounded square — card/section header marker.
export function IconSquare({ children, color, size = 38 }: { children: ReactNode; color?: string; size?: number }) {
  return (
    <div
      className="flex items-center justify-center shrink-0"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.32), background: color ? `${color}1f` : "var(--raised)" }}
    >
      {children}
    </div>
  );
}

// Pillar section inside the diagnostic tabs card — flat header (icon in a
// tinted square, 16px title, score + chevron) and body, no nested card.
// Local to Nuvos Radar: the shared ui/ExpandableSection is used by other
// pages and keeps its own look.
export function PillarSection({
  title, icon, iconColor, headline, children,
}: { title: string; icon: ReactNode; iconColor: string; headline?: ReactNode; children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <button onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} className="w-full flex items-center justify-between gap-2.5 pb-3.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <IconSquare color={iconColor} size={34}>{icon}</IconSquare>
          <span className="text-base font-extrabold tracking-tight truncate" style={{ color: "var(--text)" }}>{title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {headline}
          {expanded
            ? <ChevronUp className="w-4 h-4" style={{ color: "var(--muted)" }} />
            : <ChevronDown className="w-4 h-4" style={{ color: "var(--muted)" }} />}
        </div>
      </button>
      {expanded && <div className="space-y-3.5">{children}</div>}
    </div>
  );
}

// Tinted gradient sub-card with an icon header (Calidad's blocks).
export function TintSubCard({ icon, title, tint, children }: { icon: ReactNode; title: string; tint: string; children: ReactNode }) {
  return (
    <div className="rounded-[20px] p-4" style={{ background: `linear-gradient(135deg, ${tint}1a, var(--raised) 75%)`, border: `1px solid ${tint}33` }}>
      <div className="flex items-center gap-2.5 mb-3.5">
        <IconSquare color={tint} size={34}>{icon}</IconSquare>
        <p className="flex-1 text-[15px] font-extrabold tracking-tight truncate" style={{ color: "var(--text)" }}>{title}</p>
      </div>
      {children}
    </div>
  );
}
