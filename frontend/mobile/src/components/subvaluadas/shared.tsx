import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import Slider from "@react-native-community/slider";
import Svg, { Circle } from "react-native-svg";
import Markdown from "react-native-markdown-display";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

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

export interface LiquidityGate {
  paso: boolean;
  detalle: string;
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
  // Mirror of the web type — see its comment (Incremento 11, THE FLIP).
  dispersion_source?: "cross_method" | "bear_bull_dispersion";
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
// Mirror of the web version's types in frontend/web/src/components/subvaluadas/shared.tsx.
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

export function GeneratedAtNote({ generatedAt, colors }: { generatedAt: number; colors: any }) {
  const { t, i18n } = useTranslation();
  if (!generatedAt) return null;
  const days = Math.floor((Date.now() / 1000 - generatedAt) / 86400);
  const stale = days > 10;
  const date = new Date(generatedAt * 1000).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long" });
  const updatedText = days <= 0
    ? t("subvaluadas.footer.updatedToday", { date })
    : t("subvaluadas.footer.updatedDaysAgo", { count: days, date });
  return (
    <Text style={{ fontSize: 10, color: stale ? "#f59e0b" : colors.textMuted, fontWeight: stale ? "700" : "400" }}>
      {updatedText}{stale ? t("subvaluadas.footer.stale") : ""}
    </Text>
  );
}

export function StatChip({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={{ flex: 1, minWidth: 0, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.bgRaised }}>
      <Text style={{ fontSize: 8, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, color: colors.textMuted }} numberOfLines={1}>{label}</Text>
      <Text style={{ fontSize: 12, fontWeight: "800", marginTop: 1, color: colors.text }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

export function MosBadge({ pct }: { pct: number | null }) {
  const positive = (pct ?? 0) >= 0;
  return (
    <View style={{ borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: positive ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.12)" }}>
      <Text style={{ fontSize: 14, fontWeight: "900", color: positive ? "#22c55e" : "#ef4444" }}>
        {positive ? "+" : ""}{pct}%
      </Text>
    </View>
  );
}

export function ConfidenceMeter({ data, colors }: { data: ConfidenceMeterData; colors: any }) {
  const { t } = useTranslation();
  const color = data.score >= 85 ? "#22c55e" : data.score >= 65 ? "#eab308" : data.score >= 45 ? "#f59e0b" : "#ef4444";
  const labelKey = data.score >= 85 ? "high" : data.score >= 65 ? "moderate" : data.score >= 45 ? "low" : "speculative";
  const size = 36;
  const strokeWidth = 3.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference * (1 - data.score / 100);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.border} strokeWidth={strokeWidth} fill="none" />
          <Circle
            cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={strokeWidth} fill="none"
            strokeDasharray={circumference} strokeDashoffset={progress} strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <Text style={{ fontSize: 9, fontWeight: "900", color }}>{data.score}</Text>
      </View>
      <View>
        <Text style={{ fontSize: 10, fontWeight: "800", color: colors.text }}>{t(`subvaluadas.confidence.${labelKey}`)}</Text>
        <View style={{ flexDirection: "row", gap: 1 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Ionicons key={i} name={i <= data.stars ? "star" : "star-outline"} size={9} color={i <= data.stars ? "#f59e0b" : colors.border} />
          ))}
        </View>
      </View>
    </View>
  );
}

export function FairValueRangeDisplay({ range, consensus, colors }: { range: FairValueRangeData; consensus?: ConsensusValuationData | null; colors: any }) {
  const { t } = useTranslation();
  const lo = Math.min(range.low, range.high);
  const hi = Math.max(range.low, range.high);
  const baseValue = consensus?.consensus_fair_value ?? range.base;
  return (
    <View style={{ borderRadius: 12, padding: 12, gap: 2, backgroundColor: colors.bgRaised }}>
      <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 2, color: colors.textMuted }}>
        {consensus ? t("subvaluadas.fairValueRange.consensus") : t("subvaluadas.fairValueRange.label")}
      </Text>
      <Text style={{ fontSize: 18, fontWeight: "900", color: colors.text }}>
        ${lo.toFixed(0)} – ${hi.toFixed(0)}
      </Text>
      <Text style={{ fontSize: 11, color: colors.textSub }}>
        {t("subvaluadas.fairValueRange.base")}: <Text style={{ fontWeight: "800" }}>${baseValue.toFixed(0)}</Text>
      </Text>
      {consensus && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
          {Object.entries(consensus.methods_used).map(([key, m]) => (
            <Text key={key} style={{ fontSize: 9, color: colors.textMuted }}>
              {key.replace(/_/g, " ")}: <Text style={{ fontVariant: ["tabular-nums"] }}>${m.value.toFixed(0)}</Text>
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

export function MarketExpectationsPanel({ data, colors }: { data: MarketExpectationsData; colors: any }) {
  const { t } = useTranslation();
  if (data.market_implied_growth_pct === null) return null;
  return (
    <View style={{ borderWidth: 1, borderRadius: 12, padding: 12, borderColor: colors.border, backgroundColor: colors.bgRaised }}>
      <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text, marginBottom: 8 }}>{t("subvaluadas.marketExpectations.label")}</Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 2, color: colors.textMuted }}>{t("subvaluadas.marketExpectations.marketAssumes")}</Text>
          <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>
            {t("subvaluadas.marketExpectations.growth")}: {data.market_implied_growth_pct}%
          </Text>
          {data.market_implied_fcf_margin_pct !== null && (
            <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>
              {t("subvaluadas.marketExpectations.margin")}: {data.market_implied_fcf_margin_pct}%
            </Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 2, color: colors.textMuted }}>{t("subvaluadas.marketExpectations.nuvosBelieves")}</Text>
          <Text style={{ fontSize: 11, fontWeight: "800", color: colors.accentLight }}>
            {t("subvaluadas.marketExpectations.growth")}: {data.nuvos_growth_estimate_pct}%
          </Text>
          <Text style={{ fontSize: 11, fontWeight: "800", color: colors.accentLight }}>
            {t("subvaluadas.marketExpectations.margin")}: {data.nuvos_fcf_margin_estimate_pct}%
          </Text>
        </View>
      </View>
    </View>
  );
}

// Lets the user override the confidence-derived pessimistic/base/optimistic
// probability weighting (Parte C). Mirror of the web version — see its
// docstring for why the default starts from the backend's confidence-tiered
// weights rather than a flat 20/60/20.
export function ScenarioWeightingPanel({
  scenarios, defaultWeights, colors,
}: {
  scenarios: ScenariosData; defaultWeights: ProbabilityWeights; colors: any;
}) {
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
    { key: "base", labelKey: "subvaluadas.scenarios.base", color: colors.accentLight },
    { key: "optimistic", labelKey: "subvaluadas.scenarios.optimistic", color: "#22c55e" },
  ];

  return (
    <View style={{ borderWidth: 1, borderRadius: 12, padding: 12, borderColor: colors.border, backgroundColor: colors.bgRaised }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>{t("subvaluadas.scenarios.label")}</Text>
        <TouchableOpacity onPress={() => setWeights(defaultWeights)}>
          <Text style={{ fontSize: 10, fontWeight: "700", color: colors.textMuted }}>{t("subvaluadas.scenarios.reset")}</Text>
        </TouchableOpacity>
      </View>
      {rows.map(({ key, labelKey, color }) => (
        <View key={key} style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
            <Text style={{ fontSize: 10, color: colors.textSub }}>
              {t(labelKey)} · <Text style={{ fontWeight: "800", color: colors.text }}>${scenarios[key].intrinsic_value_per_share.toFixed(0)}</Text>
            </Text>
            <Text style={{ fontSize: 10, fontWeight: "800", color }}>{Math.round(norm(weights[key]) * 100)}%</Text>
          </View>
          <Slider
            minimumValue={0} maximumValue={100} step={1} value={weights[key]}
            onValueChange={(v) => setWeights((w) => ({ ...w, [key]: v }))}
            minimumTrackTintColor={color} maximumTrackTintColor={colors.borderStrong} thumbTintColor={color}
            style={{ height: 26 }}
          />
        </View>
      ))}
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 8, marginTop: 2, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textSub }}>{t("subvaluadas.scenarios.expectedValue")}</Text>
        <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text }}>${expectedValue.toFixed(0)}</Text>
      </View>
    </View>
  );
}

