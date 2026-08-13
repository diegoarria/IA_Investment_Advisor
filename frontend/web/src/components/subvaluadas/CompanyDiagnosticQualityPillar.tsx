"use client";

// Pilar 1 (Calidad) — revenue breakdown, moat bullet points, and the
// competitor "Duelo de Titanes" table, wrapped in the app's shared
// ExpandableSection accordion primitive.

import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { RaisedBlock } from "@/components/ui/Card";
import { CompanyDiagnosticCompetitorTable } from "@/components/subvaluadas/CompanyDiagnosticCompetitorTable";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

export function CompanyDiagnosticQualityPillar({
  revenueBreakdown, moatPoints, competitorComparison,
}: {
  revenueBreakdown: CompanyDiagnosticData["revenueBreakdown"];
  moatPoints: string[];
  competitorComparison: CompanyDiagnosticData["competitorComparison"];
}) {
  const { t } = useTranslation();

  return (
    <ExpandableSection
      title={t("companyDiagnostic.pillars.quality.title")}
      icon={<Trophy className="w-4 h-4" style={{ color: "#eab308" }} />}
    >
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
          {t("companyDiagnostic.pillars.quality.revenueBreakdown")}
        </p>
        <div className="space-y-2">
          {revenueBreakdown.map((r) => (
            <div key={r.category}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold" style={{ color: "var(--text)" }}>{r.category}</span>
                <span className="text-[11px] font-black tabular-nums" style={{ color: "var(--text)" }}>{r.percentage}%</span>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: "var(--raised)" }}>
                <div className="h-1.5 rounded-full" style={{ width: `${r.percentage}%`, background: "var(--accent)" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
          {t("companyDiagnostic.pillars.quality.moatTitle")}
        </p>
        <div className="space-y-1.5">
          {moatPoints.map((point, i) => (
            <RaisedBlock key={i}>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--text)" }}>{point}</p>
            </RaisedBlock>
          ))}
        </div>
      </div>

      <CompanyDiagnosticCompetitorTable competitorComparison={competitorComparison} />
    </ExpandableSection>
  );
}
