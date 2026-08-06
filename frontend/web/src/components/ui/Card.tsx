// Fase 4, Incremento 1 — shared UI primitives (see /Users/diegoarria/.claude/
// plans/stateful-painting-flurry.md). Every page today reinvents its own
// `<div style={{ background: "var(--card)", border: "1px solid var(--border)" }}>`
// card markup inline — this is the one place that pattern lives, so new
// Fase 4 surfaces don't add a fourth/fifth copy of it.
//
// Pure presentation, no data-fetching, no financial logic — same rule as
// every component in components/subvaluadas/shared.tsx.

import type { ReactNode, CSSProperties } from "react";

export function Card({
  children, className = "", style, padding = "p-3.5",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Tailwind padding utility — most cards use p-3.5 (subvaluadas' own
   * convention); pass "" to opt out when a child needs to own its own
   * padding (e.g. a card whose header and body have different insets). */
  padding?: string;
}) {
  return (
    <div
      className={`rounded-2xl border ${padding} ${className}`}
      style={{ borderColor: "var(--border)", background: "var(--card)", ...style }}
    >
      {children}
    </div>
  );
}

/** A slightly recessed inner block (nested inside a Card) — the "raised"
 * surface used throughout shared.tsx for factor rows / sub-sections. */
export function RaisedBlock({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`rounded-lg p-2 ${className}`} style={{ background: "var(--raised)", ...style }}>
      {children}
    </div>
  );
}
