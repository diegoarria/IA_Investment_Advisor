"use client";

// CompanyDiagnosticCard — Nuvos AI "Ficha de Diagnóstico." Self-contained
// through Capa 2 (hero + 4 collapsible pillars) plus Tesis Final, la guía
// de metodología y el disclaimer legal. No trailing action bar/footer —
// the caller (app/subvaluadas/page.tsx) renders the standard "Actualizado
// hoy / Seguir / Analizar con Arthur" row right after this card, reusing
// the exact same GeneratedAtNote/FollowButton/AnalyzeButton it already
// uses for the legacy DCF/GQV panel, instead of this component duplicating
// that with its own bespoke sticky bar. Pure presentation: accepts
// `CompanyDiagnosticData` as a prop.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Target } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { scoreColor } from "@/components/ui/Badge";
import { ExplainableValue } from "@/components/ui/ExplainableValue";
import { fmtPrice } from "@/lib/types/stock";
import { _valuationStatus, _VERDICT_COLOR, _VERDICT_EMOJI } from "@/components/subvaluadas/shared";
import { CompanyDiagnosticValuationThermometer } from "@/components/subvaluadas/CompanyDiagnosticValuationThermometer";
import { CompanyDiagnosticQualityPillar } from "@/components/subvaluadas/CompanyDiagnosticQualityPillar";
import { CompanyDiagnosticTrustPillar } from "@/components/subvaluadas/CompanyDiagnosticTrustPillar";
import { CompanyDiagnosticValuePillar } from "@/components/subvaluadas/CompanyDiagnosticValuePillar";
import { CompanyDiagnosticSimplicityPillar } from "@/components/subvaluadas/CompanyDiagnosticSimplicityPillar";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

// Bolds every dollar-amount ("$2.8 mil millones", "$3,400M") and percentage
// ("9.7%") found in a narrative string — used only for the Tesis Final
// summary, where Diego explicitly asked those 2 kinds of figures to always
// stand out in bold from the surrounding prose.
const _NUMBER_PATTERN_SOURCE = String.raw`\$\d[\d.,]*(?:\s?(?:mil millones|millones|mil|MM|bn|B|M|K))?|\d[\d.,]*%`;

function renderWithBoldNumbers(text: string): ReactNode[] {
  const splitRe = new RegExp(`(${_NUMBER_PATTERN_SOURCE})`, "gi");
  const matchRe = new RegExp(`^(?:${_NUMBER_PATTERN_SOURCE})$`, "i");
  return text.split(splitRe).map((part, i) =>
    matchRe.test(part) ? <strong key={i} style={{ color: "var(--text)" }}>{part}</strong> : <span key={i}>{part}</span>
  );
}

