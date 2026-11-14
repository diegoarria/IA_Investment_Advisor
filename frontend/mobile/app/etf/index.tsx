// Fase 9C §3/§4: Explorador de ETFs — búsqueda, categorías curadas
// (del backend, nunca inferidas en el cliente) y descubrimiento
// educativo. Mismo contrato que frontend/web/src/app/etf/page.tsx.
// Acceso: Herramientas → "Explorar ETFs" (ver portfolio.tsx), igual que
// Subvaluadas/Earnings — sin saturar la barra principal de Expo Router.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, SafeAreaView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme, type Colors } from "../../src/lib/ThemeContext";
import { etfApi } from "../../src/lib/api";
import { createRequestGuard } from "../../src/lib/requestGuard";
import { ticketsToFetch, hasMoreToLoad, visibleSlice } from "../../src/lib/etfCardBatching";
import EtfCard, { EtfCardSkeleton, type EtfCardData } from "../../src/components/EtfCard";

const DEBOUNCE_MS = 350;
const PAGE_SIZE = 6;
const DISCOVERY_TICKERS = ["VOO", "QQQ", "VXUS"];
const GOLD = "#00e887";

const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  mercado_amplio: "globe-outline",
  tecnologia: "hardware-chip-outline",
  salud: "medkit-outline",
  mercados_internacionales: "earth-outline",
  financiero_y_energia: "cash-outline",
  consumo_e_industria: "cart-outline",
};

type Category = { key: string; label: string; etfs: { ticker: string; label?: string }[] };

