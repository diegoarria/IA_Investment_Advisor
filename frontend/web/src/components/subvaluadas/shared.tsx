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

export interface NifDashboardData {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  change_pct: number | null;
  overall_nif_score: NifOverallScore | null;
  moat: NifMoatData;
  conviction: NifConvictionData;
  catalysts: NifCatalystsData | null;
  peer_comparison: NifPeerComparisonData | null;
  deterioration: NifDeteriorationData;
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
export function NifDeteriorationCard({ data }: { data: NifDeteriorationData }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
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