// Reverse DCF (Parte E) — mirror of the web version.
export function ReverseDcfPanel({
  sanityCheck, expectationsInvesting, colors,
}: {
  sanityCheck: ReverseDcfSanityCheckData | null;
  expectationsInvesting: ExpectationsInvestingData | null;
  colors: any;
}) {
  const { t } = useTranslation();
  if (!sanityCheck && !expectationsInvesting) return null;
  return (
    <View style={{ borderWidth: 1, borderRadius: 12, padding: 12, borderColor: colors.border, backgroundColor: colors.bgRaised }}>
      <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text, marginBottom: 8 }}>{t("subvaluadas.reverseDcf.label")}</Text>
      {sanityCheck && (
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          {sanityCheck.regime_change_flag && (
            <Ionicons name="alert-circle-outline" size={14} color="#f59e0b" style={{ marginTop: 1 }} />
          )}
          <Text style={{ flex: 1, fontSize: 11, lineHeight: 16, color: sanityCheck.regime_change_flag ? "#f59e0b" : colors.textSub }}>
            {sanityCheck.detalle}
          </Text>
        </View>
      )}
      {expectationsInvesting && (
        <View style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6, color: colors.textMuted }}>
            {t("subvaluadas.reverseDcf.expectationsInvesting")}
          </Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {expectationsInvesting.growth_by_rate.map((row) => (
              <View key={row.scenario} style={{ flex: 1, borderRadius: 8, padding: 6, alignItems: "center", backgroundColor: colors.card }}>
                <Text style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: 0.3, color: colors.textMuted }}>
                  {t(`subvaluadas.scenarios.${row.scenario}`)}
                </Text>
                <Text style={{ fontSize: 11, fontWeight: "900", color: colors.text }}>
                  {row.implied_growth_pct !== null ? `${row.implied_growth_pct}%` : "N/D"}
                </Text>
              </View>
            ))}
          </View>
          {expectationsInvesting.historical_fcf_decline_years > 0 && (
            <Text style={{ fontSize: 10, marginTop: 6, color: colors.textMuted }}>
              {t("subvaluadas.reverseDcf.declineYears", { count: expectationsInvesting.historical_fcf_decline_years })}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// Nuvos AI Fair Value Engine redesign — mobile parity for the web
// FairValueScenariosPanel (shared.tsx). One engine, three scenarios (Bear/
// Base/Bull). Since Incremento 11 (EL FLIP) this is the primary valuation
// panel — `fair_value_range` (FairValueRangeDisplay/ConfidenceMeter above)
// now IS this same panel's Bear<->Bull dispersion.
export interface NuvosScoreFactor {
  name: string;
  value: number | null;
  score: number | null;
  reason: string;
}

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

export interface NuvosScenario {
  fair_value_per_share: number | null;
  assumptions: NuvosScenarioAssumptions;
}

export interface NuvosFairValueData {
  scenarios: {
    bear: NuvosScenario;
    base: NuvosScenario;
    bull: NuvosScenario;
  };
  exit_metric: string;
  exit_multiple_anchor_source: "own_historical" | "peer_median" | "sector_table_fallback";
  price_implied_scenario: "bear" | "base" | "bull" | null;
  growth_factors: NuvosScoreFactor[];
  operating_margin_factors: NuvosScoreFactor[];
  terminal_roic_factors: NuvosScoreFactor[];
}

const _SCENARIO_COLOR: Record<"bear" | "base" | "bull", string> = {
  bear: "#DD6E63", base: "#D4A24C", bull: "#4FA695",
};

function _nuvosScenarioMosPct(fairValue: number | null, price: number | null): number | null {
  if (fairValue === null || fairValue <= 0 || price === null) return null;
  return ((fairValue - price) / fairValue) * 100;
}

function _NuvosScenarioRow({
  name, scenario, price, isPriceImplied, colors,
}: {
  name: "bear" | "base" | "bull";
  scenario: NuvosScenario;
  price: number | null;
  isPriceImplied: boolean;
  colors: any;
}) {
  const { t } = useTranslation();
  const color = _SCENARIO_COLOR[name];
  const fv = scenario.fair_value_per_share;
  const mos = _nuvosScenarioMosPct(fv, price);
  const a = scenario.assumptions;
  return (
    <View
      style={{
        borderRadius: 10, padding: 10, gap: 4,
        backgroundColor: colors.card,
        borderWidth: isPriceImplied ? 1.5 : 1,
        borderColor: isPriceImplied ? color : colors.border,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, color }}>
          {t(`subvaluadas.nuvosFairValue.scenarios.${name}`)}
        </Text>
        {isPriceImplied && (
          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: `${color}22` }}>
            <Text style={{ fontSize: 8, fontWeight: "800", textTransform: "uppercase", color }}>
              {t("subvaluadas.nuvosFairValue.priceImpliedBadge")}
            </Text>
          </View>
        )}
      </View>
      <Text style={{ fontSize: 18, fontWeight: "900", color: colors.text }}>
        {fv !== null ? `$${fv.toFixed(2)}` : "N/D"}
      </Text>
      {mos !== null && (
        <Text style={{ fontSize: 11, fontWeight: "800", color: mos >= 0 ? "#22c55e" : "#ef4444" }}>
          {mos >= 0 ? "+" : ""}{mos.toFixed(1)}% {t("subvaluadas.nuvosFairValue.mos")}
        </Text>
      )}
      <View style={{ paddingTop: 6, marginTop: 2, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 }}>
        <Text style={{ fontSize: 10, color: colors.textSub }}>
          {t("subvaluadas.nuvosFairValue.growth")}: <Text style={{ fontWeight: "800", color: colors.text }}>{a.revenue_growth_1_pct.toFixed(1)}%</Text>
        </Text>
        <Text style={{ fontSize: 10, color: colors.textSub }}>
          {t("subvaluadas.nuvosFairValue.margin")}: <Text style={{ fontWeight: "800", color: colors.text }}>{a.operating_margin_anchor_pct.toFixed(1)}% → {a.terminal_operating_margin_pct.toFixed(1)}%</Text>
        </Text>
        <Text style={{ fontSize: 10, color: colors.textSub }}>
          {t("subvaluadas.nuvosFairValue.wacc")}: <Text style={{ fontWeight: "800", color: colors.text }}>{a.discount_rate_pct.toFixed(1)}%</Text>
        </Text>
        {a.exit_multiple !== null && (
          <Text style={{ fontSize: 10, color: colors.textSub }}>
            {t("subvaluadas.nuvosFairValue.exitMultiple")}: <Text style={{ fontWeight: "800", color: colors.text }}>{a.exit_multiple.toFixed(1)}x {a.exit_metric ? t(`subvaluadas.nuvosFairValue.exitMetric.${a.exit_metric}`) : ""}</Text>
          </Text>
        )}
      </View>
    </View>
  );
}

