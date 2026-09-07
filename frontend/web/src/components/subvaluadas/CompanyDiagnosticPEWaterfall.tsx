"use client";

// P/E waterfall — Fase 3 del plan en /Users/diegoarria/.claude/plans/
// dapper-scribbling-honey.md. Cascada visual (base sectorial + cada uno
// de los ajustes reales de fairPeBreakdown.adjustments) reemplazando el
// listado de texto plano que tenía antes la pestaña Valuación. Mismo
// patrón visual que el Artifact validado (segmentos flex simples, sin
// librería de charts, mismo espíritu que ValuationBacktestPanel.tsx que
// dibuja su propio SVG a mano) — extendido acá para manejar ajustes
// negativos reales (el Artifact solo tuvo ejemplos con META, donde los 6
// ajustes daban positivos), coloreando cada segmento por signo en vez de
// asumir que todos suman.
//
// El ancho de cada segmento es proporcional a |valor| sobre la suma de
// |base| + |cada ajuste| — no sobre el P/E justo final (que puede ser
// menor que esa suma cuando hay ajustes negativos de por medio). El
// número final mostrado (fairPe) siempre viene del dato real, nunca de
// sumar anchos de píxeles.

import type { ValuationScenarios } from "@/lib/types/companyDiagnostic";

export function CompanyDiagnosticPEWaterfall({
  breakdown, t,
}: {
  breakdown: NonNullable<ValuationScenarios["fairPeBreakdown"]>;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  const base = breakdown.base_multiple;
  if (base == null) return null;

  const segments = [
    { label: t("companyDiagnostic.fairPeBreakdown.baseMultiple"), value: base, kind: "base" as const, reason: `${base.toFixed(1)}x` },
    ...breakdown.adjustments.map((adj) => ({
      label: adj.factor, value: adj.points, kind: (adj.points >= 0 ? ("pos" as const) : ("neg" as const)), reason: adj.reason,
    })),
  ];
  const totalSpan = segments.reduce((sum, s) => sum + Math.abs(s.value), 0) || 1;

  return (
    <div>
      <div className="flex rounded-lg overflow-hidden" style={{ height: 30, background: "var(--card-2, var(--raised))" }}>
        {segments.map((s, i) => (
          <div
            key={i}
            title={s.reason}
            className="h-full shrink-0"
            style={{
              width: `${(Math.abs(s.value) / totalSpan) * 100}%`,
              background: s.kind === "base" ? "color-mix(in srgb, var(--muted) 45%, transparent)"
                : s.kind === "pos" ? "#4FA695" : "#DD6E63",
              borderRight: i < segments.length - 1 ? "1.5px solid var(--raised)" : "none",
            }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9.5px] font-bold mt-1" style={{ color: "var(--dim)" }}>
        <span>{base.toFixed(1)}x {t("companyDiagnostic.fairPeBreakdown.baseLabel")}</span>
        <span>{t("companyDiagnostic.fairPeBreakdown.adjustmentsLabel")}</span>
      </div>
      <div className="text-right mt-1">
        <span className="text-[15px] font-black" style={{ color: "#4FA695" }}>{breakdown.fair_pe.toFixed(1)}x</span>
      </div>
    </div>
  );
}