export function CompanyDiagnosticCard({ data }: { data: CompanyDiagnosticData }) {
  const { t } = useTranslation();

  const methodologyParagraphs = t("companyDiagnostic.methodology.paragraphs", { returnObjects: true }) as string[];
  const verdictStatus = _valuationStatus(data.valuation.baseFairValue, data.valuation.currentPrice);

  return (
    <div>
      {/* Capa 1 — Hero */}
      <Card padding="p-6 sm:p-7">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-black" style={{ color: "var(--text)" }}>{data.ticker}</h1>
              <span className="text-[15px] font-semibold truncate" style={{ color: "var(--sub)" }}>{data.companyName}</span>
            </div>
            <p className="text-[14px] mt-1" style={{ color: "var(--muted)" }}>{data.sector} · {data.exchange}</p>
          </div>
          <div className="text-right shrink-0">
            <ExplainableValue
              label={t("companyDiagnostic.explanations.scoreOverall.title")}
              content={{ summary: t("companyDiagnostic.explanations.scoreOverall.body") }}
            >
              <span className="flex items-baseline gap-1">
                <span className="text-4xl sm:text-5xl font-black tabular-nums" style={{ color: scoreColor(data.score) }}>{data.score}</span>
                <span className="text-lg font-bold" style={{ color: "var(--muted)" }}>/100</span>
              </span>
            </ExplainableValue>
            <p className="text-[13px] font-bold uppercase tracking-wide mt-1.5" style={{ color: scoreColor(data.score) }}>{data.scoreLabel}</p>
          </div>
        </div>

        <p className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
          {t("companyDiagnostic.badgesTitle")}
        </p>
        <div className="flex flex-wrap gap-2.5 mb-5">
          {data.badges.map((b) => (
            <span
              key={b}
              className="text-[13px] font-bold px-3.5 py-2 rounded-xl"
              style={{ color: "#6366F1", background: "#6366F11f", border: "1px solid #6366F1" }}
            >
              {b}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-xl p-4" style={{ background: "var(--raised)" }}>
            <p className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.kpi.currentPrice")}</p>
            <p className="text-2xl font-black tabular-nums mt-0.5" style={{ color: "var(--text)" }}>{fmtPrice(data.valuation.currentPrice)}</p>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--raised)" }}>
            <p className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.kpi.fairValue")}</p>
            <p className="text-2xl font-black tabular-nums mt-0.5" style={{ color: "#4FA695" }}>{fmtPrice(data.valuation.baseFairValue)}</p>
          </div>
        </div>

        <div className="rounded-xl p-4 mb-5" style={{ background: "var(--card-2, var(--raised))", borderLeft: "3px solid var(--accent)" }}>
          <p className="text-[15px] leading-relaxed" style={{ color: "var(--text)" }}>&ldquo;{data.oneLinerPitch}&rdquo;</p>
        </div>

        {verdictStatus && (
          <div className="flex items-center justify-center py-4 mb-5">
            <span className="flex items-center gap-2.5 text-[22px] sm:text-[26px] font-black" style={{ color: _VERDICT_COLOR[verdictStatus.verdict] }}>
              {_VERDICT_EMOJI[verdictStatus.verdict]}
              {verdictStatus.verdict === "undervalued"
                ? t("companyDiagnostic.thermometer.undervalued")
                : verdictStatus.verdict === "overvalued"
                  ? t("companyDiagnostic.thermometer.overvalued")
                  : t("companyDiagnostic.thermometer.fair")}
              <span className="tabular-nums">({verdictStatus.pct.toFixed(1)}%)</span>
            </span>
          </div>
        )}

        <CompanyDiagnosticValuationThermometer scenarios={data.valuation} />

        {(data.valuation.fcfAssumptions || data.valuation.waccDetails) && (
          <details className="mt-3">
            <summary className="text-[11px] cursor-pointer" style={{ color: "var(--muted)" }}>
              {t("companyDiagnostic.modelAssumptions.toggle")}
            </summary>
            <div className="mt-2 space-y-1.5 text-[11px]" style={{ color: "var(--sub)" }}>
              {data.valuation.fcfAssumptions && (
                <>
                  <p>
                    {t("companyDiagnostic.modelAssumptions.fcfReported")}:{" "}
                    <span style={{ color: "var(--text)", fontWeight: 700 }}>
                      {data.valuation.fcfAssumptions.fcf_reported != null ? `$${(data.valuation.fcfAssumptions.fcf_reported / 1e6).toFixed(0)}M` : "—"}
                    </span>
                    {" · "}{t("companyDiagnostic.modelAssumptions.fcfNormalized")}:{" "}
                    <span style={{ color: "var(--accent-l)", fontWeight: 700 }}>
                      {data.valuation.fcfAssumptions.fcf_normalized != null ? `$${(data.valuation.fcfAssumptions.fcf_normalized / 1e6).toFixed(0)}M` : "—"}
                    </span>
                  </p>
                  {data.valuation.fcfAssumptions.growth_capex_estimate != null && data.valuation.fcfAssumptions.growth_capex_estimate > 0 && (
                    <p>
                      {t("companyDiagnostic.modelAssumptions.growthCapex")}:{" "}
                      <span style={{ color: "var(--text)", fontWeight: 700 }}>
                        ${(data.valuation.fcfAssumptions.growth_capex_estimate / 1e6).toFixed(0)}M
                      </span>
                    </p>
                  )}
                </>
              )}
              {data.valuation.waccDetails?.wacc_pct != null && (
                <p>
                  {t("companyDiagnostic.modelAssumptions.wacc")}:{" "}
                  <span style={{ color: "var(--text)", fontWeight: 700 }}>{data.valuation.waccDetails.wacc_pct.toFixed(1)}%</span>
                </p>
              )}
              {data.valuation.fcfAssumptions?.methodology_note && (
                <p style={{ color: "var(--dim)" }}>{data.valuation.fcfAssumptions.methodology_note}</p>
              )}
            </div>
          </details>
        )}
      </Card>

      {/* Capa 2 — 4 pilares */}
      <div className="mt-4 space-y-3.5">
        <CompanyDiagnosticQualityPillar
          score={data.pillarScores.quality}
          revenueBreakdown={data.revenueBreakdown}
          moatPoints={data.moatPoints}
          competitorComparison={data.competitorComparison}
        />
        <CompanyDiagnosticTrustPillar score={data.pillarScores.trust} financialHealth={data.financialHealth} roicAdjustedForBuybacks={data.roicAdjustedForBuybacks} />
        <CompanyDiagnosticValuePillar
          score={data.pillarScores.value}
          ticker={data.ticker}
          companyName={data.companyName}
          valuation={data.valuation}
        />
        <CompanyDiagnosticSimplicityPillar
          score={data.pillarScores.simplicity}
          noiseVsReality={data.noiseVsReality}
          actionPlan={data.actionPlan}
        />
      </div>

      {/* Tesis Final — resumen de inversión, números clave en negrita.
          Omitida cuando la generación de IA on-demand falló para este
          ticker (nunca se muestra un placeholder inventado). */}
      {data.investmentThesis && (
        <Card padding="p-5 sm:p-6" className="mt-4" style={{ borderColor: "var(--accent)" }}>
          <SectionHeader
            title={t("companyDiagnostic.thesis.title")}
            subtitle={t("companyDiagnostic.thesis.subtitle")}
            action={<Target className="w-5 h-5 shrink-0" style={{ color: "var(--accent-l)" }} />}
          />
          <p className="text-[15px] leading-relaxed mt-4" style={{ color: "var(--text)" }}>
            {renderWithBoldNumbers(data.investmentThesis)}
          </p>
        </Card>
      )}

      {/* Guía de metodología — hasta abajo del todo, antes del disclaimer legal */}
      <Card padding="p-5 sm:p-6" className="mt-4">
        <SectionHeader
          title={t("companyDiagnostic.methodology.title")}
          subtitle={t("companyDiagnostic.methodology.subtitle")}
          action={<BookOpen className="w-5 h-5 shrink-0" style={{ color: "var(--muted)" }} />}
        />
        <div className="mt-4 space-y-3">
          {methodologyParagraphs.map((p, i) => (
            <p key={i} className="text-[14px] leading-relaxed" style={{ color: "var(--sub)" }}>{p}</p>
          ))}
        </div>
      </Card>

      {/* Disclaimer — donde termina esta tarjeta. El pie (Actualizado hoy /
          Seguir / Analizar con Arthur) lo agrega el caller, no este
          componente — ver la nota al inicio del archivo. */}
      <p className="text-[12px] leading-relaxed mt-5 text-center" style={{ color: "var(--dim)" }}>
        {t("companyDiagnostic.disclaimer")}
      </p>
    </div>
  );
}
