// Fase 9C §5: Comparador de ETFs — mismo contrato que
// frontend/web/src/app/etf/compare/page.tsx (GET /api/etf/compare).
// Nunca afirma que un ETF es "mejor" — solo re-presenta diferencias
// concretas que el backend ya validó (comparison.py). Rendimiento
// histórico nunca se compara directamente entre ETFs: sección
// colapsada por defecto, un periodo por fondo.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, SafeAreaView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme, type Colors } from "../../src/lib/ThemeContext";
import { etfApi } from "../../src/lib/api";
import { createRequestGuard } from "../../src/lib/requestGuard";
import { addToCompareSelection, removeFromCompareSelection, canCompare, MAX_COMPARE } from "../../src/lib/etfCompareSelection";
import { formatWeightPct, costTierColor } from "../../src/lib/etfFormat";
import StockAvatar from "../../src/components/StockAvatar";

const GOLD = "#00e887";
const DEBOUNCE_MS = 350;
const TICKER_COLORS = [GOLD, "#60a5fa", "#f0b429"];

type Insight = { category: string; text: string; supporting_data: Record<string, unknown> };
type EtfSummary = {
  ticker: string;
  identification: { name?: string | null; etf_company?: string | null };
  costs: { expense_ratio_pct: number | null; cost_tier: string | null };
  exposure: { holdings_count: number | null };
  diversification: { by_sector: { top1_name: string | null }; by_country: { top1_name: string | null } };
  performance: {
    ytd_pct: number | null; one_year_pct: number | null; five_year_pct: number | null;
    max_pct: number | null; max_start_date: string | null; max_is_full_history: boolean;
  };
  data_quality?: { structural_fetched_at?: number | null; price_fetched_at?: number | null };
};
type WeightRow = { name: string } & Record<string, number | null | string>;
type CompareResponse = {
  tickers: string[];
  etfs: EtfSummary[];
  unavailable: { ticker: string; reason: string }[];
  comparison_ready: boolean;
  exposure_comparison: { sectors: WeightRow[]; countries: WeightRow[] };
  comparison_summary: string | null;
  comparison_insights: Insight[];
  performance_note: string;
};

