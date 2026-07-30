import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, TextInput, Modal,
} from "react-native";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { screenerWeeklyApi, watchlistServerApi } from "../../src/lib/api";
import PaywallModal from "../../src/components/PaywallModal";
import StockAvatar from "../../src/components/StockAvatar";
import { calcularValorIntrinseco } from "../../src/lib/dcfCalculator";
import {
  type Checklist, type LiquidityGate, type FairValueRangeData, type ConfidenceMeterData, type MarketExpectationsData,
  type ConsensusValuationData, type DcfAssumptions, type RangeBounds, type YearlyDetailRow,
  GeneratedAtNote, LiquidityWarning, ConfidenceMeter, FairValueRangeDisplay, MarketExpectationsPanel, InsightBox,
  ChecklistDisplay, ActionButtons,
} from "../../src/components/subvaluadas/shared";

// Scoped dark navy/gold palette for this whole screen — RN has no CSS
// custom properties, so this is passed explicitly as the `colors` prop to
// the shared display components instead of useTheme()'s normal light/dark
// colors, matching the mockup exactly regardless of the app's theme toggle.
const viColors = {
  bg: "#0A0F1A", bgRaised: "#16223A", card: "#111A2B", cardElevated: "#16223A",
  border: "rgba(255,255,255,0.08)", borderStrong: "#1C2B47",
  text: "#EBEEF5", textSub: "#8C97AD", textMuted: "#5C6883", textDim: "#5C6883", placeholder: "#5C6883",
  accent: "#D4A24C", accentLight: "#D4A24C", accentDark: "#A9793A",
  up: "#4FA695", down: "#DD6E63", info: "#4FA695",
};

const GOLD = "#D4A24C", TEAL = "#4FA695", CORAL = "#DD6E63";
const DEFAULT_TICKER = "AAPL";

