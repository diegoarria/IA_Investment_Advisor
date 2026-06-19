import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, ScrollView, Alert, Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../../src/lib/ThemeContext";
import { useWatchlistStore } from "../../src/lib/watchlistStore";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import { marketApi, watchlistExtApi, feedApi, priceAlertsApi } from "../../src/lib/api";
import { Image } from "react-native";
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
  onAlert: (ticker: string, currentPrice: number | null) => void;
  hasAlert?: boolean;
}

function WatchlistRow({ item, index, itemCount, prices, colors, editMode, onRemove, onMoveUp, onMoveDown, onAlert, hasAlert }: RowProps) {
  const p = prices[item.ticker] as ExtPrice | undefined;
  const dayUp  = (p?.change_pct ?? 0) >= 0;
  const dayCol = dayUp ? "#22c55e" : "#ef4444";
  const ms = (p?.market_state ?? "").toUpperCase();
  const showPre  = (ms === "PRE"  || ms === "PREPRE")  && !!p?.pre_market_price;
  const showPost = (ms === "POST" || ms === "POSTPOST") && !!p?.post_market_price;

  // Primary display: ext price when pre/post, regular price otherwise
  const primaryPrice = showPre
    ? p!.pre_market_price
    : showPost
      ? p!.post_market_price
      : p?.price ?? null;
  const primaryPct = showPre
    ? p!.pre_market_change_pct
    : showPost
      ? p!.post_market_change_pct
      : p?.change_pct ?? null;
  const primaryColor = showPre ? "#f59e0b" : showPost ? "#818cf8" : colors.text;
  const primaryPctColor = showPre ? "#f59e0b" : showPost ? "#818cf8" : dayCol;

  return (
    <View style={[rw.row, { borderTopColor: colors.border }]}>
      {/* Color bar */}
      <View style={[rw.colorBar, { backgroundColor: dayCol }]} />

      {editMode ? (
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

        {/* Left: ticker, name, state badge */}
        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={rw.tickerRow}>
            <Text style={[rw.ticker, { color: colors.text }]}>{item.ticker}</Text>
            {p && <MarketStateBadge state={p.market_state} />}
          </View>
          <Text style={[rw.name, { color: colors.textMuted }]} numberOfLines={1}>
            {p?.name ?? item.name}
          </Text>
          {/* Day change shown below name when pre/post active (mirrors web) */}
          {(showPre || showPost) && p?.change_pct != null && (
            <View style={rw.dayChangeRow}>
              <Ionicons name={dayUp ? "trending-up" : "trending-down"} size={10} color={dayCol} />
              <Text style={[rw.dayChangeText, { color: dayCol }]}>
                {fmtPct(p.change_pct)} vs cierre anterior
              </Text>
            </View>
          )}
        </View>

        {/* Right: primary price + pct, then close price when pre/post */}
        <View style={rw.rightCol}>
          <Text style={[rw.price, { color: primaryColor }]}>
            {primaryPrice != null ? fmtPrice(primaryPrice, p?.currency) : "—"}
          </Text>
          {primaryPct != null && (
            <View style={rw.pctRow}>
              <Ionicons
                name={(primaryPct ?? 0) >= 0 ? "trending-up" : "trending-down"}
                size={11}
                color={primaryPctColor}
              />
              <Text style={[rw.changePct, { color: primaryPctColor }]}>
                {fmtPct(primaryPct)}
              </Text>
            </View>
          )}
          {(showPre || showPost) && p?.price != null && (
            <Text style={[rw.closeLabel, { color: colors.textMuted }]}>
              {showPre ? "Reg." : "Cierre"} {fmtPrice(p.price, p.currency)}
            </Text>
          )}
        </View>
      </TouchableOpacity>

      {!editMode && (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <TouchableOpacity
            onPress={() => onAlert(item.ticker, prices[item.ticker]?.price ?? null)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ paddingHorizontal: 8 }}
          >
            <Ionicons
              name={hasAlert ? "notifications" : "notifications-outline"}
              size={17}
              color={hasAlert ? colors.accentLight : colors.textDim}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onRemove(item.ticker)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ paddingHorizontal: 8 }}
          >
            <Ionicons name="close-outline" size={18} color={colors.textDim} />
          </TouchableOpacity>
        </View>
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
  dayChangeRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  dayChangeText: { fontSize: 10, fontWeight: "600" },
  rightCol: { alignItems: "flex-end", gap: 2, marginLeft: 8 },
  price: { fontSize: 14, fontWeight: "700" },
  pctRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1 },
  changePct: { fontSize: 11, fontWeight: "700" },
  closeLabel: { fontSize: 10, marginTop: 1 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function WatchlistScreen() {
  const { colors } = useTheme();
  const { items, add, remove, has, reorder } = useWatchlistStore();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const { positions } = usePortfolioStore();

  const [subTab, setSubTab] = useState<"watchlist" | "videos">("watchlist");

  const [prices, setPrices]               = useState<Record<string, ExtPrice>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [query, setQuery]                 = useState("");
  const [suggestions, setSuggestions]     = useState<SearchResult[]>([]);
  const [searching, setSearching]         = useState(false);
  const [addingTicker, setAddingTicker]   = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen]     = useState(false);
  const [secondsLeft, setSecondsLeft]     = useState(60);
  const [editMode, setEditMode]           = useState(false);
  const [sortMode, setSortMode]           = useState<"default" | "gainers" | "losers">("default");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const [clips, setClips]           = useState<any[]>([]);
  const [clipsLoading, setClipsLoading] = useState(false);

  type PriceAlert = { ticker: string; target_price: number; condition: string };
  const [alerts, setAlerts]             = useState<Record<string, PriceAlert>>({});
  const [alertModal, setAlertModal]     = useState<{ ticker: string; currentPrice: number | null } | null>(null);
  const [alertPrice, setAlertPrice]     = useState("");
  const [alertCondition, setAlertCondition] = useState<"above" | "below">("below");
  const [savingAlert, setSavingAlert]   = useState(false);

  useEffect(() => {
    priceAlertsApi.list().then((r: any) => {
      const map: Record<string, PriceAlert> = {};
      for (const a of r.data ?? []) map[a.ticker] = a;
      setAlerts(map);
    }).catch(() => {});
  }, []);

  const openAlertModal = (ticker: string, currentPrice: number | null) => {
    const existing = alerts[ticker];
    setAlertPrice(existing ? String(existing.target_price) : "");
    setAlertCondition(existing?.condition === "above" ? "above" : "below");
    setAlertModal({ ticker, currentPrice });
  };

  const saveAlert = async () => {
    if (!alertModal || !alertPrice || isNaN(Number(alertPrice))) return;
    setSavingAlert(true);
    try {
      const res = await priceAlertsApi.create(alertModal.ticker, Number(alertPrice), alertCondition);
      setAlerts((prev) => ({ ...prev, [alertModal.ticker]: res.data }));
      setAlertModal(null);
    } catch { /* ignore */ }
    finally { setSavingAlert(false); }
  };

  const deleteAlert = async (ticker: string) => {
    await priceAlertsApi.remove(ticker).catch(() => {});
    setAlerts((prev) => { const n = { ...prev }; delete n[ticker]; return n; });
    setAlertModal(null);
  };

  const loadClips = useCallback(async () => {
    if (clips.length) return;
    setClipsLoading(true);
    try {
      const res = await feedApi.getClips({ sort: "recent" });
      setClips((res.data?.clips ?? res.data ?? []).slice(0, 9));
    } catch {}
    setClipsLoading(false);
  }, [clips.length]);

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

  const sortedItems = React.useMemo(() => {
    if (sortMode === "default") return items;
    return [...items].sort((a, b) => {
      const pctA = prices[a.ticker]?.change_pct ?? 0;
      const pctB = prices[b.ticker]?.change_pct ?? 0;
      return sortMode === "gainers" ? pctB - pctA : pctA - pctB;
    });
  }, [items, sortMode, prices]);

  const freePct = Math.min((items.length / FREE_LIMIT) * 100, 100);
  const freeFull = !isPremium && items.length >= FREE_LIMIT;

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>

      {/* ── Sub-tab bar: Watchlist | Videos ── */}
      <View style={[s.subTabBar, { backgroundColor: colors.bg }]}>
        <View style={[s.subTabInner, { backgroundColor: colors.bgRaised }]}>
          {(["watchlist", "videos"] as const).map((tab) => {
            const active = subTab === tab;
            const icon: React.ComponentProps<typeof Ionicons>["name"] =
              tab === "watchlist" ? "eye-outline" : "play-outline";
            const iconFilled: React.ComponentProps<typeof Ionicons>["name"] =
              tab === "watchlist" ? "eye" : "play";
            const label = tab === "watchlist" ? "Watchlist" : "Videos";
            return (
              <TouchableOpacity
                key={tab}
                style={[s.subTab, active && [s.subTabActive, { backgroundColor: colors.card }]]}
                onPress={() => { setSubTab(tab); if (tab === "videos") loadClips(); }}
                activeOpacity={0.75}
              >
                <Ionicons
                  name={active ? iconFilled : icon}
                  size={14}
                  color={active ? colors.accentLight : colors.textMuted}
                />
                <Text style={[s.subTabText, { color: active ? colors.text : colors.textMuted }]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Watchlist content ── */}
      {subTab === "watchlist" && (
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

              {/* Sort buttons — gainers / losers */}
              {items.length > 1 && !editMode && (
                <View style={s.sortRow}>
                  <TouchableOpacity
                    onPress={() => setSortMode((v) => v === "gainers" ? "default" : "gainers")}
                    style={[s.sortBtn, sortMode === "gainers" && { backgroundColor: "#22c55e22", borderColor: "#22c55e" }]}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Ionicons name="arrow-up" size={11} color={sortMode === "gainers" ? "#22c55e" : colors.textDim} />
                    <Text style={[s.sortBtnText, { color: sortMode === "gainers" ? "#22c55e" : colors.textDim }]}>Suben</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setSortMode((v) => v === "losers" ? "default" : "losers")}
                    style={[s.sortBtn, sortMode === "losers" && { backgroundColor: "#ef444422", borderColor: "#ef4444" }]}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Ionicons name="arrow-down" size={11} color={sortMode === "losers" ? "#ef4444" : colors.textDim} />
                    <Text style={[s.sortBtnText, { color: sortMode === "losers" ? "#ef4444" : colors.textDim }]}>Caen</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Reorder toggle — hidden while sorted */}
              {items.length > 1 && sortMode === "default" && (
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

            {sortedItems.map((item, index) => (
              <WatchlistRow
                key={item.ticker}
                item={item}
                index={index}
                itemCount={items.length}
                prices={prices}
                colors={colors}
                editMode={editMode && sortMode === "default"}
                onRemove={remove}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                onAlert={openAlertModal}
                hasAlert={!!alerts[item.ticker]}
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
      )}

      {/* ── Videos tab ── */}
      {subTab === "videos" && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.3 }}>Videos recientes</Text>
            <TouchableOpacity onPress={() => router.navigate("/(tabs)/videos")} activeOpacity={0.7}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.accentLight }}>Ver todo →</Text>
            </TouchableOpacity>
          </View>
          {clipsLoading
            ? <ActivityIndicator size="large" color={colors.accentLight} style={{ marginTop: 40 }} />
            : clips.length === 0
            ? (
              <View style={{ alignItems: "center", padding: 40, gap: 12 }}>
                <Ionicons name="play-circle-outline" size={48} color={colors.textDim} />
                <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: "center" }}>
                  No hay videos disponibles
                </Text>
              </View>
            )
            : clips.map((clip) => (
              <TouchableOpacity
                key={clip.id}
                activeOpacity={0.88}
                onPress={() => router.navigate("/(tabs)/videos")}
                style={[s.videoCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                {clip.thumbnail_url
                  ? <Image source={{ uri: clip.thumbnail_url }} style={s.videoThumb} />
                  : (
                    <View style={[s.videoThumb, { backgroundColor: colors.bgRaised, alignItems: "center", justifyContent: "center" }]}>
                      <Ionicons name="play-circle-outline" size={32} color={colors.textDim} />
                    </View>
                  )
                }
                <View style={s.videoInfo}>
                  <Text style={[s.videoTitle, { color: colors.text }]} numberOfLines={2}>{clip.title}</Text>
                  {clip.speaker ? (
                    <Text style={[s.videoSpeaker, { color: colors.textMuted }]} numberOfLines={1}>{clip.speaker}</Text>
                  ) : null}
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                    {(clip.tags ?? []).slice(0, 2).map((tag: string) => (
                      <View key={tag} style={[s.videoTag, { backgroundColor: colors.accentLight + "18" }]}>
                        <Text style={[s.videoTagText, { color: colors.accentLight }]}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </TouchableOpacity>
            ))
          }
        </ScrollView>
      )}

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />

      {/* ── Price Alert Modal ── */}
      <Modal visible={!!alertModal} transparent animationType="fade" onRequestClose={() => setAlertModal(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 }}
          activeOpacity={1} onPress={() => setAlertModal(null)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}
            style={{ width: "100%", borderRadius: 20, padding: 20, gap: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View>
                <Text style={{ fontSize: 10, fontWeight: "600", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Alerta de precio</Text>
                <Text style={{ fontSize: 18, fontWeight: "900", color: colors.text }}>{alertModal?.ticker}</Text>
              </View>
              <TouchableOpacity onPress={() => setAlertModal(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {alertModal?.currentPrice != null && (
              <Text style={{ fontSize: 12, color: colors.textMuted }}>
                Precio actual: <Text style={{ fontWeight: "700", color: colors.text }}>${alertModal.currentPrice.toFixed(2)}</Text>
              </Text>
            )}

            <View style={{ flexDirection: "row", borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
              {(["below", "above"] as const).map((c) => (
                <TouchableOpacity key={c} onPress={() => setAlertCondition(c)} activeOpacity={0.8}
                  style={{ flex: 1, paddingVertical: 10, alignItems: "center", backgroundColor: alertCondition === c ? colors.accent : colors.bgRaised }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: alertCondition === c ? "#fff" : colors.textMuted }}>
                    {c === "below" ? "Por debajo" : "Por encima"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              placeholder="Precio objetivo (ej. 180.00)"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={alertPrice}
              onChangeText={setAlertPrice}
              style={{ backgroundColor: colors.bgRaised, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, fontWeight: "600", color: colors.text, borderWidth: 1, borderColor: colors.border }}
            />

            <View style={{ flexDirection: "row", gap: 10 }}>
              {alertModal && alerts[alertModal.ticker] && (
                <TouchableOpacity onPress={() => deleteAlert(alertModal.ticker)} activeOpacity={0.8}
                  style={{ flex: 1, paddingVertical: 13, borderRadius: 14, alignItems: "center", borderWidth: 1, borderColor: "#ef4444" }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: "#ef4444" }}>Eliminar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={saveAlert} activeOpacity={0.8} disabled={savingAlert || !alertPrice}
                style={{ flex: 1, paddingVertical: 13, borderRadius: 14, alignItems: "center", backgroundColor: colors.accent, opacity: (!alertPrice || savingAlert) ? 0.5 : 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>{savingAlert ? "Guardando…" : "Guardar alerta"}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
  sortRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  sortBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1, borderColor: "transparent",
  },
  sortBtnText: { fontSize: 10, fontWeight: "700" },
  // Sub-tab bar
  subTabBar:   { paddingHorizontal: 16, paddingVertical: 10 },
  subTabInner: { flexDirection: "row", borderRadius: 14, padding: 3, gap: 2 },
  subTab: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 8, borderRadius: 11,
  },
  subTabActive: {},
  subTabText:   { fontSize: 13, fontWeight: "600" },
  // Video cards
  videoCard: {
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row", overflow: "hidden",
  },
  videoThumb:   { width: 100, height: 80 },
  videoInfo:    { flex: 1, padding: 10, gap: 4 },
  videoTitle:   { fontSize: 13, fontWeight: "600", lineHeight: 18 },
  videoSpeaker: { fontSize: 11, fontWeight: "400" },
  videoTag: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
  },
  videoTagText: { fontSize: 10, fontWeight: "600" },
});
