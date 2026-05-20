import React, { useState, useCallback, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, SafeAreaView, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { marketApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useWatchlistStore } from "../../src/lib/watchlistStore";

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
  const map: Record<string, { label: string; color: string }> = {
    strong_buy: { label: "Compra fuerte", color: "#16a34a" },
    buy:        { label: "Compra",        color: "#22c55e" },
    hold:       { label: "Mantener",      color: "#f59e0b" },
    sell:       { label: "Vender",        color: "#ef4444" },
    strong_sell:{ label: "Venta fuerte",  color: "#dc2626" },
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
        {item.margin && <Text style={[styles.metric, { color: colors.textMuted }]}>Mg {item.margin}%</Text>}
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
          {watching ? "En watchlist" : "Agregar watchlist"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ExploreScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [sector, setSector]       = useState<string | null>(null);
  const [query, setQuery]         = useState("");
  const [results, setResults]     = useState<Stock[]>([]);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [searched, setSearched]   = useState(false);

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
            {/* Search bar */}
            <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="search-outline" size={16} color={colors.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="ej. tech con P/E bajo y dividendo…"
                placeholderTextColor={colors.placeholder}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => search()}
                returnKeyType="search"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => search()}>
                  <View style={[styles.searchBtn, { backgroundColor: colors.accent }]}>
                    <Text style={{ color: "white", fontSize: 12, fontWeight: "700" }}>Buscar</Text>
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
                  <Text style={[styles.insightTitle, { color: colors.accentLight }]}>Análisis AI</Text>
                </View>
                <Markdown style={markdownStyles}>{aiInsight}</Markdown>
              </View>
            )}

            {loading && (
              <View style={{ alignItems: "center", padding: 32 }}>
                <ActivityIndicator color={colors.accentLight} />
                <Text style={[styles.loadingText, { color: colors.textMuted }]}>Analizando mercado…</Text>
              </View>
            )}

            {!loading && !searched && (
              <View style={styles.emptyState}>
                <Ionicons name="telescope-outline" size={44} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Explora el mercado</Text>
                <Text style={[styles.emptySub, { color: colors.textDim }]}>Filtra por sector o escribe lo que buscas</Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading && searched ? (
            <Text style={[styles.emptyTitle, { color: colors.textMuted, textAlign: "center", marginTop: 32 }]}>Sin resultados</Text>
          ) : null
        }
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
      marginHorizontal: 16, marginBottom: 10,
      borderRadius: 14, borderWidth: 1, padding: 14,
    },
    cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
    cardLeft: { gap: 2 },
    cardRight: { alignItems: "flex-end", gap: 2 },
    ticker: { fontSize: 16, fontWeight: "800" },
    name:   { fontSize: 11, color: "#888" },
    price:  { fontSize: 16, fontWeight: "700" },
    change: { fontSize: 12, fontWeight: "600" },
    scoreRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
    scoreBar: { fontSize: 11, fontFamily: "monospace", letterSpacing: -1 },
    scoreNum: { fontSize: 12, fontWeight: "700" },
    metricsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
    metric: { fontSize: 11, fontWeight: "600" },
    watchBtn: {
      flexDirection: "row", alignItems: "center", gap: 5,
      borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
      alignSelf: "flex-start",
    },
    watchBtnText: { fontSize: 11, fontWeight: "600" },
  });
}
