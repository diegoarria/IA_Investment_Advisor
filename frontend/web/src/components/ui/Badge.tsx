// Fase 4, Incremento 1 — shared UI primitives.

import type { ReactNode } from "react";

const TONE_COLOR: Record<"neutral" | "positive" | "negative" | "warning" | "accent", string> = {
  neutral: "var(--muted)",
  positive: "#22c55e",
  negative: "#ef4444",
  warning: "#f59e0b",
  accent: "var(--accent-l)",
};

export function Badge({
  children, tone = "neutral", className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warning" | "accent";
  className?: string;
}) {
  const color = TONE_COLOR[tone];
  return (
    <span
      className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${className}`}
      style={{ color, background: `${color}1a` }}
    >
      {children}
    </span>
  );
}

/** A real 0-100 score rendered with the app's established green/yellow/
 * orange/red thresholds (>=80/>=60/>=40/below) — same thresholds
 * `nifScoreColor` uses in components/subvaluadas/shared.tsx, promoted here
 * so every new Fase 4 score display shares one color scale. */
export function scoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return "var(--muted)";
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#eab308";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

export function ScorePill({ score, size = "sm" }: { score: number | null | undefined; size?: "sm" | "md" }) {
  const color = scoreColor(score);
  const textClass = size === "md" ? "text-base" : "text-[11px]";
  return (
    <span className={`${textClass} font-black tabular-nums`} style={{ color }}>
      {score !== null && score !== undefined ? score : "N/D"}
    </span>
  );
}
