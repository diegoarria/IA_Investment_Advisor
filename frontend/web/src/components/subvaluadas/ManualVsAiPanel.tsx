"use client";

// Fase 4, Incremento 7 — Manual vs. IA (Parte G). Side-by-side comparison
// of the user's own DCF assumptions (the sliders already on this page)
// against Nuvos's own suggested assumptions (already computed by the
// backend) — helps the user understand the IMPACT of each assumption,
// never which side is "correct." Diff logic lives in
// src/lib/manualVsAi.ts (pure, unit tested); this file is presentational.

import { useTranslation } from "react-i18next";
import { Card, SectionHeader } from "@/components/ui";
import type { AssumptionComparison, ManualVsAiComparison } from "@/lib/manualVsAi";

function AssumptionRow({ label, comparison }: { label: string; comparison: AssumptionComparison }) {
  const { t } = useTranslation();
  return (
    <div className="py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
      <p className="text-[10.5px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>{label}</p>
      <div className="grid grid-cols-3 gap-2 items-center">
        <div>
          <p className="text-[9px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("subvaluadas.manualVsAi.you")}</p>
          <p className="text-base font-semibold tabular-nums" style={{ color: "var(--text)" }}>{comparison.userValuePct.toFixed(2)}%</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-bold tabular-nums" style={{ color: comparison.diffPct === 0 ? "var(--muted)" : comparison.diffPct > 0 ? "#22c55e" : "#ef4444" }}>
            {comparison.diffPct > 0 ? "+" : ""}{comparison.diffPct.toFixed(2)}pp
          </p>
        </div>
        <div className="text-right">
          <p className="text-[9px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("subvaluadas.manualVsAi.nuvos")}</p>
          <p className="text-base font-semibold tabular-nums" style={{ color: "var(--accent-l)" }}>{comparison.nuvosValuePct.toFixed(2)}%</p>
        </div>
      </div>
    </div>
  );
}

export function ManualVsAiPanel({ comparison }: { comparison: ManualVsAiComparison }) {
  const { t } = useTranslation();
  const assumptionLabel = (key: AssumptionComparison["key"]) => t(`subvaluadas.manualVsAi.assumptions.${key}`);
  const mostDivergent = comparison.mostDivergentAssumption;

  return (
    <Card className="mb-6">
      <SectionHeader title={t("subvaluadas.manualVsAi.title")} subtitle={t("subvaluadas.manualVsAi.subtitle")} />

      <div>
        {comparison.assumptions.map((a) => (
          <AssumptionRow key={a.key} label={assumptionLabel(a.key)} comparison={a} />
        ))}
      </div>

      {comparison.userIntrinsicValue !== null && comparison.nuvosIntrinsicValue !== null && (
        <div className="mt-3 pt-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("subvaluadas.manualVsAi.resultingValue")}</p>
            <p className="text-sm font-bold tabular-nums" style={{ color: "var(--text)" }}>
              ${comparison.userIntrinsicValue.toFixed(2)} <span style={{ color: "var(--muted)", fontWeight: 400 }}>{t("subvaluadas.manualVsAi.vs")}</span> ${comparison.nuvosIntrinsicValue.toFixed(2)}
            </p>
          </div>
          {comparison.valueDiffPct !== null && (
            <p className="text-[11px] font-bold tabular-nums shrink-0" style={{ color: "var(--muted)" }}>
              {comparison.valueDiffPct > 0 ? "+" : ""}{comparison.valueDiffPct.toFixed(1)}%
            </p>
          )}
        </div>
      )}

      {mostDivergent && Math.abs(mostDivergent.diffPct) > 0.01 && (
        <p className="mt-3 text-[11px] leading-relaxed italic" style={{ color: "var(--sub)" }}>
          {t("subvaluadas.manualVsAi.mostDivergentNote", {
            assumption: assumptionLabel(mostDivergent.key),
            diff: `${mostDivergent.diffPct > 0 ? "+" : ""}${mostDivergent.diffPct.toFixed(2)}`,
          })}
        </p>
      )}

      <p className="mt-3 text-[10px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.manualVsAi.footnote")}</p>
    </Card>
  );
}