export default function EtfExplorerScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const st = useMemo(() => styles(colors), [colors]);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ symbol: string; name?: string }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  // Lista de tickers "activa" en este momento (búsqueda, categoría, o
  // descubrimiento) — las tarjetas se cargan en lotes de PAGE_SIZE,
  // nunca todas de una vez (Fase 9C §7: "no realizar solicitudes
  // excesivas"). Cambiar de lista reinicia el lote visible a 0.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [cardsByTicker, setCardsByTicker] = useState<Record<string, EtfCardData>>({});
  const [cardsLoading, setCardsLoading] = useState(false);
  const cardsGuardRef = useRef(createRequestGuard());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCategoriesLoading(true);
    setCategoriesError(false);
    etfApi.getCategories()
      .then((res) => setCategories(res.data?.categories ?? []))
      .catch(() => setCategoriesError(true))
      .finally(() => setCategoriesLoading(false));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) { setSearchResults(null); setSearchError(false); return; }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      setSearchError(false);
      etfApi.search(q, 20)
        .then((res) => setSearchResults(res.data?.results ?? []))
        .catch(() => { setSearchResults([]); setSearchError(true); })
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // La lista "activa" de tickers por mostrar, según la vista actual.
  const activeTickers: string[] | null = query.trim()
    ? (searchResults ? searchResults.map((r) => r.symbol) : null)
    : selectedCategory
      ? selectedCategory.etfs.map((e) => e.ticker)
      : DISCOVERY_TICKERS;

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [query, selectedCategory]);

  useEffect(() => {
    if (!activeTickers || activeTickers.length === 0) return;
    const toFetch = ticketsToFetch(activeTickers, visibleCount, cardsByTicker);
    if (toFetch.length === 0) return;
    const reqId = cardsGuardRef.current.next();
    setCardsLoading(true);
    etfApi.getCards(toFetch, i18n.language === "en" ? "en" : "es")
      .then((res) => {
        if (!cardsGuardRef.current.isCurrent(reqId)) return;
        const cards: EtfCardData[] = res.data?.cards ?? [];
        setCardsByTicker((prev) => {
          const next = { ...prev };
          for (const c of cards) next[c.ticker] = c;
          return next;
        });
      })
      .catch(() => {
        if (!cardsGuardRef.current.isCurrent(reqId)) return;
        setCardsByTicker((prev) => {
          const next = { ...prev };
          for (const tk of toFetch) next[tk] = { ticker: tk, available: false };
          return next;
        });
      })
      .finally(() => { if (cardsGuardRef.current.isCurrent(reqId)) setCardsLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTickers?.join(","), visibleCount]);

  const openTicker = (ticker: string) => router.push(`/etf/${encodeURIComponent(ticker)}` as any);
  const openCompare = () => router.push("/etf/compare" as any);

  const visibleTickers = visibleSlice(activeTickers, visibleCount);
  const canLoadMore = hasMoreToLoad(activeTickers, visibleCount);

  return (
    <SafeAreaView style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>{t("etf.explorer.title")}</Text>
        <TouchableOpacity onPress={openCompare} style={st.compareBtn}>
          <Ionicons name="git-compare-outline" size={14} color="#04211a" />
          <Text style={st.compareBtnText}>{t("etf.explorer.compareCta")}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <Text style={st.subtitle}>{t("etf.explorer.subtitle")}</Text>

        <View style={[st.searchRow, { borderColor: colors.border, backgroundColor: colors.bgRaised ?? colors.card }]}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("etf.explorer.searchPlaceholder")}
            placeholderTextColor={colors.textMuted}
            style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 9 }}
            autoCapitalize="none"
          />
          {searching && <ActivityIndicator size="small" color={GOLD} />}
        </View>

        {query.trim() ? (
          <View style={{ gap: 8, marginTop: 10 }}>
            {searchError && <Text style={st.errorText}>{t("etf.explorer.searchError")}</Text>}
            {!searching && searchResults?.length === 0 && (
              <Text style={st.mutedText}>{t("etf.explorer.searchEmpty", { query: query.trim() })}</Text>
            )}
            {visibleTickers.map((tk) => (
              cardsByTicker[tk]
                ? <EtfCard key={tk} card={cardsByTicker[tk]} onPress={() => openTicker(tk)} />
                : <EtfCardSkeleton key={tk} />
            ))}
          </View>
        ) : (
          <View style={{ gap: 14, marginTop: 14 }}>
            {!selectedCategory && (
              <View style={{ gap: 8 }}>
                <Text style={st.sectionTitle}>{t("etf.explorer.categoriesTitle")}</Text>
                <Text style={st.noteText}>{t("etf.explorer.categoriesEducationalNote")}</Text>
                {categoriesLoading && <ActivityIndicator color={GOLD} />}
                {categoriesError && <Text style={st.errorText}>{t("etf.explorer.categoriesError")}</Text>}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {categories?.map((cat) => (
                    <TouchableOpacity
                      key={cat.key}
                      onPress={() => setSelectedCategory(cat)}
                      activeOpacity={0.85}
                      style={[st.categoryTile, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <Ionicons name={CATEGORY_ICON[cat.key] ?? "pie-chart-outline"} size={18} color={GOLD} />
                      <Text style={st.categoryLabel} numberOfLines={2}>{cat.label ?? t(`etf.explorer.categories.${cat.key}`)}</Text>
                      <Text style={st.categoryCount}>{t("etf.explorer.resultsTitle")}: {cat.etfs.length}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {selectedCategory && (
              <View style={{ gap: 8 }}>
                <TouchableOpacity onPress={() => setSelectedCategory(null)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name="chevron-back" size={14} color={colors.textMuted} />
                  <Text style={st.mutedText}>{t("etf.explorer.backToCategories")}</Text>
                </TouchableOpacity>
                <Text style={st.sectionTitle}>{selectedCategory.label ?? t(`etf.explorer.categories.${selectedCategory.key}`)}</Text>
                <Text style={st.noteText}>{t("etf.explorer.categoryCuratedNote")}</Text>
                <View style={{ gap: 8 }}>
                  {visibleTickers.map((tk) => (
                    cardsByTicker[tk]
                      ? <EtfCard key={tk} card={cardsByTicker[tk]} onPress={() => openTicker(tk)} />
                      : <EtfCardSkeleton key={tk} />
                  ))}
                </View>
              </View>
            )}

            {!selectedCategory && (
              <View style={{ gap: 8 }}>
                <Text style={st.sectionTitle}>{t("etf.explorer.discoveryTitle")}</Text>
                <Text style={st.noteText}>{t("etf.explorer.discoveryNote")}</Text>
                <View style={{ gap: 8 }}>
                  {DISCOVERY_TICKERS.map((tk) => (
                    cardsByTicker[tk]
                      ? <EtfCard key={tk} card={cardsByTicker[tk]} onPress={() => openTicker(tk)} />
                      : <EtfCardSkeleton key={tk} />
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {canLoadMore && (
          <TouchableOpacity
            onPress={() => setVisibleCount((n) => n + PAGE_SIZE)}
            disabled={cardsLoading}
            style={[st.loadMoreBtn, { borderColor: colors.border }]}
            activeOpacity={0.8}
          >
            {cardsLoading
              ? <ActivityIndicator size="small" color={GOLD} />
              : <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: "700" }}>{t("etf.explorer.loadMore")}</Text>}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 15, fontWeight: "800", color: c.text },
  compareBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  compareBtnText: { fontSize: 11.5, fontWeight: "800", color: "#04211a" },
  content: { padding: 14, paddingBottom: 40 },
  subtitle: { fontSize: 12.5, color: c.textSub, marginBottom: 10 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: c.text },
  noteText: { fontSize: 11, color: c.textMuted },
  mutedText: { fontSize: 12, color: c.textMuted },
  errorText: { fontSize: 12, color: "#E0A030" },
  categoryTile: { width: "47%", borderRadius: 14, borderWidth: 1, padding: 12, gap: 4 },
  categoryLabel: { fontSize: 12.5, fontWeight: "700", color: c.text },
  categoryCount: { fontSize: 10.5, color: c.textMuted },
  loadMoreBtn: { marginTop: 14, borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignItems: "center" },
});
