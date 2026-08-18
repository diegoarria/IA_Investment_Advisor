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
//
// The 3 scenario labels used to float directly above the bar at their true
// numeric position — but when the current price sits far outside the
// conservative/base/optimistic range (a real, common case: AAPL trading at
// $305 against a $196-$250 fair-value range), those 3 values compress into
// a tight cluster and their labels overlap into unreadable text (confirmed
// live by Diego on AAPL, on mobile — same bug here since neither version
// had collision avoidance). Fixed by splitting the two concerns: the bar
// keeps small tick marks at the TRUE relative position (still useful at a
// glance), but the label+value for each scenario now renders in a fixed
// 3-column legend row below the bar, always evenly spaced in bear/base/
// bull order regardless of how close the real values are — this can never
// overlap. The current-price badge is the only element still floating
// above the bar; its anchor is clamped well inside the edges so it can't
// clip past the container on an outlier price.

import { useTranslation } from "react-i18next";
import { fmtPrice } from "@/lib/types/stock";
import { _SCENARIO_COLOR } from "@/components/subvaluadas/shared";
import type { ValuationScenarios } from "@/lib/types/companyDiagnostic";

const PRICE_MIN = 10;
const PRICE_MAX = 90;

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
  const pricePct = Math.min(PRICE_MAX, Math.max(PRICE_MIN, pctOf(currentPrice)));

  const markers: { key: "conservative" | "baseFairValue" | "optimistic"; label: string; value: number; color: string }[] = [
    { key: "conservative", label: t("companyDiagnostic.thermometer.conservative"), value: conservative, color: _SCENARIO_COLOR.bear },
    { key: "baseFairValue", label: t("companyDiagnostic.thermometer.baseFairValue"), value: baseFairValue, color: _SCENARIO_COLOR.base },
    { key: "optimistic", label: t("companyDiagnostic.thermometer.optimistic"), value: optimistic, color: _SCENARIO_COLOR.bull },
  ];

  return (
    <div className="mt-2">
      <p className="text-[13px] font-bold uppercase tracking-wide mb-3" style={{ color: "var(--muted)" }}>
        {t("companyDiagnostic.thermometer.title")}
      </p>

      <div className="relative mt-7 mb-2">
        <div
          className="h-2.5 rounded-full"
          style={{ background: `linear-gradient(90deg, ${_SCENARIO_COLOR.bear}, ${_SCENARIO_COLOR.base}, ${_SCENARIO_COLOR.bull})` }}
        />
        {markers.map((m) => (
          <div
            key={m.key}
            className="absolute top-0 -translate-x-1/2 w-2 h-2 rounded-full border-2"
            style={{ left: `${pctOf(m.value)}%`, background: "var(--card)", borderColor: m.color }}
          />
        ))}
        <div className="absolute -top-7 -translate-x-1/2 flex flex-col items-center" style={{ left: `${pricePct}%` }}>
          <span className="text-[13px] font-black tabular-nums rounded-full px-2.5 py-1 whitespace-nowrap" style={{ background: "var(--text)", color: "var(--card)" }}>
            {t("companyDiagnostic.thermometer.priceToday")} {fmtPrice(currentPrice)}
          </span>
          <div className="w-0.5 h-3.5" style={{ background: "var(--text)" }} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        {markers.map((m) => (
          <div key={m.key} className="flex flex-col items-center text-center">
            <p className="text-[12px] font-bold whitespace-nowrap" style={{ color: m.color }}>{m.label}</p>
            <p className="text-[14px] font-black tabular-nums whitespace-nowrap mt-0.5" style={{ color: "var(--text)" }}>{fmtPrice(m.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
