"use client";

// Pilar 1 (Calidad) — revenue breakdown, moat bullet points, and the
// competitor "Duelo de Titanes" table, each in its own clearly separated
// sub-card (icon + title header) instead of a continuous flow, wrapped in
// the app's shared ExpandableSection accordion.

import { useTranslation } from "react-i18next";
import { Trophy, PieChart, Castle, Swords, Scale } from "lucide-react";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { CompanyDiagnosticSectionScore } from "@/components/subvaluadas/CompanyDiagnosticSectionScore";
import { CompanyDiagnosticCompetitorTable } from "@/components/subvaluadas/CompanyDiagnosticCompetitorTable";
import { CompanyDiagnosticSectorComparison } from "@/components/subvaluadas/CompanyDiagnosticSectorComparison";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

function SubCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-2.5 mb-3.5">
        {icon}
        <p className="text-[15px] font-bold" style={{ color: "var(--text)" }}>{title}</p>
      </div>
      {children}
    </div>
  );
}

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
    <ExpandableSection
      title={t("companyDiagnostic.pillars.quality.title")}
      icon={<Trophy className="w-5 h-5" style={{ color: "#eab308" }} />}
      defaultExpanded
      headline={
        <CompanyDiagnosticSectionScore
          score={score}
          label={t("companyDiagnostic.explanations.scoreQuality.title")}
          explanation={t("companyDiagnostic.explanations.scoreQuality.body")}
        />
      }
    >
      <div className="space-y-5">
        <SubCard icon={<PieChart className="w-5 h-5" style={{ color: "var(--accent-l)" }} />} title={t("companyDiagnostic.pillars.quality.revenueBreakdown")}>
          <div className="space-y-3">
            {revenueBreakdown.map((r) => (
              <div key={r.category}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>{r.category}</span>
                  <span className="text-[14px] font-black tabular-nums" style={{ color: "var(--text)" }}>{r.percentage}%</span>
                </div>
                <div className="h-2 rounded-full" style={{ background: "var(--border)" }}>
                  <div className="h-2 rounded-full" style={{ width: `${r.percentage}%`, background: "var(--accent)" }} />
                </div>
              </div>
            ))}
          </div>
        </SubCard>

        <SubCard icon={<Castle className="w-5 h-5" style={{ color: "#4FA695" }} />} title={t("companyDiagnostic.pillars.quality.moatTitle")}>
          <div className="space-y-2">
            {moatPoints.map((point, i) => (
              <div key={i} className="rounded-xl p-3" style={{ background: "var(--card)" }}>
                <p className="text-[14px] leading-relaxed" style={{ color: "var(--text)" }}>{point}</p>
              </div>
            ))}
          </div>
        </SubCard>

        {sectorComparison && (
          <SubCard icon={<Scale className="w-5 h-5" style={{ color: "var(--accent-l)" }} />} title={t("companyDiagnostic.pillars.quality.sectorComparisonTitle")}>
            <CompanyDiagnosticSectorComparison comparison={sectorComparison} ticker={ticker} />
          </SubCard>
        )}

        {competitorComparison && (
          <SubCard icon={<Swords className="w-5 h-5" style={{ color: "#DD6E63" }} />} title={t("companyDiagnostic.pillars.quality.competitorTitle")}>
            <CompanyDiagnosticCompetitorTable competitorComparison={competitorComparison} />
          </SubCard>
        )}
      </div>
    </ExpandableSection>
  );
}
