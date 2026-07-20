import React, { useState, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, TextInput, Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import Markdown from "react-native-markdown-display";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { screenerWeeklyApi, watchlistServerApi } from "../../src/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";
import StockAvatar from "../../src/components/StockAvatar";

interface ChecklistItem {
  key?: string;
  name: string;
  stars: number | null;
  reason: string;
}

interface Checklist {
  items: ChecklistItem[];
  avg_stars: number | null;
}

interface LiquidityGate {
  paso: boolean;
  detalle: string;
}

interface FairValueRangeData {
  low: number;
  high: number;
  base: number;
}

interface ConfidenceMeterData {
  score: number;
  label: string;
  stars: number;
}

interface MarketExpectationsData {
  market_implied_growth_pct: number | null;
  market_implied_fcf_margin_pct: number | null;
  nuvos_growth_estimate_pct: number;
  nuvos_fcf_margin_estimate_pct: number;
}

interface ConsensusValuationData {
  archetype: string;
  methods_used: Record<string, { value: number; weight: number }>;
  consensus_fair_value: number;
}

interface MomentumData {
  return_1m_pct: number;
  return_6m_pct: number;
  turn_score: number;
}

interface UndervaluedResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  intrinsic_value_base: number | null;
  margin_of_safety_pct: number | null;
  composite_score: number | null;
  fair_value_range: FairValueRangeData | null;
  confidence_meter: ConfidenceMeterData | null;
  consensus_valuation: ConsensusValuationData | null;
  momentum: MomentumData | null;
  thesis_scores: Record<string, number> | null;
  weak_dimension_warning: string | null;
  blurb: string | null;
  checklist: Checklist | null;
  liquidity_gate: LiquidityGate | null;
}

interface QuickAnalysisResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  intrinsic_value_base: number | null;
  expected_value_per_share: number | null;
  margin_of_safety_pct: number | null;
  implied_growth_pct: number | null;
  composite_score: number | null;
  fair_value_range: FairValueRangeData | null;
  confidence_meter: ConfidenceMeterData | null;
  market_expectations: MarketExpectationsData | null;
  summary: string;
  checklist: Checklist | null;
  liquidity_gate: LiquidityGate | null;
  generated_at: number;
}

