"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Star, MessageCircle, AlertTriangle, Check, Sparkles, ShieldCheck, Wand2,
  ChevronDown, ChevronUp, Shield, Target, Users, Rocket, TrendingDown, TrendingUp, Minus,
} from "lucide-react";

export interface ChecklistItem {
  key?: string;
  name: string;
  stars: number | null;
  reason: string;
}

export interface Checklist {
  items: ChecklistItem[];
  avg_stars: number | null;
}

export interface FairValueRangeData {
  low: number;
  high: number;
  base: number;
}

export interface ConfidenceMeterData {
  score: number;
  label: string;
  stars: number;
  // "cross_method" when the score's method-agreement component used a real
  // cross-method spread (kept, currently unused by any live caller — see
  // confidence_engine.py's docstring), or "bear_bull_dispersion" (Nuvos AI
  // Fair Value Engine redesign, Incremento 11 — THE FLIP) — the normal case
  // — the real Bear<->Bull spread of the single engine. Optional/
  // informational — not required for the meter to render.
  dispersion_source?: "cross_method" | "bear_bull_dispersion";
}

export interface MarketExpectationsData {
  market_implied_growth_pct: number | null;
  market_implied_fcf_margin_pct: number | null;
  nuvos_growth_estimate_pct: number;
  nuvos_fcf_margin_estimate_pct: number;
  // Fase 1.5, Incremento 12/13 (Reverse DCF 2.0) — 3 more implied variables
  // solved the same way (hold everything else fixed at Nuvos's real
  // estimate, back out this one). market_implied_fcf_year_1 is NOT a 4th
  // solve — it's derived from market_implied_fcf_margin_pct's own already-
  // solved figures, since FCF isn't an independent lever in this model.
  market_implied_operating_margin_pct: number | null;
  market_implied_terminal_roic_pct: number | null;
  market_implied_base_revenue: number | null;
  market_implied_fcf_year_1: number | null;
  nuvos_operating_margin_estimate_pct: number | null;
  nuvos_terminal_roic_estimate_pct: number | null;
  nuvos_base_revenue_estimate: number | null;
}

export interface MomentumData {
  return_1m_pct: number;
  return_6m_pct: number;
  turn_score: number;
}

export interface LiquidityGate {
  paso: boolean;
  detalle: string;
}

export interface RangeBounds {
  low: number;
  high: number;
}

export interface DcfAssumptions {
  methodology: string;
  suggested_g: number | null;
  suggested_r: number | null;
  suggested_gt: number | null;
  g_range: RangeBounds | null;
  r_range: RangeBounds | null;
  gt_range: RangeBounds | null;
  historical_growth_pct: number | null;
  moat_adjustment_pct: number | null;
  avg_roic_pct: number | null;
  avg_roe_pct: number | null;
  market_implied_growth_pct: number | null;
  business_quality: number | null;
  predictability: number | null;
  financial_strength: number | null;
  growth_outlook: number | null;
  management_capital_allocation: number | null;
}

export interface YearlyDetailRow {
  year: number;
  fcf: number;
  discount_factor: number;
  present_value: number;
}

export interface SensitivityMatrixData {
  wacc_rows_pct: number[];
  growth_cols_pct: number[];
  values: (number | null)[][];
}

export interface ReverseDcfSanityCheckData {
  fcf_projected_year_n: number;
  years: number;
  vs_cagr_historico_propio: string;
  regime_change_flag: boolean;
  detalle: string;
}

export interface ExpectationsInvestingGrowthByRate {
  scenario: string;
  discount_rate_pct: number;
  implied_growth_pct: number | null;
}

export interface ExpectationsInvestingData {
  fcf0: number;
  fcf0_source: string;
  implied_multiple_pfcf: number;
  growth_by_rate: ExpectationsInvestingGrowthByRate[];
  fcf_year10_base_scenario: number | null;
  historical_fcf_decline_years: number;
  years_available: number;
}

export function GeneratedAtNote({ generatedAt }: { generatedAt: number }) {
  const { t, i18n } = useTranslation();
  if (!generatedAt) return null;
  const days = Math.floor((Date.now() / 1000 - generatedAt) / 86400);
  const stale = days > 10;
  const date = new Date(generatedAt * 1000).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long" });
  const updatedText = days <= 0
    ? t("subvaluadas.footer.updatedToday", { date })
    : t("subvaluadas.footer.updatedDaysAgo", { count: days, date });
  return (
    <p className="text-[10px]" style={stale ? { color: "#f59e0b", fontWeight: 700 } : { color: "var(--muted)" }}>
      {updatedText}{stale ? t("subvaluadas.footer.stale") : ""}
    </p>
  );
}

export function LiquidityWarning({ gate }: { gate: LiquidityGate }) {
  if (gate.paso) return null;
  return (
    <div className="rounded-xl p-3 flex gap-2 items-start"
         style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "#ef4444" }} />
      <p className="text-[11px] font-medium" style={{ color: "#ef4444" }}>{gate.detalle}</p>
    </div>
  );
}

export function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 min-w-0 rounded-xl px-2.5 py-1.5" style={{ background: "var(--raised)" }}>
      <p className="text-[9px] font-bold uppercase tracking-wide truncate" style={{ color: "var(--muted)" }}>{label}</p>
      <p className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{value}</p>
    </div>
  );
}

export function InsightBox({ children }: { children: string }) {
  return (
    <div className="rounded-xl p-3 flex gap-2 items-start"
         style={{ background: "rgba(0,168,94,0.06)", border: "1px solid rgba(0,168,94,0.18)" }}>
      <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--accent-l)" }} />
      <div className="text-base leading-relaxed [&_p]:m-0 [&_p+p]:mt-2" style={{ color: "var(--sub)" }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
      </div>
    </div>
  );
}

export function WarningBadge({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
         style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)" }}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: "#f59e0b" }} />
      <p className="text-[11px] font-medium" style={{ color: "#f59e0b" }}>{t("subvaluadas.weakDimensionWarning", { text })}</p>
    </div>
  );
}

function StarRow({ stars }: { stars: number | null }) {
  if (stars === null) {
    return <span className="text-[10px] font-bold shrink-0" style={{ color: "var(--muted)" }}>?</span>;
  }
  return (
    <div className="flex gap-0.5 shrink-0">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className="w-3 h-3"
              style={{ color: i <= stars ? "#f59e0b" : "var(--border)" }}
              fill={i <= stars ? "#f59e0b" : "none"} />
      ))}
    </div>
  );
}

