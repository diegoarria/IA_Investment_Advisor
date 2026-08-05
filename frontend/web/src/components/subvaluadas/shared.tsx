"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Star, MessageCircle, AlertTriangle, Check, Sparkles, ShieldCheck, Wand2 } from "lucide-react";

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
  // Fase 1, Incremento 5: "cross_method" when the score's method-agreement
  // component used the real DCF/Relative/Historical spread, or
  // "scenario_range_proxy" when fewer than 2 methods were computable and it
  // fell back to the original scenario-range proxy. Optional/informational
  // — not required for the meter to render.
  dispersion_source?: "cross_method" | "scenario_range_proxy";
}

export interface MarketExpectationsData {
  market_implied_growth_pct: number | null;
  market_implied_fcf_margin_pct: number | null;
  nuvos_growth_estimate_pct: number;
  nuvos_fcf_margin_estimate_pct: number;
}

export interface ConsensusValuationData {
  archetype: string;
  methods_used: Record<string, { value: number; weight: number }>;
  consensus_fair_value: number;
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

// ── Fase 1, Incremento 4 (escenarios configurables + sensibilidad real +
// reverse DCF) — see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
export interface ScenarioValues {
  intrinsic_value_per_share: number;
  stage1_growth_pct: number;
  discount_rate_pct: number;
}

export interface ScenariosData {
  pessimistic: ScenarioValues;
  base: ScenarioValues;
  optimistic: ScenarioValues;
}

export interface ProbabilityWeights {
  pessimistic: number;
  base: number;
  optimistic: number;
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

// Fase 1, Incremento 6 (Fair Value Engine — Parte G).
export interface FairValueAdjustment {
  factor: string;
  points: number;
  reason: string;
}

export interface FairValueEngineData {
  sector: string | null;
  base_multiple: number;
  justified_multiple: number;
  adjustments: FairValueAdjustment[];
  eps: number | null;
  fair_value: number | null;
  margin_of_safety_pct: number | null;
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

export function ConfidenceMeter({ data }: { data: ConfidenceMeterData }) {
  const { t } = useTranslation();
  const color = data.score >= 85 ? "#22c55e" : data.score >= 65 ? "#eab308" : data.score >= 45 ? "#f59e0b" : "#ef4444";
  const labelKey = data.score >= 85 ? "high" : data.score >= 65 ? "moderate" : data.score >= 45 ? "low" : "speculative";
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <div className="relative w-9 h-9 rounded-full shrink-0" style={{ background: `conic-gradient(${color} ${data.score}%, var(--border) ${data.score}%)` }}>
        <div className="absolute inset-[3px] rounded-full flex items-center justify-center" style={{ background: "var(--card)" }}>
          <span className="text-[10px] font-black" style={{ color }}>{data.score}</span>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold" style={{ color: "var(--text)" }}>{t(`subvaluadas.confidence.${labelKey}`)}</p>
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} className="w-2.5 h-2.5" style={{ color: i <= data.stars ? "#f59e0b" : "var(--border)" }} fill={i <= data.stars ? "#f59e0b" : "none"} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function FairValueRangeDisplay({ range, consensus }: { range: FairValueRangeData; consensus?: ConsensusValuationData | null }) {
  const { t } = useTranslation();
  const lo = Math.min(range.low, range.high);
  const hi = Math.max(range.low, range.high);
  const baseValue = consensus?.consensus_fair_value ?? range.base;
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--raised)" }}>
      <p className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>
        {consensus ? t("subvaluadas.fairValueRange.consensus") : t("subvaluadas.fairValueRange.label")}
      </p>
      <p className="text-lg font-black tabular-nums" style={{ color: "var(--text)" }}>
        ${lo.toFixed(0)} – ${hi.toFixed(0)}
      </p>
      <p className="text-[11px]" style={{ color: "var(--sub)" }}>
        {t("subvaluadas.fairValueRange.base")}: <span className="font-bold">${baseValue.toFixed(0)}</span>
      </p>
      {consensus && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5 pt-1.5 border-t" style={{ borderColor: "var(--border)" }}>
          {Object.entries(consensus.methods_used).map(([key, m]) => (
            <span key={key} className="text-[9px]" style={{ color: "var(--muted)" }}>
              {key.replace(/_/g, " ")}: <span className="tabular-nums">${m.value.toFixed(0)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function MarketExpectationsPanel({ data }: { data: MarketExpectationsData }) {
  const { t } = useTranslation();
  if (data.market_implied_growth_pct === null) return null;
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
      <p className="text-[11px] font-bold mb-2" style={{ color: "var(--text)" }}>{t("subvaluadas.marketExpectations.label")}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "var(--muted)" }}>{t("subvaluadas.marketExpectations.marketAssumes")}</p>
          <p className="text-[11px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{t("subvaluadas.marketExpectations.growth")}: {data.market_implied_growth_pct}%</p>
          {data.market_implied_fcf_margin_pct !== null && (
            <p className="text-[11px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{t("subvaluadas.marketExpectations.margin")}: {data.market_implied_fcf_margin_pct}%</p>
          )}
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "var(--muted)" }}>{t("subvaluadas.marketExpectations.nuvosBelieves")}</p>
          <p className="text-[11px] font-bold tabular-nums" style={{ color: "var(--accent-l)" }}>{t("subvaluadas.marketExpectations.growth")}: {data.nuvos_growth_estimate_pct}%</p>
          <p className="text-[11px] font-bold tabular-nums" style={{ color: "var(--accent-l)" }}>{t("subvaluadas.marketExpectations.margin")}: {data.nuvos_fcf_margin_estimate_pct}%</p>
        </div>
      </div>
    </div>
  );
}

// Lets the user override the confidence-derived pessimistic/base/optimistic
// probability weighting (Parte C) — the backend still computes a smarter,
// confidence-tiered default (`defaultWeights`, e.g. 15/70/15 for a
// high-confidence company) rather than a flat 20/60/20, since that default
// is already real signal; this panel starts FROM that default and lets the
// user reweight it, recomputing the expected value client-side from the
// three real per-share scenario values already in the response — no new
// backend call needed for every slider drag.
export function ScenarioWeightingPanel({ scenarios, defaultWeights }: { scenarios: ScenariosData; defaultWeights: ProbabilityWeights }) {
  const { t } = useTranslation();
  const [weights, setWeights] = useState(defaultWeights);

  const total = weights.pessimistic + weights.base + weights.optimistic;
  const norm = (w: number) => (total > 0 ? w / total : 0);
  const expectedValue =
    scenarios.pessimistic.intrinsic_value_per_share * norm(weights.pessimistic) +
    scenarios.base.intrinsic_value_per_share * norm(weights.base) +
    scenarios.optimistic.intrinsic_value_per_share * norm(weights.optimistic);

  const rows: { key: keyof ProbabilityWeights; labelKey: string; color: string }[] = [
    { key: "pessimistic", labelKey: "subvaluadas.scenarios.pessimistic", color: "#ef4444" },
    { key: "base", labelKey: "subvaluadas.scenarios.base", color: "var(--accent-l)" },
    { key: "optimistic", labelKey: "subvaluadas.scenarios.optimistic", color: "#22c55e" },
  ];

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold" style={{ color: "var(--text)" }}>{t("subvaluadas.scenarios.label")}</p>
        <button onClick={() => setWeights(defaultWeights)} className="text-[10px] font-semibold hover:opacity-80" style={{ color: "var(--muted)" }}>
          {t("subvaluadas.scenarios.reset")}
        </button>
      </div>
      <div className="space-y-2.5">
        {rows.map(({ key, labelKey, color }) => (
          <div key={key}>
            <div className="flex items-center justify-between text-[10px] mb-0.5">
              <span style={{ color: "var(--sub)" }}>
                {t(labelKey)} · <span className="tabular-nums font-bold" style={{ color: "var(--text)" }}>${scenarios[key].intrinsic_value_per_share.toFixed(0)}</span>
              </span>
              <span className="tabular-nums font-bold" style={{ color }}>{Math.round(norm(weights[key]) * 100)}%</span>
            </div>
            <input
              type="range" min={0} max={100} value={weights[key]}
              onChange={(e) => setWeights((w) => ({ ...w, [key]: Number(e.target.value) }))}
              className="w-full" style={{ accentColor: color }}
            />
          </div>
        ))}
      </div>
      <div className="pt-2 mt-2 border-t flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <span className="text-[11px] font-bold" style={{ color: "var(--sub)" }}>{t("subvaluadas.scenarios.expectedValue")}</span>
        <span className="text-[13px] font-black tabular-nums" style={{ color: "var(--text)" }}>${expectedValue.toFixed(0)}</span>
      </div>
    </div>
  );
}

// Reverse DCF (Parte E) — already fully solved by the backend (Brent's
// method) in 3 flavors, never previously shown anywhere in the frontend.
// This surfaces the regime-change sanity check and the Expectations
// Investing (Rappaport) constant-growth table.
export function ReverseDcfPanel({
  sanityCheck, expectationsInvesting,
}: {
  sanityCheck: ReverseDcfSanityCheckData | null;
  expectationsInvesting: ExpectationsInvestingData | null;
}) {
  const { t } = useTranslation();
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
          <p className="text-[9px] uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
            {t("subvaluadas.reverseDcf.expectationsInvesting")}
          </p>
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
  );
}

// Fase 1, Incremento 7 (Parte H — Resultado Final): the headline summary
// that ties both independent valuation methods together instead of
// showing just one number. Never implies false precision — always framed
// as "estimación fundamentada," and explicitly explains why the two
// methods can differ (they answer different questions: intrinsic value is
// "what are the cash flows worth," fair value is "is the price reasonable
// for this business's growth/quality") rather than treating a gap as an
// error to reconcile.
export function FinalResultPanel({
  intrinsicValue, fairValue, price, confidence,
}: {
  intrinsicValue: number | null;
  fairValue: number | null;
  price: number | null;
  confidence: ConfidenceMeterData | null;
}) {
  const { t } = useTranslation();
  if (intrinsicValue === null && fairValue === null) return null;

  const values = [intrinsicValue, fairValue].filter((v): v is number => v !== null);
  const average = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const low = values.length ? Math.min(...values) : null;
  const high = values.length ? Math.max(...values) : null;
  const diffPct = intrinsicValue !== null && fairValue !== null && average
    ? Math.abs(intrinsicValue - fairValue) / average * 100
    : null;

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <p className="text-[13px] font-bold mb-3" style={{ color: "var(--text)" }}>{t("subvaluadas.finalResult.label")}</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {intrinsicValue !== null && (
          <div className="rounded-xl p-2.5" style={{ background: "var(--raised)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("subvaluadas.finalResult.intrinsicValue")}</p>
            <p className="text-lg font-black tabular-nums" style={{ color: "var(--text)" }}>${intrinsicValue.toFixed(0)}</p>
          </div>
        )}
        {fairValue !== null && (
          <div className="rounded-xl p-2.5" style={{ background: "var(--raised)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("subvaluadas.finalResult.fairValue")}</p>
            <p className="text-lg font-black tabular-nums" style={{ color: "var(--text)" }}>${fairValue.toFixed(0)}</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] mb-2" style={{ color: "var(--sub)" }}>
        {price !== null && <span>{t("subvaluadas.finalResult.currentPrice")}: <span className="font-bold tabular-nums" style={{ color: "var(--text)" }}>${price.toFixed(2)}</span></span>}
        {average !== null && <span>{t("subvaluadas.finalResult.average")}: <span className="font-bold tabular-nums" style={{ color: "var(--text)" }}>${average.toFixed(0)}</span></span>}
        {low !== null && high !== null && low !== high && (
          <span>{t("subvaluadas.finalResult.range")}: <span className="font-bold tabular-nums" style={{ color: "var(--text)" }}>${low.toFixed(0)} – ${high.toFixed(0)}</span></span>
        )}
      </div>
      {confidence && <div className="mb-2"><ConfidenceMeter data={confidence} /></div>}
      {diffPct !== null && diffPct > 15 && (
        <p className="text-[11px] leading-relaxed mb-1" style={{ color: "#f59e0b" }}>
          {t("subvaluadas.finalResult.methodsDiffer", { pct: diffPct.toFixed(0) })}
        </p>
      )}
      <p className="text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>{t("subvaluadas.finalResult.disclaimer")}</p>
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

export interface NifPillarData {
  pillar: string;
  score: number | null;
  data: Record<string, unknown>;
  nuvos_estimate: Record<string, unknown>;
  explanation: NifExplanation | null;
}

export interface NifOverallScore {
  score: number;
  weakest_pillar: string;
  weakest_pillar_score: number;
  pillar_breakdown: Record<string, { score: number | null; weight: number }>;
}

export interface NifDashboardData {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  change_pct: number | null;
  overall_nif_score: NifOverallScore | null;
  pillars: {
    business_quality: NifPillarData;
    financial_strength: NifPillarData;
    management_quality: NifPillarData;
    valuation: NifPillarData;
  };
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
