"use client";

// Capa 1 — horizontal Bear/Base/Bull + current-price bar. Same visual
// language as shared.tsx's private `_PriceVsScenariosBar` (gradient bar,
// tick markers, price marker above), rebuilt standalone here because
// CompanyDiagnosticData's flat ValuationScenarios shape (conservative/
// baseFairValue/optimistic/currentPrice) differs from that component's
// NuvosScenario-object props — reuses the SAME color tokens and verdict
// logic (_SCENARIO_COLOR/_valuationStatus/_VERDICT_COLOR/_VERDICT_EMOJI)
// rather than redefining them, so the color language stays identical
// across the app.

import { useTranslation } from "react-i18next";
import { fmtPrice } from "@/lib/types/stock";
import { _SCENARIO_COLOR, _valuationStatus, _VERDICT_COLOR, _VERDICT_EMOJI } from "@/components/subvaluadas/shared";
import type { ValuationScenarios } from "@/lib/types/companyDiagnostic";

export function CompanyDiagnosticValuationThermometer({ scenarios }: { scenarios: ValuationScenarios }) {
  const { t } = useTranslation();
  const { conservative, baseFairValue, optimistic, currentPrice } = scenarios;

  const rawMin = Math.min(conservative, baseFairValue, optimistic, currentPrice);
  const rawMax = Math.max(conservative, baseFairValue, optimistic, currentPrice);
  const pad = (rawMax - rawMin) * 0.12 || rawMax * 0.1 || 1;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const span = max - min || 1;
  const pctOf = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100));

  const markers: { key: "conservative" | "baseFairValue" | "optimistic"; label: string; value: number; color: string }[] = [
    { key: "conservative", label: t("companyDiagnostic.thermometer.conservative"), value: conservative, color: _SCENARIO_COLOR.bear },
    { key: "baseFairValue", label: t("companyDiagnostic.thermometer.baseFairValue"), value: baseFairValue, color: _SCENARIO_COLOR.base },
    { key: "optimistic", label: t("companyDiagnostic.thermometer.optimistic"), value: optimistic, color: _SCENARIO_COLOR.bull },
  ];

  const status = _valuationStatus(baseFairValue, currentPrice);

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          {t("companyDiagnostic.thermometer.title")}
        </p>
        {status && (
          <span className="flex items-center gap-1 text-[11px] font-bold" style={{ color: _VERDICT_COLOR[status.verdict] }}>
            {_VERDICT_EMOJI[status.verdict]}
            {status.verdict === "undervalued"
              ? t("companyDiagnostic.thermometer.undervalued")
              : status.verdict === "overvalued"
                ? t("companyDiagnostic.thermometer.overvalued")
                : t("companyDiagnostic.thermometer.fair")}
            {" "}({status.pct.toFixed(1)}%)
          </span>
        )}
      </div>

      <div className="relative mt-6 mb-12">
        <div
          className="h-2 rounded-full"
          style={{ background: `linear-gradient(90deg, ${_SCENARIO_COLOR.bear}, ${_SCENARIO_COLOR.base}, ${_SCENARIO_COLOR.bull})` }}
        />
        {markers.map((m) => (
          <div key={m.key} className="absolute top-0 -translate-x-1/2 flex flex-col items-center" style={{ left: `${pctOf(m.value)}%` }}>
            <div className="w-0.5 h-2 rounded-full" style={{ background: "rgba(0,0,0,0.25)" }} />
            <p className="text-[9px] font-bold whitespace-nowrap mt-1" style={{ color: "var(--muted)" }}>{m.label}</p>
            <p className="text-[10px] font-black tabular-nums whitespace-nowrap" style={{ color: "var(--text)" }}>{fmtPrice(m.value)}</p>
          </div>
        ))}
        <div className="absolute -top-6 -translate-x-1/2 flex flex-col items-center" style={{ left: `${pctOf(currentPrice)}%` }}>
          <span className="text-[10px] font-black tabular-nums rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: "var(--text)", color: "var(--card)" }}>
            {t("companyDiagnostic.thermometer.priceToday")} {fmtPrice(currentPrice)}
          </span>
          <div className="w-0.5 h-3" style={{ background: "var(--text)" }} />
        </div>
      </div>
    </div>
  );
}
