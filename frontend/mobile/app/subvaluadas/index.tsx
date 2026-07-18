import React, { useState, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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

interface UndervaluedResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  intrinsic_value_base: number | null;
  margin_of_safety_pct: number | null;
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
              {filtered.map((u) => (
                <View key={u.ticker} style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={s.cardHeader}>
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
  insightBox: { flexDirection: "row", gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  checklistBox: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  checklistHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 },
  warningBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(245,158,11,0.1)", borderWidth: 1, borderColor: "rgba(245,158,11,0.25)", borderRadius: 10, padding: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12 },
});
