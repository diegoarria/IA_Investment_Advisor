"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, RotateCcw, Sliders, ChevronDown, Check } from "lucide-react";
import {
  type NuvosFairValueData, type NuvosScenario, type NifMoatData, type NifDeteriorationData, type ConfidenceMeterData,
  _ComparisonBars, _valuationStatus, _VERDICT_COLOR, _VERDICT_EMOJI, _SCENARIO_COLOR, _fmtCompactMoney,
  _solveImpliedGrowth, _solveImpliedDiscountRate, _solveImpliedExitMultiple, deriveBaseInputs,
} from "./shared";
import { projectDriverBasedDcf, type DriverBasedDcfInput, type DriverBasedDcfResult } from "@/lib/driverBasedDcf";

type ScenarioName = "bear" | "base" | "bull";
type TabId = "template" | "projection" | "conversion" | "discount" | "terminal" | "result" | "full";

const TAB_ORDER: TabId[] = ["template", "projection", "conversion", "discount", "terminal", "result", "full"];

interface CustomAssumptions {
  growth1Pct: number;
  marginStartPct: number;
  marginTerminalPct: number;
  reinvestmentRateAnchorPct: number;
  discountRatePct: number;
  exitMultiple: number;
}

function assumptionsFromScenario(scenario: NuvosScenario): CustomAssumptions {
  const a = scenario.assumptions;
  return {
    growth1Pct: a.revenue_growth_1_pct,
    marginStartPct: a.operating_margin_anchor_pct,
    marginTerminalPct: a.terminal_operating_margin_pct,
    reinvestmentRateAnchorPct: a.reinvestment_rate_anchor_pct,
    discountRatePct: a.discount_rate_pct,
    exitMultiple: a.exit_multiple ?? 0,
  };
}

function Slider({
  label, value, min, max, step, unit, onChange, referencePoints,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  referencePoints?: { label: string; value: number }[];
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-bold" style={{ color: "var(--sub)" }}>{label}</span>
        <span className="text-[12px] font-black tabular-nums" style={{ color: "var(--text)" }}>
          {value.toFixed(step < 1 ? 1 : 0)}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-current"
        style={{ accentColor: "var(--accent)" }}
      />
      {referencePoints && referencePoints.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {referencePoints.map((rp) => (
            <button
              key={rp.label}
              onClick={() => onChange(rp.value)}
              className="text-[9.5px] rounded-full px-2 py-0.5"
              style={{ background: "var(--raised)", color: "var(--muted)" }}
            >
              {rp.label}: <b style={{ color: "var(--sub)" }}>{rp.value.toFixed(1)}{unit}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-4 mb-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <p className="text-[12px] font-bold mb-3" style={{ color: "var(--text)" }}>{title}</p>
      {children}
    </div>
  );
}

// "¿Cómo llegamos a este valor?" — the walkthrough Diego was most excited
// about. Every step's number is real: year-1 of the actual 10-year
// projection for revenue/margin/FCF, then the real PV of the full 10-year
// FCF stream and the real PV of the terminal value — never a cosmetic
// placeholder next to the label.
// Diego's favorite — "¿Por qué Nuvos vale menos/más que el mercado?" A
// waterfall from the market price down (or up) to Nuvos's fair value,
// attributed one assumption at a time: for each of growth/WACC/exit
// multiple, solve what THAT ONE assumption alone would need to be (others
// held at Nuvos's real values) to justify the market price, then compare
// to Nuvos's own real value for that same assumption. This is a genuine
// one-at-a-time sensitivity attribution, not a fabricated narrative.
function _MarketVsNuvosBridge({ baseInputs, price, fv }: { baseInputs: DriverBasedDcfInput | null; price: number | null; fv: number | null }) {
  const { t } = useTranslation();
  const rows = useMemo(() => {
    if (!baseInputs || !price) return null;
    const impliedGrowth = _solveImpliedGrowth(baseInputs, price);
    const impliedDiscount = _solveImpliedDiscountRate(baseInputs, price);
    const impliedMultiple = _solveImpliedExitMultiple(baseInputs, price);
    const out: { key: string; delta: number; unit: string }[] = [];
    if (impliedGrowth !== null) out.push({ key: "growth", delta: impliedGrowth - baseInputs.revenueGrowth1 * 100, unit: "pp" });
    if (impliedDiscount !== null) out.push({ key: "wacc", delta: (impliedDiscount - baseInputs.discountRate) * 100, unit: "pp" });
    if (impliedMultiple !== null && baseInputs.exitMultiple) out.push({ key: "multiple", delta: impliedMultiple - baseInputs.exitMultiple, unit: "x" });
    return out;
  }, [baseInputs, price]);

  if (!rows || rows.length === 0 || price === null || fv === null) return null;
  const marketAbove = price > fv;

  return (
    <div className="rounded-2xl border p-4 mb-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <p className="text-[12px] font-bold mb-3" style={{ color: "var(--text)" }}>
        {marketAbove ? t("subvaluadas.fullModel.bridge2.titleBelow") : t("subvaluadas.fullModel.bridge2.titleAbove")}
      </p>
      <div className="flex items-center justify-center gap-4 mb-3">
        <div className="text-center">
          <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("subvaluadas.fullModel.bridge2.market")}</p>
          <p className="text-lg font-black tabular-nums" style={{ color: "var(--text)" }}>${price.toFixed(2)}</p>
        </div>
        <ChevronDown className="w-4 h-4 -rotate-90 shrink-0" style={{ color: "var(--muted)" }} />
        <div className="text-center">
          <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: _SCENARIO_COLOR.base }}>{t("subvaluadas.fullModel.bridge2.nuvos")}</p>
          <p className="text-lg font-black tabular-nums" style={{ color: "var(--text)" }}>${fv.toFixed(2)}</p>
        </div>
      </div>
      <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>{t("subvaluadas.fullModel.bridge2.differencesFrom")}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--raised)" }}>
            <span className="text-[10px] font-black" style={{ color: "var(--muted)" }}>+</span>
            <span className="text-[11.5px]" style={{ color: "var(--sub)" }}>
              {t(`subvaluadas.fullModel.bridge2.reasons.${r.key}`, { delta: `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(r.unit === "x" ? 2 : 1)}${r.unit}` })}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed mt-2.5" style={{ color: "var(--dim)" }}>
        {t("subvaluadas.fullModel.bridge2.disclaimer")}
      </p>
    </div>
  );
}

