"use client";

// Pilar 3 (Valor) — valuation multiples + scenario breakdown, then embeds
// the REAL "Mi Zona de Compra" module: FollowAlertPanel already does
// exactly what this pillar asks for (margin-of-safety presets, custom
// input, real target-price math, and a real price-alert creation button
// wired to priceAlerts.create()) — reused directly instead of building a
// second slider/selector from scratch.

import { useTranslation } from "react-i18next";
import { Gem } from "lucide-react";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { RaisedBlock } from "@/components/ui/Card";
import { FollowAlertPanel } from "@/components/subvaluadas/FollowAlertPanel";
import { fmtPrice } from "@/lib/types/stock";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

export const COMPANY_DIAGNOSTIC_VALUE_PILLAR_ID = "company-diagnostic-value-pillar";

export function CompanyDiagnosticValuePillar({
  ticker, companyName, valuation,
}: {
  ticker: string;
  companyName: string;
  valuation: CompanyDiagnosticData["valuation"];
}) {
  const { t } = useTranslation();

  const multiples: { label: string; value: string }[] = [
    { label: t("companyDiagnostic.pillars.value.peCurrent"), value: `${valuation.peCurrent.toFixed(1)}x` },
    { label: t("companyDiagnostic.pillars.value.peHistorical"), value: `${valuation.peHistoricalAvg.toFixed(1)}x` },
    { label: t("companyDiagnostic.pillars.value.evFcf"), value: `${valuation.evFcf.toFixed(1)}x` },
  ];

  const scenarios: { label: string; value: number; color: string }[] = [
    { label: t("companyDiagnostic.pillars.value.conservative"), value: valuation.conservative, color: "#DD6E63" },
    { label: t("companyDiagnostic.pillars.value.baseFairValue"), value: valuation.baseFairValue, color: "#D4A24C" },
    { label: t("companyDiagnostic.pillars.value.optimistic"), value: valuation.optimistic, color: "#4FA695" },
  ];

  return (
    <div id={COMPANY_DIAGNOSTIC_VALUE_PILLAR_ID}>
      <ExpandableSection
        title={t("companyDiagnostic.pillars.value.title")}
        icon={<Gem className="w-4 h-4" style={{ color: "#4FA695" }} />}
        defaultExpanded
      >
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
            {t("companyDiagnostic.pillars.value.multiplesTitle")}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {multiples.map((m) => (
              <RaisedBlock key={m.label}>
                <p className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>{m.label}</p>
                <p className="text-[13px] font-black tabular-nums" style={{ color: "var(--text)" }}>{m.value}</p>
              </RaisedBlock>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
            {t("companyDiagnostic.pillars.value.modelsTitle")}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {scenarios.map((s) => (
              <div key={s.label} className="rounded-xl p-2.5 text-center" style={{ background: `${s.color}1f`, border: `1px solid ${s.color}` }}>
                <p className="text-[8px] font-bold uppercase tracking-wide" style={{ color: s.color }}>{s.label}</p>
                <p className="text-[13px] font-black tabular-nums mt-0.5" style={{ color: "var(--text)" }}>{fmtPrice(s.value)}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>
            {t("companyDiagnostic.pillars.value.marginOfSafety")}:{" "}
            <span className="font-black tabular-nums" style={{ color: "#4FA695" }}>{valuation.marginOfSafetyPercent.toFixed(1)}%</span>
          </p>
        </div>
      </ExpandableSection>

      <FollowAlertPanel
        ticker={ticker}
        companyName={companyName}
        price={valuation.currentPrice}
        intrinsicValue={valuation.baseFairValue}
        defaultMarginPct={Math.round(valuation.marginOfSafetyPercent)}
      />
    </div>
  );
}