function _NuvosFactorsSection({ title, factors, colors }: { title: string; factors: NuvosScoreFactor[]; colors: any }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (factors.length === 0) return null;
  return (
    <View>
      <TouchableOpacity onPress={() => setExpanded((e) => !e)}>
        <Text style={{ fontSize: 10, fontWeight: "800", textDecorationLine: "underline", color: colors.textMuted }}>
          {title} — {expanded ? t("subvaluadas.checklist.hide") : t("subvaluadas.checklist.viewDetail")}
        </Text>
      </TouchableOpacity>
      {expanded && (
        <View style={{ gap: 6, marginTop: 6 }}>
          {factors.map((f, i) => (
            <View key={i} style={{ borderRadius: 8, padding: 8, backgroundColor: colors.bgRaised }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
                <Text style={{ fontSize: 10.5, fontWeight: "800", color: colors.textSub }}>
                  {t(`subvaluadas.nuvosFairValue.assumptionFactors.${f.name}`, { defaultValue: f.name })}
                </Text>
                {f.value !== null && (
                  <Text style={{ fontSize: 10.5, fontWeight: "900", color: colors.text }}>{f.value.toFixed(1)}%</Text>
                )}
              </View>
              <Text style={{ fontSize: 10.5, lineHeight: 15, color: colors.textMuted }}>{f.reason}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function FairValueScenariosPanel({ data, price, colors }: { data: NuvosFairValueData | null; price: number | null; colors: any }) {
  const { t } = useTranslation();
  if (!data) return null;
  const { scenarios, price_implied_scenario } = data;
  return (
    <View style={{ borderWidth: 1, borderRadius: 12, padding: 12, borderColor: colors.border, backgroundColor: colors.bgRaised }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 2 }}>
        <Ionicons name="sparkles-outline" size={13} color={colors.accentLight} />
        <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>{t("subvaluadas.nuvosFairValue.title")}</Text>
      </View>
      <Text style={{ fontSize: 10.5, lineHeight: 15, color: colors.textMuted, marginBottom: 10 }}>
        {t("subvaluadas.nuvosFairValue.subtitle")}
      </Text>

      <View style={{ gap: 8, marginBottom: 10 }}>
        <_NuvosScenarioRow name="bear" scenario={scenarios.bear} price={price} isPriceImplied={price_implied_scenario === "bear"} colors={colors} />
        <_NuvosScenarioRow name="base" scenario={scenarios.base} price={price} isPriceImplied={price_implied_scenario === "base"} colors={colors} />
        <_NuvosScenarioRow name="bull" scenario={scenarios.bull} price={price} isPriceImplied={price_implied_scenario === "bull"} colors={colors} />
      </View>

      {price_implied_scenario && (
        <Text style={{ fontSize: 11, lineHeight: 16, fontStyle: "italic", color: colors.textSub, marginBottom: 10 }}>
          {t("subvaluadas.nuvosFairValue.priceImpliedNote", { scenario: t(`subvaluadas.nuvosFairValue.scenarios.${price_implied_scenario}`) })}
        </Text>
      )}

      <View style={{ gap: 8 }}>
        <_NuvosFactorsSection title={t("subvaluadas.nuvosFairValue.growthFactorsTitle")} factors={data.growth_factors} colors={colors} />
        <_NuvosFactorsSection title={t("subvaluadas.nuvosFairValue.marginFactorsTitle")} factors={data.operating_margin_factors} colors={colors} />
        <_NuvosFactorsSection title={t("subvaluadas.nuvosFairValue.roicFactorsTitle")} factors={data.terminal_roic_factors} colors={colors} />
      </View>

      <Text style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, fontSize: 9.5, lineHeight: 14, color: colors.textDim }}>
        {t("subvaluadas.nuvosFairValue.disclaimer")}
      </Text>
    </View>
  );
}

// Fase 1, Incremento 7 (Parte H — Resultado Final). Mirror of the web
// version — see its comment for the full rationale.
export function FinalResultPanel({
  intrinsicValue, fairValue, price, confidence, colors,
}: {
  intrinsicValue: number | null;
  fairValue: number | null;
  price: number | null;
  confidence: ConfidenceMeterData | null;
  colors: any;
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
    <View style={{ borderWidth: 1, borderRadius: 16, padding: 14, borderColor: colors.border, backgroundColor: colors.card }}>
      <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text, marginBottom: 10 }}>{t("subvaluadas.finalResult.label")}</Text>
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
        {intrinsicValue !== null && (
          <View style={{ flex: 1, borderRadius: 10, padding: 8, backgroundColor: colors.bgRaised }}>
            <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }}>{t("subvaluadas.finalResult.intrinsicValue")}</Text>
            <Text style={{ fontSize: 17, fontWeight: "900", color: colors.text }}>${intrinsicValue.toFixed(0)}</Text>
          </View>
        )}
        {fairValue !== null && (
          <View style={{ flex: 1, borderRadius: 10, padding: 8, backgroundColor: colors.bgRaised }}>
            <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }}>{t("subvaluadas.finalResult.fairValue")}</Text>
            <Text style={{ fontSize: 17, fontWeight: "900", color: colors.text }}>${fairValue.toFixed(0)}</Text>
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
        {price !== null && (
          <Text style={{ fontSize: 11, color: colors.textSub }}>{t("subvaluadas.finalResult.currentPrice")}: <Text style={{ fontWeight: "800", color: colors.text }}>${price.toFixed(2)}</Text></Text>
        )}
        {average !== null && (
          <Text style={{ fontSize: 11, color: colors.textSub }}>{t("subvaluadas.finalResult.average")}: <Text style={{ fontWeight: "800", color: colors.text }}>${average.toFixed(0)}</Text></Text>
        )}
        {low !== null && high !== null && low !== high && (
          <Text style={{ fontSize: 11, color: colors.textSub }}>{t("subvaluadas.finalResult.range")}: <Text style={{ fontWeight: "800", color: colors.text }}>${low.toFixed(0)} – ${high.toFixed(0)}</Text></Text>
        )}
      </View>
      {confidence && <View style={{ marginBottom: 8 }}><ConfidenceMeter data={confidence} colors={colors} /></View>}
      {diffPct !== null && diffPct > 15 && (
        <Text style={{ fontSize: 11, lineHeight: 16, color: "#f59e0b", marginBottom: 4 }}>
          {t("subvaluadas.finalResult.methodsDiffer", { pct: diffPct.toFixed(0) })}
        </Text>
      )}
      <Text style={{ fontSize: 10, lineHeight: 14, color: colors.textDim }}>{t("subvaluadas.finalResult.disclaimer")}</Text>
    </View>
  );
}

export function InsightBox({ text, colors }: { text: string; colors: any }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, borderWidth: 1, borderRadius: 12, padding: 10, backgroundColor: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.18)" }}>
      <Ionicons name="sparkles" size={13} color={colors.accentLight} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Markdown style={{ body: { color: colors.textSub, fontSize: 15, lineHeight: 21 }, strong: { color: colors.text, fontWeight: "800" } }}>
          {text}
        </Markdown>
      </View>
    </View>
  );
}