// "Calidad de la valuación" — NOT the company's quality, the MODEL's
// trustworthiness for THIS specific company. Every checkmark is a real,
// already-computed signal (moat_engine.stability_score, deterioration_
// engine's highest_concern, years_available, beta) — never a new
// fabricated score. The headline level is read straight off the existing
// `confidence_meter` (confidence_engine.py), which already blends these
// same kinds of signals server-side; the checklist below just explains
// WHY in plain language instead of a bare number.
function _ModelConfidenceCard({
  confidenceMeter, yearsAvailable, beta, moatEngine, deteriorationEngine,
}: {
  confidenceMeter: ConfidenceMeterData | null;
  yearsAvailable: number | null;
  beta: number | null;
  moatEngine: NifMoatData | null;
  deteriorationEngine: NifDeteriorationData | null;
}) {
  const { t } = useTranslation();
  if (!confidenceMeter) return null;

  const checks: { key: string; pass: boolean }[] = [
    { key: "matureBusiness", pass: !deteriorationEngine?.highest_concern },
    { key: "stableMargins", pass: (moatEngine?.stability_score ?? 0) >= 60 },
    { key: "longHistory", pass: (yearsAvailable ?? 0) >= 8 },
    { key: "lowVolatility", pass: beta !== null && beta < 1.3 },
  ];

  const level = confidenceMeter.stars >= 4 ? "high" : confidenceMeter.stars >= 2 ? "medium" : "low";
  const levelColor = level === "high" ? "#22c55e" : level === "medium" ? "#f59e0b" : "#ef4444";

  return (
    <div className="rounded-2xl border p-4 mb-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <p className="text-[12px] font-bold mb-0.5" style={{ color: "var(--text)" }}>{t("subvaluadas.fullModel.modelConfidence.title")}</p>
      <p className="text-[10px] mb-3" style={{ color: "var(--muted)" }}>{t("subvaluadas.fullModel.modelConfidence.subtitle")}</p>
      <span className="inline-block text-[12px] font-black rounded-full px-3 py-1 mb-3" style={{ background: `${levelColor}1f`, color: levelColor }}>
        {t(`subvaluadas.fullModel.modelConfidence.level.${level}`)}
      </span>
      <div className="space-y-1.5">
        {checks.map((c) => (
          <div key={c.key} className="flex items-center gap-2">
            {c.pass
              ? <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "#22c55e" }} />
              : <X className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--muted)" }} />}
            <span className="text-[11.5px]" style={{ color: c.pass ? "var(--text)" : "var(--muted)" }}>
              {t(`subvaluadas.fullModel.modelConfidence.checks.${c.key}`)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtShares(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toFixed(0);
}

// AlphaSpread's intrinsic-value bridge: Enterprise Value -> (- Net Debt /
// + Net Cash) -> Equity Value -> (÷ Shares) -> Fair Value per share. Every
// number here is either read directly from the real DCF result or backed
// out algebraically from it (net_cash = equity_value - enterprise_value,
// shares_out = equity_value / fair_value_per_share) — see
// `deriveBaseInputs` above, which computes these once from the real
// scenario and holds them fixed across slider customization (a company's
// real net cash/share count don't change when a user tweaks growth or
// WACC).
function _ValueBridge({
  enterpriseValue, netCash, equityValue, sharesOut, fairValue,
}: {
  enterpriseValue: number | null;
  netCash: number | null;
  equityValue: number | null;
  sharesOut: number | null;
  fairValue: number | null;
}) {
  const { t } = useTranslation();
  if (enterpriseValue === null) return null;
  const isNetCash = (netCash ?? 0) >= 0;

  const rows: { label: string; value: string; op?: string }[] = [
    { label: t("subvaluadas.fullModel.bridge.enterpriseValue"), value: _fmtCompactMoney(enterpriseValue) },
    {
      label: isNetCash ? t("subvaluadas.fullModel.bridge.netCash") : t("subvaluadas.fullModel.bridge.netDebt"),
      value: `${isNetCash ? "+" : "-"}${_fmtCompactMoney(Math.abs(netCash ?? 0))}`,
      op: isNetCash ? "+" : "−",
    },
    { label: t("subvaluadas.fullModel.bridge.equityValue"), value: _fmtCompactMoney(equityValue), op: "=" },
    { label: t("subvaluadas.fullModel.bridge.sharesOut"), value: sharesOut !== null ? fmtShares(sharesOut) : "N/D", op: "÷" },
  ];

  return (
    <div className="mb-4">
      <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
        {t("subvaluadas.fullModel.bridge.title")}
      </p>
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
        {rows.map((row, i) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 px-3.5 py-2.5"
            style={{ background: i % 2 === 0 ? "var(--card)" : "var(--raised)", borderTop: i > 0 ? "1px solid var(--border)" : undefined }}
          >
            <div className="flex items-center gap-2 min-w-0">
              {row.op && (
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black shrink-0" style={{ background: "var(--raised)", color: "var(--muted)" }}>
                  {row.op}
                </span>
              )}
              <span className="text-[11.5px] font-semibold truncate" style={{ color: "var(--sub)" }}>{row.label}</span>
            </div>
            <span className="text-[12.5px] font-black tabular-nums shrink-0" style={{ color: "var(--text)" }}>{row.value}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 px-3.5 py-3" style={{ background: "var(--accent)", borderTop: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black shrink-0" style={{ background: "rgba(10,15,26,0.15)", color: "#0A0F1A" }}>=</span>
            <span className="text-[12px] font-black" style={{ color: "#0A0F1A" }}>{t("subvaluadas.nuvosFairValue.headlineLabel")}</span>
          </div>
          <span className="text-[15px] font-black tabular-nums" style={{ color: "#0A0F1A" }}>{fairValue !== null ? `$${fairValue.toFixed(2)}` : "N/D"}</span>
        </div>
      </div>
    </div>
  );
}

// AlphaSpread's "40% explicit / 60% terminal" split — how much of the
// enterprise value comes from the real 10-year projected FCF stream vs.
// the real terminal value, both already computed by the same DCF result.
function _ValueContribution({ pvOfFcfSum, pvOfTerminalValue }: { pvOfFcfSum: number | null; pvOfTerminalValue: number | null }) {
  const { t } = useTranslation();
  if (pvOfFcfSum === null || pvOfTerminalValue === null) return null;
  const total = pvOfFcfSum + pvOfTerminalValue;
  if (total <= 0) return null;
  const explicitPct = (pvOfFcfSum / total) * 100;
  const terminalPct = 100 - explicitPct;

  return (
    <div className="mb-4">
      <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
        {t("subvaluadas.fullModel.contribution.title")}
      </p>
      <div className="h-6 rounded-full overflow-hidden flex" style={{ background: "var(--raised)" }}>
        <div className="h-full flex items-center justify-center" style={{ width: `${explicitPct}%`, background: "var(--accent-l)" }}>
          {explicitPct > 14 && <span className="text-[10px] font-black" style={{ color: "#0A0F1A" }}>{explicitPct.toFixed(0)}%</span>}
        </div>
        <div className="h-full flex items-center justify-center" style={{ width: `${terminalPct}%`, background: "var(--muted)" }}>
          {terminalPct > 14 && <span className="text-[10px] font-black" style={{ color: "#0A0F1A" }}>{terminalPct.toFixed(0)}%</span>}
        </div>
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-[10px]" style={{ color: "var(--sub)" }}>
          <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "var(--accent-l)" }} />
          {t("subvaluadas.fullModel.contribution.explicit")}
        </span>
        <span className="text-[10px]" style={{ color: "var(--sub)" }}>
          {t("subvaluadas.fullModel.contribution.terminal")}
          <span className="inline-block w-2 h-2 rounded-full ml-1" style={{ background: "var(--muted)" }} />
        </span>
      </div>
    </div>
  );
}

// Simple div-based bar chart, no charting library — same hand-rolled
// convention already used by _ComparisonBars/NifOverallScoreBanner.
function RevenueBarChart({ yearly }: { yearly: DriverBasedDcfResult["yearly"] }) {
  const max = Math.max(...yearly.map((y) => y.revenue), 1);
  return (
    <div className="flex items-end gap-1 h-28 mt-2">
      {yearly.map((y) => (
        <div key={y.year} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full rounded-t-sm"
            style={{ height: `${Math.max(2, (y.revenue / max) * 100)}%`, background: "var(--accent-l)" }}
            title={`Año ${y.year}: ${_fmtCompactMoney(y.revenue)}`}
          />
          <span className="text-[8px]" style={{ color: "var(--muted)" }}>{`Y${y.year}`}</span>
        </div>
      ))}
    </div>
  );
}

export function FullModelPanel({
  data, price, ticker, companyName, onClose,
  yearsAvailable = null, beta = null, moatEngine = null, deteriorationEngine = null, confidenceMeter = null,
}: {
  data: NuvosFairValueData;
  price: number | null;
  ticker: string;
  companyName: string | null;
  onClose: () => void;
  yearsAvailable?: number | null;
  beta?: number | null;
  moatEngine?: NifMoatData | null;
  deteriorationEngine?: NifDeteriorationData | null;
  confidenceMeter?: ConfidenceMeterData | null;
}) {
  const { t } = useTranslation();
  const defaultScenario: ScenarioName = data.price_implied_scenario ?? "base";
  const [scenarioName, setScenarioName] = useState<ScenarioName>(defaultScenario);
  const [tab, setTab] = useState<TabId>("template");

  const baseScenario = data.scenarios[scenarioName];
  const baseInputs = useMemo(() => deriveBaseInputs(baseScenario), [baseScenario]);
  const [overrides, setOverrides] = useState<CustomAssumptions>(() => assumptionsFromScenario(baseScenario));

  // Switching scenario resets overrides to that scenario's own real
  // assumptions — never carries a bear-scenario slider position onto bull.
  function selectScenario(name: ScenarioName) {
    setScenarioName(name);
    setOverrides(assumptionsFromScenario(data.scenarios[name]));
  }
  function resetToNuvos() {
    setOverrides(assumptionsFromScenario(baseScenario));
  }
  const isCustomized = useMemo(() => {
    const nuvos = assumptionsFromScenario(baseScenario);
    return (Object.keys(overrides) as (keyof CustomAssumptions)[]).some((k) => Math.abs(overrides[k] - nuvos[k]) > 1e-6);
  }, [overrides, baseScenario]);

  const customResult: DriverBasedDcfResult | null = useMemo(() => {
    if (!baseInputs) return null;
    try {
      return projectDriverBasedDcf({
        ...baseInputs,
        revenueGrowth1: overrides.growth1Pct / 100,
        operatingMarginAnchorPct: overrides.marginStartPct / 100,
        terminalOperatingMarginPct: overrides.marginTerminalPct / 100,
        reinvestmentRateAnchorPct: overrides.reinvestmentRateAnchorPct / 100,
        discountRate: overrides.discountRatePct / 100,
        exitMultiple: baseInputs.exitMetric ? overrides.exitMultiple : null,
      });
    } catch {
      return null;
    }
  }, [baseInputs, overrides]);

  const interactive = baseInputs !== null;
  const displayedResult = customResult;
  const fv = displayedResult?.valuePerShare ?? baseScenario.fair_value_per_share;
  const status = _valuationStatus(fv, price);
  const scenarioColor = _SCENARIO_COLOR[scenarioName];
  const exitMetric = baseScenario.assumptions.exit_metric;
  const ladder = data.exit_multiple_ladder;

  const growthReferencePoints = [
    ...(data.revenue_cagr_3y_pct != null ? [{ label: t("subvaluadas.fullModel.ref.hist3y"), value: data.revenue_cagr_3y_pct }] : []),
    ...(data.revenue_cagr_5y_pct != null ? [{ label: t("subvaluadas.fullModel.ref.hist5y"), value: data.revenue_cagr_5y_pct }] : []),
    ...(data.wall_street_revenue_growth_next_year_pct != null
      ? [{ label: t("subvaluadas.fullModel.ref.wallStreet"), value: data.wall_street_revenue_growth_next_year_pct }]
      : []),
    { label: t("subvaluadas.nuvosFairValue.scenarios.bear"), value: data.scenarios.bear.assumptions.revenue_growth_1_pct },
    { label: t("subvaluadas.nuvosFairValue.scenarios.base"), value: data.scenarios.base.assumptions.revenue_growth_1_pct },
    { label: t("subvaluadas.nuvosFairValue.scenarios.bull"), value: data.scenarios.bull.assumptions.revenue_growth_1_pct },
  ];

  const exitMultipleReferencePoints = [
    ...(ladder?.own_historical != null ? [{ label: t("subvaluadas.fullModel.ref.ownHistorical"), value: ladder.own_historical }] : []),
    ...(ladder?.peer_median != null ? [{ label: t("subvaluadas.fullModel.ref.peerMedian"), value: ladder.peer_median }] : []),
    ...(ladder?.sector_table_fallback != null ? [{ label: t("subvaluadas.fullModel.ref.sectorFallback"), value: ladder.sector_table_fallback }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="w-full sm:max-w-3xl h-full overflow-y-auto" style={{ background: "var(--bg)" }}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
          <div className="min-w-0">
            <p className="text-[13px] font-bold truncate" style={{ color: "var(--text)" }}>
              {t("subvaluadas.fullModel.title", { ticker, company: companyName ?? ticker })}
            </p>
            <p className="text-[10.5px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.fullModel.subtitle")}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-2" style={{ background: "var(--raised)" }}>
            <X className="w-4 h-4" style={{ color: "var(--sub)" }} />
          </button>
        </div>

        <div className="px-5 pt-4">
          {/* Scenario picker — determines the coherent Nuvos default every tab starts from */}
          <div className="flex rounded-xl p-1 mb-3" style={{ background: "var(--raised)" }}>
            {(["bear", "base", "bull"] as const).map((name) => (
              <button
                key={name}
                onClick={() => selectScenario(name)}
                className="flex-1 rounded-lg py-1.5 text-[11px] font-bold uppercase tracking-wide"
                style={{
                  background: scenarioName === name ? _SCENARIO_COLOR[name] : "transparent",
                  color: scenarioName === name ? "#0A0F1A" : "var(--sub)",
                }}
              >
                {t(`subvaluadas.nuvosFairValue.scenarios.${name}`)}
              </button>
            ))}
          </div>

          {isCustomized && (
            <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 mb-3" style={{ background: "rgba(212,162,76,0.1)" }}>
              <div className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" style={{ color: "#D4A24C" }} />
                <span className="text-[11px] font-semibold" style={{ color: "#D4A24C" }}>{t("subvaluadas.fullModel.customized")}</span>
              </div>
              <button onClick={resetToNuvos} className="flex items-center gap-1 text-[10.5px] font-bold underline underline-offset-2" style={{ color: "var(--muted)" }}>
                <RotateCcw className="w-3 h-3" /> {t("subvaluadas.fullModel.resetToNuvos")}
              </button>
            </div>
          )}

          {!interactive && (
            <div className="rounded-xl px-3 py-2 mb-3 text-[11px]" style={{ background: "var(--raised)", color: "var(--muted)" }}>
              {t("subvaluadas.fullModel.notInteractive")}
            </div>
          )}

          {/* Tab nav */}
          <div className="flex gap-1 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
            {TAB_ORDER.map((id) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold whitespace-nowrap"
                style={{
                  background: tab === id ? "var(--accent)" : "var(--raised)",
                  color: tab === id ? "#0A0F1A" : "var(--sub)",
                }}
              >
                {t(`subvaluadas.fullModel.tabs.${id}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 pb-8">
          {(tab === "template" || tab === "full") && (
            <SectionCard title={t("subvaluadas.fullModel.tabs.template")}>
              <p className="text-[11.5px] leading-relaxed mb-2" style={{ color: "var(--sub)" }}>
                {t("subvaluadas.fullModel.template.body")}
              </p>
              <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--dim)" }}>
                {t("subvaluadas.fullModel.template.methodology", {
                  metric: exitMetric ? t(`subvaluadas.nuvosFairValue.exitMetric.${exitMetric}`) : "",
                })}
              </p>
            </SectionCard>
          )}

          {(tab === "projection" || tab === "full") && interactive && baseInputs && (
            <SectionCard title={t("subvaluadas.fullModel.tabs.projection")}>
              <Slider
                label={t("subvaluadas.fullModel.projection.growth")}
                value={overrides.growth1Pct}
                min={-20} max={60} step={0.5} unit="%"
                onChange={(v) => setOverrides((o) => ({ ...o, growth1Pct: v }))}
                referencePoints={growthReferencePoints}
              />
              <Slider
                label={t("subvaluadas.fullModel.projection.marginStart")}
                value={overrides.marginStartPct}
                min={0} max={60} step={0.5} unit="%"
                onChange={(v) => setOverrides((o) => ({ ...o, marginStartPct: v }))}
              />
              <Slider
                label={t("subvaluadas.fullModel.projection.marginTerminal")}
                value={overrides.marginTerminalPct}
                min={0} max={60} step={0.5} unit="%"
                onChange={(v) => setOverrides((o) => ({ ...o, marginTerminalPct: v }))}
              />
              {displayedResult && <RevenueBarChart yearly={displayedResult.yearly} />}
            </SectionCard>
          )}

          {(tab === "conversion" || tab === "full") && interactive && (
            <SectionCard title={t("subvaluadas.fullModel.tabs.conversion")}>
              <Slider
                label={t("subvaluadas.fullModel.conversion.reinvestmentRate")}
                value={overrides.reinvestmentRateAnchorPct}
                min={0} max={100} step={1} unit="%"
                onChange={(v) => setOverrides((o) => ({ ...o, reinvestmentRateAnchorPct: v }))}
              />
              {baseScenario.fcf_conversion_pct != null && (
                <p className="text-[11px]" style={{ color: "var(--sub)" }}>
                  {t("subvaluadas.fullModel.conversion.fcfConversion", { pct: baseScenario.fcf_conversion_pct.toFixed(0) })}
                </p>
              )}
            </SectionCard>
          )}

          {(tab === "discount" || tab === "full") && interactive && (
            <SectionCard title={t("subvaluadas.fullModel.tabs.discount")}>
              <Slider
                label={t("subvaluadas.fullModel.discount.wacc")}
                value={overrides.discountRatePct}
                min={4} max={20} step={0.25} unit="%"
                onChange={(v) => setOverrides((o) => ({ ...o, discountRatePct: v }))}
                referencePoints={[
                  { label: t("subvaluadas.fullModel.ref.nuvosAuto"), value: baseScenario.assumptions.discount_rate_pct },
                ]}
              />
            </SectionCard>
          )}

          {(tab === "terminal" || tab === "full") && interactive && exitMetric && (
            <SectionCard title={t("subvaluadas.fullModel.tabs.terminal")}>
              <p className="text-[10.5px] mb-2" style={{ color: "var(--muted)" }}>
                {t("subvaluadas.fullModel.terminal.metricLabel", { metric: t(`subvaluadas.nuvosFairValue.exitMetric.${exitMetric}`) })}
              </p>
              <Slider
                label={t("subvaluadas.fullModel.terminal.multiple")}
                value={overrides.exitMultiple}
                min={Math.max(0.5, overrides.exitMultiple * 0.3)} max={overrides.exitMultiple * 2.5 || 20} step={0.1}
                unit="x"
                onChange={(v) => setOverrides((o) => ({ ...o, exitMultiple: v }))}
                referencePoints={exitMultipleReferencePoints}
              />
              {displayedResult?.assumptions.gordonSanityCheckRatio != null && (
                <p className="text-[10.5px]" style={{ color: "var(--muted)" }}>
                  {t("subvaluadas.fullModel.terminal.gordonRatio", { ratio: displayedResult.assumptions.gordonSanityCheckRatio.toFixed(2) })}
                </p>
              )}
            </SectionCard>
          )}

          {(tab === "result" || tab === "full") && (
            <SectionCard title={t("subvaluadas.fullModel.tabs.result")}>
              <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                <div>
                  <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: "var(--muted)" }}>
                    {t("subvaluadas.nuvosFairValue.headlineLabel")}
                  </p>
                  <p className="text-3xl font-black tabular-nums" style={{ color: "var(--text)" }}>
                    {fv !== null ? `$${fv.toFixed(2)}` : "N/D"}
                  </p>
                </div>
                {status && (
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2 shrink-0" style={{ background: `${_VERDICT_COLOR[status.verdict]}1a` }}>
                    <span className="text-lg leading-none">{_VERDICT_EMOJI[status.verdict]}</span>
                    <div>
                      <p className="text-[12px] font-bold" style={{ color: _VERDICT_COLOR[status.verdict] }}>
                        {t(`subvaluadas.nuvosFairValue.verdictLabel.${status.verdict}`)}
                      </p>
                      <p className="text-[10.5px]" style={{ color: "var(--sub)" }}>
                        {t(`subvaluadas.nuvosFairValue.verdictDetail.${status.verdict}`, { pct: status.pct.toFixed(0) })}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <_ComparisonBars fairValue={fv} price={price} color={scenarioColor} />

              {displayedResult && (
                <div className="mt-4">
                  <_ValueContribution pvOfFcfSum={displayedResult.pvOfFcfSum} pvOfTerminalValue={displayedResult.pvOfTerminalValue} />
                  <_ValueBridge
                    enterpriseValue={displayedResult.enterpriseValue}
                    netCash={baseInputs?.netCash ?? null}
                    equityValue={displayedResult.equityValue}
                    sharesOut={baseInputs?.sharesOut ?? null}
                    fairValue={displayedResult.valuePerShare}
                  />
                </div>
              )}

              {displayedResult && (
                <div className="mt-4 overflow-x-auto">
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
                    {t("subvaluadas.detail.level3.yearlyTable")}
                  </p>
                  <table className="w-full text-[10.5px]">
                    <thead>
                      <tr style={{ color: "var(--muted)" }}>
                        <th className="text-left font-bold pb-1">{t("subvaluadas.detail.level3.year")}</th>
                        <th className="text-right font-bold pb-1">{t("subvaluadas.detail.level3.fcf")}</th>
                        <th className="text-right font-bold pb-1">{t("subvaluadas.detail.level3.presentValue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedResult.yearly.map((row) => (
                        <tr key={row.year} style={{ color: "var(--sub)" }}>
                          <td className="py-0.5">{row.year}</td>
                          <td className="text-right tabular-nums py-0.5">{_fmtCompactMoney(row.fcf)}</td>
                          <td className="text-right tabular-nums py-0.5">{_fmtCompactMoney(row.discountedFcf)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          )}

          {(tab === "result" || tab === "full") && (
            <>
              <_MarketVsNuvosBridge baseInputs={baseInputs} price={price} fv={fv} />
              <_ModelConfidenceCard
                confidenceMeter={confidenceMeter}
                yearsAvailable={yearsAvailable}
                beta={beta}
                moatEngine={moatEngine}
                deteriorationEngine={deteriorationEngine}
              />
            </>
          )}
        </div>

        <p className="px-5 pb-6 text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>
          {t("subvaluadas.nuvosFairValue.disclaimer")}
        </p>
      </div>
    </div>
  );
}
