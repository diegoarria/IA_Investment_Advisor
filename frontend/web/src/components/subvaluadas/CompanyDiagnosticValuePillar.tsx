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
import { PillarSection, RaisedTile, Eyebrow } from "@/components/subvaluadas/radarUi";
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

  const fmtMultiple = (v: number | null) => (v != null ? `${v.toFixed(1)}x` : t("companyDiagnostic.pillars.value.notAvailable"));
  // P/E Actual (TTM), P/E Forward (NTM) and P/E Ajustado shown as standard,
  // side by side, for every company — not just when they happen to differ
  // (per Diego's explicit request that Forward P/E be a standard field in
  // the Value box, not tucked into an optional "ver supuestos" toggle).
  const multiples: { explKey: string; value: string }[] = [
    { explKey: "peCurrent", value: fmtMultiple(valuation.peCurrent) },
    { explKey: "peForward", value: fmtMultiple(valuation.peForward) },
    { explKey: "peNormalized", value: fmtMultiple(valuation.peNormalized) },
    { explKey: "peHistorical", value: fmtMultiple(valuation.peHistoricalAvg) },
    { explKey: "evFcf", value: fmtMultiple(valuation.evFcf) },
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
      <PillarSection
        title={t("companyDiagnostic.pillars.value.title")}
        icon={<Gem className="w-[18px] h-[18px]" style={{ color: "#4FA695" }} />}
        iconColor="#4FA695"
        headline={
          <CompanyDiagnosticSectionScore
            score={score}
            label={t("companyDiagnostic.explanations.scoreValue.title")}
            explanation={t("companyDiagnostic.explanations.scoreValue.body")}
          />
        }
      >
        <div>
          <Eyebrow>{t("companyDiagnostic.pillars.value.multiplesTitle")}</Eyebrow>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {multiples.map((m) => (
              <RaisedTile key={m.explKey} tint="#4FA695">
                <ExplainableValue
                  label={t(`companyDiagnostic.explanations.${m.explKey}.title`)}
                  content={{ summary: t(`companyDiagnostic.explanations.${m.explKey}.body`) }}
                >
                  <span className="block text-[10.5px] font-black uppercase tracking-[0.4px] truncate" style={{ color: "var(--muted)" }}>
                    {t(`companyDiagnostic.pillars.value.${m.explKey}`)}
                  </span>
                </ExplainableValue>
                <p className="text-[22px] font-black tabular-nums mt-2 tracking-tight" style={{ color: "var(--text)" }}>{m.value}</p>
              </RaisedTile>
            ))}
          </div>
        </div>

        <div>
          <Eyebrow>{t("companyDiagnostic.pillars.value.modelsTitle")}</Eyebrow>
          <div className="flex gap-1.5 p-[5px] rounded-[18px]" style={{ background: "var(--raised)" }}>
            {scenarios.map((sc) => {
              const isSelected = sc.key === selectedScenario;
              return (
                <button
                  key={sc.key}
                  onClick={() => setSelectedScenario(sc.key)}
                  className="flex-1 min-w-0 rounded-[14px] py-[11px] px-1 flex flex-col items-center transition-all"
                  style={{ background: isSelected ? `linear-gradient(135deg, ${sc.color}, ${sc.color}b3)` : "transparent" }}
                >
                  <span className="text-[9.5px] font-black uppercase tracking-[0.4px] text-center" style={{ color: isSelected ? "#0A0F1A" : sc.color }}>{sc.label}</span>
                  <span className="text-[15.5px] font-black tabular-nums mt-1" style={{ color: isSelected ? "#0A0F1A" : "var(--text)" }}>{fmtPrice(sc.value)}</span>
                </button>
              );
            })}
          </div>

          <div
            className="mt-3 rounded-2xl flex items-center gap-2.5 px-4 py-3.5"
            style={{
              background: status ? `linear-gradient(90deg, ${_VERDICT_COLOR[status.verdict]}2b, ${_VERDICT_COLOR[status.verdict]}08)` : "var(--raised)",
              border: `1px solid ${status ? `${_VERDICT_COLOR[status.verdict]}55` : "var(--border)"}`,
            }}
          >
            <div className="flex-1 min-w-0">
              <ExplainableValue
                label={t("companyDiagnostic.explanations.marginOfSafety.title")}
                content={{ summary: t("companyDiagnostic.explanations.marginOfSafety.body") }}
              >
                <span className="text-[13.5px] font-bold" style={{ color: "var(--sub)" }}>{t("companyDiagnostic.pillars.value.marginOfSafety")}</span>
              </ExplainableValue>
            </div>
            {status && (
              <span className="text-2xl font-black tabular-nums tracking-tight" style={{ color: _VERDICT_COLOR[status.verdict] }}>
                {_VERDICT_EMOJI[status.verdict]} {status.pct.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      </PillarSection>

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
