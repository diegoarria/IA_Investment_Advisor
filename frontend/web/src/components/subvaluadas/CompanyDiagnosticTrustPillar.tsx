"use client";

// Pilar 2 (Confianza) — a clean metrics grid for financial health, each
// label wrapped in ExplainableValue so every concept (ROIC, deuda,
// márgenes...) has a real (i) explanation, wrapped in the shared
// ExpandableSection accordion.

import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { RaisedBlock } from "@/components/ui/Card";
import { ExplainableValue } from "@/components/ui/ExplainableValue";
import { CompanyDiagnosticSectionScore } from "@/components/subvaluadas/CompanyDiagnosticSectionScore";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

export function CompanyDiagnosticTrustPillar({
  score, financialHealth, roicAdjustedForBuybacks,
}: {
  score: number;
  financialHealth: CompanyDiagnosticData["financialHealth"];
  roicAdjustedForBuybacks?: boolean;
}) {
  const { t } = useTranslation();

  const rows: { explKey: string; value: string }[] = [
    { explKey: "longTermDebt", value: financialHealth.longTermDebt },
    { explKey: "netCash", value: financialHealth.netCash },
    { explKey: "roic", value: financialHealth.roic },
    { explKey: "operatingMargin", value: financialHealth.operatingMargin },
    { explKey: "netMargin", value: financialHealth.netMargin },
    { explKey: "operatingCashFlow", value: financialHealth.operatingCashFlow },
  ];

  return (
    <ExpandableSection
      title={t("companyDiagnostic.pillars.trust.title")}
      icon={<Shield className="w-5 h-5" style={{ color: "#6366F1" }} />}
      defaultExpanded
      headline={
        <CompanyDiagnosticSectionScore
          score={score}
          label={t("companyDiagnostic.explanations.scoreTrust.title")}
          explanation={t("companyDiagnostic.explanations.scoreTrust.body")}
        />
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        {rows.map((row) => {
          const label = t(`companyDiagnostic.pillars.trust.${row.explKey}`);
          return (
            <RaisedBlock key={row.explKey}>
              <ExplainableValue
                label={t(`companyDiagnostic.explanations.${row.explKey}.title`)}
                content={{ summary: t(`companyDiagnostic.explanations.${row.explKey}.body`) }}
              >
                <span className="block text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{label}</span>
              </ExplainableValue>
              <p className="text-[17px] font-black tabular-nums mt-1" style={{ color: "var(--text)" }}>{row.value}</p>
              {row.explKey === "roic" && roicAdjustedForBuybacks && (
                <p className="text-[9.5px] mt-1" style={{ color: "var(--muted)" }}>
                  {t("companyDiagnostic.pillars.trust.roicAdjustedNote")}
                </p>
              )}
            </RaisedBlock>
          );
        })}
      </div>
    </ExpandableSection>
  );
}
