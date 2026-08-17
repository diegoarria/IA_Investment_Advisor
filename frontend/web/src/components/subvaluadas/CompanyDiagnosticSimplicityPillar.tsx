"use client";

// Pilar 4 (Simplicidad) — red/green noise-vs-reality contrast blocks plus
// the suggested action plan, wrapped in the shared ExpandableSection.

import { useTranslation } from "react-i18next";
import { Lightbulb } from "lucide-react";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { CompanyDiagnosticSectionScore } from "@/components/subvaluadas/CompanyDiagnosticSectionScore";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

export function CompanyDiagnosticSimplicityPillar({
  score, noiseVsReality, actionPlan,
}: {
  score: number;
  noiseVsReality: CompanyDiagnosticData["noiseVsReality"];
  actionPlan: CompanyDiagnosticData["actionPlan"];
}) {
  const { t } = useTranslation();

  return (
    <ExpandableSection
      title={t("companyDiagnostic.pillars.simplicity.title")}
      icon={<Lightbulb className="w-5 h-5" style={{ color: "#f59e0b" }} />}
      defaultExpanded
      headline={
        <CompanyDiagnosticSectionScore
          score={score}
          label={t("companyDiagnostic.explanations.scoreSimplicity.title")}
          explanation={t("companyDiagnostic.explanations.scoreSimplicity.body")}
        />
      }
    >
      {noiseVsReality && (
        <div className="space-y-3">
          <div className="rounded-xl p-4" style={{ background: "#ef44441a", border: "1px solid #ef4444" }}>
            <p className="text-[13px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "#ef4444" }}>
              🔴 {t("companyDiagnostic.pillars.simplicity.marketSaw")}
            </p>
            <p className="text-[14px] leading-relaxed" style={{ color: "var(--text)" }}>{noiseVsReality.marketSaw}</p>
          </div>
          <div className="rounded-xl p-4" style={{ background: "#22c55e1a", border: "1px solid #22c55e" }}>
            <p className="text-[13px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "#22c55e" }}>
              🟢 {t("companyDiagnostic.pillars.simplicity.nuvosReality")}
            </p>
            <p className="text-[14px] leading-relaxed" style={{ color: "var(--text)" }}>{noiseVsReality.nuvosReality}</p>
          </div>
        </div>
      )}

      {actionPlan && (
        <div>
          <p className="text-[13px] font-bold uppercase tracking-wide mb-2.5" style={{ color: "var(--muted)" }}>
            {t("companyDiagnostic.pillars.simplicity.actionPlanTitle")}
          </p>
          <div className="rounded-xl p-4" style={{ background: "var(--raised)" }}>
            <p className="text-[12px]" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.pillars.simplicity.profile")}</p>
            <p className="text-[15px] font-bold mb-2.5" style={{ color: "var(--text)" }}>{actionPlan.profile}</p>
            <p className="text-[12px]" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.pillars.simplicity.strategy")}</p>
            <p className="text-[15px] font-bold" style={{ color: "var(--text)" }}>{actionPlan.strategy}</p>
          </div>
        </div>
      )}
    </ExpandableSection>
  );
}
