"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, RotateCcw, Sliders } from "lucide-react";
import {
  type NuvosFairValueData, type NuvosScenario,
  _ComparisonBars, _valuationStatus, _VERDICT_COLOR, _VERDICT_EMOJI, _SCENARIO_COLOR,
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

/** Reconstructs the exact `project_driver_based_dcf` inputs that PRODUCED a
 * real Nuvos scenario, from fields the backend already serializes (Modelo
 * Completo, Incremento 1 of the frontend build — no new endpoint). Every
 * value here is either read directly from `assumptions`/`yearly` or backed
 * out algebraically from other real, already-exposed numbers (never a
 * guess) — see the plan's "Backend — cambios concretos" section for which
 * fields already existed vs. were newly exposed. Returns null when the
 * scenario is missing the `yearly`/`equity_value` fields this needs (e.g. a
 * cache entry from before the cache-key bump — degrades to "no interactivo"
 * rather than silently computing with wrong reconstructed inputs). */
function deriveBaseInputs(scenario: NuvosScenario): DriverBasedDcfInput | null {
  const a = scenario.assumptions;
  if (!scenario.yearly || scenario.yearly.length === 0) return null;
  if (scenario.equity_value == null || scenario.enterprise_value == null || scenario.fair_value_per_share == null) return null;

  const growth1 = a.revenue_growth_1_pct / 100;
  const terminalGrowth = a.terminal_growth_pct / 100;
  const terminalReinvestmentRate = a.terminal_reinvestment_rate_pct / 100;
  // terminal_roic backed out from Damodaran's own identity the engine
  // enforces (terminal_reinvestment_rate = terminal_growth / terminal_roic)
  // — a near-zero terminal reinvestment rate has no stable inverse, falls
  // back to a conservative 12% rather than dividing by ~0.
  const terminalRoicPct = Math.abs(terminalReinvestmentRate) > 1e-6 ? terminalGrowth / terminalReinvestmentRate : 0.12;
  const revenue0 = scenario.yearly[0].revenue / (1 + growth1);
  const netCash = scenario.equity_value - scenario.enterprise_value;
  const sharesOut = scenario.equity_value / scenario.fair_value_per_share;

  return {
    revenue0,
    revenueGrowth1: growth1,
    terminalGrowth,
    operatingMarginAnchorPct: a.operating_margin_anchor_pct / 100,
    terminalOperatingMarginPct: a.terminal_operating_margin_pct / 100,
    taxRate: a.tax_rate_pct / 100,
    reinvestmentRateAnchorPct: a.reinvestment_rate_anchor_pct / 100,
    terminalRoicPct,
    discountRate: a.discount_rate_pct / 100,
    netCash,
    sharesOut,
    highGrowthYears: a.high_growth_years,
    exitMultiple: a.exit_multiple,
    exitMetric: a.exit_metric,
  };
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

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "N/D";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
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
            title={`Año ${y.year}: ${fmtMoney(y.revenue)}`}
          />
          <span className="text-[8px]" style={{ color: "var(--muted)" }}>{`Y${y.year}`}</span>
        </div>
      ))}
    </div>
  );
}

export function FullModelPanel({
  data, price, ticker, companyName, onClose,
}: {
  data: NuvosFairValueData;
  price: number | null;
  ticker: string;
  companyName: string | null;
  onClose: () => void;
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
                <div className="grid grid-cols-2 gap-2 mt-4">
                  {[
                    { label: t("subvaluadas.detail.level3.pvFcf"), value: fmtMoney(displayedResult.pvOfFcfSum) },
                    { label: t("subvaluadas.detail.level3.pvTerminal"), value: fmtMoney(displayedResult.pvOfTerminalValue) },
                    { label: t("subvaluadas.detail.level3.enterpriseValue"), value: fmtMoney(displayedResult.enterpriseValue) },
                    { label: t("subvaluadas.detail.level3.equityValue"), value: fmtMoney(displayedResult.equityValue) },
                  ].map((row) => (
                    <div key={row.label} className="rounded-lg p-2" style={{ background: "var(--raised)" }}>
                      <p className="text-[9px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>{row.label}</p>
                      <p className="text-[12px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{row.value}</p>
                    </div>
                  ))}
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
                          <td className="text-right tabular-nums py-0.5">{fmtMoney(row.fcf)}</td>
                          <td className="text-right tabular-nums py-0.5">{fmtMoney(row.discountedFcf)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          )}
        </div>

        <p className="px-5 pb-6 text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>
          {t("subvaluadas.nuvosFairValue.disclaimer")}
        </p>
      </div>
    </div>
  );
}
