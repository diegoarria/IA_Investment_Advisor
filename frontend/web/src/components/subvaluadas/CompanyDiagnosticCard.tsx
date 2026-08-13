"use client";

// CompanyDiagnosticCard — Nuvos AI "Ficha de Diagnóstico." 3-layer
// progressive-disclosure card: Capa 1 (hero, always visible), Capa 2 (4
// collapsible pillars — Calidad/Confianza/Valor/Simplicidad), Capa 3
// (sticky action bar + legal footer). Pure presentation: accepts
// `CompanyDiagnosticData` as a prop — see lib/types/companyDiagnostic.ts
// for why this isn't wired to real backend data yet.

import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Bell, Star, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge, ScorePill, scoreColor } from "@/components/ui/Badge";
import { useWatchlistStore } from "@/lib/store";
import { fmtPrice } from "@/lib/types/stock";
import { CompanyDiagnosticValuationThermometer } from "@/components/subvaluadas/CompanyDiagnosticValuationThermometer";
import { CompanyDiagnosticQualityPillar } from "@/components/subvaluadas/CompanyDiagnosticQualityPillar";
import { CompanyDiagnosticTrustPillar } from "@/components/subvaluadas/CompanyDiagnosticTrustPillar";
import { CompanyDiagnosticValuePillar, COMPANY_DIAGNOSTIC_VALUE_PILLAR_ID } from "@/components/subvaluadas/CompanyDiagnosticValuePillar";
import { CompanyDiagnosticSimplicityPillar } from "@/components/subvaluadas/CompanyDiagnosticSimplicityPillar";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

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

  return (
    <div className="pb-24">
      {/* Capa 1 — Hero */}
      <Card padding="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h1 className="text-xl font-black" style={{ color: "var(--text)" }}>{data.ticker}</h1>
              <span className="text-[12px] font-semibold truncate" style={{ color: "var(--sub)" }}>{data.companyName}</span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>{data.sector} · {data.exchange}</p>
          </div>
          <div className="text-right shrink-0">
            <ScorePill score={data.score} size="md" />
            <p className="text-[9px] font-bold uppercase tracking-wide mt-0.5" style={{ color: scoreColor(data.score) }}>{data.scoreLabel}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {data.badges.map((b) => (
            <Badge key={b} tone="accent">{b}</Badge>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="rounded-xl p-3" style={{ background: "var(--raised)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.kpi.currentPrice")}</p>
            <p className="text-lg font-black tabular-nums" style={{ color: "var(--text)" }}>{fmtPrice(data.valuation.currentPrice)}</p>
          </div>
          <div className="rounded-xl p-3" style={{ background: "var(--raised)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.kpi.fairValue")}</p>
            <p className="text-lg font-black tabular-nums" style={{ color: "#4FA695" }}>{fmtPrice(data.valuation.baseFairValue)}</p>
          </div>
        </div>

        <div className="rounded-xl p-3.5 mb-4" style={{ background: "var(--card-2, var(--raised))", borderLeft: "3px solid var(--accent)" }}>
          <p className="text-[12px] leading-relaxed italic" style={{ color: "var(--text)" }}>&ldquo;{data.oneLinerPitch}&rdquo;</p>
        </div>

        <CompanyDiagnosticValuationThermometer scenarios={data.valuation} />
      </Card>

      {/* Capa 2 — 4 pilares */}
      <div className="mt-4 space-y-3">
        <CompanyDiagnosticQualityPillar
          revenueBreakdown={data.revenueBreakdown}
          moatPoints={data.moatPoints}
          competitorComparison={data.competitorComparison}
        />
        <CompanyDiagnosticTrustPillar financialHealth={data.financialHealth} />
        <CompanyDiagnosticValuePillar ticker={data.ticker} companyName={data.companyName} valuation={data.valuation} />
        <CompanyDiagnosticSimplicityPillar noiseVsReality={data.noiseVsReality} actionPlan={data.actionPlan} />
      </div>

      {/* Disclaimer */}
      <p className="text-[10px] leading-relaxed mt-5 text-center" style={{ color: "var(--dim)" }}>
        {t("companyDiagnostic.disclaimer")}
      </p>

      {/* Capa 3 — Sticky action bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 px-3 py-2.5 flex items-center justify-center gap-2"
        style={{ background: "var(--card)", borderTop: "1px solid var(--border)" }}
      >
        <button
          onClick={scrollToBuyZone}
          className="flex-1 max-w-[180px] flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-bold"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          <Bell className="w-3.5 h-3.5" />
          <span className="truncate">{t("companyDiagnostic.actions.followZone")}</span>
        </button>
        <button
          onClick={toggleInvestable}
          className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 px-3 text-[11px] font-bold shrink-0"
          style={{ background: "var(--raised)", color: isInvestable ? "#eab308" : "var(--text)" }}
          title={isInvestable ? t("companyDiagnostic.actions.markedInvestable") : t("companyDiagnostic.actions.markInvestable")}
        >
          <Star className="w-3.5 h-3.5" fill={isInvestable ? "#eab308" : "none"} />
        </button>
        <button
          onClick={analyzeWithArthur}
          className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 px-3 text-[11px] font-bold shrink-0"
          style={{ background: "var(--raised)", color: "var(--text)" }}
          title={t("companyDiagnostic.actions.analyzeWithArthur")}
        >
          <MessageCircle className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
