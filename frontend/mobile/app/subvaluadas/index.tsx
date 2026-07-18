import React, { useState, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../../src/lib/ThemeContext";
import { screenerWeeklyApi } from "../../src/lib/api";

interface UndervaluedResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  intrinsic_value_base: number | null;
  margin_of_safety_pct: number | null;
  thesis_scores: Record<string, number> | null;
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
}

export default function SubvaluadasScreen() {
  const { colors } = useTheme();
  const [results, setResults] = useState<UndervaluedResult[]>([]);
  const [generatedAt, setGeneratedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sectorFilter, setSectorFilter] = useState("Todos");

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [quickResult, setQuickResult] = useState<QuickAnalysisResult | null>(null);

  useEffect(() => {
    screenerWeeklyApi.getUndervalued(undefined, 60)
      .then((res: any) => {
        setResults(res.data?.results || []);
        setGeneratedAt(res.data?.generated_at || 0);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    setQuickResult(null);
    try {
      const res = await screenerWeeklyApi.quickAnalysis(query.trim());
      setQuickResult(res.data);
    } catch (err: any) {
      setSearchError(err?.response?.data?.detail || "No se pudo calcular el valor intrínseco para esa búsqueda.");
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Acciones Subvaluadas (DCF)</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.warningBox, { borderColor: "#ef4444", backgroundColor: "rgba(239,68,68,0.08)" }]}>
          <Text style={styles.warningTitle}>ESTO NO ES RECOMENDACIÓN DE INVERSIÓN</Text>
          <Text style={[styles.warningSubtitle, { color: colors.textSub }]}>Para un análisis más detallado, ve a Mentor IA.</Text>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.text }]}>Buscar cualquier acción</Text>
        <View style={styles.searchRow}>
          <View style={[styles.searchInputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleSearch}
              placeholder="Ticker o nombre (ej. AAPL, Nike)"
              placeholderTextColor={colors.placeholder}
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>
          <TouchableOpacity onPress={handleSearch} disabled={searching || !query.trim()}
                            style={[styles.searchBtn, { backgroundColor: colors.accent, opacity: (searching || !query.trim()) ? 0.5 : 1 }]}>
            {searching ? <ActivityIndicator color="#000" size="small" /> : <Text style={styles.searchBtnText}>Buscar</Text>}
          </TouchableOpacity>
        </View>

        {searchError && <Text style={{ fontSize: 12, color: "#ef4444", marginBottom: 12 }}>{searchError}</Text>}

        {quickResult && (
          <View style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <Text style={[styles.ticker, { color: colors.text }]}>
                {quickResult.ticker} {quickResult.company_name ? `· ${quickResult.company_name}` : ""}
              </Text>
              <Text style={{ fontSize: 13, fontWeight: "900", color: (quickResult.margin_of_safety_pct ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                {(quickResult.margin_of_safety_pct ?? 0) >= 0 ? "+" : ""}{quickResult.margin_of_safety_pct}%
              </Text>
            </View>
            <Text style={[styles.meta, { color: colors.textDim, marginBottom: 8 }]}>
              Precio ${quickResult.price} · Valor intrínseco ${quickResult.intrinsic_value_base} · Valor esperado ${quickResult.expected_value_per_share}
              {quickResult.implied_growth_pct !== null && ` · Crecimiento implícito ${quickResult.implied_growth_pct}%`}
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textSub }}>{quickResult.summary}</Text>
          </View>
        )}

        <Text style={[styles.subtitle, { color: colors.textMuted, marginTop: 16 }]}>
          Todas las candidatas con margen de seguridad positivo real, mismo motor de DCF que Mentor IA.
          {generatedAt > 0 && ` Actualizado: ${new Date(generatedAt * 1000).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}.`}
        </Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accentLight} />
          </View>
        ) : results.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>
              Todavía no hay datos del screener semanal — vuelve más tarde.
            </Text>
          </View>
        ) : (
          <>
            {sectors.length > 2 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {sectors.map((s) => (
                    <TouchableOpacity key={s} onPress={() => setSectorFilter(s)}
                                       style={[styles.chip, {
                                         borderColor: sectorFilter === s ? colors.accent : colors.border,
                                         backgroundColor: sectorFilter === s ? colors.accent + "20" : colors.card,
                                       }]}>
                      <Text style={{ fontSize: 11, color: sectorFilter === s ? colors.accentLight : colors.textSub, fontWeight: "700" }}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
            <View style={[styles.listCard, { borderColor: colors.border }]}>
              {filtered.map((u, i) => (
                <View key={u.ticker} style={[styles.row, { borderTopColor: colors.border, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, backgroundColor: colors.card }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.ticker, { color: colors.text }]} numberOfLines={1}>
                      {u.ticker} {u.company_name ? `· ${u.company_name}` : ""}
                    </Text>
                    <Text style={[styles.meta, { color: colors.textDim }]} numberOfLines={1}>
                      Precio ${u.price} · Valor intrínseco ${u.intrinsic_value_base} · {u.sector || "N/D"}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 13, fontWeight: "900", color: "#22c55e" }}>+{u.margin_of_safety_pct}%</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 15, fontWeight: "800" },
  scroll: { padding: 16, paddingBottom: 40 },
  warningBox: { borderWidth: 2, borderRadius: 16, padding: 14, marginBottom: 16, alignItems: "center" },
  warningTitle: { fontSize: 16, fontWeight: "900", color: "#ef4444", textAlign: "center" },
  warningSubtitle: { fontSize: 11, marginTop: 4, textAlign: "center" },
  sectionLabel: { fontSize: 13, fontWeight: "800", marginBottom: 8 },
  searchRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  searchInputWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 13 },
  searchBtn: { paddingHorizontal: 16, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  searchBtnText: { fontSize: 13, fontWeight: "900", color: "#000" },
  quickCard: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 16 },
  subtitle: { fontSize: 12, marginBottom: 16, lineHeight: 17 },
  center: { paddingVertical: 40, alignItems: "center" },
  emptyCard: { borderWidth: 1, borderRadius: 16, padding: 24 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  listCard: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14 },
  ticker: { fontSize: 13, fontWeight: "700" },
  meta: { fontSize: 10, marginTop: 2 },
});
