"use client";

// Pilar 1 (Calidad) — revenue breakdown, moat bullet points, and the
// competitor "Duelo de Titanes" table, each in its own clearly separated
// sub-card (icon + title header) instead of a continuous flow, wrapped in
// the app's shared ExpandableSection accordion.

import { useTranslation } from "react-i18next";
import { Trophy, PieChart, Castle, Swords, Scale, Check } from "lucide-react";
import { PillarSection, TintSubCard, IconDot, GOLD_LIGHT } from "@/components/subvaluadas/radarUi";
import { CompanyDiagnosticSectionScore } from "@/components/subvaluadas/CompanyDiagnosticSectionScore";
import { CompanyDiagnosticCompetitorTable } from "@/components/subvaluadas/CompanyDiagnosticCompetitorTable";
import { CompanyDiagnosticSectorComparison } from "@/components/subvaluadas/CompanyDiagnosticSectorComparison";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

export function CompanyDiagnosticQualityPillar({
  score, revenueBreakdown, moatPoints, competitorComparison, sectorComparison, ticker,
}: {
  score: number;
  revenueBreakdown: CompanyDiagnosticData["revenueBreakdown"];
  moatPoints: string[];
  competitorComparison: CompanyDiagnosticData["competitorComparison"];
  sectorComparison: CompanyDiagnosticData["sectorComparison"];
  ticker: string;
}) {
  const { t } = useTranslation();

  return (
    <PillarSection
      title={t("companyDiagnostic.pillars.quality.title")}
      icon={<Trophy className="w-[18px] h-[18px]" style={{ color: "#eab308" }} />}
      iconColor="#eab308"
      headline={
        <CompanyDiagnosticSectionScore
          score={score}
          label={t("companyDiagnostic.explanations.scoreQuality.title")}
          explanation={t("companyDiagnostic.explanations.scoreQuality.body")}
        />
      }
    >
      <div className="space-y-3.5">
        <TintSubCard tint="#D4A24C" icon={<PieChart className="w-4 h-4" style={{ color: "var(--accent-l)" }} />} title={t("companyDiagnostic.pillars.quality.revenueBreakdown")}>
          <div className="space-y-3.5">
            {revenueBreakdown.map((r) => (
              <div key={r.category}>
                <div className="flex items-baseline justify-between gap-2 mb-[7px]">
                  <span className="flex-1 min-w-0 text-[13.5px] font-bold truncate" style={{ color: "var(--text)" }}>{r.category}</span>
                  <span className="text-[15px] font-black tabular-nums" style={{ color: "var(--text)" }}>{r.percentage}%</span>
                </div>
                <div className="h-2.5 rounded-[5px] overflow-hidden" style={{ background: "rgba(127,127,127,0.16)" }}>
                  <div className="h-full rounded-[5px]" style={{ width: `${r.percentage}%`, background: `linear-gradient(90deg, ${GOLD_LIGHT}, var(--accent))` }} />
                </div>
              </div>
            ))}
          </div>
        </TintSubCard>

        <TintSubCard tint="#4FA695" icon={<Castle className="w-4 h-4" style={{ color: "#4FA695" }} />} title={t("companyDiagnostic.pillars.quality.moatTitle")}>
          <div className="space-y-2.5">
            {moatPoints.map((point, i) => (
              <div key={i} className="flex gap-2.5 items-start rounded-[14px] p-3" style={{ background: "var(--card)" }}>
                <div className="mt-px"><IconDot color="#4FA695" size={22}><Check className="w-3 h-3" /></IconDot></div>
                <p className="flex-1 text-[13.5px] leading-[19.5px]" style={{ color: "var(--text)" }}>{point}</p>
              </div>
            ))}
          </div>
        </TintSubCard>

        {sectorComparison && (
          <TintSubCard tint="#D4A24C" icon={<Scale className="w-4 h-4" style={{ color: "var(--accent-l)" }} />} title={t("companyDiagnostic.pillars.quality.sectorComparisonTitle")}>
            <CompanyDiagnosticSectorComparison comparison={sectorComparison} ticker={ticker} />
          </TintSubCard>
        )}

        {competitorComparison && (
          <TintSubCard tint="#DD6E63" icon={<Swords className="w-4 h-4" style={{ color: "#DD6E63" }} />} title={t("companyDiagnostic.pillars.quality.competitorTitle")}>
            <CompanyDiagnosticCompetitorTable competitorComparison={competitorComparison} />
          </TintSubCard>
        )}
      </div>
    </PillarSection>
  );
}
