"use client";

// CompanyDiagnosticCard — Nuvos AI "Ficha de Diagnóstico." 3-layer
// progressive-disclosure card: Capa 1 (hero, always visible), Capa 2 (4
// collapsible pillars — Calidad/Confianza/Valor/Simplicidad), Capa 3
// (sticky action bar + legal footer). Pure presentation: accepts
// `CompanyDiagnosticData` as a prop — see lib/types/companyDiagnostic.ts
// for why this isn't wired to real backend data yet.

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Bell, Star, MessageCircle, BookOpen, Target } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { scoreColor } from "@/components/ui/Badge";
import { ExplainableValue } from "@/components/ui/ExplainableValue";
import { useWatchlistStore } from "@/lib/store";
import { fmtPrice } from "@/lib/types/stock";
import { _valuationStatus, _VERDICT_COLOR, _VERDICT_EMOJI } from "@/components/subvaluadas/shared";
import { CompanyDiagnosticSectionScore } from "@/components/subvaluadas/CompanyDiagnosticSectionScore";
import { CompanyDiagnosticValuationThermometer } from "@/components/subvaluadas/CompanyDiagnosticValuationThermometer";
import { CompanyDiagnosticQualityPillar } from "@/components/subvaluadas/CompanyDiagnosticQualityPillar";
import { CompanyDiagnosticTrustPillar } from "@/components/subvaluadas/CompanyDiagnosticTrustPillar";
import { CompanyDiagnosticValuePillar, COMPANY_DIAGNOSTIC_VALUE_PILLAR_ID } from "@/components/subvaluadas/CompanyDiagnosticValuePillar";
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
  const router = useRouter();
  const watchlist = useWatchlistStore();
  const isInvestable = watchlist.has(data.ticker);

  const toggleInvestable = () => {
    if (isInvestable) watchlist.remove(data.ticker);
    else watchlist.add(data.ticker, data.companyName);
  };

  const scrollToBuyZone = () => {
    document.getElementById(COMPANY_DIAGNOSTIC_VALUE_PILLAR_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const analyzeWithArthur = () => {
    const prompt = t("companyDiagnostic.actions.analyzePrompt", { ticker: data.ticker, companyName: data.companyName });
    router.push(`/chat?msg=${encodeURIComponent(prompt)}&autosend=1`);
  };

  const methodologyParagraphs = t("companyDiagnostic.methodology.paragraphs", { returnObjects: true }) as string[];
  const verdictStatus = _valuationStatus(data.valuation.baseFairValue, data.valuation.currentPrice);

  return (
    <div className="pb-28">
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
      </Card>

      {/* Capa 2 — 4 pilares */}
      <div className="mt-4 space-y-3.5">
        <CompanyDiagnosticQualityPillar
          score={data.pillarScores.quality}
          revenueBreakdown={data.revenueBreakdown}
          moatPoints={data.moatPoints}
          competitorComparison={data.competitorComparison}
        />
        <CompanyDiagnosticTrustPillar score={data.pillarScores.trust} financialHealth={data.financialHealth} />
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

      {/* Disclaimer */}
      <p className="text-[12px] leading-relaxed mt-5 text-center" style={{ color: "var(--dim)" }}>
        {t("companyDiagnostic.disclaimer")}
      </p>

      {/* Capa 3 — Sticky action bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 px-3 py-3 flex items-center justify-center gap-2"
        style={{ background: "var(--card)", borderTop: "1px solid var(--border)" }}
      >
        <button
          onClick={scrollToBuyZone}
          className="flex-1 max-w-[200px] flex items-center justify-center gap-1.5 rounded-xl py-3 text-[14px] font-bold"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          <Bell className="w-4 h-4" />
          <span className="truncate">{t("companyDiagnostic.actions.followZone")}</span>
        </button>
        <button
          onClick={toggleInvestable}
          className="flex items-center justify-center gap-1.5 rounded-xl py-3 px-3.5 text-[14px] font-bold shrink-0"
          style={{ background: "var(--raised)", color: isInvestable ? "#eab308" : "var(--text)" }}
          title={isInvestable ? t("companyDiagnostic.actions.markedInvestable") : t("companyDiagnostic.actions.markInvestable")}
        >
          <Star className="w-4 h-4" fill={isInvestable ? "#eab308" : "none"} />
        </button>
        <button
          onClick={analyzeWithArthur}
          className="flex items-center justify-center gap-1.5 rounded-xl py-3 px-3.5 text-[14px] font-bold shrink-0"
          style={{ background: "var(--raised)", color: "var(--text)" }}
          title={t("companyDiagnostic.actions.analyzeWithArthur")}
        >
          <MessageCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