interface QuickAnalysisResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  change_pct: number | null;
  exchange: string | null;
  intrinsic_value_base: number | null;
  expected_value_per_share: number | null;
  margin_of_safety_pct: number | null;
  implied_growth_pct: number | null;
  composite_score: number | null;
  fair_value_range: FairValueRangeData | null;
  confidence_meter: ConfidenceMeterData | null;
  market_expectations: MarketExpectationsData | null;
  consensus_valuation: ConsensusValuationData | null;
  summary: string;
  checklist: Checklist | null;
  liquidity_gate: LiquidityGate | null;
  generated_at: number;
  current_fcf: number | null;
  net_cash: number | null;
  shares_outstanding: number | null;
  dcf_assumptions: DcfAssumptions | null;
  yearly_detail: YearlyDetailRow[] | null;
  pv_of_fcf_sum: number | null;
  pv_of_terminal_value: number | null;
  enterprise_value: number | null;
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "N/D";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(2)}`;
}

type Stoplight = "green" | "yellow" | "red";

function stoplightFor(value: number, range: RangeBounds | null): Stoplight {
  if (!range) return "yellow";
  const spread = range.high - range.low;
  if (value >= range.low && value <= range.high) return "green";
  if (value >= range.low - spread && value <= range.high + spread) return "yellow";
  return "red";
}

const STOPLIGHT_DOT: Record<Stoplight, string> = { green: "🟢", yellow: "🟡", red: "🔴" };
const STOPLIGHT_COLOR: Record<Stoplight, string> = { green: "#22c55e", yellow: "#f59e0b", red: "#ef4444" };

function colorForRatio(ratio: number): string {
  const coral = [221, 110, 99], gold = [212, 162, 76], teal = [79, 166, 149];
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  let c: number[];
  if (ratio <= 1.0) {
    const t = clamp((ratio - 0.6) / 0.4, 0, 1);
    c = coral.map((v, i) => Math.round(v + (gold[i] - v) * t));
  } else {
    const t = clamp((ratio - 1.0) / 0.5, 0, 1);
    c = gold.map((v, i) => Math.round(v + (teal[i] - v) * t));
  }
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const G_OFFSETS = [-4, -2, 0, 2, 4];
const R_OFFSETS = [-2, -1, 0, 1, 2];

function SensitivityHeatmap({ fcf0, netCash, shares, g, r, gt, price }: {
  fcf0: number; netCash: number; shares: number; g: number; r: number; gt: number; price: number;
}) {
  const { t } = useTranslation();
  const gVals = G_OFFSETS.map((o) => g + o);
  const rVals = R_OFFSETS.map((o) => r + o);
  const cellSize = 52;

  return (
    <View style={{ borderRadius: 14, backgroundColor: viColors.card, borderWidth: 1, borderColor: viColors.border, padding: 16, marginTop: 16 }}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: viColors.text, marginBottom: 4 }}>{t("subvaluadas.detail.heatmap.title")}</Text>
      <Text style={{ fontSize: 11.5, lineHeight: 16, color: viColors.textSub, marginBottom: 10 }}>{t("subvaluadas.detail.heatmap.desc")}</Text>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}>
        <Text style={{ fontSize: 10, color: viColors.textMuted }}>{t("subvaluadas.detail.heatmap.lower")}</Text>
        <View style={{ width: 80, height: 6, borderRadius: 3, backgroundColor: GOLD }} />
        <Text style={{ fontSize: 10, color: viColors.textMuted }}>{t("subvaluadas.detail.heatmap.higher")}</Text>
      </View>

      <View style={{ flexDirection: "row" }}>
        <View style={{ width: 38 }} />
        {gVals.map((gv, i) => (
          <View key={i} style={{ width: cellSize, alignItems: "center" }}>
            <Text style={{ fontSize: 9, color: viColors.textMuted }}>{pct(gv)}</Text>
          </View>
        ))}
      </View>
      {rVals.map((rv, ri) => (
        <View key={ri} style={{ flexDirection: "row", marginTop: 3 }}>
          <View style={{ width: 38, justifyContent: "center" }}>
            <Text style={{ fontSize: 9, color: viColors.textMuted, textAlign: "right", paddingRight: 4 }}>{pct(rv)}</Text>
          </View>
          {gVals.map((gv, gi) => {
            const val = calcularValorIntrinseco({ fcf0, g: gv / 100, r: rv / 100, gt: gt / 100, netCash, shares });
            const isCenter = ri === 2 && gi === 2;
            const noSolution = val === null;
            const ratio = val && price ? val.valorPorAccion / price : 1;
            return (
              <View key={gi} style={{
                width: cellSize, height: cellSize, marginHorizontal: 1.5, borderRadius: 8,
                alignItems: "center", justifyContent: "center",
                backgroundColor: noSolution ? viColors.borderStrong : colorForRatio(ratio),
                borderWidth: isCenter ? 2 : 0, borderColor: "#EBEEF5",
              }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: noSolution ? viColors.textDim : "#0A0F1A" }}>
                  {noSolution ? "N/D" : `$${val!.valorPorAccion.toFixed(0)}`}
                </Text>
              </View>
            );
          })}
        </View>
      ))}

      <View style={{ flexDirection: "row", gap: 8, marginTop: 14, padding: 10, borderRadius: 10, backgroundColor: viColors.bgRaised }}>
        <Ionicons name="alert-circle-outline" size={14} color={GOLD} style={{ marginTop: 1 }} />
        <Text style={{ flex: 1, fontSize: 11, lineHeight: 15, color: viColors.textSub }}>{t("subvaluadas.detail.heatmap.note")}</Text>
      </View>
    </View>
  );
}

export default function SubvaluadasScreen() {
  const { t, i18n } = useTranslation();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);

  const [paywallOpen, setPaywallOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState(DEFAULT_TICKER);
  const [data, setData] = useState<QuickAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watchlisted, setWatchlisted] = useState(false);
  const [level3Open, setLevel3Open] = useState(false);

  useEffect(() => {
    if (!isPremium) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    screenerWeeklyApi.quickAnalysis(ticker, i18n.language)
      .then((res: any) => setData(res.data))
      .catch((err: any) => setError(err?.response?.data?.detail || t("subvaluadas.search.error")))
      .finally(() => setLoading(false));
  }, [ticker, isPremium, i18n.language, t]);

  const handleSearch = () => {
    if (!query.trim() || !isPremium) return;
    setWatchlisted(false);
    setTicker(query.trim().toUpperCase());
  };

  const hasData = data?.current_fcf != null && data?.net_cash != null && data?.shares_outstanding != null && data?.price != null;
  const isFinancialSector = data?.dcf_assumptions?.methodology === "residual_income_justified_pb";

  const fcf0 = hasData ? data!.current_fcf! / 1e6 : 0;
  const netCash = hasData ? data!.net_cash! / 1e6 : 0;
  const shares = hasData ? data!.shares_outstanding! / 1e6 : 0;
  const horizon = data?.yearly_detail && data.yearly_detail.length > 0 ? data.yearly_detail.length : 10;

  const suggestedG = data?.dcf_assumptions?.suggested_g ?? 7;
  const suggestedR = data?.dcf_assumptions?.suggested_r ?? 9;
  const suggestedGt = data?.dcf_assumptions?.suggested_gt ?? 3;

  const [g, setG] = useState(suggestedG);
  const [r, setR] = useState(suggestedR);
  const [gt, setGt] = useState(suggestedGt);

  useEffect(() => { setG(suggestedG); setR(suggestedR); setGt(suggestedGt); }, [suggestedG, suggestedR, suggestedGt]);

  const isDefault = g === suggestedG && r === suggestedR && gt === suggestedGt;

  const liveResult = useMemo(() => {
    if (!hasData) return null;
    return calcularValorIntrinseco({ fcf0, g: g / 100, r: r / 100, gt: gt / 100, n: horizon, netCash, shares });
  }, [hasData, fcf0, g, r, gt, horizon, netCash, shares]);

  const price = data?.price ?? 0;
  const liveMos = liveResult && price ? ((liveResult.valorPorAccion - price) / price) * 100 : null;
  const barMax = Math.max(price, liveResult?.valorPorAccion ?? 0) * 1.15 || 1;

  const handleFollow = async () => {
    if (!data || watchlisted) return;
    try { await watchlistServerApi.add(data.ticker, data.company_name || undefined); setWatchlisted(true); } catch { /* idempotent */ }
  };
  const handleAnalyze = () => router.push(`/chat?msg=${encodeURIComponent(t("subvaluadas.analyze.prompt", { ticker }))}&autosend=1` as any);
  const askMentor = (question: string) => router.push(`/chat?msg=${encodeURIComponent(question)}&autosend=1` as any);

  const name = data?.company_name || ticker;
  const mentorQuestions = [
    { key: "why", text: t("subvaluadas.dcf.mentor.why", { ticker: name }) },
    { key: "risk", text: t("subvaluadas.dcf.mentor.risk", { ticker: name }) },
    { key: "sensitivity", text: t("subvaluadas.dcf.mentor.sensitivity", { ticker: name }) },
    { key: "change", text: t("subvaluadas.dcf.mentor.change", { ticker: name }) },
  ];

  if (!isPremium) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: viColors.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16 }}>
          <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={viColors.text} /></TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: "rgba(212,162,76,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Ionicons name="lock-closed" size={26} color={GOLD} />
          </View>
          <Text style={{ fontSize: 15, fontWeight: "700", color: viColors.text, marginBottom: 6 }}>{t("subvaluadas.premiumGate.title")}</Text>
          <Text style={{ fontSize: 13, color: viColors.textMuted, textAlign: "center", marginBottom: 18 }}>{t("subvaluadas.premiumGate.desc")}</Text>
          <TouchableOpacity onPress={() => setPaywallOpen(true)} style={{ backgroundColor: GOLD, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12 }}>
            <Text style={{ fontSize: 13, fontWeight: "800", color: "#0A0F1A" }}>{t("subvaluadas.premiumGate.cta")}</Text>
          </TouchableOpacity>
        </View>
        <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("subvaluadas.premiumGate.paywallReason")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: viColors.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 }}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={viColors.text} /></TouchableOpacity>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.card, paddingHorizontal: 12 }}>
          <Ionicons name="search" size={16} color={viColors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            placeholder={t("subvaluadas.search.placeholder")}
            placeholderTextColor={viColors.placeholder}
            style={{ flex: 1, paddingVertical: 10, fontSize: 13, color: viColors.text }}
          />
        </View>
        <TouchableOpacity onPress={handleSearch} disabled={!query.trim()}
                          style={{ backgroundColor: GOLD, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, opacity: !query.trim() ? 0.5 : 1 }}>
          <Text style={{ fontSize: 12, fontWeight: "800", color: "#0A0F1A" }}>{t("subvaluadas.search.button")}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={GOLD} />
        </View>
      ) : error || !data ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ fontSize: 13, color: viColors.textMuted, textAlign: "center" }}>{error || t("subvaluadas.search.error")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <StockAvatar ticker={data.ticker} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "600", color: viColors.text }} numberOfLines={1}>{data.company_name}</Text>
                <Text style={{ fontSize: 12, color: viColors.textSub, marginTop: 2 }} numberOfLines={1}>
                  {data.sector}{data.exchange ? ` · ${data.exchange}` : ""}
                </Text>
              </View>
            </View>
            {data.price !== null && (
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 20, fontWeight: "600", color: viColors.text }}>${data.price.toFixed(2)}</Text>
                {data.change_pct !== null && (
                  <Text style={{ fontSize: 12, color: data.change_pct >= 0 ? TEAL : CORAL }}>
                    {data.change_pct >= 0 ? "+" : ""}{data.change_pct.toFixed(2)}% {t("subvaluadas.detail.today")}
                  </Text>
                )}
              </View>
            )}
          </View>

          <View style={{ gap: 10, marginBottom: 22 }}>
            <GeneratedAtNote generatedAt={data.generated_at} colors={viColors} />
            {data.liquidity_gate && <LiquidityWarning gate={data.liquidity_gate} />}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {data.fair_value_range && <FairValueRangeDisplay range={data.fair_value_range} consensus={data.consensus_valuation} colors={viColors} />}
              {data.confidence_meter && <ConfidenceMeter data={data.confidence_meter} colors={viColors} />}
            </View>
            {data.market_expectations && <MarketExpectationsPanel data={data.market_expectations} colors={viColors} />}
            {data.checklist && <ChecklistDisplay checklist={data.checklist} colors={viColors} />}
            <InsightBox text={data.summary} colors={viColors} />
          </View>

          <Text style={{ fontSize: 24, fontWeight: "600", color: viColors.text, marginBottom: 6 }}>
            {t("subvaluadas.detail.pageTitle.pre")} <Text style={{ fontStyle: "italic", color: GOLD }}>{t("subvaluadas.detail.pageTitle.em")}</Text>
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 18, color: viColors.textSub, marginBottom: 16 }}>{t("subvaluadas.detail.pageSubtitle")}</Text>

          {hasData && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
              {[
                [t("subvaluadas.detail.chips.fcf"), fmtMoney(data.current_fcf)],
                [t("subvaluadas.detail.chips.netCash"), fmtMoney(data.net_cash)],
                [t("subvaluadas.detail.chips.shares"), `${(data.shares_outstanding! / 1e6).toFixed(0)}M`],
              ].map(([label, value]) => (
                <View key={label} style={{ borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: viColors.card, borderWidth: 1, borderColor: viColors.border, flexDirection: "row", gap: 5 }}>
                  <Text style={{ fontSize: 11, color: viColors.textSub }}>{label}</Text>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: viColors.text }}>{value}</Text>
                </View>
              ))}
            </View>
          )}

          {!hasData ? (
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.card, padding: 14 }}>
              <Text style={{ fontSize: 12, color: viColors.textSub }}>{t("subvaluadas.dcf.noData")}</Text>
            </View>
          ) : isFinancialSector ? (
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.card, padding: 14 }}>
              <Text style={{ fontSize: 12, color: viColors.textSub }}>{t("subvaluadas.dcf.financialSectorNote")}</Text>
            </View>
          ) : (
            <>
              <View style={{ borderRadius: 14, backgroundColor: viColors.card, borderWidth: 1, borderColor: viColors.border, padding: 16, gap: 18 }}>
                {[
                  { key: "growth", label: t("subvaluadas.detail.controls.growth"), sub: t("subvaluadas.detail.controls.growthSub"), value: g, set: setG, min: 0, max: 25, step: 0.5, range: data.dcf_assumptions?.g_range ?? null },
                  { key: "wacc", label: t("subvaluadas.detail.controls.wacc"), sub: t("subvaluadas.detail.controls.waccSub"), value: r, set: setR, min: 4, max: 18, step: 0.25, range: data.dcf_assumptions?.r_range ?? null },
                  { key: "terminal", label: t("subvaluadas.detail.controls.terminalGrowth"), sub: t("subvaluadas.detail.controls.terminalGrowthSub"), value: gt, set: setGt, min: 0, max: 5, step: 0.25, range: data.dcf_assumptions?.gt_range ?? null },
                ].map((ctrl) => {
                  const light = stoplightFor(ctrl.value, ctrl.range);
                  return (
                    <View key={ctrl.key}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 4 }}>
                        <View>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: viColors.text }}>{ctrl.label}</Text>
                          <Text style={{ fontSize: 10.5, color: viColors.textMuted }}>{ctrl.sub}</Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ fontSize: 12 }}>{STOPLIGHT_DOT[light]}</Text>
                          <Text style={{ fontSize: 15, fontWeight: "600", color: GOLD }}>{pct(ctrl.value)}</Text>
                        </View>
                      </View>
                      <Slider
                        minimumValue={ctrl.min} maximumValue={ctrl.max} step={ctrl.step} value={ctrl.value}
                        onValueChange={ctrl.set}
                        minimumTrackTintColor={GOLD} maximumTrackTintColor={viColors.borderStrong} thumbTintColor={GOLD}
                        style={{ height: 30 }}
                      />
                      <Text style={{ fontSize: 10, color: STOPLIGHT_COLOR[light] }}>{t(`subvaluadas.dcf.stoplight.${light}`)}</Text>
                    </View>
                  );
                })}

                {!isDefault && (
                  <TouchableOpacity onPress={() => { setG(suggestedG); setR(suggestedR); setGt(suggestedGt); }} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="refresh" size={12} color={GOLD} />
                    <Text style={{ fontSize: 11, fontWeight: "700", color: GOLD }}>{t("subvaluadas.dcf.reset")}</Text>
                  </TouchableOpacity>
                )}

                <View style={{ height: 1, backgroundColor: viColors.border }} />

                <View>
                  <Text style={{ fontSize: 11, textTransform: "uppercase", color: viColors.textMuted, marginBottom: 2 }}>{t("subvaluadas.detail.output.label")}</Text>
                  {liveResult ? (
                    <>
                      <Text style={{ fontSize: 34, fontWeight: "700", color: viColors.text }}>${liveResult.valorPorAccion.toFixed(2)}</Text>
                      <Text style={{ fontSize: 12, color: viColors.textSub }}>{t("subvaluadas.detail.output.vs", { price: price.toFixed(2) })}</Text>
                    </>
                  ) : (
                    <Text style={{ fontSize: 13, color: viColors.textMuted }}>{t("subvaluadas.dcf.liveResult.noSolution")}</Text>
                  )}
                </View>

                {liveMos !== null && (
                  <View style={{ alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: liveMos >= 0 ? "rgba(79,166,149,0.14)" : "rgba(221,110,99,0.14)" }}>
                    <Text style={{ fontSize: 12.5, fontWeight: "700", color: liveMos >= 0 ? TEAL : CORAL }}>
                      {liveMos >= 0 ? "+" : ""}{liveMos.toFixed(1)}% {t("subvaluadas.detail.marginOfSafety")}
                    </Text>
                  </View>
                )}

                {liveResult && (
                  <View style={{ height: 10, borderRadius: 5, backgroundColor: viColors.borderStrong, marginTop: 8 }}>
                    <View style={{ position: "absolute", top: -3, left: `${Math.max(0, Math.min(100, (price / barMax) * 100))}%`, width: 12, height: 12, borderRadius: 6, backgroundColor: viColors.textSub, marginLeft: -6 }} />
                    <View style={{ position: "absolute", top: -3, left: `${Math.max(0, Math.min(100, (liveResult.valorPorAccion / barMax) * 100))}%`, width: 12, height: 12, borderRadius: 6, backgroundColor: GOLD, marginLeft: -6 }} />
                  </View>
                )}

                {data.dcf_assumptions?.market_implied_growth_pct != null && (
                  <Text style={{ fontSize: 11, lineHeight: 15, color: viColors.textMuted }}>
                    {t("subvaluadas.dcf.marketImplied", { market: data.dcf_assumptions.market_implied_growth_pct.toFixed(1), nuvos: suggestedG.toFixed(1) })}
                  </Text>
                )}
              </View>

              <SensitivityHeatmap fcf0={fcf0} netCash={netCash} shares={shares} g={g} r={r} gt={gt} price={price} />

              <TouchableOpacity onPress={() => setLevel3Open(true)} style={{ marginTop: 14 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", textDecorationLine: "underline", color: viColors.textMuted }}>{t("subvaluadas.detail.level3Toggle")}</Text>
              </TouchableOpacity>

              <View style={{ marginTop: 20 }}>
                <Text style={{ fontSize: 10, fontWeight: "700", textTransform: "uppercase", color: viColors.textMuted, marginBottom: 8 }}>{t("subvaluadas.dcf.mentor.title")}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {mentorQuestions.map((q) => (
                    <TouchableOpacity key={q.key} onPress={() => askMentor(q.text)}
                                      style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.card }}>
                      <Ionicons name="chatbubble-ellipses-outline" size={12} color={viColors.textSub} />
                      <Text style={{ fontSize: 11, fontWeight: "600", color: viColors.textSub }}>{q.text}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </>
          )}

          <View style={{ marginTop: 22 }}>
            <ActionButtons watchlisted={watchlisted} onFollow={handleFollow} onAnalyze={handleAnalyze} colors={viColors} />
          </View>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 18, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.bg }}>
            <Ionicons name="alert-circle-outline" size={14} color={viColors.textMuted} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, fontSize: 11, lineHeight: 15, color: viColors.textMuted }}>
              <Text style={{ fontWeight: "700", color: viColors.textSub }}>{t("subvaluadas.detail.disclaimer.bold")}</Text> {t("subvaluadas.detail.disclaimer.text")}
            </Text>
          </View>
        </ScrollView>
      )}

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("subvaluadas.premiumGate.paywallReason")} />

      {level3Open && data && (
        <Level3Modal
          ticker={data.ticker} price={data.price} fcf0={fcf0} netCash={netCash} shares={shares}
          g={g} r={r} gt={gt}
          yearlyDetail={data.yearly_detail} pvOfFcfSum={data.pv_of_fcf_sum} pvOfTerminalValue={data.pv_of_terminal_value} enterpriseValue={data.enterprise_value}
          onClose={() => setLevel3Open(false)}
        />
      )}
    </SafeAreaView>
  );
}

function Level3Modal({ ticker, price, fcf0, netCash, shares, g, r, gt, yearlyDetail, pvOfFcfSum, pvOfTerminalValue, enterpriseValue, onClose }: {
  ticker: string; price: number | null; fcf0: number; netCash: number; shares: number; g: number; r: number; gt: number;
  yearlyDetail: YearlyDetailRow[] | null; pvOfFcfSum: number | null; pvOfTerminalValue: number | null; enterpriseValue: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const equityValue = enterpriseValue !== null ? enterpriseValue + netCash * 1e6 : null;
  const perShare = equityValue !== null && shares > 0 ? equityValue / (shares * 1e6) : null;
  const mos = perShare !== null && price ? ((perShare - price) / price) * 100 : null;

  const handleExport = async () => {
    const [XLSX, FileSystem, Sharing] = await Promise.all([
      import("xlsx"),
      import("expo-file-system/legacy"),
      import("expo-sharing"),
    ]);
    const wb = XLSX.utils.book_new();
    const inputsSheet = XLSX.utils.aoa_to_sheet([
      [t("subvaluadas.detail.level3.inputs")],
      [t("subvaluadas.detail.controls.growth"), pct(g)],
      [t("subvaluadas.detail.controls.wacc"), pct(r)],
      [t("subvaluadas.detail.controls.terminalGrowth"), pct(gt)],
      ["FCF (TTM, M)", fcf0.toFixed(1)],
      [t("subvaluadas.detail.level3.netCash") + " (M)", netCash.toFixed(1)],
      [t("subvaluadas.detail.level3.shares") + " (M)", shares.toFixed(1)],
      [t("subvaluadas.stats.price"), price ?? "N/D"],
    ]);
    XLSX.utils.book_append_sheet(wb, inputsSheet, "Inputs");
    if (yearlyDetail && yearlyDetail.length > 0) {
      const rows = [
        [t("subvaluadas.detail.level3.year"), t("subvaluadas.detail.level3.fcf"), t("subvaluadas.detail.level3.discountFactor"), t("subvaluadas.detail.level3.presentValue")],
        ...yearlyDetail.map((row) => [row.year, row.fcf, row.discount_factor, row.present_value]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Proyeccion");
    }
    const bridgeSheet = XLSX.utils.aoa_to_sheet([
      [t("subvaluadas.detail.level3.pvFcf"), pvOfFcfSum ?? "N/D"],
      [t("subvaluadas.detail.level3.pvTerminal"), pvOfTerminalValue ?? "N/D"],
      [t("subvaluadas.detail.level3.enterpriseValue"), enterpriseValue ?? "N/D"],
      [t("subvaluadas.detail.level3.netCash"), netCash * 1e6],
      [t("subvaluadas.detail.level3.equityValue"), equityValue ?? "N/D"],
      [t("subvaluadas.detail.level3.shares"), shares * 1e6],
      [t("subvaluadas.detail.level3.perShare"), perShare ?? "N/D"],
    ]);
    XLSX.utils.book_append_sheet(wb, bridgeSheet, "Valuacion");
    const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    const path = (FileSystem.cacheDirectory ?? "") + `${ticker}_dcf_nuvos.xlsx`;
    await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" }}>
        <View style={{ maxHeight: "85%", borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: viColors.card }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: viColors.border }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: viColors.text }}>{t("subvaluadas.detail.level3.title", { ticker })}</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={20} color={viColors.textMuted} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[
                { label: t("subvaluadas.detail.controls.growth"), value: pct(g) },
                { label: t("subvaluadas.detail.controls.wacc"), value: pct(r) },
                { label: t("subvaluadas.detail.controls.terminalGrowth"), value: pct(gt) },
              ].map((stat) => (
                <View key={stat.label} style={{ flex: 1, borderRadius: 10, backgroundColor: viColors.bgRaised, padding: 8 }}>
                  <Text style={{ fontSize: 9, fontWeight: "700", textTransform: "uppercase", color: viColors.textMuted }}>{stat.label}</Text>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: viColors.text }}>{stat.value}</Text>
                </View>
              ))}
            </View>

            {yearlyDetail && yearlyDetail.length > 0 && (
              <View>
                <Text style={{ fontSize: 11, fontWeight: "700", textTransform: "uppercase", color: viColors.textMuted, marginBottom: 6 }}>{t("subvaluadas.detail.level3.yearlyTable")}</Text>
                <View style={{ borderRadius: 10, borderWidth: 1, borderColor: viColors.border, overflow: "hidden" }}>
                  <View style={{ flexDirection: "row", backgroundColor: viColors.bgRaised, paddingVertical: 6, paddingHorizontal: 8 }}>
                    <Text style={{ flex: 1, fontSize: 10, fontWeight: "700", color: viColors.textMuted }}>{t("subvaluadas.detail.level3.year")}</Text>
                    <Text style={{ flex: 2, fontSize: 10, fontWeight: "700", color: viColors.textMuted, textAlign: "right" }}>{t("subvaluadas.detail.level3.fcf")}</Text>
                    <Text style={{ flex: 2, fontSize: 10, fontWeight: "700", color: viColors.textMuted, textAlign: "right" }}>{t("subvaluadas.detail.level3.presentValue")}</Text>
                  </View>
                  {yearlyDetail.map((row) => (
                    <View key={row.year} style={{ flexDirection: "row", paddingVertical: 6, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: viColors.border }}>
                      <Text style={{ flex: 1, fontSize: 10.5, fontWeight: "700", color: viColors.text }}>{row.year}</Text>
                      <Text style={{ flex: 2, fontSize: 10.5, color: viColors.textSub, textAlign: "right" }}>{fmtMoney(row.fcf)}</Text>
                      <Text style={{ flex: 2, fontSize: 10.5, fontWeight: "700", color: viColors.text, textAlign: "right" }}>{fmtMoney(row.present_value)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View>
              <Text style={{ fontSize: 11, fontWeight: "700", textTransform: "uppercase", color: viColors.textMuted, marginBottom: 6 }}>{t("subvaluadas.detail.level3.pvFcf")}</Text>
              <View style={{ borderRadius: 10, backgroundColor: viColors.bgRaised, padding: 10, gap: 6 }}>
                {[
                  [t("subvaluadas.detail.level3.pvFcf"), fmtMoney(pvOfFcfSum), false],
                  [t("subvaluadas.detail.level3.pvTerminal"), fmtMoney(pvOfTerminalValue), false],
                  [t("subvaluadas.detail.level3.enterpriseValue"), fmtMoney(enterpriseValue), true],
                  [t("subvaluadas.detail.level3.netCash"), fmtMoney(netCash * 1e6), false],
                  [t("subvaluadas.detail.level3.equityValue"), fmtMoney(equityValue), true],
                  [t("subvaluadas.detail.level3.shares"), `${shares.toFixed(1)}M`, false],
                ].map(([label, value, bold], i) => (
                  <View key={i} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 11, color: viColors.textSub }}>{label as string}</Text>
                    <Text style={{ fontSize: 11, fontWeight: bold ? "700" : "400", color: viColors.text }}>{value as string}</Text>
                  </View>
                ))}
                <View style={{ paddingTop: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: viColors.border, flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: viColors.textSub }}>{t("subvaluadas.detail.level3.perShare")}</Text>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: GOLD }}>{perShare !== null ? `$${perShare.toFixed(2)}` : "N/D"}</Text>
                </View>
                {mos !== null && (
                  <Text style={{ fontSize: 11, color: mos >= 0 ? TEAL : CORAL }}>
                    {t("subvaluadas.detail.marginOfSafety")}: {mos >= 0 ? "+" : ""}{mos.toFixed(1)}%
                  </Text>
                )}
              </View>
            </View>

            <TouchableOpacity onPress={handleExport}
                              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.bgRaised }}>
              <Ionicons name="document-text-outline" size={15} color={viColors.text} />
              <Text style={{ fontSize: 12, fontWeight: "700", color: viColors.text }}>{t("subvaluadas.detail.level3.export")}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
