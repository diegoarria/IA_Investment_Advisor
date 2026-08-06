"use client";

// Fase 4, Incremento 2 — Dashboard Principal (Parte A). The executive
// summary: everything the brief asks to be visible immediately, with clear
// visual hierarchy, using data this page ALREADY fetches (QuickAnalysisResult
// + NifDashboardData) plus one new lightweight read (the Fase 3 thesis
// draft) — no new valuation/scoring logic, purely presentational.
//
// This is the "Principiante" tier per src/lib/detailLevel.ts — always
// visible regardless of the selected Nivel de Detalle.

import { useTranslation } from "react-i18next";
import { AlertTriangle, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, SectionHeader, ScorePill, Badge, ExplainableValue, type ExplanationContent } from "@/components/ui";
import type { FairValueRangeData, ThesisDraftData, NifDeteriorationData, NifScoreFactor, ConfidenceMeterData, ConsensusValuationData } from "./shared";
import { FairValueRangeDisplay } from "./shared";
import { extractFactorsFromNuvosEstimate, formatMarginOfSafetyFormula, pickDeteriorationChangeNote } from "@/lib/explainability";

function StatTile({
  label, value, sub, valueColor, explanation,
}: { label: string; value: string; sub?: string; valueColor?: string; explanation?: ExplanationContent }) {
  const valueEl = <p className="text-lg font-semibold tabular-nums truncate" style={{ color: valueColor ?? "var(--text)" }}>{value}</p>;
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide truncate" style={{ color: "var(--muted)" }}>{label}</p>
      {explanation ? <ExplainableValue label={label} content={explanation}>{valueEl}</ExplainableValue> : valueEl}
      {sub && <p className="text-[10.5px] tabular-nums" style={{ color: "var(--sub)" }}>{sub}</p>}
    </div>
  );
}

function ScoreTile({ label, score, explanation }: { label: string; score: number | null; explanation?: ExplanationContent }) {
  const pill = <ScorePill score={score} size="md" />;
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-0">
      {explanation ? <ExplainableValue label={label} content={explanation}>{pill}</ExplainableValue> : pill}
      <p className="text-[9.5px] uppercase tracking-wide text-center" style={{ color: "var(--muted)" }}>{label}</p>
    </div>
  );
}