export function LiquidityWarning({ gate }: { gate: LiquidityGate }) {
  if (gate.paso) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10, padding: 8, backgroundColor: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.25)" }}>
      <Ionicons name="alert-circle-outline" size={13} color="#ef4444" />
      <Text style={{ fontSize: 11, color: "#ef4444", flex: 1 }}>{gate.detalle}</Text>
    </View>
  );
}

export function WarningBadge({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(245,158,11,0.1)", borderWidth: 1, borderColor: "rgba(245,158,11,0.25)", borderRadius: 10, padding: 8 }}>
      <Ionicons name="warning-outline" size={13} color="#f59e0b" />
      <Text style={{ fontSize: 11, color: "#f59e0b", flex: 1 }}>{t("subvaluadas.weakDimensionWarning", { text })}</Text>
    </View>
  );
}

function StarRow({ stars, colors }: { stars: number | null; colors: any }) {
  if (stars === null) {
    return <Text style={{ fontSize: 10, fontWeight: "800", color: colors.textMuted }}>?</Text>;
  }
  return (
    <View style={{ flexDirection: "row", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={i <= stars ? "star" : "star-outline"} size={11} color={i <= stars ? "#f59e0b" : colors.border} />
      ))}
    </View>
  );
}

export function ChecklistDisplay({ checklist, colors }: { checklist: Checklist; colors: any }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const avgStars = checklist.avg_stars;
  const scoreColor = avgStars === null ? colors.textMuted : avgStars >= 4 ? "#22c55e" : avgStars >= 2.5 ? "#f59e0b" : "#ef4444";

  return (
    <View style={{ borderWidth: 1, borderRadius: 12, overflow: "hidden", borderColor: colors.border, backgroundColor: colors.bgRaised }}>
      <TouchableOpacity onPress={() => setExpanded((e) => !e)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="star" size={13} color={scoreColor} />
          <Text style={{ fontSize: 14, fontWeight: "900", color: scoreColor }}>{avgStars !== null ? `${avgStars}/5` : "N/D"}</Text>
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.textSub }}>{t("subvaluadas.checklist.label")}</Text>
        </View>
        <Text style={{ fontSize: 10, color: colors.textMuted }}>{expanded ? t("subvaluadas.checklist.hide") : t("subvaluadas.checklist.viewDetail")}</Text>
      </TouchableOpacity>
      {expanded && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 8 }}>
          {checklist.items.map((item, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <View style={{ marginTop: 2 }}>
                <StarRow stars={item.stars} colors={colors} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>
                  {item.key ? t(`subvaluadas.checklist.items.${item.key}`, { defaultValue: item.name }) : item.name}
                </Text>
                <Text style={{ fontSize: 10, color: colors.textDim }}>{item.reason}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function ActionButtons({ watchlisted, onFollow, onAnalyze, colors }: {
  watchlisted: boolean; onFollow: () => void; onAnalyze: () => void; colors: any;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TouchableOpacity onPress={onFollow} disabled={watchlisted}
                        style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised }}>
        <Ionicons name={watchlisted ? "checkmark" : "star-outline"} size={13} color={watchlisted ? "#22c55e" : colors.textSub} />
        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.textSub }}>
          {watchlisted ? t("subvaluadas.follow.following") : t("subvaluadas.follow.button")}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onAnalyze} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.accent }}>
        <Ionicons name="chatbubble-ellipses-outline" size={13} color="#000" />
        <Text style={{ fontSize: 11, fontWeight: "900", color: "#000" }}>
          {t("subvaluadas.analyze.button")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Nuvos Investment Framework (NIF) — Phase 1 dashboard (mobile mirror of the
// web version in frontend/web/src/components/subvaluadas/shared.tsx — keep
// both in sync). Every pillar keeps data/nuvos_estimate/explanation visually
// separate with a literal labeled chip, not just color, per Diego's explicit
// transparency requirement.
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

export interface NifRow {
  label: string;
  value: string;
}

function nifScoreColor(score: number | null): string {
  if (score === null) return "#9ca3af";
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#eab308";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

export function NifOverallScoreBanner({ overall, colors }: { overall: NifOverallScore | null; colors: any }) {
  const { t } = useTranslation();
  if (!overall) return null;
  const color = nifScoreColor(overall.score);
  const size = 56;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference * (1 - overall.score / 100);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12, borderColor: colors.border, backgroundColor: colors.card }}>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.border} strokeWidth={strokeWidth} fill="none" />
          <Circle
            cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={strokeWidth} fill="none"
            strokeDasharray={circumference} strokeDashoffset={progress} strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <Text style={{ fontSize: 16, fontWeight: "900", color }}>{overall.score}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, color: colors.textMuted }}>{t("subvaluadas.nif.overallScoreLabel")}</Text>
        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>{overall.score}/100</Text>
        <Text style={{ fontSize: 10, color: colors.textSub }}>
          {t("subvaluadas.nif.weakestPillar", { pillar: t(`subvaluadas.nif.pillars.${overall.weakest_pillar}.title`), score: overall.weakest_pillar_score })}
        </Text>
      </View>
    </View>
  );
}

