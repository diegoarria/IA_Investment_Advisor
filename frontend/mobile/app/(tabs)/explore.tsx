import React, { useState, useCallback, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, SafeAreaView, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { useTranslation } from "react-i18next";
import { marketApi, screenerWeeklyApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useWatchlistStore } from "../../src/lib/watchlistStore";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";

const SECTORS = ["Todos", "Tech", "Finance", "Salud", "Consumo", "Energía", "ETF"];

interface Stock {
  ticker: string;
  name: string;
  sector: string;
  price: number | null;
  change_pct: number | null;
  pe: number | null;
  fwd_pe: number | null;
  rev_growth: number | null;
  margin: number | null;
  div_yield: number | null;
  recom: string;
  score: number;
}

function scoreBar(score: number): string {
  const filled = Math.round(score / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function scoreColor(score: number): string {
  if (score >= 70) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function RecomBadge({ recom, colors }: { recom: string; colors: Colors }) {
  const { t } = useTranslation();
  const map: Record<string, { label: string; color: string }> = {
    strong_buy: { label: t("explore.recom.strongBuy"), color: "#16a34a" },
    buy:        { label: t("explore.recom.buy"),        color: "#22c55e" },
    hold:       { label: t("explore.recom.hold"),        color: "#f59e0b" },
    sell:       { label: t("explore.recom.sell"),        color: "#ef4444" },
    strong_sell:{ label: t("explore.recom.strongSell"),  color: "#dc2626" },
  };
  const cfg = map[recom];
  if (!cfg) return null;
  return (
    <View style={{ backgroundColor: cfg.color + "20", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ color: cfg.color, fontSize: 10, fontWeight: "700" }}>{cfg.label}</Text>
    </View>
  );
}

function StockCard({ item, colors, styles }: { item: Stock; colors: Colors; styles: ReturnType<typeof makeStyles> }) {
  const { t } = useTranslation();
  const { add, remove, has } = useWatchlistStore();
  const watching = has(item.ticker);
  const color = scoreColor(item.score);
  const chgColor = (item.change_pct ?? 0) >= 0 ? "#22c55e" : "#ef4444";

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardLeft}>
          <Text style={[styles.ticker, { color: colors.text }]}>{item.ticker}</Text>
          <Text style={[styles.name, { color: colors.textMuted }]}>{item.name}</Text>
        </View>
        <View style={styles.cardRight}>
          {item.price && (
            <Text style={[styles.price, { color: colors.text }]}>
              ${item.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </Text>
          )}
          {item.change_pct !== null && (
            <Text style={[styles.change, { color: chgColor }]}>
              {item.change_pct >= 0 ? "▲" : "▼"} {Math.abs(item.change_pct).toFixed(2)}%
            </Text>
          )}
        </View>
      </View>

      {/* Score bar */}
      <View style={styles.scoreRow}>
        <Text style={[styles.scoreBar, { color }]}>{scoreBar(item.score)}</Text>
        <Text style={[styles.scoreNum, { color }]}>{item.score}/100</Text>
      </View>

      {/* Metrics row */}
      <View style={styles.metricsRow}>
        {item.pe     && <Text style={[styles.metric, { color: colors.textMuted }]}>P/E {item.pe}x</Text>}
        {item.rev_growth && (
          <Text style={[styles.metric, { color: item.rev_growth > 15 ? "#22c55e" : colors.textMuted }]}>
            Rev +{item.rev_growth}%
          </Text>
        )}
        {item.margin && <Text style={[styles.metric, { color: colors.textMuted }]}>{t("explore.card.marginLabel")} {item.margin}%</Text>}
        {item.div_yield && <Text style={[styles.metric, { color: "#f59e0b" }]}>Div {item.div_yield}%</Text>}
        <RecomBadge recom={item.recom} colors={colors} />
      </View>

      {/* Watch button */}
      <TouchableOpacity
        style={[styles.watchBtn, { borderColor: watching ? "#22c55e" : colors.border }]}
        onPress={() => watching ? remove(item.ticker) : add(item.ticker, item.name)}
      >
        <Ionicons name={watching ? "bookmark" : "bookmark-outline"} size={13} color={watching ? "#22c55e" : colors.textMuted} />
        <Text style={[styles.watchBtnText, { color: watching ? "#22c55e" : colors.textMuted }]}>
          {watching ? t("explore.watchBtn.inWatchlist") : t("explore.watchBtn.add")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ExploreScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const subStore  = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);

  const [sector, setSector]       = useState<string | null>(null);
  const [query, setQuery]         = useState("");
  const [results, setResults]     = useState<Stock[]>([]);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [searched, setSearched]   = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  // Weekly picks
  const [weekly, setWeekly]         = useState<any>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyExpanded, setWeeklyExpanded] = useState(false);

  const loadWeekly = useCallback(async () => {
    if (!isPremium || weekly) return;
    setWeeklyLoading(true);
    try {
      const res: any = await screenerWeeklyApi.getWeekly([]);
      setWeekly(res.data);
    } catch {}
    setWeeklyLoading(false);
  }, [isPremium, weekly]);

  const markdownStyles = useMemo(() => ({
    body: { color: colors.textSub, fontSize: 13, lineHeight: 20 },
    paragraph: { marginVertical: 2 },
    strong: { color: colors.text, fontWeight: "700" as const },
    bullet_list: { marginVertical: 3 },
    list_item: { color: colors.textSub, fontSize: 13 },
  }), [colors]);

  const search = useCallback(async (overrideSector?: string | null) => {
    setLoading(true);
    setAiInsight(null);
    try {
      const s = overrideSector !== undefined ? overrideSector : sector;
      const res = await marketApi.screener(s, query);
      setResults(res.data.results);
      setAiInsight(res.data.ai_insight ?? null);
      setSearched(true);
    } catch {}
    setLoading(false);
  }, [sector, query]);

  const handleSector = (s: string) => {
    const val = s === "Todos" ? null : s;
    setSector(val);
    search(val);
  };

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={results}
        keyExtractor={(item) => item.ticker}
        renderItem={({ item }) => <StockCard item={item} colors={colors} styles={styles} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            {/* ══ SCREENER SEMANAL PREMIUM ══ */}
            <View style={{ marginHorizontal: 12, marginBottom: 12 }}>
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 14, paddingVertical: 12 }}
                onPress={() => { if (!isPremium) { setPaywallOpen(true); } else { setWeeklyExpanded(!weeklyExpanded); loadWeekly(); } }}
              >
                <Ionicons name="star-outline" size={16} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>{t("explore.weeklyPicks.title")}</Text>
                  {weekly?.week_theme && weeklyExpanded && (
                    <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>{weekly.week_theme}</Text>
                  )}
                </View>
                {!isPremium && (
                  <View style={{ backgroundColor: colors.accent + "20", borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ color: colors.accent, fontSize: 9, fontWeight: "800" }}>{t("explore.weeklyPicks.premiumBadge")}</Text>
                  </View>
                )}
                {weeklyLoading
                  ? <ActivityIndicator size="small" color={colors.accent} />
                  : <Ionicons name={weeklyExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.textMuted} />
                }
              </TouchableOpacity>

              {weeklyExpanded && weekly?.picks && (
                <View style={{ marginTop: 8, gap: 8 }}>
                  {weekly.picks.map((pick: any, i: number) => (
                    <View key={pick.ticker} style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                        <View style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: i === 0 ? "#fbbf2420" : colors.bgRaised }}>
                          <Text style={{ fontSize: 11, fontWeight: "800", color: i === 0 ? "#fbbf24" : colors.textMuted }}>{i + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text style={{ fontSize: 15, fontWeight: "800", color: colors.text }}>{pick.ticker}</Text>
                            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>${pick.price?.toFixed(2) ?? "—"}</Text>
                          </View>
                          <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6 }}>{pick.name} · {pick.sector}</Text>
                          <Text style={{ fontSize: 12, color: colors.textSub, lineHeight: 17, marginBottom: 6 }}>{pick.why}</Text>
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            <View style={{ flex: 1, borderRadius: 8, padding: 8, backgroundColor: "#22c55e0A", borderWidth: 1, borderColor: "#22c55e20" }}>
                              <Text style={{ fontSize: 9, fontWeight: "800", color: "#22c55e", marginBottom: 2 }}>{t("explore.weeklyPicks.catalyst")}</Text>
                              <Text style={{ fontSize: 10, color: colors.textSub }}>{pick.catalyst}</Text>
                            </View>
                            <View style={{ flex: 1, borderRadius: 8, padding: 8, backgroundColor: "#ef44440A", borderWidth: 1, borderColor: "#ef444420" }}>
                              <Text style={{ fontSize: 9, fontWeight: "800", color: "#ef4444", marginBottom: 2 }}>{t("explore.weeklyPicks.risk")}</Text>
                              <Text style={{ fontSize: 10, color: colors.textSub }}>{pick.risk}</Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    </View>
                  ))}
                  {weekly.mentor_note && (
                    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.accent + "40", backgroundColor: colors.accent + "0D", padding: 12 }}>
                      <Text style={{ fontSize: 10, fontWeight: "800", color: colors.accent, marginBottom: 6 }}>{t("explore.weeklyPicks.mentorNote")}</Text>
                      <Text style={{ fontSize: 12, color: colors.textSub, lineHeight: 18 }}>{weekly.mentor_note}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Search bar */}
            <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="search-outline" size={16} color={colors.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder={t("explore.search.placeholder")}
                placeholderTextColor={colors.placeholder}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => search()}
                returnKeyType="search"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => search()}>
                  <View style={[styles.searchBtn, { backgroundColor: colors.accent }]}>
                    <Text style={{ color: "white", fontSize: 12, fontWeight: "700" }}>{t("explore.search.button")}</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>

            {/* Sector chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {SECTORS.map((s) => {
                const active = (s === "Todos" && sector === null) || s === sector;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.chip, { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent + "20" : "transparent" }]}
                    onPress={() => handleSector(s)}
                  >
                    <Text style={[styles.chipText, { color: active ? colors.accentLight : colors.textMuted }]}>{s}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* AI insight */}
            {aiInsight && (
              <View style={[styles.insightCard, { backgroundColor: colors.card, borderColor: colors.accent + "40" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Ionicons name="sparkles" size={14} color={colors.accentLight} />
                  <Text style={[styles.insightTitle, { color: colors.accentLight }]}>{t("explore.aiInsight.title")}</Text>
                </View>
                <Markdown style={markdownStyles}>{aiInsight}</Markdown>
              </View>
            )}

            {loading && (
              <View style={{ alignItems: "center", padding: 32 }}>
                <ActivityIndicator color={colors.accentLight} />
                <Text style={[styles.loadingText, { color: colors.textMuted }]}>{t("explore.loading")}</Text>
              </View>
            )}

            {!loading && !searched && (
              <View style={styles.emptyState}>
                <Ionicons name="telescope-outline" size={44} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>{t("explore.empty.title")}</Text>
                <Text style={[styles.emptySub, { color: colors.textDim }]}>{t("explore.empty.subtitle")}</Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading && searched ? (
            <Text style={[styles.emptyTitle, { color: colors.textMuted, textAlign: "center", marginTop: 32 }]}>{t("explore.noResults")}</Text>
          ) : null
        }
      />
      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason={t("explore.paywallReason")}
      />
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    list: { paddingBottom: 40 },
    searchWrap: {
      flexDirection: "row", alignItems: "center", gap: 8,
      margin: 16, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10,
    },
    searchInput: { flex: 1, fontSize: 14 },
    searchBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
    chipsScroll: { marginBottom: 12 },
    chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
    chipText: { fontSize: 12, fontWeight: "600" },
    insightCard: {
      marginHorizontal: 16, marginBottom: 12,
      borderRadius: 12, borderWidth: 1, padding: 14,
    },
    insightTitle: { fontSize: 13, fontWeight: "700" },
    loadingText: { marginTop: 10, fontSize: 13 },
    emptyState: { alignItems: "center", paddingTop: 60, gap: 8 },
    emptyTitle: { fontSize: 15, fontWeight: "600" },
    emptySub: { fontSize: 13 },
    card: {
      marginHorizontal: 12, marginBottom: 7,
      borderRadius: 12, borderWidth: 1, padding: 10,
    },
    cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
    cardLeft: { gap: 1 },
    cardRight: { alignItems: "flex-end", gap: 1 },
    ticker: { fontSize: 15, fontWeight: "800" },
    name:   { fontSize: 10, color: "#888" },
    price:  { fontSize: 15, fontWeight: "700" },
    change: { fontSize: 11, fontWeight: "600" },
    scoreRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 5 },
    scoreBar: { fontSize: 10, fontFamily: "monospace", letterSpacing: -1 },
    scoreNum: { fontSize: 11, fontWeight: "700" },
    metricsRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 7 },
    metric: { fontSize: 10, fontWeight: "600" },
    watchBtn: {
      flexDirection: "row", alignItems: "center", gap: 4,
      borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4,
      alignSelf: "flex-start",
    },
    watchBtnText: { fontSize: 10, fontWeight: "600" },
  });
}