function GeneratedAtNote({ generatedAt, colors }: { generatedAt: number; colors: any }) {
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

function StatChip({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={[s.statChip, { backgroundColor: colors.bgRaised }]}>
      <Text style={[s.statLabel, { color: colors.textMuted }]} numberOfLines={1}>{label}</Text>
      <Text style={[s.statValue, { color: colors.text }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function MosBadge({ pct }: { pct: number | null }) {
  const positive = (pct ?? 0) >= 0;
  return (
    <View style={[s.mosBadge, { backgroundColor: positive ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.12)" }]}>
      <Text style={{ fontSize: 14, fontWeight: "900", color: positive ? "#22c55e" : "#ef4444" }}>
        {positive ? "+" : ""}{pct}%
      </Text>
    </View>
  );
}

type SortLens = "overall" | "discount" | "quality" | "momentum";

function RankStrip({ lens, onChange, colors }: { lens: SortLens; onChange: (lens: SortLens) => void; colors: any }) {
  const { t } = useTranslation();
  const lenses: SortLens[] = ["overall", "discount", "quality", "momentum"];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {lenses.map((l) => (
          <TouchableOpacity key={l} onPress={() => onChange(l)}
                             style={[s.chip, {
                               borderColor: lens === l ? colors.accent : colors.border,
                               backgroundColor: lens === l ? colors.accent + "20" : colors.card,
                             }]}>
            <Text style={{ fontSize: 11, color: lens === l ? colors.accentLight : colors.textSub, fontWeight: "700" }}>
              {t(`subvaluadas.rankStrip.${l}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

function CompareToggle({ checked, disabled, onToggle, colors }: { checked: boolean; disabled: boolean; onToggle: () => void; colors: any }) {
  return (
    <TouchableOpacity onPress={onToggle} disabled={disabled && !checked}
                      style={{
                        width: 24, height: 24, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center",
                        opacity: disabled && !checked ? 0.3 : 1,
                        borderColor: checked ? colors.accent : colors.border,
                        backgroundColor: checked ? colors.accent : "transparent",
                      }}>
      {checked && <Ionicons name="checkmark" size={14} color="#000" />}
    </TouchableOpacity>
  );
}

function CompareTray({ items, onRemove, onClear, onCompare, colors }: {
  items: UndervaluedResult[]; onRemove: (ticker: string) => void; onClear: () => void; onCompare: () => void; colors: any;
}) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <View style={[s.compareTray, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {items.map((it) => (
            <View key={it.ticker} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.bgRaised, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>{it.ticker}</Text>
              <TouchableOpacity onPress={() => onRemove(it.ticker)}>
                <Ionicons name="close" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>
      <TouchableOpacity onPress={onClear}>
        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.textMuted }}>{t("subvaluadas.compare.clear")}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCompare} disabled={items.length < 2}
                        style={{ backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, opacity: items.length < 2 ? 0.4 : 1 }}>
        <Text style={{ fontSize: 11, fontWeight: "900", color: "#000" }}>{t("subvaluadas.compare.compareButton", { count: items.length })}</Text>
      </TouchableOpacity>
    </View>
  );
}

function CompareRow({ label, values, format, colors }: { label: string; values: (number | string | null)[]; format?: (v: number) => string; colors: any }) {
  return (
    <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 8 }}>
      <Text style={{ width: 110, fontSize: 10, fontWeight: "800", color: colors.textMuted }}>{label}</Text>
      {values.map((v, i) => (
        <Text key={i} style={{ width: 80, fontSize: 11, fontWeight: "800", color: colors.text, textAlign: "center" }}>
          {v === null || v === undefined ? "N/D" : typeof v === "number" && format ? format(v) : v}
        </Text>
      ))}
    </View>
  );
}

function CompareModal({ items, onClose, colors }: { items: UndervaluedResult[]; onClose: () => void; colors: any }) {
  const { t } = useTranslation();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%" }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 14, fontWeight: "900", color: colors.text }}>{t("subvaluadas.compare.title")}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView horizontal>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <View style={{ flexDirection: "row", marginBottom: 4 }}>
                <View style={{ width: 110 }} />
                {items.map((it) => (
                  <View key={it.ticker} style={{ width: 80, alignItems: "center", gap: 4 }}>
                    <StockAvatar ticker={it.ticker} size={28} />
                    <Text style={{ fontSize: 11, fontWeight: "900", color: colors.text }}>{it.ticker}</Text>
                  </View>
                ))}
              </View>
              <CompareRow colors={colors} label={t("subvaluadas.compare.metric.price")} values={items.map((it) => it.price)} format={(v) => `$${v.toFixed(2)}`} />
              <CompareRow colors={colors} label={t("subvaluadas.compare.metric.intrinsicValue")} values={items.map((it) => it.intrinsic_value_base)} format={(v) => `$${v.toFixed(2)}`} />
              <CompareRow colors={colors} label={t("subvaluadas.compare.metric.marginOfSafety")} values={items.map((it) => it.margin_of_safety_pct)} format={(v) => `${v > 0 ? "+" : ""}${v}%`} />
              <CompareRow colors={colors} label={t("subvaluadas.compare.metric.composite")} values={items.map((it) => it.composite_score)} format={(v) => `${v}/100`} />
              <CompareRow colors={colors} label={t("subvaluadas.compare.metric.confidence")} values={items.map((it) => it.confidence_meter?.score ?? null)} format={(v) => `${v}/100`} />
              <CompareRow colors={colors} label={t("subvaluadas.compare.metric.businessQuality")} values={items.map((it) => it.thesis_scores?.business_quality ?? null)} format={(v) => `${v}/100`} />
              <CompareRow colors={colors} label={t("subvaluadas.compare.metric.financialStrength")} values={items.map((it) => it.thesis_scores?.financial_strength ?? null)} format={(v) => `${v}/100`} />
              <CompareRow colors={colors} label={t("subvaluadas.compare.metric.predictability")} values={items.map((it) => it.thesis_scores?.predictability ?? null)} format={(v) => `${v}/100`} />
              <CompareRow colors={colors} label={t("subvaluadas.compare.metric.growthOutlook")} values={items.map((it) => it.thesis_scores?.growth_outlook ?? null)} format={(v) => `${v}/100`} />
              <CompareRow
                colors={colors}
                label={t("subvaluadas.compare.metric.fairValueRange")}
                values={items.map((it) => it.fair_value_range ? `$${Math.min(it.fair_value_range.low, it.fair_value_range.high).toFixed(0)}–${Math.max(it.fair_value_range.low, it.fair_value_range.high).toFixed(0)}` : null)}
              />
              <CompareRow colors={colors} label={t("subvaluadas.compare.metric.momentum1m")} values={items.map((it) => it.momentum?.return_1m_pct ?? null)} format={(v) => `${v > 0 ? "+" : ""}${v}%`} />
              <CompareRow colors={colors} label={t("subvaluadas.compare.metric.momentum6m")} values={items.map((it) => it.momentum?.return_6m_pct ?? null)} format={(v) => `${v > 0 ? "+" : ""}${v}%`} />
            </ScrollView>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ConfidenceMeter({ data, colors }: { data: ConfidenceMeterData; colors: any }) {
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

function FairValueRangeDisplay({ range, consensus, colors }: { range: FairValueRangeData; consensus?: ConsensusValuationData | null; colors: any }) {
  const { t } = useTranslation();
  const lo = Math.min(range.low, range.high);
  const hi = Math.max(range.low, range.high);
  const baseValue = consensus?.consensus_fair_value ?? range.base;
  return (
    <View style={[s.fvrBox, { backgroundColor: colors.bgRaised }]}>
      <Text style={[s.fvrLabel, { color: colors.textMuted }]}>
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

function MarketExpectationsPanel({ data, colors }: { data: MarketExpectationsData; colors: any }) {
  const { t } = useTranslation();
  if (data.market_implied_growth_pct === null) return null;
  return (
    <View style={[s.mktExpBox, { borderColor: colors.border, backgroundColor: colors.bgRaised }]}>
      <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text, marginBottom: 8 }}>{t("subvaluadas.marketExpectations.label")}</Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={[s.mktExpHeading, { color: colors.textMuted }]}>{t("subvaluadas.marketExpectations.marketAssumes")}</Text>
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
          <Text style={[s.mktExpHeading, { color: colors.textMuted }]}>{t("subvaluadas.marketExpectations.nuvosBelieves")}</Text>
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

function InsightBox({ text, colors }: { text: string; colors: any }) {
  return (
    <View style={[s.insightBox, { backgroundColor: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.18)" }]}>
      <Ionicons name="sparkles" size={13} color={colors.accentLight} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Markdown style={{ body: { color: colors.textSub, fontSize: 15, lineHeight: 21 }, strong: { color: colors.text, fontWeight: "800" } }}>
          {text}
        </Markdown>
      </View>
    </View>
  );
}

function LiquidityWarning({ gate }: { gate: LiquidityGate }) {
  if (gate.paso) return null;
  return (
    <View style={[s.warningBadge, { backgroundColor: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.25)" }]}>
      <Ionicons name="alert-circle-outline" size={13} color="#ef4444" />
      <Text style={{ fontSize: 11, color: "#ef4444", flex: 1 }}>{gate.detalle}</Text>
    </View>
  );
}

function WarningBadge({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <View style={s.warningBadge}>
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

function ChecklistDisplay({ checklist, colors }: { checklist: Checklist; colors: any }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const avgStars = checklist.avg_stars;
  const scoreColor = avgStars === null ? colors.textMuted : avgStars >= 4 ? "#22c55e" : avgStars >= 2.5 ? "#f59e0b" : "#ef4444";

  return (
    <View style={[s.checklistBox, { borderColor: colors.border, backgroundColor: colors.bgRaised }]}>
      <TouchableOpacity onPress={() => setExpanded((e) => !e)} style={s.checklistHeader}>
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

function ActionButtons({ ticker, companyName, watchlisted, onFollow, onAnalyze, colors }: {
  ticker: string; companyName: string | null; watchlisted: boolean;
  onFollow: () => void; onAnalyze: () => void; colors: any;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TouchableOpacity onPress={onFollow} disabled={watchlisted}
                        style={[s.actionBtn, { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised }]}>
        <Ionicons name={watchlisted ? "checkmark" : "star-outline"} size={13} color={watchlisted ? "#22c55e" : colors.textSub} />
        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.textSub }}>
          {watchlisted ? t("subvaluadas.follow.following") : t("subvaluadas.follow.button")}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onAnalyze} style={[s.actionBtn, { backgroundColor: colors.accent }]}>
        <Ionicons name="chatbubble-ellipses-outline" size={13} color="#000" />
        <Text style={{ fontSize: 11, fontWeight: "900", color: "#000" }}>
          {t("subvaluadas.analyze.button")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function SubvaluadasScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const [results, setResults] = useState<UndervaluedResult[]>([]);
  const [generatedAt, setGeneratedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sectorFilter, setSectorFilter] = useState("Todos");

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [quickResult, setQuickResult] = useState<QuickAnalysisResult | null>(null);
  const [watchlisted, setWatchlisted] = useState<Set<string>>(new Set());
  const [sortLens, setSortLens] = useState<SortLens>("overall");
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const MAX_COMPARE = 4;

  const handleFollow = async (ticker: string, companyName: string | null) => {
    if (watchlisted.has(ticker)) return;
    try {
      await watchlistServerApi.add(ticker, companyName || undefined);
      setWatchlisted((prev) => new Set(prev).add(ticker));
    } catch {
      // Ignore duplicates/errors — retrying by tapping again is a fine fallback.
    }
  };

  const handleAnalyze = (ticker: string) => {
    router.push(`/chat?msg=${encodeURIComponent(t("subvaluadas.analyze.prompt", { ticker }))}&autosend=1` as any);
  };

  useEffect(() => {
    if (!isPremium) { setLoading(false); return; }
    screenerWeeklyApi.getUndervalued(undefined, 60, i18n.language)
      .then((res: any) => {
        setResults(res.data?.results || []);
        setGeneratedAt(res.data?.generated_at || 0);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [isPremium, i18n.language]);

  const handleSearch = async () => {
    if (!query.trim() || !isPremium) return;
    setSearching(true);
    setSearchError(null);
    setQuickResult(null);
    try {
      const res = await screenerWeeklyApi.quickAnalysis(query.trim(), i18n.language);
      setQuickResult(res.data);
    } catch (err: any) {
      setSearchError(err?.response?.data?.detail || t("subvaluadas.search.error"));
    } finally {
      setSearching(false);
    }
  };

  const sectors = useMemo(() => {
    const unique = Array.from(new Set(results.map((r) => r.sector).filter(Boolean))) as string[];
    return ["Todos", ...unique.sort()];
  }, [results]);

  const filtered = sectorFilter === "Todos" ? results : results.filter((r) => r.sector === sectorFilter);

  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    const byNullable = (v: number | null | undefined) => (v === null || v === undefined ? -Infinity : v);
    switch (sortLens) {
      case "discount":
        arr.sort((a, b) => byNullable(b.margin_of_safety_pct) - byNullable(a.margin_of_safety_pct));
        break;
      case "quality":
        arr.sort((a, b) => byNullable(b.thesis_scores?.business_quality) - byNullable(a.thesis_scores?.business_quality));
        break;
      case "momentum":
        arr.sort((a, b) => byNullable(b.momentum?.turn_score) - byNullable(a.momentum?.turn_score));
        break;
      default:
        arr.sort((a, b) => byNullable(b.composite_score) - byNullable(a.composite_score) || byNullable(b.margin_of_safety_pct) - byNullable(a.margin_of_safety_pct));
    }
    return arr;
  }, [filtered, sortLens]);

  const toggleCompare = (ticker: string) => {
    setCompareSelection((prev) => {
      if (prev.includes(ticker)) return prev.filter((t) => t !== ticker);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, ticker];
    });
  };

  const compareItems = compareSelection
    .map((t) => results.find((r) => r.ticker === t))
    .filter((r): r is UndervaluedResult => !!r);

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.text }]}>{t("subvaluadas.title")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {!isPremium ? (
          <View style={[s.paywallCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[s.paywallIcon, { backgroundColor: "rgba(0,168,94,0.1)" }]}>
              <Ionicons name="lock-closed" size={26} color={colors.accentLight} />
            </View>
            <Text style={[s.paywallTitle, { color: colors.text }]}>{t("subvaluadas.premiumGate.title")}</Text>
            <Text style={[s.paywallDesc, { color: colors.textMuted }]}>
              {t("subvaluadas.premiumGate.desc")}
            </Text>
            <TouchableOpacity onPress={() => setPaywallOpen(true)} style={s.paywallBtn}>
              <Text style={s.paywallBtnText}>{t("subvaluadas.premiumGate.cta")}</Text>
            </TouchableOpacity>
          </View>
        ) : (
        <>
        <View style={[s.warningBox, { borderColor: "#ef4444", backgroundColor: "rgba(239,68,68,0.08)" }]}>
          <Text style={s.warningTitle}>{t("subvaluadas.disclaimer.title")}</Text>
          <Text style={[s.warningSubtitle, { color: colors.textSub }]}>{t("subvaluadas.disclaimer.subtitle")}</Text>
        </View>

        <Text style={[s.sectionLabel, { color: colors.text }]}>{t("subvaluadas.search.label")}</Text>
        <View style={s.searchRow}>
          <View style={[s.searchInputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleSearch}
              placeholder={t("subvaluadas.search.placeholder")}
              placeholderTextColor={colors.placeholder}
              style={[s.searchInput, { color: colors.text }]}
            />
          </View>
          <TouchableOpacity onPress={handleSearch} disabled={searching || !query.trim()}
                            style={[s.searchBtn, { backgroundColor: colors.accent, opacity: (searching || !query.trim()) ? 0.5 : 1 }]}>
            {searching ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.searchBtnText}>{t("subvaluadas.search.button")}</Text>}
          </TouchableOpacity>
        </View>

        {searchError && <Text style={{ fontSize: 12, color: "#ef4444", marginBottom: 12 }}>{searchError}</Text>}

        {quickResult && (
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.cardHeader}>
              <StockAvatar ticker={quickResult.ticker} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.ticker, { color: colors.text }]} numberOfLines={1}>{quickResult.ticker}</Text>
                <Text style={{ fontSize: 11, color: colors.textMuted }} numberOfLines={1}>
                  {quickResult.company_name}{quickResult.sector ? ` · ${quickResult.sector}` : ""}
                </Text>
              </View>
              <MosBadge pct={quickResult.margin_of_safety_pct} />
            </View>

            <GeneratedAtNote generatedAt={quickResult.generated_at} colors={colors} />

            {quickResult.liquidity_gate && <LiquidityWarning gate={quickResult.liquidity_gate} />}

            {quickResult.fair_value_range && <FairValueRangeDisplay range={quickResult.fair_value_range} colors={colors} />}
            {quickResult.confidence_meter && <ConfidenceMeter data={quickResult.confidence_meter} colors={colors} />}
            {quickResult.market_expectations && <MarketExpectationsPanel data={quickResult.market_expectations} colors={colors} />}

            <View style={s.statsRow}>
              <StatChip label={t("subvaluadas.stats.price")} value={`$${quickResult.price}`} colors={colors} />
              <StatChip label={t("subvaluadas.stats.intrinsicValue")} value={`$${quickResult.intrinsic_value_base}`} colors={colors} />
              <StatChip label={t("subvaluadas.stats.expectedValue")} value={`$${quickResult.expected_value_per_share}`} colors={colors} />
            </View>

            {quickResult.checklist && <ChecklistDisplay checklist={quickResult.checklist} colors={colors} />}
            <InsightBox text={quickResult.summary} colors={colors} />

            <View style={{ marginTop: 10 }}>
              <ActionButtons ticker={quickResult.ticker} companyName={quickResult.company_name}
                             watchlisted={watchlisted.has(quickResult.ticker)}
                             onFollow={() => handleFollow(quickResult.ticker, quickResult.company_name)}
                             onAnalyze={() => handleAnalyze(quickResult.ticker)} colors={colors} />
            </View>
          </View>
        )}

        <Text style={[s.subtitle, { color: colors.textMuted, marginTop: 16 }]}>
          {t("subvaluadas.footer.description")}
          {generatedAt > 0 && (() => {
            const days = Math.floor((Date.now() / 1000 - generatedAt) / 86400);
            const stale = days > 10;
            const date = new Date(generatedAt * 1000).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long" });
            const updatedText = days <= 0
              ? t("subvaluadas.footer.updatedToday", { date })
              : t("subvaluadas.footer.updatedDaysAgo", { count: days, date });
            return (
              <Text style={stale ? { color: "#f59e0b", fontWeight: "700" } : undefined}>
                {" "}{updatedText}{stale ? t("subvaluadas.footer.stale") : ""}
              </Text>
            );
          })()}
        </Text>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={colors.accentLight} />
          </View>
        ) : results.length === 0 ? (
          <View style={[s.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>
              {t("subvaluadas.emptyState")}
            </Text>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <RankStrip lens={sortLens} onChange={setSortLens} colors={colors} />
              </View>
              <TouchableOpacity
                onPress={() => { setCompareMode((v) => !v); if (compareMode) setCompareSelection([]); }}
                style={[s.chip, {
                  marginBottom: 10,
                  borderColor: compareMode ? colors.accent : colors.border,
                  backgroundColor: compareMode ? colors.accent + "20" : colors.card,
                }]}>
                <Text style={{ fontSize: 11, color: compareMode ? colors.accentLight : colors.textSub, fontWeight: "700" }}>
                  {compareMode ? t("subvaluadas.compare.disable") : t("subvaluadas.compare.enable")}
                </Text>
              </TouchableOpacity>
            </View>
            {sectors.length > 2 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {sectors.map((sec) => (
                    <TouchableOpacity key={sec} onPress={() => setSectorFilter(sec)}
                                       style={[s.chip, {
                                         borderColor: sectorFilter === sec ? colors.accent : colors.border,
                                         backgroundColor: sectorFilter === sec ? colors.accent + "20" : colors.card,
                                       }]}>
                      <Text style={{ fontSize: 11, color: sectorFilter === sec ? colors.accentLight : colors.textSub, fontWeight: "700" }}>
                        {sec === "Todos" ? t("subvaluadas.sectorAll") : sec}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
            <View style={{ gap: 10 }}>
              {sortedFiltered.map((u) => (
                <View key={u.ticker} style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={s.cardHeader}>
                    {compareMode && (
                      <CompareToggle checked={compareSelection.includes(u.ticker)}
                                     disabled={compareSelection.length >= MAX_COMPARE}
                                     onToggle={() => toggleCompare(u.ticker)} colors={colors} />
                    )}
                    <StockAvatar ticker={u.ticker} size={40} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[s.ticker, { color: colors.text }]} numberOfLines={1}>{u.ticker}</Text>
                      <Text style={{ fontSize: 11, color: colors.textMuted }} numberOfLines={1}>
                        {u.company_name}{u.sector ? ` · ${u.sector}` : ""}
                      </Text>
                    </View>
                    <MosBadge pct={u.margin_of_safety_pct} />
                  </View>

                  {u.liquidity_gate && <LiquidityWarning gate={u.liquidity_gate} />}

                  {u.fair_value_range && <FairValueRangeDisplay range={u.fair_value_range} consensus={u.consensus_valuation} colors={colors} />}
                  {u.confidence_meter && <ConfidenceMeter data={u.confidence_meter} colors={colors} />}

                  <View style={s.statsRow}>
                    <StatChip label={t("subvaluadas.stats.price")} value={`$${u.price}`} colors={colors} />
                    <StatChip label={t("subvaluadas.stats.intrinsicValue")} value={`$${u.intrinsic_value_base}`} colors={colors} />
                    <StatChip label={t("subvaluadas.stats.businessQuality")} value={`${u.thesis_scores?.business_quality ?? "N/D"}/100`} colors={colors} />
                  </View>

                  {u.weak_dimension_warning && <WarningBadge text={u.weak_dimension_warning} />}
                  {u.checklist && <ChecklistDisplay checklist={u.checklist} colors={colors} />}
                  {u.blurb && <InsightBox text={u.blurb} colors={colors} />}

                  <View style={{ marginTop: 10 }}>
                    <ActionButtons ticker={u.ticker} companyName={u.company_name}
                                   watchlisted={watchlisted.has(u.ticker)}
                                   onFollow={() => handleFollow(u.ticker, u.company_name)}
                                   onAnalyze={() => handleAnalyze(u.ticker)} colors={colors} />
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
        </>
        )}
      </ScrollView>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("subvaluadas.premiumGate.paywallReason")} />
      {compareMode && (
        <CompareTray
          items={compareItems}
          onRemove={(ticker) => setCompareSelection((prev) => prev.filter((t) => t !== ticker))}
          onClear={() => setCompareSelection([])}
          onCompare={() => setCompareOpen(true)}
          colors={colors}
        />
      )}
      {compareOpen && <CompareModal items={compareItems} onClose={() => setCompareOpen(false)} colors={colors} />}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 15, fontWeight: "800" },
  scroll: { padding: 16, paddingBottom: 40 },
  paywallCard: { borderWidth: 1, borderRadius: 20, padding: 28, alignItems: "center" },
  paywallIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  paywallTitle: { fontSize: 16, fontWeight: "900", marginBottom: 8 },
  paywallDesc: { fontSize: 13, textAlign: "center", lineHeight: 18, marginBottom: 18 },
  paywallBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, backgroundColor: "#00a85e" },
  paywallBtnText: { fontSize: 13, fontWeight: "900", color: "#fff" },
  warningBox: { borderWidth: 2, borderRadius: 16, padding: 14, marginBottom: 16, alignItems: "center" },
  warningTitle: { fontSize: 16, fontWeight: "900", color: "#ef4444", textAlign: "center" },
  warningSubtitle: { fontSize: 11, marginTop: 4, textAlign: "center" },
  sectionLabel: { fontSize: 13, fontWeight: "800", marginBottom: 8 },
  searchRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  searchInputWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 13 },
  searchBtn: { paddingHorizontal: 16, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  searchBtnText: { fontSize: 13, fontWeight: "900", color: "#000" },
  subtitle: { fontSize: 12, marginBottom: 16, lineHeight: 17 },
  center: { paddingVertical: 40, alignItems: "center" },
  emptyCard: { borderWidth: 1, borderRadius: 16, padding: 24 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  card: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  ticker: { fontSize: 14, fontWeight: "800" },
  statsRow: { flexDirection: "row", gap: 6 },
  statChip: { flex: 1, minWidth: 0, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
  statLabel: { fontSize: 8, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  statValue: { fontSize: 12, fontWeight: "800", marginTop: 1 },
  mosBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  fvrBox: { borderRadius: 12, padding: 12, gap: 2 },
  fvrLabel: { fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 2 },
  mktExpBox: { borderWidth: 1, borderRadius: 12, padding: 12 },
  mktExpHeading: { fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 2 },
  compareTray: {
    position: "absolute", bottom: 16, left: 16, right: 16, borderWidth: 1, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 6,
  },
  insightBox: { flexDirection: "row", gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  checklistBox: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  checklistHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 },
  warningBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(245,158,11,0.1)", borderWidth: 1, borderColor: "rgba(245,158,11,0.25)", borderRadius: 10, padding: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12 },
});
