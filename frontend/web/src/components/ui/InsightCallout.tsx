// Shared "why this matters to your decision" pattern (Diego, 2026-09-11:
// the app's core promise — "Nuvos me ayuda a tomar mejores decisiones con
// mi dinero" — held up inconsistently screen to screen because every
// place that DID connect a number to a decision (Oportunidades, Watchlist's
// empty state, Screener Semanal) wrote its own one-off copy instead of
// sharing a pattern. This is that pattern: real data in, one honest
// sentence connecting it to a decision the user can actually make — never
// a generic tip, never shown when there's nothing real to say (the caller
// is responsible for that; this component never fabricates a fallback).
import type { ReactNode } from "react";
import { Lightbulb, ArrowRight } from "lucide-react";

const GOLD = "#D4A24C";

export function InsightCallout({
  icon, title, body, cta, className = "",
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  cta?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 flex gap-3 ${className}`}
      style={{ borderColor: `${GOLD}40`, background: `${GOLD}0d` }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${GOLD}20` }}
      >
        {icon ?? <Lightbulb size={16} style={{ color: GOLD }} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold mb-1" style={{ color: "var(--text)" }}>{title}</p>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--sub)" }}>{body}</p>
        {cta && (
          <button
            onClick={cta.onClick}
            className="flex items-center gap-1 text-[12px] font-bold mt-2"
            style={{ color: GOLD }}
          >
            {cta.label} <ArrowRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