export function NifPillarCard({
  titleKey, score, dataRows, estimateRows, explanation, colors,
}: {
  titleKey: string;
  score: number | null;
  dataRows: NifRow[];
  estimateRows: NifRow[];
  explanation: NifExplanation | null;
  colors: any;
}) {
  const { t } = useTranslation();
  const color = nifScoreColor(score);
  return (
    <View style={{ borderWidth: 1, borderRadius: 16, padding: 12, gap: 10, borderColor: colors.border, backgroundColor: colors.card }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 12, fontWeight: "800", color: colors.text, flex: 1 }} numberOfLines={2}>{t(`subvaluadas.nif.pillars.${titleKey}.title`)}</Text>
        <Text style={{ fontSize: 16, fontWeight: "900", color }}>{score !== null ? score : "N/D"}</Text>
      </View>

      {dataRows.length > 0 && (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 }}>
            <Ionicons name="shield-checkmark-outline" size={11} color={colors.textMuted} />
            <Text style={{ fontSize: 8, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, color: colors.textMuted }}>{t("subvaluadas.nif.sections.verifiedData")}</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {dataRows.map((row, i) => (
              <View key={i} style={{ minWidth: "42%" }}>
                <Text style={{ fontSize: 8, color: colors.textDim }} numberOfLines={1}>{row.label}</Text>
                <Text style={{ fontSize: 10, fontWeight: "800", color: colors.text }} numberOfLines={1}>{row.value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {estimateRows.length > 0 && (
        <View style={{ borderRadius: 10, padding: 8, backgroundColor: "rgba(212,162,76,0.08)", borderWidth: 1, borderColor: "rgba(212,162,76,0.2)" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 }}>
            <Ionicons name="sparkles-outline" size={11} color="#D4A24C" />
            <Text style={{ fontSize: 8, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, color: "#D4A24C" }}>{t("subvaluadas.nif.sections.nuvosEstimate")}</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {estimateRows.map((row, i) => (
              <View key={i} style={{ minWidth: "42%" }}>
                <Text style={{ fontSize: 8, color: colors.textDim }} numberOfLines={1}>{row.label}</Text>
                <Text style={{ fontSize: 10, fontWeight: "800", color: colors.text }} numberOfLines={1}>{row.value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {explanation && explanation.sub_factors.length > 0 && (
        <View style={{ borderRadius: 10, padding: 8, backgroundColor: "rgba(0,168,94,0.06)", borderWidth: 1, borderColor: "rgba(0,168,94,0.18)" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 }}>
            <Ionicons name="sparkles" size={11} color={colors.accentLight} />
            <Text style={{ fontSize: 8, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, color: colors.accentLight }}>{t("subvaluadas.nif.sections.aiExplanation")}</Text>
          </View>
          <View style={{ gap: 6 }}>
            {explanation.sub_factors.map((sf, i) => (
              <View key={i}>
                <Text style={{ fontSize: 9, fontWeight: "800", color: colors.textSub }}>
                  {t(`subvaluadas.nif.subFactors.${sf.key}`, { defaultValue: sf.key })}
                </Text>
                <Text style={{ fontSize: 10, lineHeight: 14, color: colors.textDim }}>{sf.text}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      {!explanation && (
        <Text style={{ fontSize: 9, fontStyle: "italic", color: colors.textMuted }}>{t("subvaluadas.nif.explanationUnavailable")}</Text>
      )}
    </View>
  );
}

export function NifDashboardSkeleton({ colors }: { colors: any }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ borderWidth: 1, borderRadius: 16, marginBottom: 10, height: 84, borderColor: colors.border, backgroundColor: colors.card, opacity: 0.6 }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ width: "47%", borderWidth: 1, borderRadius: 16, height: 170, borderColor: colors.border, backgroundColor: colors.card, opacity: 0.6 }} />
        ))}
      </View>
    </View>
  );
}
