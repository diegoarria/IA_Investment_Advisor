import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, ScrollView, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../../src/lib/ThemeContext";
import { useWatchlistStore } from "../../src/lib/watchlistStore";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import { marketApi, watchlistExtApi } from "../../src/lib/api";
import StockAvatar from "../../src/components/StockAvatar";
import PaywallModal from "../../src/components/PaywallModal";
import MobileEarningsCalendar from "../../src/components/MobileEarningsCalendar";

const FREE_LIMIT = 30;

interface ExtPrice {
  ticker: string;
  name: string;
  price: number | null;
  prev_close: number | null;
  change: number;
  change_pct: number;
  currency: string;
  market_state: string;
  pre_market_price: number | null;
  pre_market_change_pct: number | null;
  post_market_price: number | null;
  post_market_change_pct: number | null;
}

interface SearchResult {
  ticker: string;
  name: string;
}

function fmtPrice(price: number | null, currency = "USD"): string {
  if (price === null || price === undefined) return "—";
  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  return `${sym}${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(pct: number | null): string {
  if (pct === null || pct === undefined) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function MarketStateBadge({ state }: { state: string }) {
  const s = (state || "").toUpperCase();
  if (s === "REGULAR") {
    return (
      <View style={[badge.wrap, { backgroundColor: "rgba(34,197,94,0.12)" }]}>
        <View style={badge.dot} />
        <Text style={[badge.text, { color: "#22c55e" }]}>En vivo</Text>
      </View>
    );
  }
  if (s === "PRE" || s === "PREPRE") {
    return (
      <View style={[badge.wrap, { backgroundColor: "rgba(245,158,11,0.12)" }]}>
        <Text style={[badge.text, { color: "#f59e0b" }]}>Pre-Mkt</Text>
      </View>
    );
  }
  if (s === "POST" || s === "POSTPOST") {
    return (
      <View style={[badge.wrap, { backgroundColor: "rgba(99,102,241,0.12)" }]}>
        <Text style={[badge.text, { color: "#818cf8" }]}>Post-Mkt</Text>
      </View>
    );
  }
  return (
    <View style={[badge.wrap, { backgroundColor: "rgba(148,163,184,0.08)" }]}>
      <Text style={[badge.text, { color: "#64748b" }]}>Cerrado</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" },
  text: { fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },
});

// ─── Watchlist Row ────────────────────────────────────────────────────────────

interface RowProps {
  item: { ticker: string; name: string };
  index: number;
  itemCount: number;
  prices: Record<string, ExtPrice>;
  colors: ReturnType<typeof useTheme>["colors"];
  editMode: boolean;
  onRemove: (ticker: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

function WatchlistRow({ item, index, itemCount, prices, colors, editMode, onRemove, onMoveUp, onMoveDown }: RowProps) {
  const p = prices[item.ticker] as ExtPrice | undefined;
  const up = (p?.change_pct ?? 0) >= 0;
  const col = up ? "#22c55e" : "#ef4444";
  const ms = (p?.market_state ?? "").toUpperCase();
  const showPre  = (ms === "PRE"  || ms === "PREPRE")  && p?.pre_market_price;
  const showPost = (ms === "POST" || ms === "POSTPOST") && p?.post_market_price;

  return (
    <View style={[rw.row, { borderTopColor: colors.border }]}>
      {/* Color bar */}
      <View style={[rw.colorBar, { backgroundColor: col }]} />

      {editMode ? (
        // Reorder controls
        <View style={rw.reorderCol}>
          <TouchableOpacity
            onPress={() => onMoveUp(index)}
            disabled={index === 0}
            style={[rw.arrowBtn, { opacity: index === 0 ? 0.2 : 1 }]}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="chevron-up" size={18} color={colors.textSub} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onMoveDown(index)}
            disabled={index === itemCount - 1}
            style={[rw.arrowBtn, { opacity: index === itemCount - 1 ? 0.2 : 1 }]}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="chevron-down" size={18} color={colors.textSub} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Tap → stock detail */}
      <TouchableOpacity
        style={rw.inner}
        onPress={() => router.push(`/stock/${item.ticker}` as any)}
        activeOpacity={0.7}
      >
        <StockAvatar ticker={item.ticker} size={38} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={rw.tickerRow}>
            <Text style={[rw.ticker, { color: colors.text }]}>{item.ticker}</Text>
            {p && <MarketStateBadge state={p.market_state} />}
          </View>
          <Text style={[rw.name, { color: colors.textMuted }]} numberOfLines={1}>
            {p?.name ?? item.name}
          </Text>
          {showPre && (
            <Text style={[rw.extPrice, { color: "#f59e0b" }]}>
              Pre: {fmtPrice(p!.pre_market_price, p!.currency)}{" "}
              <Text style={rw.extPct}>({fmtPct(p!.pre_market_change_pct)})</Text>
            </Text>
          )}
          {showPost && (
            <Text style={[rw.extPrice, { color: "#818cf8" }]}>
              Post: {fmtPrice(p!.post_market_price, p!.currency)}{" "}
              <Text style={rw.extPct}>({fmtPct(p!.post_market_change_pct)})</Text>
            </Text>
          )}
        </View>
        <View style={rw.rightCol}>
          {p?.price != null ? (
            <Text style={[rw.price, { color: colors.text }]}>
              {fmtPrice(p.price, p.currency)}
            </Text>
          ) : (
            <Text style={[rw.price, { color: colors.textDim }]}>—</Text>
          )}
          {p?.change_pct != null && (
            <View style={[rw.changeBadge, { backgroundColor: col + "1a" }]}>
              <Ionicons name={up ? "caret-up" : "caret-down"} size={10} color={col} />
              <Text style={[rw.changePct, { color: col }]}>{Math.abs(p.change_pct).toFixed(2)}%</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Remove / reorder-mode shows nothing on right */}
      {!editMode && (
        <TouchableOpacity
          onPress={() => onRemove(item.ticker)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ paddingHorizontal: 10 }}
        >
          <Ionicons name="close-outline" size={18} color={colors.textDim} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const rw = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center",
    minHeight: 72, borderTopWidth: StyleSheet.hairlineWidth,
  },
  colorBar: { width: 3, alignSelf: "stretch" },
  reorderCol: { width: 38, alignItems: "center", justifyContent: "center", gap: 0 },
  arrowBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  inner: { flex: 1, flexDirection: "row", alignItems: "center", paddingRight: 6, paddingVertical: 10 },
  tickerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  ticker: { fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
  name: { fontSize: 11, marginBottom: 1 },
  extPrice: { fontSize: 10, fontWeight: "600", marginTop: 2 },
  extPct: { fontWeight: "400", fontSize: 10 },
  rightCol: { alignItems: "flex-end", gap: 4, marginLeft: 8 },
  price: { fontSize: 14, fontWeight: "700" },
  changeBadge: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 20 },
  changePct: { fontSize: 11, fontWeight: "700" },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function WatchlistScreen() {
  const { colors } = useTheme();
  const { items, add, remove, has, reorder } = useWatchlistStore();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const { positions } = usePortfolioStore();

  const [prices, setPrices]               = useState<Record<string, ExtPrice>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [query, setQuery]                 = useState("");
  const [suggestions, setSuggestions]     = useState<SearchResult[]>([]);
  const [searching, setSearching]         = useState(false);
  const [addingTicker, setAddingTicker]   = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen]     = useState(false);
  const [secondsLeft, setSecondsLeft]     = useState(60);
  const [editMode, setEditMode]           = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPrices = useCallback(async (silent = false) => {
    if (items.length === 0) return;
    if (!silent) setPricesLoading(true);
    try {
      const res = await watchlistExtApi.batchPrices(items.map((i) => i.ticker));
      setPrices(res.data as Record<string, ExtPrice>);
    } catch {}
    if (!silent) setPricesLoading(false);
  }, [items.length]);

  useEffect(() => { loadPrices(); }, [items.length]);

  useEffect(() => {
    setSecondsLeft(60);
    if (refreshRef.current) clearInterval(refreshRef.current);
    refreshRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { loadPrices(true); return 60; }
        return s - 1;
      });
    }, 1000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [loadPrices]);

  const handleSearch = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 1) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await marketApi.searchTickers(text.trim());
        setSuggestions((res.data.results || []).slice(0, 6));
      } catch {}
      setSearching(false);
    }, 300);
  };

  const handleAdd = async (ticker: string, name: string) => {
    if (has(ticker)) {
      Alert.alert("Ya está en tu Watchlist", `${ticker} ya está agregado.`);
      setQuery(""); setSuggestions([]);
      return;
    }
    if (!isPremium && items.length >= FREE_LIMIT) { setPaywallOpen(true); return; }
    setAddingTicker(ticker);
    add(ticker, name);
    setQuery(""); setSuggestions([]);
    setAddingTicker(null);
    setTimeout(() => loadPrices(true), 400);
  };

  const handleMoveUp = (index: number) => {
    if (index > 0) reorder(index, index - 1);
  };

  const handleMoveDown = (index: number) => {
    if (index < items.length - 1) reorder(index, index + 1);
  };

  const freePct = Math.min((items.length / FREE_LIMIT) * 100, 100);
  const freeFull = !isPremium && items.length >= FREE_LIMIT;

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Search */}
        <View style={[s.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={16} color={colors.textMuted} />
          <TextInput
            style={[s.searchInput, { color: colors.text }]}
            placeholder="Busca ticker: NVDA, AAPL, TSLA…"
            placeholderTextColor={colors.placeholder}
            value={query}
            onChangeText={handleSearch}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {searching && <ActivityIndicator size="small" color={colors.accentLight} />}
          {query.length > 0 && !searching && (
            <TouchableOpacity onPress={() => { setQuery(""); setSuggestions([]); }}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <View style={[s.suggestionsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {suggestions.map((sg) => (
              <TouchableOpacity
                key={sg.ticker}
                style={[s.suggRow, { borderTopColor: colors.border }]}
                onPress={() => handleAdd(sg.ticker, sg.name)}
                disabled={addingTicker === sg.ticker}
              >
                <StockAvatar ticker={sg.ticker} size={32} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[s.suggTicker, { color: colors.text }]}>{sg.ticker}</Text>
                  <Text style={[s.suggName, { color: colors.textMuted }]} numberOfLines={1}>{sg.name}</Text>
                </View>
                {has(sg.ticker) ? (
                  <Ionicons name="checkmark-circle" size={18} color={colors.accentLight} />
                ) : addingTicker === sg.ticker ? (
                  <ActivityIndicator size="small" color={colors.accentLight} />
                ) : (
                  <Ionicons name="add-circle-outline" size={18} color={colors.accentLight} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Free tier bar */}
        {!isPremium && (
          <View style={[s.tierBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.tierTop}>
              <Text style={[s.tierLabel, { color: colors.textMuted }]}>
                {items.length}/{FREE_LIMIT} acciones
              </Text>
              {freeFull && (
                <TouchableOpacity onPress={() => setPaywallOpen(true)}>
                  <Text style={[s.tierUpgrade, { color: colors.accentLight }]}>Actualizar a Premium →</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={[s.tierTrack, { backgroundColor: colors.border }]}>
              <View style={[s.tierFill, { width: `${freePct}%` as never, backgroundColor: freePct >= 80 ? "#f59e0b" : colors.accentLight }]} />
            </View>
          </View>
        )}

        {/* Empty state */}
        {items.length === 0 && (
          <View style={[s.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="eye-outline" size={40} color={colors.textMuted} style={{ marginBottom: 12 }} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>Tu Watchlist está vacía</Text>
            <Text style={[s.emptySub, { color: colors.textMuted }]}>
              Busca un ticker arriba y agrégalo para seguirlo en tiempo real
            </Text>
          </View>
        )}

        {/* Watchlist */}
        {items.length > 0 && (
          <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.listHeader}>
              <Ionicons name="eye-outline" size={14} color={colors.accentLight} />
              <Text style={[s.listHeaderText, { color: colors.text }]}>Watchlist</Text>

              {/* Reorder toggle */}
              {items.length > 1 && (
                <TouchableOpacity
                  onPress={() => setEditMode((v) => !v)}
                  style={[s.editBtn, { backgroundColor: editMode ? colors.accentLight + "22" : colors.bgRaised, borderColor: editMode ? colors.accentLight : colors.border }]}
                >
                  <Ionicons name={editMode ? "checkmark" : "reorder-three-outline"} size={13} color={editMode ? colors.accentLight : colors.textDim} />
                  <Text style={[s.editBtnText, { color: editMode ? colors.accentLight : colors.textDim }]}>
                    {editMode ? "Listo" : "Ordenar"}
                  </Text>
                </TouchableOpacity>
              )}

              {!editMode && (
                pricesLoading
                  ? <ActivityIndicator size="small" color={colors.accentLight} style={{ marginLeft: "auto" }} />
                  : (
                    <TouchableOpacity
                      style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4 }}
                      onPress={() => { loadPrices(); setSecondsLeft(60); }}
                    >
                      <Ionicons name="refresh-outline" size={13} color={colors.textDim} />
                      <Text style={[s.counterText, { color: colors.textDim }]}>{secondsLeft}s</Text>
                    </TouchableOpacity>
                  )
              )}
            </View>

            {items.map((item, index) => (
              <WatchlistRow
                key={item.ticker}
                item={item}
                index={index}
                itemCount={items.length}
                prices={prices}
                colors={colors}
                editMode={editMode}
                onRemove={remove}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))}
          </View>
        )}

        {/* Earnings Calendar */}
        <MobileEarningsCalendar
          watchlistTickers={items.map((i) => i.ticker)}
          portfolioTickers={positions.map((p) => p.ticker)}
          isPremium={isPremium}
          onUpgrade={() => setPaywallOpen(true)}
        />
      </ScrollView>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 14, fontWeight: "500" },
  suggestionsCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  suggRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  suggTicker: { fontSize: 13, fontWeight: "700", letterSpacing: -0.2 },
  suggName: { fontSize: 11, marginTop: 1 },
  tierBar: { padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  tierTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tierLabel: { fontSize: 12, fontWeight: "600" },
  tierUpgrade: { fontSize: 12, fontWeight: "700" },
  tierTrack: { height: 4, borderRadius: 2 },
  tierFill: { height: 4, borderRadius: 2 },
  emptyCard: {
    alignItems: "center", padding: 40,
    borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed",
  },
  emptyTitle: { fontSize: 15, fontWeight: "800", marginBottom: 8 },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  listCard: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  listHeader: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  listHeaderText: { fontSize: 13, fontWeight: "700" },
  editBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  editBtnText: { fontSize: 11, fontWeight: "700" },
  counterText: { fontSize: 11 },
});