export default function EtfCompareScreen() {
  const params = useLocalSearchParams<{ tickers?: string }>();
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const st = useMemo(() => styles(colors), [colors]);
  const na = t("etf.detail.notAvailable");

  const [selected, setSelected] = useState<string[]>(() =>
    params.tickers ? params.tickers.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, MAX_COMPARE) : []
  );
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ symbol: string; name?: string }[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [result, setResult] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  const guardRef = useRef(createRequestGuard());

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) { setSearchResults(null); return; }
    debounceRef.current = setTimeout(() => {
      etfApi.search(q, 10).then((res) => setSearchResults(res.data?.results ?? [])).catch(() => setSearchResults([]));
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const runCompare = () => {
    if (!canCompare(selected)) return;
    const reqId = guardRef.current.next();
    setLoading(true);
    setError(false);
    etfApi.compare(selected, i18n.language === "en" ? "en" : "es")
      .then((res) => { if (guardRef.current.isCurrent(reqId)) setResult(res.data); })
      .catch(() => { if (guardRef.current.isCurrent(reqId)) { setResult(null); setError(true); } })
      .finally(() => { if (guardRef.current.isCurrent(reqId)) setLoading(false); });
  };

  // Precarga desde la ficha (?tickers=A,B) — se corre una sola vez al
  // montar, nunca automáticamente ante cada cambio de selección.
  useEffect(() => {
    if (selected.length >= 2) runCompare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTicker = (tk: string) => {
    const r = addToCompareSelection(selected, tk, MAX_COMPARE);
    setSelected(r.selected);
    setSelectionError(r.error);
    setQuery("");
    setSearchResults(null);
    if (r.error) setTimeout(() => setSelectionError(null), 2500);
  };
  const removeTicker = (tk: string) => {
    setSelected((prev) => removeFromCompareSelection(prev, tk));
    setResult(null);
  };

  const colorFor = (ticker: string) => TICKER_COLORS[selected.indexOf(ticker)] ?? colors.textMuted;

  return (
    <SafeAreaView style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>{t("etf.compare.title")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <Text style={st.subtitle}>{t("etf.compare.subtitle")}</Text>

        <Text style={st.subhead}>{t("etf.compare.selectorLabel")} ({t("etf.compare.selectedCount", { count: selected.length })})</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {selected.map((tk) => (
            <View key={tk} style={[st.chip, { borderColor: colorFor(tk) }]}>
              <Text style={{ fontSize: 12, fontWeight: "800", color: colorFor(tk) }}>{tk}</Text>
              <TouchableOpacity onPress={() => removeTicker(tk)} accessibilityLabel={t("etf.compare.remove", { ticker: tk })}>
                <Ionicons name="close-circle" size={15} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
        {!!selectionError && (
          <Text style={{ fontSize: 11, color: "#E0A030", marginTop: 4 }}>
            {selectionError === "max_reached" ? t("etf.compare.maxReached") : t("etf.compare.alreadyAdded", { ticker: query.trim().toUpperCase() })}
          </Text>
        )}

        {selected.length < MAX_COMPARE && (
          <View style={[st.searchRow, { borderColor: colors.border, backgroundColor: colors.bgRaised ?? colors.card }]}>
            <Ionicons name="search" size={15} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("etf.compare.selectorPlaceholder")}
              placeholderTextColor={colors.textMuted}
              style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 8 }}
              autoCapitalize="none"
            />
          </View>
        )}
        {!!searchResults?.length && (
          <View style={{ gap: 4, marginTop: 6 }}>
            {searchResults.slice(0, 6).map((r) => (
              <TouchableOpacity key={r.symbol} onPress={() => addTicker(r.symbol)} style={[st.resultRow, { borderColor: colors.border }]} activeOpacity={0.8}>
                <StockAvatar ticker={r.symbol} size={22} />
                <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.text }}>{r.symbol}</Text>
                {!!r.name && <Text style={{ fontSize: 11, color: colors.textMuted, flex: 1 }} numberOfLines={1}>{r.name}</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {selected.length < 2 && <Text style={st.mutedText}>{t("etf.compare.minRequired")}</Text>}

        <TouchableOpacity
          onPress={runCompare}
          disabled={!canCompare(selected) || loading}
          style={[st.compareBtn, { backgroundColor: canCompare(selected) ? GOLD : colors.border }]}
          activeOpacity={0.85}
        >
          {loading ? <ActivityIndicator size="small" color="#04211a" /> : (
            <Text style={{ fontSize: 13, fontWeight: "800", color: canCompare(selected) ? "#04211a" : colors.textMuted }}>
              {t("etf.compare.compareButton")}
            </Text>
          )}
        </TouchableOpacity>

        {error && <Text style={st.errorText}>{t("etf.compare.error")}</Text>}

        {!loading && result && !result.comparison_ready && (
          <View style={[st.card, { marginTop: 14 }]}>
            <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>{t("etf.compare.notReadyTitle")}</Text>
            <Text style={st.mutedText}>{t("etf.compare.notReadyBody")}</Text>
          </View>
        )}

        {!loading && result && result.unavailable.length > 0 && (
          <View style={{ marginTop: 10, gap: 4 }}>
            {result.unavailable.map((u) => (
              <Text key={u.ticker} style={st.errorText}>
                {u.reason === "not_etf" ? t("etf.compare.unavailableReason.not_etf", { ticker: u.ticker }) : t("etf.compare.unavailableReason.unavailable", { ticker: u.ticker })}
              </Text>
            ))}
          </View>
        )}

        {!loading && result && result.comparison_ready && (
          <View style={{ gap: 16, marginTop: 14 }}>
            {!!result.comparison_summary && (
              <Text style={{ fontSize: 13, color: colors.text, fontWeight: "700", lineHeight: 19 }}>{result.comparison_summary}</Text>
            )}

            {/* Resumen por ETF */}
            <View style={{ gap: 8 }}>
              {result.etfs.map((etf) => (
                <View key={etf.ticker} style={[st.card, { borderColor: colorFor(etf.ticker) }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <StockAvatar ticker={etf.ticker} size={28} />
                    <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>{etf.ticker}</Text>
                    {!!etf.identification.name && <Text style={{ fontSize: 11, color: colors.textMuted, flex: 1 }} numberOfLines={1}>{etf.identification.name}</Text>}
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                    <Text style={st.metaText}>{t("etf.detail.metrics.expenseRatio")}: {formatWeightPct(etf.costs.expense_ratio_pct, na)}</Text>
                    <Text style={st.metaText}>{t("etf.detail.metrics.holdingsCount")}: {etf.exposure.holdings_count ?? na}</Text>
                    <Text style={st.metaText}>{t("etf.detail.metrics.dominantSector")}: {etf.diversification.by_sector.top1_name ?? na}</Text>
                  </View>
                  <TouchableOpacity onPress={() => router.push(`/etf/${encodeURIComponent(etf.ticker)}` as any)}>
                    <Text style={{ fontSize: 11, color: GOLD, fontWeight: "700", marginTop: 6 }}>{t("etf.compare.viewFicha")}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            {/* Entender la comparación */}
            <Section title={t("etf.compare.understand.title")} colors={colors}>
              {result.comparison_insights.length === 0
                ? <Text style={st.mutedText}>{t("etf.compare.understand.empty")}</Text>
                : result.comparison_insights.map((ins, i) => (
                  <View key={i} style={st.card}><Text style={{ fontSize: 12.5, color: colors.text, lineHeight: 18 }}>{ins.text}</Text></View>
                ))}
              <Text style={st.disclaimerText}>{t("etf.compare.understand.disclaimer")}</Text>
            </Section>

            {/* Sectores */}
            <Section title={t("etf.compare.sectors.title")} colors={colors}>
              {result.exposure_comparison.sectors.length === 0
                ? <Text style={st.mutedText}>{t("etf.compare.sectors.empty")}</Text>
                : result.exposure_comparison.sectors.slice(0, 8).map((row, i) => (
                  <CompareRow key={i} row={row} tickers={selected} colorFor={colorFor} na={na} colors={colors} />
                ))}
            </Section>

            {/* Geografía */}
            <Section title={t("etf.compare.countries.title")} colors={colors}>
              {result.exposure_comparison.countries.length === 0
                ? <Text style={st.mutedText}>{t("etf.compare.countries.empty")}</Text>
                : result.exposure_comparison.countries.slice(0, 6).map((row, i) => (
                  <CompareRow key={i} row={row} tickers={selected} colorFor={colorFor} na={na} colors={colors} />
                ))}
            </Section>

            {/* Rendimiento histórico — colapsado por defecto, nunca comparado directamente */}
            <View>
              <TouchableOpacity onPress={() => setPerfOpen((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name={perfOpen ? "chevron-down" : "chevron-forward"} size={14} color={colors.textMuted} />
                <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }}>{t("etf.compare.performance.title")}</Text>
              </TouchableOpacity>
              {perfOpen && (
                <View style={{ gap: 6, marginTop: 8 }}>
                  <Text style={st.disclaimerText}>{result.performance_note}</Text>
                  {result.etfs.map((etf) => (
                    <Text key={etf.ticker} style={st.mutedText}>
                      {etf.ticker}: {formatWeightPct(etf.performance.max_pct, na)} ({etf.performance.max_is_full_history
                        ? t("etf.detail.performance.maxFullHistory")
                        : t("etf.detail.performance.maxCapped", { years: 10 })})
                    </Text>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CompareRow({ row, tickers, colorFor, na, colors }: { row: WeightRow; tickers: string[]; colorFor: (t: string) => string; na: string; colors: Colors }) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }} numberOfLines={1}>{row.name}</Text>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 2 }}>
        {tickers.map((tk) => (
          <Text key={tk} style={{ fontSize: 11, color: colorFor(tk), fontWeight: "700" }}>
            {tk}: {formatWeightPct(typeof row[tk] === "number" ? (row[tk] as number) : null, na)}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Section({ title, colors, children }: { title: string; colors: Colors; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }}>{title}</Text>
      {children}
    </View>
  );
}

const styles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 15, fontWeight: "800", color: c.text },
  content: { padding: 14, paddingBottom: 40 },
  subtitle: { fontSize: 12.5, color: c.textSub, marginBottom: 10 },
  subhead: { fontSize: 11.5, fontWeight: "800", color: c.textSub, textTransform: "uppercase" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, marginTop: 10 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 8 },
  compareBtn: { borderRadius: 12, paddingVertical: 11, alignItems: "center", marginTop: 12 },
  errorText: { fontSize: 12, color: "#E0A030", marginTop: 8 },
  mutedText: { fontSize: 12, color: c.textSub, marginTop: 4 },
  metaText: { fontSize: 10.5, color: c.textMuted },
  disclaimerText: { fontSize: 10.5, color: c.textMuted, fontStyle: "italic" },
  card: { borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, padding: 12 },
});
