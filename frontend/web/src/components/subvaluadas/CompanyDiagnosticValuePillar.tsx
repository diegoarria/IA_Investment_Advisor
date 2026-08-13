"use client";

// Pilar 3 (Valor) — valuation multiples + selectable scenario tabs (Bear/
// Base/Bull always visible, never hidden behind one click — same
// discipline shared.tsx's own scenario-tabs comment documents elsewhere in
// this app), with margin of safety recomputed live via the app's own
// _valuationStatus formula. Then embeds the REAL "Mi Zona de Compra"
// module: CompanyDiagnosticBuyZonePanel (a themed sibling of
// FollowAlertPanel — same real price-alert logic, restyled to match this
// card instead of FollowAlertPanel's own hardcoded white background, which
// stays untouched since it's shared with the real /subvaluadas page).
// Remounted via `key={selectedScenario}` when the scenario changes so its
// own internal state (seeded once from props at mount) picks up the new
// anchor.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Gem } from "lucide-react";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { RaisedBlock } from "@/components/ui/Card";
import { ExplainableValue } from "@/components/ui/ExplainableValue";
import { CompanyDiagnosticSectionScore } from "@/components/subvaluadas/CompanyDiagnosticSectionScore";
import { CompanyDiagnosticBuyZonePanel } from "@/components/subvaluadas/CompanyDiagnosticBuyZonePanel";
import { _valuationStatus, _VERDICT_COLOR, _VERDICT_EMOJI } from "@/components/subvaluadas/shared";
import { fmtPrice } from "@/lib/types/stock";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

export const COMPANY_DIAGNOSTIC_VALUE_PILLAR_ID = "company-diagnostic-value-pillar";

type ScenarioKey = "conservative" | "baseFairValue" | "optimistic";

export function CompanyDiagnosticValuePillar({
  score, ticker, companyName, valuation,
}: {
  score: number;
  ticker: string;
  companyName: string;
  valuation: CompanyDiagnosticData["valuation"];
}) {
  const { t } = useTranslation();
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>("baseFairValue");

  const multiples: { explKey: string; value: string }[] = [
    { explKey: "peCurrent", value: `${valuation.peCurrent.toFixed(1)}x` },
    { explKey: "peHistorical", value: `${valuation.peHistoricalAvg.toFixed(1)}x` },
    { explKey: "evFcf", value: `${valuation.evFcf.toFixed(1)}x` },
  ];

  const scenarios: { key: ScenarioKey; label: string; value: number; color: string }[] = [
    { key: "conservative", label: t("companyDiagnostic.pillars.value.conservative"), value: valuation.conservative, color: "#DD6E63" },
    { key: "baseFairValue", label: t("companyDiagnostic.pillars.value.baseFairValue"), value: valuation.baseFairValue, color: "#D4A24C" },
    { key: "optimistic", label: t("companyDiagnostic.pillars.value.optimistic"), value: valuation.optimistic, color: "#4FA695" },
  ];

  const selectedValue = scenarios.find((s) => s.key === selectedScenario)!.value;
  const status = _valuationStatus(selectedValue, valuation.currentPrice);

  return (
    <div id={COMPANY_DIAGNOSTIC_VALUE_PILLAR_ID}>
      <ExpandableSection
        title={t("companyDiagnostic.pillars.value.title")}
        icon={<Gem className="w-5 h-5" style={{ color: "#4FA695" }} />}
        headline={
          <CompanyDiagnosticSectionScore
            score={score}
            label={t("companyDiagnostic.explanations.scoreValue.title")}
            explanation={t("companyDiagnostic.explanations.scoreValue.body")}
          />
        }
        defaultExpanded
      >
        <div>
          <p className="text-[13px] font-bold uppercase tracking-wide mb-2.5" style={{ color: "var(--muted)" }}>
            {t("companyDiagnostic.pillars.value.multiplesTitle")}
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            {multiples.map((m) => (
              <RaisedBlock key={m.explKey}>
                <ExplainableValue
                  label={t(`companyDiagnostic.explanations.${m.explKey}.title`)}
                  content={{ summary: t(`companyDiagnostic.explanations.${m.explKey}.body`) }}
                >
                  <span className="block text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    {t(`companyDiagnostic.pillars.value.${m.explKey}`)}
                  </span>
                </ExplainableValue>
                <p className="text-[16px] font-black tabular-nums mt-1" style={{ color: "var(--text)" }}>{m.value}</p>
              </RaisedBlock>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[13px] font-bold uppercase tracking-wide mb-2.5" style={{ color: "var(--muted)" }}>
            {t("companyDiagnostic.pillars.value.modelsTitle")}
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            {scenarios.map((s) => {
              const isSelected = s.key === selectedScenario;
              return (
                <button
                  key={s.key}
                  onClick={() => setSelectedScenario(s.key)}
                  className="rounded-xl p-3 text-center transition-all"
                  style={{
                    background: `${s.color}${isSelected ? "33" : "1f"}`,
                    border: `${isSelected ? 2 : 1}px solid ${s.color}`,
                  }}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: s.color }}>{s.label}</p>
                  <p className="text-[16px] font-black tabular-nums mt-0.5" style={{ color: "var(--text)" }}>{fmtPrice(s.value)}</p>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3">
            <ExplainableValue
              label={t("companyDiagnostic.explanations.marginOfSafety.title")}
              content={{ summary: t("companyDiagnostic.explanations.marginOfSafety.body") }}
            >
              <span className="text-[13px]" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.pillars.value.marginOfSafety")}</span>
            </ExplainableValue>
            {status && (
              <span className="text-[15px] font-black tabular-nums flex items-center gap-1" style={{ color: _VERDICT_COLOR[status.verdict] }}>
                {_VERDICT_EMOJI[status.verdict]} {status.pct.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      </ExpandableSection>

      <CompanyDiagnosticBuyZonePanel
        key={selectedScenario}
        ticker={ticker}
        companyName={companyName}
        price={valuation.currentPrice}
        intrinsicValue={selectedValue}
        defaultMarginPct={status?.verdict === "undervalued" ? Math.round(status.pct) : undefined}
      />
    </div>
  );
}
