"use client";

// Pilar 2 (Confianza) — a clean metrics grid for financial health, wrapped
// in the shared ExpandableSection accordion.

import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { RaisedBlock } from "@/components/ui/Card";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

export function CompanyDiagnosticTrustPillar({
  financialHealth,
}: {
  financialHealth: CompanyDiagnosticData["financialHealth"];
}) {
  const { t } = useTranslation();

  const rows: { label: string; value: string }[] = [
    { label: t("companyDiagnostic.pillars.trust.longTermDebt"), value: financialHealth.longTermDebt },
    { label: t("companyDiagnostic.pillars.trust.netCash"), value: financialHealth.netCash },
    { label: t("companyDiagnostic.pillars.trust.roic"), value: financialHealth.roic },
    { label: t("companyDiagnostic.pillars.trust.operatingMargin"), value: financialHealth.operatingMargin },
    { label: t("companyDiagnostic.pillars.trust.netMargin"), value: financialHealth.netMargin },
    { label: t("companyDiagnostic.pillars.trust.operatingCashFlow"), value: financialHealth.operatingCashFlow },
  ];

  return (
    <ExpandableSection
      title={t("companyDiagnostic.pillars.trust.title")}
      icon={<Shield className="w-4 h-4" style={{ color: "#6366F1" }} />}
    >
      <div className="grid grid-cols-2 gap-2">
        {rows.map((row) => (
          <RaisedBlock key={row.label}>
            <p className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>{row.label}</p>
            <p className="text-[13px] font-black tabular-nums" style={{ color: "var(--text)" }}>{row.value}</p>
          </RaisedBlock>
        ))}
      </div>
    </ExpandableSection>
  );
}