export function ExecutiveSummaryPanel({
  price, intrinsicValue, fairValueRange, consensusValuation, marginOfSafetyPct,
  qualityScore, qualityNuvosEstimate, convictionScore, convictionFactors, confidenceMeter,
  thesisDraft, thesisLoading, deterioration,
}: {
  price: number | null;
  intrinsicValue: number | null;
  fairValueRange: FairValueRangeData | null;
  /** Fase 1.5, Incremento 11 — Method 5's real weighted blend (DCF/
   * Relative/Historical), shown as the breakdown behind fairValueRange
   * below via FairValueRangeDisplay. Optional/nullable: not every ticker
   * has enough real peer/historical data for Consensus to compute. */
  consensusValuation?: ConsensusValuationData | null;
  marginOfSafetyPct: number | null;
  qualityScore: number | null;
  /** Fase 4, Incremento 3 — raw pillar nuvos_estimate (untyped upstream
   * since every NIF pillar has different fields); extracted via
   * extractFactorsFromNuvosEstimate for the explainability popover. */
  qualityNuvosEstimate?: Record<string, unknown> | null;
  convictionScore: number | null;
  convictionFactors?: NifScoreFactor[] | null;
  confidenceMeter?: ConfidenceMeterData | null;
  thesisDraft: ThesisDraftData | null;
  thesisLoading: boolean;
  deterioration: NifDeteriorationData | null;
}) {
  const { t } = useTranslation();
  const mosColor = marginOfSafetyPct === null ? "var(--text)" : marginOfSafetyPct >= 0 ? "#22c55e" : "#ef4444";
  const topRisks = (thesisDraft?.key_risks ?? []).slice(0, 3);

  // Fase 4, Incremento 3 (Explainability Engine) — every explanation below
  // is built ENTIRELY from data the backend already computed (factors[],
  // deterioration reasons, the real MoS formula) — never a new judgment.
  const qualityExplanation: ExplanationContent = {
    summary: t("subvaluadas.executiveSummary.explain.qualitySummary"),
    factors: extractFactorsFromNuvosEstimate(qualityNuvosEstimate),
    changeNote: pickDeteriorationChangeNote(deterioration?.factors ?? null, ["roic", "operating_margin", "net_margin", "fcf_margin"]),
  };
  const convictionExplanation: ExplanationContent = {
    summary: t("subvaluadas.executiveSummary.explain.convictionSummary"),
    factors: (convictionFactors ?? []).map((f) => ({ name: f.name, value: f.value, score: f.score, reason: f.reason })),
    changeNote: pickDeteriorationChangeNote(deterioration?.factors ?? null, ["roic", "operating_margin"]),
  };
  const confidenceExplanation: ExplanationContent | undefined = confidenceMeter ? {
    summary: t("subvaluadas.executiveSummary.explain.confidenceSummary", { label: confidenceMeter.label }),
    factors: [{
      name: t("subvaluadas.executiveSummary.explain.confidenceMethodName"),
      value: confidenceMeter.dispersion_source ?? null,
      score: null,
      reason: t(
        confidenceMeter.dispersion_source === "cross_method"
          ? "subvaluadas.executiveSummary.explain.confidenceCrossMethod"
          : "subvaluadas.executiveSummary.explain.confidenceBearBullDispersion"
      ),
    }],
  } : undefined;
  const marginOfSafetyFormula = formatMarginOfSafetyFormula(price, intrinsicValue);
  const marginOfSafetyExplanation: ExplanationContent = {
    summary: t("subvaluadas.executiveSummary.explain.marginOfSafetySummary"),
    factors: marginOfSafetyFormula
      ? [{ name: t("subvaluadas.executiveSummary.explain.formula"), value: null, score: null, reason: marginOfSafetyFormula }]
      : [],
  };

  return (
    <Card className="mb-6">
      <SectionHeader title={t("subvaluadas.executiveSummary.title")} subtitle={t("subvaluadas.executiveSummary.subtitle")} />

      {/* Valuación real */}
      <div className="grid grid-cols-3 gap-4 pb-4 mb-4 border-b" style={{ borderColor: "var(--border)" }}>
        <StatTile label={t("subvaluadas.executiveSummary.price")} value={price !== null ? `$${price.toFixed(2)}` : "N/D"} />
        <StatTile label={t("subvaluadas.executiveSummary.intrinsicValue")} value={intrinsicValue !== null ? `$${intrinsicValue.toFixed(2)}` : "N/D"} />
        <StatTile
          label={t("subvaluadas.executiveSummary.marginOfSafety")}
          value={marginOfSafetyPct !== null ? `${marginOfSafetyPct >= 0 ? "+" : ""}${marginOfSafetyPct.toFixed(1)}%` : "N/D"}
          valueColor={mosColor}
          explanation={marginOfSafetyPct !== null ? marginOfSafetyExplanation : undefined}
        />
      </div>

      {/* Fase 1.5, Incremento 11 — nunca un punto único: el rango ahora
          combina percentiles de Monte Carlo + el spread real de Consensus
          (Method 5), con el desglose por método visible (FairValueRangeDisplay,
          ya existía pero nunca estaba conectado a ninguna pantalla). */}
      {fairValueRange && (
        <div className="pb-4 mb-4 border-b" style={{ borderColor: "var(--border)" }}>
          <FairValueRangeDisplay range={fairValueRange} consensus={consensusValuation} />
        </div>
      )}

      {/* Scores reales (Fase 2) — cada uno explicable, nunca solo un número
          (Fase 4, Incremento 3). */}
      <div className="grid grid-cols-3 gap-3 pb-4 mb-4 border-b" style={{ borderColor: "var(--border)" }}>
        <ScoreTile label={t("subvaluadas.executiveSummary.qualityScore")} score={qualityScore} explanation={qualityScore !== null ? qualityExplanation : undefined} />
        <ScoreTile label={t("subvaluadas.executiveSummary.convictionScore")} score={convictionScore} explanation={convictionScore !== null ? convictionExplanation : undefined} />
        <ScoreTile label={t("subvaluadas.executiveSummary.confidenceScore")} score={confidenceMeter?.score ?? null} explanation={confidenceExplanation} />
      </div>

      {/* Estado de la tesis + cambio reciente (Fase 3) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
            {t("subvaluadas.executiveSummary.thesisStatus")}
          </p>
          {thesisLoading ? (
            <p className="text-[12px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.executiveSummary.thesisLoading")}</p>
          ) : thesisDraft ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Badge tone="accent">{t(`subvaluadas.executiveSummary.confidence.${thesisDraft.confidence}`)}</Badge>
              </div>
              <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>{thesisDraft.thesis_summary}</p>
            </div>
          ) : (
            <p className="text-[12px] italic" style={{ color: "var(--muted)" }}>{t("subvaluadas.executiveSummary.noThesis")}</p>
          )}
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
            {t("subvaluadas.executiveSummary.recentChange")}
          </p>
          {deterioration ? (
            deterioration.deteriorating_count > 0 ? (
              <div className="flex items-start gap-1.5">
                <TrendingDown className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "#ef4444" }} />
                <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>
                  {t("subvaluadas.executiveSummary.deteriorationDetected", { count: deterioration.deteriorating_count })}
                  {deterioration.highest_concern && ` (${deterioration.highest_concern})`}
                </p>
              </div>
            ) : deterioration.improving_count > 0 ? (
              <div className="flex items-start gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "#22c55e" }} />
                <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>
                  {t("subvaluadas.executiveSummary.improvementDetected", { count: deterioration.improving_count })}
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-1.5">
                <Minus className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--muted)" }} />
                <p className="text-[12px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.executiveSummary.noMaterialChange")}</p>
              </div>
            )
          ) : (
            <p className="text-[12px] italic" style={{ color: "var(--muted)" }}>{t("subvaluadas.executiveSummary.noThesis")}</p>
          )}
        </div>
      </div>

      {topRisks.length > 0 && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
            {t("subvaluadas.executiveSummary.keyRisks")}
          </p>
          <ul className="space-y-1">
            {topRisks.map((risk, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
                {risk.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