export function ChecklistDisplay({ checklist }: { checklist: Checklist }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const avgStars = checklist.avg_stars;
  const scoreColor = avgStars === null ? "var(--muted)" : avgStars >= 4 ? "#22c55e" : avgStars >= 2.5 ? "#f59e0b" : "#ef4444";

  return (
    <div className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5" style={{ color: scoreColor }} fill={scoreColor} />
          <span className="text-sm font-black" style={{ color: scoreColor }}>{avgStars !== null ? `${avgStars}/5` : "N/D"}</span>
          <span className="text-xs font-semibold" style={{ color: "var(--sub)" }}>{t("subvaluadas.checklist.label")}</span>
        </div>
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>{expanded ? t("subvaluadas.checklist.hide") : t("subvaluadas.checklist.viewDetail")}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {checklist.items.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="mt-0.5"><StarRow stars={item.stars} /></div>
              <div className="min-w-0">
                <p className="text-xs font-bold" style={{ color: "var(--text)" }}>
                  {item.key ? t(`subvaluadas.checklist.items.${item.key}`, { defaultValue: item.name }) : item.name}
                </p>
                <p className="text-[11px]" style={{ color: "var(--dim)" }}>{item.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function _fmtCompactMoney(v: number | null): string {
  if (v === null || !isFinite(v)) return "N/D";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
}

/** One implied-vs-Nuvos row — skipped entirely when the market side
 * couldn't be solved (a wide/absurd price can put the implied value
 * outside the reverse-DCF solver's sane search range, see
 * reverse_dcf_engine.py), since showing only Nuvos's half would misleadingly
 * imply agreement. */
function _marketExpectationsRow(label: string, marketVal: number | null, nuvosVal: number | null, fmt: (v: number) => string) {
  if (marketVal === null) return null;
  return (
    <div key={label} className="grid grid-cols-3 gap-2 items-baseline py-1">
      <p className="text-[10px]" style={{ color: "var(--sub)" }}>{label}</p>
      <p className="text-[11.5px] font-bold tabular-nums text-right" style={{ color: "var(--text)" }}>{fmt(marketVal)}</p>
      <p className="text-[11.5px] font-bold tabular-nums text-right" style={{ color: "var(--accent-l)" }}>{nuvosVal !== null ? fmt(nuvosVal) : "N/D"}</p>
    </div>
  );
}

export function MarketExpectationsPanel({ data }: { data: MarketExpectationsData }) {
  const { t } = useTranslation();
  if (data.market_implied_growth_pct === null) return null;
  const pct = (v: number) => `${v}%`;
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
      <p className="text-[11px] font-bold mb-1" style={{ color: "var(--text)" }}>{t("subvaluadas.marketExpectations.label")}</p>
      <div className="grid grid-cols-3 gap-2 pb-1 mb-1 border-b" style={{ borderColor: "var(--border)" }}>
        <span />
        <p className="text-[9px] uppercase tracking-wide text-right" style={{ color: "var(--muted)" }}>{t("subvaluadas.marketExpectations.marketAssumes")}</p>
        <p className="text-[9px] uppercase tracking-wide text-right" style={{ color: "var(--muted)" }}>{t("subvaluadas.marketExpectations.nuvosBelieves")}</p>
      </div>
      {_marketExpectationsRow(t("subvaluadas.marketExpectations.growth"), data.market_implied_growth_pct, data.nuvos_growth_estimate_pct, pct)}
      {_marketExpectationsRow(t("subvaluadas.marketExpectations.margin"), data.market_implied_fcf_margin_pct, data.nuvos_fcf_margin_estimate_pct, pct)}
      {/* Fase 1.5, Incremento 13 — Reverse DCF 2.0's 3 new implied
          variables plus the derived implied FCF. */}
      {_marketExpectationsRow(t("subvaluadas.marketExpectations.operatingMargin"), data.market_implied_operating_margin_pct, data.nuvos_operating_margin_estimate_pct, pct)}
      {_marketExpectationsRow(t("subvaluadas.marketExpectations.terminalRoic"), data.market_implied_terminal_roic_pct, data.nuvos_terminal_roic_estimate_pct, pct)}
      {_marketExpectationsRow(t("subvaluadas.marketExpectations.baseRevenue"), data.market_implied_base_revenue, data.nuvos_base_revenue_estimate, _fmtCompactMoney)}
      {_marketExpectationsRow(t("subvaluadas.marketExpectations.fcfYear1"), data.market_implied_fcf_year_1, null, _fmtCompactMoney)}
    </div>
  );
}

// Reverse DCF (Parte E) — already fully solved by the backend (Brent's
// method) in 3 flavors, never previously shown anywhere in the frontend.
// This surfaces the regime-change sanity check and the Expectations
// Investing (Rappaport) constant-growth table.
// Incremento 15 — "plegada": the regime-change sanity check (safety-
// relevant, never hidden) stays always visible; the Expectations Investing
// (Rappaport) constant-growth breakdown, a deeper drill-down, collapses
// behind a toggle so this panel takes less space now that it sits below
// the primary Bear/Base/Bull panel and the sensitivity heatmap.
export function ReverseDcfPanel({
  sanityCheck, expectationsInvesting,
}: {
  sanityCheck: ReverseDcfSanityCheckData | null;
  expectationsInvesting: ExpectationsInvestingData | null;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (!sanityCheck && !expectationsInvesting) return null;
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
      <p className="text-[11px] font-bold mb-2" style={{ color: "var(--text)" }}>{t("subvaluadas.reverseDcf.label")}</p>
      {sanityCheck && (
        <div className="flex items-start gap-2 mb-2">
          {sanityCheck.regime_change_flag && <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />}
          <p className="text-[11px] leading-relaxed" style={{ color: sanityCheck.regime_change_flag ? "#f59e0b" : "var(--sub)" }}>
            {sanityCheck.detalle}
          </p>
        </div>
      )}
      {expectationsInvesting && (
        <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <button onClick={() => setExpanded((e) => !e)} className="text-[10px] font-bold underline underline-offset-2" style={{ color: "var(--muted)" }}>
            {t("subvaluadas.reverseDcf.expectationsInvesting")} — {expanded ? t("subvaluadas.checklist.hide") : t("subvaluadas.checklist.viewDetail")}
          </button>
          {expanded && (
            <div className="mt-1.5">
              <div className="grid grid-cols-3 gap-1.5">
                {expectationsInvesting.growth_by_rate.map((row) => (
                  <div key={row.scenario} className="rounded-lg p-1.5 text-center" style={{ background: "var(--card)" }}>
                    <p className="text-[8px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t(`subvaluadas.scenarios.${row.scenario}`)}</p>
                    <p className="text-[11px] font-black tabular-nums" style={{ color: "var(--text)" }}>
                      {row.implied_growth_pct !== null ? `${row.implied_growth_pct}%` : "N/D"}
                    </p>
                  </div>
                ))}
              </div>
              {expectationsInvesting.historical_fcf_decline_years > 0 && (
                <p className="text-[10px] mt-1.5" style={{ color: "var(--muted)" }}>
                  {t("subvaluadas.reverseDcf.declineYears", { count: expectationsInvesting.historical_fcf_decline_years })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Nuvos AI Fair Value Engine redesign (ver /Users/diegoarria/.claude/plans/
// stateful-painting-flurry.md) — una sola máquina, tres escenarios (Bear/
// Base/Bull), reemplazo del "Conservative DCF"/"Professional DCF"/Relative
// Valuation mostrados como métodos separados. Desde Incremento 11 (EL FLIP)
// este es el panel de valuación PRIMARIO — `fair_value_range` (usado por
// ExecutiveSummaryPanel/ConfidenceMeter en toda la pantalla) ahora ES la
// dispersión Bear<->Bull de este mismo panel, no un número independiente.
export interface NuvosScenarioAssumptions {
  revenue_growth_1_pct: number;
  high_growth_years: number;
  terminal_growth_pct: number;
  operating_margin_anchor_pct: number;
  terminal_operating_margin_pct: number;
  tax_rate_pct: number;
  reinvestment_rate_anchor_pct: number;
  terminal_reinvestment_rate_pct: number;
  discount_rate_pct: number;
  terminal_value_method: "gordon" | "exit_multiple";
  exit_multiple: number | null;
  exit_metric: "ev_sales" | "ev_ebit" | "ev_fcf" | null;
  gordon_terminal_value: number | null;
  gordon_sanity_check_ratio: number | null;
  implied_fcf_margin_pct_year_n: number | null;
}

// One projected year of the Revenue -> ... -> FCF waterfall — mirrors
// dcf_engine.py's YearlyDriverRow exactly (see driverBasedDcf.ts, the TS
// port used to recompute this same shape client-side for custom scenarios).
export interface NuvosYearlyDriverRow {
  year: number;
  revenue: number;
  revenue_growth_pct: number;
  operating_margin_pct: number;
  ebit: number;
  tax_rate_pct: number;
  nopat: number;
  reinvestment_rate_pct: number;
  reinvestment: number;
  fcf: number;
  discounted_fcf: number;
}

export interface NuvosScenario {
  fair_value_per_share: number | null;
  assumptions: NuvosScenarioAssumptions;
  // "Modelo Completo" fields (Nuvos AI Fair Value Engine — Modelo Completo,
  // see stateful-painting-flurry.md) — the full waterfall + DCF result,
  // already computed backend-side, just not previously serialized.
  yearly?: NuvosYearlyDriverRow[];
  pv_of_fcf_sum?: number;
  terminal_value?: number;
  pv_of_terminal_value?: number;
  enterprise_value?: number;
  equity_value?: number | null;
  fcf_conversion_pct?: number | null;
}

// Real reference points for the terminal-value multiple — the 3 candidates
// `exit_multiple_engine._resolve_anchor` chooses between (only the winner
// normally survives into `exit_multiple_anchor_source`); `null` for any
// candidate this ticker genuinely doesn't have real data for.
export interface NuvosExitMultipleLadder {
  own_historical: number | null;
  peer_median: number | null;
  sector_table_fallback: number;
}

// Incremento 15 — WACC x exit multiple, not WACC x growth: this engine's
// terminal value comes from a real exit multiple, so growth alone would
// miss the actual lever driving the number. `multiple_cols` are absolute
// multiples (e.g. 4.2x), not percentages — the middle 3 columns are
// literally Bear/Base/Bull's own multiple (see fundamental_analysis_
// service.py's nuvos_sensitivity_matrix comment).
export interface NuvosSensitivityMatrixData {
  wacc_rows_pct: number[];
  multiple_cols: number[];
  exit_metric: "ev_sales" | "ev_ebit" | "ev_fcf";
  values: (number | null)[][];
}

export interface NuvosFairValueData {
  scenarios: {
    bear: NuvosScenario;
    base: NuvosScenario;
    bull: NuvosScenario;
  };
  exit_metric: string;
  exit_multiple_anchor_source: "own_historical" | "peer_median" | "sector_table_fallback";
  exit_multiple_ladder?: NuvosExitMultipleLadder | null;
  price_implied_scenario: "bear" | "base" | "bull" | null;
  growth_factors: NifScoreFactor[];
  operating_margin_factors: NifScoreFactor[];
  terminal_roic_factors: NifScoreFactor[];
  sensitivity_matrix: NuvosSensitivityMatrixData | null;
  // "Modelo Completo" reference bands — real windows only, null when the
  // ticker doesn't have enough history/coverage for that specific window.
  revenue_cagr_3y_pct?: number | null;
  revenue_cagr_5y_pct?: number | null;
  wall_street_revenue_growth_next_year_pct?: number | null;
  wall_street_eps_growth_next_year_pct?: number | null;
}

export const _SCENARIO_COLOR: Record<"bear" | "base" | "bull", string> = {
  bear: "#DD6E63", base: "#D4A24C", bull: "#4FA695",
};

export type _Verdict = "undervalued" | "overvalued" | "fair";
export interface _ValuationStatus {
  verdict: _Verdict;
  pct: number; // always a positive magnitude — which formula produced it depends on `verdict`
}

// Two different formulas, deliberately not one signed percentage divided
// by a single denominator:
// - Undervalued (price <= value): margin of safety, as a % of the
//   ESTIMATED VALUE — "how much cushion below what it's really worth."
//   (value - price) / value.
// - Overvalued (price > value): premium, as a % of the CURRENT PRICE —
//   "how much extra you'd be paying right now." (price - value) / price.
// Using the same value-denominator formula for both (then just flipping
// the sign) is what produces headline-grabbing nonsense like "-858%" when
// a business trades far above a small or shrinking estimated value — the
// two questions ("how cheap?" vs. "how expensive?") aren't symmetric, so
// the formulas shouldn't be either. ±5% either side reads as noise, not a
// real verdict, so anything inside that band is "fairly valued."
export function _valuationStatus(fairValue: number | null, price: number | null): _ValuationStatus | null {
  if (fairValue === null || fairValue <= 0 || price === null || price <= 0) return null;
  if (price > fairValue) {
    const premiumPct = ((price - fairValue) / price) * 100;
    return { verdict: premiumPct >= 5 ? "overvalued" : "fair", pct: premiumPct };
  }
  const mosPct = ((fairValue - price) / fairValue) * 100;
  return { verdict: mosPct >= 5 ? "undervalued" : "fair", pct: mosPct };
}
export const _VERDICT_COLOR: Record<_Verdict, string> = {
  undervalued: "#22c55e", overvalued: "#ef4444", fair: "#D4A24C",
};
export const _VERDICT_EMOJI: Record<_Verdict, string> = {
  undervalued: "🟢", overvalued: "🔴", fair: "🟡",
};

export interface RelativeValuationData {
  intrinsic_value_per_share: number;
  peer_count: number;
}

export interface AnalystPriceTargetData {
  target_high: number | null;
  target_low: number | null;
  target_mean: number | null;
  target_median: number | null;
}

// The two stacked bars on a shared scale, the single most distinctive
// device on AlphaSpread's fair-value card — lets the eye compare the two
// lengths directly instead of reading two separate numbers. `scale` is
// the larger of the two values with headroom so neither bar is flush to
// the edge.
export function _ComparisonBars({ fairValue, price, color }: { fairValue: number | null; price: number | null; color: string }) {
  const { t } = useTranslation();
  if (fairValue === null && price === null) return null;
  const scale = Math.max(fairValue ?? 0, price ?? 0) * 1.15 || 1;
  const rows: { label: string; value: number | null; barColor: string }[] = [
    { label: t("subvaluadas.nuvosFairValue.barIntrinsicValue"), value: fairValue, barColor: color },
    { label: t("subvaluadas.nuvosFairValue.barPrice"), value: price, barColor: "var(--muted)" },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          <span className="text-[10px] w-20 shrink-0" style={{ color: "var(--sub)" }}>{row.label}</span>
          <div className="flex-1 h-5 rounded-md overflow-hidden" style={{ background: "var(--raised)" }}>
            {row.value !== null && (
              <div
                className="h-full rounded-md flex items-center justify-end px-1.5"
                style={{ width: `${Math.max(4, (row.value / scale) * 100)}%`, background: row.barColor }}
              >
                <span className="text-[10px] font-bold tabular-nums" style={{ color: "#0A0F1A" }}>${row.value.toFixed(0)}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function _NuvosFactorsSection({ title, factors }: { title: string; factors: NifScoreFactor[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (factors.length === 0) return null;
  return (
    <div>
      <button onClick={() => setExpanded((e) => !e)} className="text-[10px] font-bold underline underline-offset-2" style={{ color: "var(--muted)" }}>
        {title} — {expanded ? t("subvaluadas.checklist.hide") : t("subvaluadas.checklist.viewDetail")}
      </button>
      {expanded && (
        <div className="space-y-1.5 mt-1.5">
          {factors.map((f, i) => (
            <div key={i} className="rounded-lg p-2" style={{ background: "var(--raised)" }}>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[10.5px] font-bold" style={{ color: "var(--sub)" }}>
                  {t(`subvaluadas.nuvosFairValue.assumptionFactors.${f.name}`, { defaultValue: f.name })}
                </span>
                {f.value !== null && (
                  <span className="text-[10.5px] font-black tabular-nums shrink-0" style={{ color: "var(--text)" }}>{f.value.toFixed(1)}%</span>
                )}
              </div>
              <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--dim)" }}>{f.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Incremento 17 — redesigned after a direct AlphaSpread comparison: one
// number at a time behind a scenario TAB switcher (not 3 columns shown at
// once), a verdict badge, two comparison bars on a shared scale, a plain-
// language sentence restating the same numbers in words, a methodology
// line naming what actually produced the number, and a demoted "other
// reference points" row (multiples estimate, Wall Street target) — never
// blended into the headline number, just shown alongside it.
export function FairValueScenariosPanel({
  data, price, relativeValuation, analystPriceTarget,
}: {
  data: NuvosFairValueData | null;
  price: number | null;
  relativeValuation?: RelativeValuationData | null;
  analystPriceTarget?: AnalystPriceTargetData | null;
}) {
  const { t } = useTranslation();
  const defaultScenario = data?.price_implied_scenario ?? "base";
  const [selected, setSelected] = useState<"bear" | "base" | "bull">(defaultScenario);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  if (!data) return null;
  const { scenarios, price_implied_scenario } = data;

  const scenario = scenarios[selected];
  const color = _SCENARIO_COLOR[selected];
  const fv = scenario.fair_value_per_share;
  const status = _valuationStatus(fv, price);
  const verdict = status?.verdict ?? null;
  const a = scenario.assumptions;

  const referencePoints: { icon: string; label: string; value: number }[] = [];
  if (relativeValuation?.intrinsic_value_per_share) {
    referencePoints.push({ icon: "⚖️", label: t("subvaluadas.nuvosFairValue.multiplesEstimate"), value: relativeValuation.intrinsic_value_per_share });
  }
  if (analystPriceTarget?.target_mean) {
    referencePoints.push({ icon: "🎯", label: t("subvaluadas.nuvosFairValue.wallStreetTarget"), value: analystPriceTarget.target_mean });
  }

  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
        <p className="text-[12px] font-bold" style={{ color: "var(--text)" }}>{t("subvaluadas.nuvosFairValue.title")}</p>
      </div>
      <p className="text-[10.5px] leading-relaxed mb-4" style={{ color: "var(--muted)" }}>{t("subvaluadas.nuvosFairValue.subtitle")}</p>

      {/* Scenario tab switcher — AlphaSpread's "Escenario bajista/base/alcista" pattern */}
      <div className="flex rounded-xl p-1 mb-4" style={{ background: "var(--raised)" }}>
        {(["bear", "base", "bull"] as const).map((name) => {
          const isActive = selected === name;
          const tabColor = _SCENARIO_COLOR[name];
          return (
            <button
              key={name}
              onClick={() => setSelected(name)}
              className="flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors"
              style={{
                background: isActive ? tabColor : "transparent",
                color: isActive ? "#0A0F1A" : "var(--sub)",
              }}
            >
              {t(`subvaluadas.nuvosFairValue.scenarios.${name}`)}
              {price_implied_scenario === name && (
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: isActive ? "#0A0F1A" : tabColor }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Headline number + "Estado de valoración" — two different formulas
          depending on the side (see _valuationStatus), never a single
          signed percentage that can read as a nonsensical "-858%". */}
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: "var(--muted)" }}>
            {t("subvaluadas.nuvosFairValue.headlineLabel")}
          </p>
          <p className="text-4xl font-black tabular-nums" style={{ color: "var(--text)" }}>
            {fv !== null ? `$${fv.toFixed(2)}` : "N/D"}
          </p>
        </div>
        {verdict && status && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 shrink-0" style={{ background: `${_VERDICT_COLOR[verdict]}1a` }}>
            <span className="text-lg leading-none">{_VERDICT_EMOJI[verdict]}</span>
            <div>
              <p className="text-[12px] font-bold" style={{ color: _VERDICT_COLOR[verdict] }}>
                {t(`subvaluadas.nuvosFairValue.verdictLabel.${verdict}`)}
              </p>
              <p className="text-[10.5px]" style={{ color: "var(--sub)" }}>
                {t(`subvaluadas.nuvosFairValue.verdictDetail.${verdict}`, { pct: status.pct.toFixed(0) })}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Comparison bars — the AlphaSpread device: same scale, so length alone tells the story */}
      <div className="mb-3">
        <_ComparisonBars fairValue={fv} price={price} color={color} />
      </div>

      {/* Plain-language sentence, restating the same numbers in words */}
      {fv !== null && price !== null && verdict && status && (
        <p className="text-[11.5px] leading-relaxed mb-3" style={{ color: "var(--sub)" }}>
          {t("subvaluadas.nuvosFairValue.narrative", {
            scenario: t(`subvaluadas.nuvosFairValue.scenarios.${selected}`),
            fairValue: fv.toFixed(2),
            price: price.toFixed(2),
            verdictPhrase: verdict === "fair"
              ? t("subvaluadas.nuvosFairValue.verdictWord.fair")
              : t(`subvaluadas.nuvosFairValue.verdictWord.${verdict}`, { pct: status.pct.toFixed(0) }),
          })}
        </p>
      )}

      {/* Methodology — names what actually produced this number */}
      {a.exit_multiple !== null && (
        <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 mb-4 w-fit" style={{ background: "var(--raised)" }}>
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.nuvosFairValue.methodologyLabel")}</span>
          <span className="text-[11px] font-bold" style={{ color: "var(--text)" }}>
            {t("subvaluadas.nuvosFairValue.methodologyValue", {
              multiple: a.exit_multiple.toFixed(1),
              metric: a.exit_metric ? t(`subvaluadas.nuvosFairValue.exitMetric.${a.exit_metric}`) : "",
            })}
          </span>
        </div>
      )}

      {/* Other reference points — demoted on purpose, never blended into the headline number */}
      {referencePoints.length > 0 && (
        <div className="mb-4">
          <p className="text-[9px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
            {t("subvaluadas.nuvosFairValue.otherReferencePoints")}
          </p>
          <div className="flex flex-wrap gap-2">
            {referencePoints.map((rp) => (
              <span key={rp.label} className="text-[11px] rounded-full px-3 py-1.5" style={{ background: "var(--raised)", color: "var(--sub)" }}>
                {rp.icon} {rp.label} <b style={{ color: "var(--text)" }}>${rp.value.toFixed(2)}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Assumptions behind the selected scenario, collapsed */}
      <div className="mb-2">
        <button onClick={() => setAssumptionsOpen((o) => !o)} className="text-[10px] font-bold underline underline-offset-2" style={{ color: "var(--muted)" }}>
          {t("subvaluadas.nuvosFairValue.assumptionsToggle")} — {assumptionsOpen ? t("subvaluadas.checklist.hide") : t("subvaluadas.checklist.viewDetail")}
        </button>
        {assumptionsOpen && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-1.5">
            {[
              { label: t("subvaluadas.nuvosFairValue.growth"), value: `${a.revenue_growth_1_pct.toFixed(1)}%` },
              { label: t("subvaluadas.nuvosFairValue.margin"), value: `${a.operating_margin_anchor_pct.toFixed(1)}% → ${a.terminal_operating_margin_pct.toFixed(1)}%` },
              { label: t("subvaluadas.nuvosFairValue.wacc"), value: `${a.discount_rate_pct.toFixed(1)}%` },
              ...(a.exit_multiple !== null ? [{ label: t("subvaluadas.nuvosFairValue.exitMultiple"), value: `${a.exit_multiple.toFixed(1)}x` }] : []),
            ].map((row) => (
              <div key={row.label} className="rounded-lg p-2" style={{ background: "var(--raised)" }}>
                <p className="text-[9px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>{row.label}</p>
                <p className="text-[12px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{row.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 mt-2">
        <_NuvosFactorsSection title={t("subvaluadas.nuvosFairValue.growthFactorsTitle")} factors={data.growth_factors} />
        <_NuvosFactorsSection title={t("subvaluadas.nuvosFairValue.marginFactorsTitle")} factors={data.operating_margin_factors} />
        <_NuvosFactorsSection title={t("subvaluadas.nuvosFairValue.roicFactorsTitle")} factors={data.terminal_roic_factors} />
      </div>

      <p className="mt-3 pt-3 border-t text-[10px] leading-relaxed" style={{ borderColor: "var(--border)", color: "var(--dim)" }}>
        {t("subvaluadas.nuvosFairValue.disclaimer")}
      </p>
    </div>
  );
}

export function FollowButton({ watchlisted, onFollow }: { ticker: string; watchlisted: boolean; onFollow: () => void }) {
  const { t } = useTranslation();
  return (
    <button onClick={onFollow} disabled={watchlisted}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors"
            style={{ borderColor: "var(--border)", color: "var(--sub)", background: "var(--raised)" }}>
      {watchlisted ? <Check className="w-3.5 h-3.5" style={{ color: "#22c55e" }} /> : <Star className="w-3.5 h-3.5" />}
      {watchlisted ? t("subvaluadas.follow.following") : t("subvaluadas.follow.button")}
    </button>
  );
}

export function AnalyzeButton({ onAnalyze }: { onAnalyze: () => void }) {
  const { t } = useTranslation();
  return (
    <button onClick={onAnalyze}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-black"
            style={{ background: "var(--accent)" }}>
      <MessageCircle className="w-3.5 h-3.5" />
      {t("subvaluadas.analyze.button")}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Nuvos Investment Framework (NIF) — Phase 1 dashboard
//
// Every pillar response from the backend (backend/app/services/nif_service.py)
// follows the same data/nuvos_estimate/explanation envelope. This file keeps
// that separation visible in the UI on purpose (Diego's explicit ask): a
// literal labeled chip on each block, not just color, so it's never ambiguous
// which numbers are 100%-verifiable financial data vs. Nuvos's own derived
// estimate vs. the AI's explanation of why.
// ═══════════════════════════════════════════════════════════════════════════

export interface NifSubFactor {
  key: string;
  text: string;
}

export interface NifExplanation {
  sub_factors: NifSubFactor[];
}

// Fase 2, Incremento 8: management_quality's deep dive (guidance track
// record + governance flags), grounded in real evidence — declares
// "sin evidencia suficiente" rather than inventing a track record.
export interface NifManagementDeepDive {
  guidance_track_record: string;
  governance_flags: { flag: string; evidence: string }[];
  overall_assessment: string;
}

export interface NifPillarData {
  pillar: string;
  score: number | null;
  data: Record<string, unknown>;
  nuvos_estimate: Record<string, unknown>;
  explanation: NifExplanation | null;
  deep_dive?: NifManagementDeepDive | null;
}

export interface NifOverallScore {
  score: number;
  weakest_pillar: string;
  weakest_pillar_score: number;
  pillar_breakdown: Record<string, { score: number | null; weight: number }>;
}

/** Shared shape for every "real score + explainable factor list"
 * engine (Moat, Conviction) — see backend/app/services/quality/*_engine.py. */
export interface NifScoreFactor {
  name: string;
  value: number | null;
  score: number | null;
  reason: string;
}

// Fase 2, Incremento 7 (Moat Engine) — sibling key, never folded into
// overall_nif_score.
export interface NifMoatDeepDiveType {
  type: string;
  intensity: "alta" | "media" | "baja" | "ninguna";
  evidence: string;
  explanation: string;
  risks: string;
}

export interface NifMoatDeepDive {
  moat_types: NifMoatDeepDiveType[];
  why_it_exists: string;
  what_could_destroy_it: string;
  trend: "fortaleciendo" | "debilitando" | "estable";
}

export interface NifMoatData {
  score: number;
  roic_premium_score: number | null;
  margin_premium_score: number | null;
  stability_score: number | null;
  factors: NifScoreFactor[];
  deep_dive: NifMoatDeepDive | null;
}

// Fase 2, Incremento 9 (Conviction Engine) — pure synthesis, never touches
// price/valuation.
export interface NifConvictionData {
  score: number;
  quality_score: number | null;
  moat_score: number | null;
  stability_score: number | null;
  beta_score: number | null;
  factors: NifScoreFactor[];
}

// Fase 2, Incremento 9 (Catalysts Engine) — no deterministic score, purely
// evidence-grounded AI narration.
export interface NifCatalyst {
  catalyst: string;
  type: string;
  evidence: string;
  time_horizon: "corto_plazo" | "mediano_plazo" | "largo_plazo";
  impact_if_realized: string;
}

export interface NifCatalystsData {
  catalysts: NifCatalyst[];
}

// Fase 2, Incremento 10 (Peer Comparison Engine) — real peer group's own
// Quality Scores, never a fabricated ranking.
export interface NifPeerQualitySnapshot {
  ticker: string;
  quality_score: number | null;
  roic_pct: number | null;
  operating_margin_pct: number | null;
  revenue_cagr_pct: number | null;
}

export interface NifPeerComparisonData {
  peer_count: number;
  peers_used: string[];
  company_quality_score: number | null;
  quality_score_percentile: number | null;
  quality_score_rank: number | null;
  peer_quality_scores: NifPeerQualitySnapshot[];
}

// Fase 2, Incremento 10 (Deterioration Engine) — mechanical trend
// direction, complements (never duplicates) Moat's CV-based stability.
export interface NifDeteriorationFactor {
  name: string;
  direction: "mejorando" | "deteriorando" | "estable" | null;
  change_pct: number | null;
  reason: string;
}

export interface NifDeteriorationData {
  deteriorating_count: number;
  improving_count: number;
  stable_count: number;
  highest_concern: string | null;
  factors: NifDeteriorationFactor[];
}

// Fase 3 (Investment Research Engine) — Thesis Engine's shared draft, from
// GET /api/research-engine/company/{ticker}/thesis/draft. Every claim
// carries fact/inference/ai_opinion + confidence (claim_schema.py's
// EvidenceTaggedClaim) — never a bare string with no provenance.
export interface EvidenceTaggedClaimData {
  text: string;
  kind: "fact" | "inference" | "ai_opinion";
  source: string | null;
  source_date: string | null;
  confidence: "low" | "medium" | "high";
}

export interface ThesisDraftData {
  id: string;
  ticker: string;
  generated_at: string;
  thesis_summary: string;
  strengths: EvidenceTaggedClaimData[];
  critical_variables: EvidenceTaggedClaimData[];
  key_risks: EvidenceTaggedClaimData[];
  invalidation_events: EvidenceTaggedClaimData[];
  confidence: "low" | "medium" | "high";
}

export interface NifDashboardData {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  change_pct: number | null;
  overall_nif_score: NifOverallScore | null;
  // Structurally always present in a freshly-computed response
  // (nif_service.py builds every key unconditionally) — but this endpoint
  // is cached for up to 90 days (screener.py's _NIF_DASHBOARD_CACHE_TTL),
  // so a payload cached before this contract existed, or any other
  // real-world schema drift, can still legitimately arrive missing a key.
  // Typed optional so every consumer is forced to handle that, rather than
  // trusting a shape the cache doesn't actually guarantee.
  moat?: NifMoatData | null;
  conviction?: NifConvictionData | null;
  catalysts: NifCatalystsData | null;
  peer_comparison: NifPeerComparisonData | null;
  deterioration?: NifDeteriorationData | null;
  pillars?: {
    business_quality?: NifPillarData | null;
    financial_strength?: NifPillarData | null;
    management_quality?: NifPillarData | null;
    valuation?: NifPillarData | null;
  } | null;
}

/** A single prepared row for the "Dato real" / "Estimación Nuvos" sections —
 * built by the page (which knows each pillar's specific field names), not by
 * this generic card, matching how every other component here takes
 * already-formatted data rather than a raw API dict. */
export interface NifRow {
  label: string;
  value: string;
}

function nifScoreColor(score: number | null): string {
  if (score === null) return "var(--muted)";
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#eab308";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

export function NifOverallScoreBanner({ overall }: { overall: NifOverallScore | null }) {
  const { t } = useTranslation();
  if (!overall) return null;
  const color = nifScoreColor(overall.score);
  return (
    <div className="rounded-2xl border p-4 flex items-center gap-4 mb-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="relative w-16 h-16 rounded-full shrink-0" style={{ background: `conic-gradient(${color} ${overall.score}%, var(--raised) ${overall.score}%)` }}>
        <div className="absolute inset-[4px] rounded-full flex items-center justify-center" style={{ background: "var(--card)" }}>
          <span className="text-lg font-black tabular-nums" style={{ color }}>{overall.score}</span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("subvaluadas.nif.overallScoreLabel")}</p>
        <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{overall.score}/100</p>
        <p className="text-[11px]" style={{ color: "var(--sub)" }}>
          {t("subvaluadas.nif.weakestPillar", { pillar: t(`subvaluadas.nif.pillars.${overall.weakest_pillar}.title`), score: overall.weakest_pillar_score })}
        </p>
      </div>
    </div>
  );
}

export function NifPillarCard({
  titleKey, score, dataRows, estimateRows, explanation,
}: {
  titleKey: string;
  score: number | null;
  dataRows: NifRow[];
  estimateRows: NifRow[];
  explanation: NifExplanation | null;
}) {
  const { t } = useTranslation();
  const color = nifScoreColor(score);
  return (
    <div className="rounded-2xl border p-3.5 flex flex-col gap-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold" style={{ color: "var(--text)" }}>{t(`subvaluadas.nif.pillars.${titleKey}.title`)}</p>
        <span className="text-base font-black tabular-nums" style={{ color }}>{score !== null ? score : "N/D"}</span>
      </div>

      {dataRows.length > 0 && (
        <div>
          <div className="flex items-center gap-1 mb-1">
            <ShieldCheck className="w-3 h-3" style={{ color: "var(--muted)" }} />
            <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("subvaluadas.nif.sections.verifiedData")}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {dataRows.map((row, i) => (
              <div key={i} className="min-w-0">
                <p className="text-[9px] truncate" style={{ color: "var(--dim)" }}>{row.label}</p>
                <p className="text-[11px] font-bold tabular-nums truncate" style={{ color: "var(--text)" }}>{row.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {estimateRows.length > 0 && (
        <div className="rounded-lg p-2" style={{ background: "rgba(212,162,76,0.08)", border: "1px solid rgba(212,162,76,0.2)" }}>
          <div className="flex items-center gap-1 mb-1">
            <Wand2 className="w-3 h-3" style={{ color: "#D4A24C" }} />
            <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "#D4A24C" }}>{t("subvaluadas.nif.sections.nuvosEstimate")}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {estimateRows.map((row, i) => (
              <div key={i} className="min-w-0">
                <p className="text-[9px] truncate" style={{ color: "var(--dim)" }}>{row.label}</p>
                <p className="text-[11px] font-bold tabular-nums truncate" style={{ color: "var(--text)" }}>{row.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {explanation && explanation.sub_factors.length > 0 && (
        <div className="rounded-lg p-2" style={{ background: "rgba(0,168,94,0.06)", border: "1px solid rgba(0,168,94,0.18)" }}>
          <div className="flex items-center gap-1 mb-1.5">
            <Sparkles className="w-3 h-3" style={{ color: "var(--accent-l)" }} />
            <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--accent-l)" }}>{t("subvaluadas.nif.sections.aiExplanation")}</span>
          </div>
          <div className="space-y-1.5">
            {explanation.sub_factors.map((sf, i) => (
              <div key={i}>
                <p className="text-[10px] font-bold" style={{ color: "var(--sub)" }}>
                  {t(`subvaluadas.nif.subFactors.${sf.key}`, { defaultValue: sf.key })}
                </p>
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--dim)" }}>{sf.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {!explanation && (
        <p className="text-[10px] italic" style={{ color: "var(--muted)" }}>{t("subvaluadas.nif.explanationUnavailable")}</p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Fase 2 — Quality Engines (Moat, Conviction, Catalysts, Peer Comparison,
// Deterioration) — see backend/app/services/quality/*_engine.py and
// /Users/diegoarria/.claude/plans/stateful-painting-flurry.md. Every card
// here follows the same principle as the pillars above: real numbers
// first, collapsed by default, expandable to the full factor-by-factor
// breakdown so nothing is ever a black box. Deliberately rendered as
// SIBLINGS of the 4-pillar grid, never blended into overall_nif_score —
// "how good/durable is this business" must stay visibly separate from
// "is it cheap."
// ═══════════════════════════════════════════════════════════════════════════

function DirectionIcon({ direction }: { direction: "mejorando" | "deteriorando" | "estable" | null }) {
  if (direction === "mejorando") return <TrendingUp className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />;
  if (direction === "deteriorando") return <TrendingDown className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />;
  if (direction === "estable") return <Minus className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />;
  return null;
}

/** Generic expandable card for a "real score + explainable factor list"
 * engine (Moat, Conviction) — collapsed to just the headline score and
 * icon by default. */
export function NifScoreEngineCard({
  titleKey, icon, score, factors, footer,
}: {
  titleKey: string;
  icon: React.ReactNode;
  score: number | null;
  factors: NifScoreFactor[];
  footer?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const color = nifScoreColor(score);
  return (
    <div className="rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between gap-2 p-3.5">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{t(`subvaluadas.nif.engines.${titleKey}.title`)}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-base font-black tabular-nums" style={{ color }}>{score !== null ? score : "N/D"}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />}
        </div>
      </button>
      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-2">
          <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--muted)" }}>{t(`subvaluadas.nif.engines.${titleKey}.description`)}</p>
          {factors.map((f, i) => (
            <div key={i} className="rounded-lg p-2" style={{ background: "var(--raised)" }}>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[10.5px] font-bold" style={{ color: "var(--sub)" }}>
                  {t(`subvaluadas.nif.factors.${f.name}`, { defaultValue: f.name })}
                </span>
                {f.score !== null && (
                  <span className="text-[10.5px] font-black tabular-nums shrink-0" style={{ color: nifScoreColor(f.score) }}>{f.score}</span>
                )}
              </div>
              <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--dim)" }}>{f.reason}</p>
            </div>
          ))}
          {footer}
        </div>
      )}
    </div>
  );
}

/** Fase 2, Incremento 7 — Moat Engine's 11-moat-type AI deep dive, shown
 * as an optional expandable footer inside NifScoreEngineCard's Moat card
 * (only rendered when the deep dive was actually available). */
export function NifMoatDeepDiveBlock({ deepDive }: { deepDive: NifMoatDeepDive }) {
  const { t } = useTranslation();
  const relevantTypes = deepDive.moat_types.filter((mt) => mt.intensity !== "ninguna");
  return (
    <div className="rounded-lg p-2 space-y-2" style={{ background: "rgba(0,168,94,0.06)", border: "1px solid rgba(0,168,94,0.18)" }}>
      <div className="flex items-center gap-1">
        <Sparkles className="w-3 h-3" style={{ color: "var(--accent-l)" }} />
        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--accent-l)" }}>{t("subvaluadas.nif.sections.aiExplanation")}</span>
      </div>
      {relevantTypes.length === 0 ? (
        <p className="text-[10.5px] italic" style={{ color: "var(--muted)" }}>{t("subvaluadas.nif.engines.moat.noTypesFound")}</p>
      ) : (
        <div className="space-y-1.5">
          {relevantTypes.map((mt, i) => (
            <div key={i}>
              <p className="text-[10.5px] font-bold" style={{ color: "var(--text)" }}>
                {t(`subvaluadas.nif.moatTypes.${mt.type}`, { defaultValue: mt.type })}
                <span className="ml-1.5 font-normal" style={{ color: "var(--muted)" }}>({t(`subvaluadas.nif.intensity.${mt.intensity}`)})</span>
              </p>
              <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--dim)" }}>{mt.explanation}</p>
            </div>
          ))}
        </div>
      )}
      <div className="pt-1 border-t" style={{ borderColor: "var(--border)" }}>
        <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--dim)" }}><strong style={{ color: "var(--sub)" }}>{t("subvaluadas.nif.engines.moat.whyItExists")}:</strong> {deepDive.why_it_exists}</p>
        <p className="text-[10.5px] leading-relaxed mt-1" style={{ color: "var(--dim)" }}><strong style={{ color: "var(--sub)" }}>{t("subvaluadas.nif.engines.moat.whatCouldDestroyIt")}:</strong> {deepDive.what_could_destroy_it}</p>
      </div>
    </div>
  );
}

/** Fase 2, Incremento 8 — Management Engine's guidance-track-record /
 * governance deep dive, rendered alongside the management_quality pillar
 * card. */
export function NifManagementDeepDiveCard({ deepDive }: { deepDive: NifManagementDeepDive | null | undefined }) {
  const { t } = useTranslation();
  if (!deepDive) return null;
  return (
    <div className="rounded-2xl border p-3.5 space-y-2" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center gap-2">
        <Users className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
        <span className="text-xs font-bold" style={{ color: "var(--text)" }}>{t("subvaluadas.nif.engines.managementDeepDive.title")}</span>
      </div>
      <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--dim)" }}>{deepDive.guidance_track_record}</p>
      {deepDive.governance_flags.length > 0 && (
        <div className="space-y-1">
          {deepDive.governance_flags.map((flag, i) => (
            <div key={i} className="flex items-start gap-1.5 rounded-lg p-1.5" style={{ background: "rgba(239,68,68,0.06)" }}>
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "#ef4444" }} />
              <div>
                <p className="text-[10.5px] font-bold" style={{ color: "var(--text)" }}>{flag.flag}</p>
                <p className="text-[10px]" style={{ color: "var(--dim)" }}>{flag.evidence}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10.5px] italic leading-relaxed" style={{ color: "var(--muted)" }}>{deepDive.overall_assessment}</p>
    </div>
  );
}

/** Fase 2, Incremento 9 — Catalysts Engine: real catalysts grounded in
 * revenue segments + cited evidence, or an honest empty state. */
export function NifCatalystsCard({ data }: { data: NifCatalystsData | null }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const catalysts = data?.catalysts ?? [];
  return (
    <div className="rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between gap-2 p-3.5">
        <div className="flex items-center gap-2 min-w-0">
          <Rocket className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
          <span className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{t("subvaluadas.nif.engines.catalysts.title")}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] font-bold tabular-nums" style={{ color: "var(--muted)" }}>{catalysts.length}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />}
        </div>
      </button>
      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-2">
          {catalysts.length === 0 ? (
            <p className="text-[10.5px] italic" style={{ color: "var(--muted)" }}>{t("subvaluadas.nif.engines.catalysts.none")}</p>
          ) : catalysts.map((c, i) => (
            <div key={i} className="rounded-lg p-2" style={{ background: "var(--raised)" }}>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[10.5px] font-bold" style={{ color: "var(--text)" }}>{c.catalyst}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide shrink-0" style={{ color: "var(--muted)" }}>
                  {t(`subvaluadas.nif.timeHorizon.${c.time_horizon}`)}
                </span>
              </div>
              <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--dim)" }}>{c.evidence}</p>
              <p className="text-[10.5px] leading-relaxed mt-1" style={{ color: "var(--muted)" }}>{c.impact_if_realized}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Fase 2, Incremento 10 — Peer Comparison Engine: ranks the company's
 * real Quality Score against its real peers' own Quality Scores. */
export function NifPeerComparisonCard({ data }: { data: NifPeerComparisonData | null }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (!data || data.quality_score_percentile === null) return null;
  return (
    <div className="rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between gap-2 p-3.5">
        <div className="flex items-center gap-2 min-w-0">
          <Target className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
          <span className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{t("subvaluadas.nif.engines.peerComparison.title")}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] font-bold tabular-nums" style={{ color: nifScoreColor(data.quality_score_percentile) }}>
            {t("subvaluadas.nif.engines.peerComparison.percentile", { pct: data.quality_score_percentile })}
          </span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />}
        </div>
      </button>
      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-2">
          <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
            {t("subvaluadas.nif.engines.peerComparison.rankSummary", { rank: data.quality_score_rank, count: data.peer_count + 1 })}
          </p>
          <div className="space-y-1">
            {[...data.peer_quality_scores]
              .sort((a, b) => (b.quality_score ?? -1) - (a.quality_score ?? -1))
              .map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1" style={{ background: "var(--raised)" }}>
                  <span className="text-[10.5px] font-bold" style={{ color: "var(--text)" }}>{s.ticker}</span>
                  <span className="text-[10.5px] font-black tabular-nums" style={{ color: nifScoreColor(s.quality_score) }}>{s.quality_score ?? "N/D"}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Fase 2, Incremento 10 — Deterioration Engine: mechanical trend
 * direction per metric, complements Moat's non-directional stability. */
export function NifDeteriorationCard({ data }: { data: NifDeteriorationData | null | undefined }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (!data) return null;
  return (
    <div className="rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between gap-2 p-3.5">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
          <span className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{t("subvaluadas.nif.engines.deterioration.title")}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {data.deteriorating_count > 0 ? (
            <span className="text-[10.5px] font-bold" style={{ color: "#ef4444" }}>{t("subvaluadas.nif.engines.deterioration.countBadge", { count: data.deteriorating_count })}</span>
          ) : (
            <span className="text-[10.5px] font-bold" style={{ color: "#22c55e" }}>{t("subvaluadas.nif.engines.deterioration.noneBadge")}</span>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />}
        </div>
      </button>
      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-1.5">
          {data.factors.map((f, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg p-2" style={{ background: "var(--raised)" }}>
              <div className="mt-0.5"><DirectionIcon direction={f.direction} /></div>
              <div className="min-w-0">
                <p className="text-[10.5px] font-bold" style={{ color: "var(--text)" }}>
                  {t(`subvaluadas.nif.factors.${f.name}`, { defaultValue: f.name })}
                </p>
                <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--dim)" }}>{f.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NifDashboardSkeleton() {
  return (
    <div className="mb-4">
      <div className="rounded-2xl border p-4 mb-3 animate-pulse" style={{ borderColor: "var(--border)", background: "var(--card)", height: 88 }} />
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border p-3.5 animate-pulse" style={{ borderColor: "var(--border)", background: "var(--card)", height: 180 }} />
        ))}
      </div>
    </div>
  );
}
