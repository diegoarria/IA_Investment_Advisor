import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, ScrollView, Alert, Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { router, useLocalSearchParams } from "expo-router";
import MobileTourBanner from "../../src/components/MobileTourBanner";
import { useWatchlistStore } from "../../src/lib/watchlistStore";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import { marketApi, watchlistExtApi, feedApi, priceAlertsApi } from "../../src/lib/api";
import { posthog } from "../../src/config/posthog";
import { Image } from "react-native";
import StockAvatar from "../../src/components/StockAvatar";
import PaywallModal from "../../src/components/PaywallModal";
import MobileEarningsCalendar from "../../src/components/MobileEarningsCalendar";

const FREE_LIMIT = 25;

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
  const { t } = useTranslation();
  const s = (state || "").toUpperCase();
  if (s === "REGULAR") {
    return (
      <View style={[badge.wrap, { backgroundColor: "rgba(34,197,94,0.12)" }]}>
        <View style={badge.dot} />
        <Text style={[badge.text, { color: "#22c55e" }]}>{t("watchlist.marketState.live")}</Text>
      </View>
    );
  }
  if (s === "PRE" || s === "PREPRE") {
    return (
      <View style={[badge.wrap, { backgroundColor: "rgba(245,158,11,0.12)" }]}>
        <Text style={[badge.text, { color: "#f59e0b" }]}>{t("watchlist.marketState.preMkt")}</Text>
      </View>
    );
  }
  if (s === "POST" || s === "POSTPOST") {
    return (
      <View style={[badge.wrap, { backgroundColor: "rgba(99,102,241,0.12)" }]}>
        <Text style={[badge.text, { color: "#818cf8" }]}>{t("watchlist.marketState.postMkt")}</Text>
      </View>
    );
  }
  return (
    <View style={[badge.wrap, { backgroundColor: "rgba(148,163,184,0.08)" }]}>
      <Text style={[badge.text, { color: "#64748b" }]}>{t("watchlist.marketState.closed")}</Text>
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
  editMode: boolean;
  advanced?: boolean;
  onRemove: (ticker: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onAlert: (ticker: string, currentPrice: number | null) => void;
  hasAlert?: boolean;
}

function WatchlistRow({ item, index, itemCount, prices, editMode, advanced, onRemove, onMoveUp, onMoveDown, onAlert, hasAlert }: RowProps) {
  const { t } = useTranslation();
  const p = prices[item.ticker] as ExtPrice | undefined;
  const dayUp  = (p?.change_pct ?? 0) >= 0;
  const dayCol = dayUp ? "#22c55e" : "#ef4444";
  const ms = (p?.market_state ?? "").toUpperCase();
  const showPre  = (ms === "PRE"  || ms === "PREPRE")  && !!p?.pre_market_price;
  const showPost = (ms === "POST" || ms === "POSTPOST") && !!p?.post_market_price;
  // In advanced mode, also show pre/post even during regular hours if data is available
  const showPreAdv  = advanced && !showPre  && !showPost && !!p?.pre_market_price;
  const showPostAdv = advanced && !showPre  && !showPost && !showPreAdv && !!p?.post_market_price;

  const primaryPrice = showPre ? p!.pre_market_price : showPost ? p!.post_market_price : p?.price ?? null;
  const primaryPct   = showPre ? p!.pre_market_change_pct : showPost ? p!.post_market_change_pct : p?.change_pct ?? null;
  const primaryColor    = showPre ? "#f59e0b" : showPost ? "#818cf8" : "#fff";
  const primaryPctColor = showPre ? "#f59e0b" : showPost ? "#818cf8" : dayCol;

  return (
    <View style={[rw.row, { borderTopColor: "#1f2330" }]}>
      <View style={[rw.colorBar, { backgroundColor: dayCol }]} />

      {editMode ? (
        <View style={rw.reorderCol}>
          <TouchableOpacity
            onPress={() => onMoveUp(index)}
            disabled={index === 0}
            style={[rw.arrowBtn, { opacity: index === 0 ? 0.2 : 1 }]}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="chevron-up" size={18} color="#9ca3af" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onMoveDown(index)}
            disabled={index === itemCount - 1}
            style={[rw.arrowBtn, { opacity: index === itemCount - 1 ? 0.2 : 1 }]}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="chevron-down" size={18} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity
        style={rw.inner}
        onPress={() => router.push(`/stock/${item.ticker}` as any)}
        activeOpacity={0.7}
      >
        <StockAvatar ticker={item.ticker} size={38} />

        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={rw.tickerRow}>
            <Text style={[rw.ticker, { color: "#fff" }]}>{item.ticker}</Text>
            {p && <MarketStateBadge state={p.market_state} />}
          </View>
          <Text style={[rw.name, { color: "#6b7280" }]} numberOfLines={1}>
            {p?.name ?? item.name}
          </Text>
          {(showPre || showPost) && p?.change_pct != null && (
            <View style={rw.dayChangeRow}>
              <Ionicons name={dayUp ? "trending-up" : "trending-down"} size={10} color={dayCol} />
              <Text style={[rw.dayChangeText, { color: dayCol }]}>
                {fmtPct(p.change_pct)} {t("watchlist.row.vsPrevClose")}
              </Text>
            </View>
          )}
        </View>

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
            <Text style={[rw.closeLabel, { color: "#6b7280" }]}>
              {showPre ? t("watchlist.row.regShort") : t("watchlist.row.close")} {fmtPrice(p.price, p.currency)}
            </Text>
          )}
          {showPreAdv && p?.pre_market_price != null && (
            <Text style={[rw.closeLabel, { color: "#f59e0b" }]}>
              {t("watchlist.row.prePrefix")} {fmtPrice(p.pre_market_price, p?.currency)}{p?.pre_market_change_pct != null ? ` (${fmtPct(p.pre_market_change_pct)})` : ""}
            </Text>
          )}
          {showPostAdv && p?.post_market_price != null && (
            <Text style={[rw.closeLabel, { color: "#818cf8" }]}>
              {t("watchlist.row.postPrefix")} {fmtPrice(p.post_market_price, p?.currency)}{p?.post_market_change_pct != null ? ` (${fmtPct(p.post_market_change_pct)})` : ""}
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
              color={hasAlert ? "#00d47e" : "#4b5563"}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onRemove(item.ticker)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ paddingHorizontal: 8 }}
          >
            <Ionicons name="close-outline" size={18} color="#4b5563" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const rw = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", minHeight: 72, borderTopWidth: StyleSheet.hairlineWidth },
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
  const { t } = useTranslation();
  const { tour } = useLocalSearchParams<{ tour?: string }>();
  const isTour = tour === "5";
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

  const [viewMode, setViewMode] = useState<"basic" | "advanced">("basic");

  const [clips, setClips]               = useState<any[]>([]);
  const [clipsLoading, setClipsLoading] = useState(false);

  type PriceAlert = { ticker: string; target_price: number; condition: string };
  const [alerts, setAlerts]                 = useState<Record<string, PriceAlert>>({});
  const [alertModal, setAlertModal]         = useState<{ ticker: string; currentPrice: number | null } | null>(null);
  const [alertPrice, setAlertPrice]         = useState("");
  const [alertCondition, setAlertCondition] = useState<"above" | "below">("below");
  const [savingAlert, setSavingAlert]       = useState(false);

  useEffect(() => {
    priceAlertsApi.list().then((r: any) => {
      const map: Record<string, PriceAlert> = {};
      for (const a of r.data ?? []) map[a.ticker] = a;
      setAlerts(map);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    import("../../src/lib/api").then(({ syncApi }) => {
      syncApi.getAll().then((res: any) => {
        const mode = res.data?.watchlist_view_mode;
        if (mode === "basic" || mode === "advanced") setViewMode(mode);
      }).catch(() => {});
    });
  }, []);

  const toggleViewMode = () => {
    const next: "basic" | "advanced" = viewMode === "basic" ? "advanced" : "basic";
    setViewMode(next);
    import("../../src/lib/api").then(({ syncApi }) => syncApi.pushWatchlistViewMode(next).catch(() => {}));
  };

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
      posthog.capture("price_alert_created", { ticker: alertModal.ticker, condition: alertCondition, target_price: Number(alertPrice) });
      setAlerts((prev) => ({ ...prev, [alertModal.ticker]: res.data }));
      setAlertModal(null);
    } catch { }
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
      Alert.alert(t("watchlist.alerts.alreadyAdded.title"), t("watchlist.alerts.alreadyAdded.message", { ticker }));
      setQuery(""); setSuggestions([]);
      return;
    }
    if (!isPremium && items.length >= FREE_LIMIT) { setPaywallOpen(true); return; }
    setAddingTicker(ticker);
    add(ticker, name);
    posthog.capture("watchlist_stock_added", { ticker, watchlist_size: items.length + 1 });
    setQuery(""); setSuggestions([]);
    setAddingTicker(null);
    setTimeout(() => loadPrices(true), 400);
  };

  const handleMoveUp   = (index: number) => { if (index > 0) reorder(index, index - 1); };
  const handleMoveDown = (index: number) => { if (index < items.length - 1) reorder(index, index + 1); };

  const sortedItems = React.useMemo(() => {
    if (sortMode === "default") return items;
    return [...items].sort((a, b) => {
      const pctA = prices[a.ticker]?.change_pct ?? 0;
      const pctB = prices[b.ticker]?.change_pct ?? 0;
      return sortMode === "gainers" ? pctB - pctA : pctA - pctB;
    });
  }, [items, sortMode, prices]);

  const freePct  = Math.min((items.length / FREE_LIMIT) * 100, 100);
  const freeFull = !isPremium && items.length >= FREE_LIMIT;

  return (
    <View style={s.container}>

      {/* Sub-tab bar */}
      <View style={s.subTabBar}>
        <View style={s.subTabInner}>
          {(["watchlist", "videos"] as const).map((tab) => {
            const active = subTab === tab;
            const icon: React.ComponentProps<typeof Ionicons>["name"] =
              tab === "watchlist" ? "eye-outline" : "play-outline";
            const iconFilled: React.ComponentProps<typeof Ionicons>["name"] =
              tab === "watchlist" ? "eye" : "play";
            const label = tab === "watchlist" ? t("watchlist.tabs.watchlist") : t("watchlist.tabs.videos");
            return (
              <TouchableOpacity
                key={tab}
                style={[s.subTab, active && s.subTabActive]}
                onPress={() => { setSubTab(tab); if (tab === "videos") loadClips(); }}
                activeOpacity={0.75}
              >
                <Ionicons
                  name={active ? iconFilled : icon}
                  size={14}
                  color={active ? "#00d47e" : "#6b7280"}
                />
                <Text style={[s.subTabText, { color: active ? "#fff" : "#6b7280" }]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Watchlist content */}
      {subTab === "watchlist" && (
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Search */}
          <View style={[s.searchWrap, { borderColor: isTour ? "#00d47e" : "#1f2330", borderWidth: isTour ? 2 : 1 }]}>
            <Ionicons name="search-outline" size={16} color="#6b7280" />
            <TextInput
              style={s.searchInput}
              placeholder={t("watchlist.search.placeholder")}
              placeholderTextColor="#374151"
              value={query}
              onChangeText={handleSearch}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color="#00d47e" />}
            {query.length > 0 && !searching && (
              <TouchableOpacity onPress={() => { setQuery(""); setSuggestions([]); }}>
                <Ionicons name="close-circle" size={16} color="#6b7280" />
              </TouchableOpacity>
            )}
          </View>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <View style={s.suggestionsCard}>
              {suggestions.map((sg) => (
                <TouchableOpacity
                  key={sg.ticker}
                  style={[s.suggRow, { borderTopColor: "#1f2330" }]}
                  onPress={() => handleAdd(sg.ticker, sg.name)}
                  disabled={addingTicker === sg.ticker}
                >
                  <StockAvatar ticker={sg.ticker} size={32} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={s.suggTicker}>{sg.ticker}</Text>
                    <Text style={s.suggName} numberOfLines={1}>{sg.name}</Text>
                  </View>
                  {has(sg.ticker) ? (
                    <Ionicons name="checkmark-circle" size={18} color="#00d47e" />
                  ) : addingTicker === sg.ticker ? (
                    <ActivityIndicator size="small" color="#00d47e" />
                  ) : (
                    <Ionicons name="add-circle-outline" size={18} color="#00d47e" />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Free tier bar */}
          {!isPremium && (
            <View style={s.tierBar}>
              <View style={s.tierTop}>
                <Text style={s.tierLabel}>{t("watchlist.tier.label", { count: items.length, limit: FREE_LIMIT })}</Text>
                {freeFull && (
                  <TouchableOpacity onPress={() => setPaywallOpen(true)}>
                    <Text style={s.tierUpgrade}>{t("watchlist.tier.upgrade")}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={s.tierTrack}>
                <View style={[s.tierFill, { width: `${freePct}%` as never, backgroundColor: freePct >= 80 ? "#f59e0b" : "#00d47e" }]} />
              </View>
            </View>
          )}

          {/* Empty state */}
          {items.length === 0 && (
            <View style={s.emptyCard}>
              <View style={s.emptyIcon}>
                <Ionicons name="eye-outline" size={26} color="#00d47e" />
              </View>
              <Text style={s.emptyTitle}>{t("watchlist.empty.title")}</Text>
              <Text style={s.emptySub}>
                {t("watchlist.empty.subtitle")}
              </Text>
            </View>
          )}

          {/* Watchlist */}
          {items.length > 0 && (
            <View style={s.listCard}>
              <View style={s.listHeader}>
                <Ionicons name="eye-outline" size={14} color="#00d47e" />
                <Text style={s.listHeaderText}>{t("watchlist.tabs.watchlist")}</Text>

                {items.length > 1 && !editMode && (
                  <View style={s.sortRow}>
                    <TouchableOpacity
                      onPress={() => setSortMode((v) => v === "gainers" ? "default" : "gainers")}
                      style={[s.sortBtn, sortMode === "gainers" && { backgroundColor: "#22c55e22", borderColor: "#22c55e" }]}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="arrow-up" size={11} color={sortMode === "gainers" ? "#22c55e" : "#4b5563"} />
                      <Text style={[s.sortBtnText, { color: sortMode === "gainers" ? "#22c55e" : "#4b5563" }]}>{t("watchlist.sort.gainers")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setSortMode((v) => v === "losers" ? "default" : "losers")}
                      style={[s.sortBtn, sortMode === "losers" && { backgroundColor: "#ef444422", borderColor: "#ef4444" }]}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="arrow-down" size={11} color={sortMode === "losers" ? "#ef4444" : "#4b5563"} />
                      <Text style={[s.sortBtnText, { color: sortMode === "losers" ? "#ef4444" : "#4b5563" }]}>{t("watchlist.sort.losers")}</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {items.length > 1 && sortMode === "default" && (
                  <TouchableOpacity
                    onPress={() => setEditMode((v) => !v)}
                    style={[s.editBtn, { backgroundColor: editMode ? "rgba(0,212,126,0.12)" : "#1a1d27", borderColor: editMode ? "#00d47e" : "#1f2330" }]}
                  >
                    <Ionicons name={editMode ? "checkmark" : "reorder-three-outline"} size={13} color={editMode ? "#00d47e" : "#4b5563"} />
                    <Text style={[s.editBtnText, { color: editMode ? "#00d47e" : "#4b5563" }]}>
                      {editMode ? t("watchlist.edit.done") : t("watchlist.edit.reorder")}
                    </Text>
                  </TouchableOpacity>
                )}

                {!editMode && (
                  <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <TouchableOpacity
                      onPress={toggleViewMode}
                      style={[s.sortBtn, viewMode === "advanced" && { backgroundColor: "rgba(99,102,241,0.12)", borderColor: "#6366f1" }]}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Text style={[s.sortBtnText, { color: viewMode === "advanced" ? "#818cf8" : "#4b5563" }]}>
                        {viewMode === "basic" ? t("watchlist.viewMode.basic") : t("watchlist.viewMode.advanced")}
                      </Text>
                    </TouchableOpacity>
                    {pricesLoading
                      ? <ActivityIndicator size="small" color="#00d47e" />
                      : (
                        <TouchableOpacity
                          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                          onPress={() => { loadPrices(); setSecondsLeft(60); }}
                        >
                          <Ionicons name="refresh-outline" size={13} color="#4b5563" />
                          <Text style={s.counterText}>{secondsLeft}s</Text>
                        </TouchableOpacity>
                      )
                    }
                  </View>
                )}
              </View>

              {sortedItems.map((item, index) => (
                <WatchlistRow
                  key={item.ticker}
                  item={item}
                  index={index}
                  itemCount={items.length}
                  prices={prices}
                  editMode={editMode && sortMode === "default"}
                  advanced={viewMode === "advanced"}
                  onRemove={(ticker: string) => { posthog.capture("watchlist_stock_removed", { ticker, watchlist_size: items.length - 1 }); remove(ticker); }}
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

      {/* Videos tab */}
      {subTab === "videos" && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: -0.3 }}>{t("watchlist.videos.recentTitle")}</Text>
            <TouchableOpacity onPress={() => router.navigate("/(tabs)/videos")} activeOpacity={0.7}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#00d47e" }}>{t("common.seeAll")}</Text>
            </TouchableOpacity>
          </View>
          {clipsLoading
            ? <ActivityIndicator size="large" color="#00d47e" style={{ marginTop: 40 }} />
            : clips.length === 0
            ? (
              <View style={{ alignItems: "center", padding: 40, gap: 12 }}>
                <Ionicons name="play-circle-outline" size={48} color="#4b5563" />
                <Text style={{ color: "#6b7280", fontSize: 14, textAlign: "center" }}>
                  {t("watchlist.videos.empty")}
                </Text>
              </View>
            )
            : clips.map((clip) => (
              <TouchableOpacity
                key={clip.id}
                activeOpacity={0.88}
                onPress={() => router.navigate("/(tabs)/videos")}
                style={s.videoCard}
              >
                {clip.thumbnail_url
                  ? <Image source={{ uri: clip.thumbnail_url }} style={s.videoThumb} />
                  : (
                    <View style={[s.videoThumb, { backgroundColor: "#1a1d27", alignItems: "center", justifyContent: "center" }]}>
                      <Ionicons name="play-circle-outline" size={32} color="#4b5563" />
                    </View>
                  )
                }
                <View style={s.videoInfo}>
                  <Text style={s.videoTitle} numberOfLines={2}>{clip.title}</Text>
                  {clip.speaker ? (
                    <Text style={s.videoSpeaker} numberOfLines={1}>{clip.speaker}</Text>
                  ) : null}
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                    {(clip.tags ?? []).slice(0, 2).map((tag: string) => (
                      <View key={tag} style={s.videoTag}>
                        <Text style={s.videoTagText}>{tag}</Text>
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

      {/* Price Alert Modal */}
      <Modal visible={!!alertModal} transparent animationType="fade" onRequestClose={() => setAlertModal(null)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", padding: 24 }}
          activeOpacity={1} onPress={() => setAlertModal(null)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}
            style={{ width: "100%", borderRadius: 22, padding: 20, gap: 16, backgroundColor: "#111318", borderWidth: 1, borderColor: "#1f2330" }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View>
                <Text style={{ fontSize: 10, fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{t("watchlist.alertModal.title")}</Text>
                <Text style={{ fontSize: 18, fontWeight: "900", color: "#fff" }}>{alertModal?.ticker}</Text>
              </View>
              <TouchableOpacity onPress={() => setAlertModal(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>

            {alertModal?.currentPrice != null && (
              <Text style={{ fontSize: 12, color: "#6b7280" }}>
                {t("watchlist.alertModal.currentPrice")} <Text style={{ fontWeight: "700", color: "#fff" }}>${alertModal.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
              </Text>
            )}

            <View style={{ flexDirection: "row", borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: "#1f2330" }}>
              {(["below", "above"] as const).map((c) => (
                <TouchableOpacity key={c} onPress={() => setAlertCondition(c)} activeOpacity={0.8}
                  style={{ flex: 1, paddingVertical: 10, alignItems: "center", backgroundColor: alertCondition === c ? "#00d47e" : "#1a1d27" }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: alertCondition === c ? "#000" : "#6b7280" }}>
                    {c === "below" ? t("watchlist.alertModal.below") : t("watchlist.alertModal.above")}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              placeholder={t("watchlist.alertModal.placeholder")}
              placeholderTextColor="#374151"
              keyboardType="numeric"
              value={alertPrice}
              onChangeText={setAlertPrice}
              style={{ backgroundColor: "#1a1d27", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, fontWeight: "600", color: "#fff", borderWidth: 1, borderColor: "#1f2330" }}
            />

            <View style={{ flexDirection: "row", gap: 10 }}>
              {alertModal && alerts[alertModal.ticker] && (
                <TouchableOpacity onPress={() => deleteAlert(alertModal.ticker)} activeOpacity={0.8}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center", borderWidth: 1, borderColor: "#ef4444" }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: "#ef4444" }}>{t("common.delete")}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={saveAlert} activeOpacity={0.8} disabled={savingAlert || !alertPrice}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center", backgroundColor: "#00d47e", opacity: (!alertPrice || savingAlert) ? 0.5 : 1,
                  shadowColor: "#00d47e", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
                }}>
                <Text style={{ fontSize: 14, fontWeight: "900", color: "#000" }}>{savingAlert ? t("common.saving2") : t("watchlist.alertModal.save")}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {isTour && (
        <MobileTourBanner
          step={5}
          title={t("watchlist.tour.title")}
          description={t("watchlist.tour.description")}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0d12" },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },

  // Sub-tab bar
  subTabBar: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#0a0d12" },
  subTabInner: { flexDirection: "row", borderRadius: 14, padding: 3, gap: 2, backgroundColor: "#111318" },
  subTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 11 },
  subTabActive: { backgroundColor: "#1f2330" },
  subTabText: { fontSize: 13, fontWeight: "600" },

  // Search
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 14, backgroundColor: "#111318",
  },
  searchInput: { flex: 1, fontSize: 14, fontWeight: "500", color: "#fff" },

  // Suggestions
  suggestionsCard: { borderRadius: 16, borderWidth: 1, borderColor: "rgba(0,212,126,0.2)", overflow: "hidden", backgroundColor: "#111318" },
  suggRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  suggTicker: { fontSize: 13, fontWeight: "700", letterSpacing: -0.2, color: "#00d47e" },
  suggName: { fontSize: 11, marginTop: 1, color: "#6b7280" },

  // Tier bar
  tierBar: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "#1f2330", backgroundColor: "#111318", gap: 8 },
  tierTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tierLabel: { fontSize: 12, fontWeight: "600", color: "#6b7280" },
  tierUpgrade: { fontSize: 12, fontWeight: "700", color: "#00d47e" },
  tierTrack: { height: 4, borderRadius: 2, backgroundColor: "#1f2330" },
  tierFill: { height: 4, borderRadius: 2 },

  // Empty state
  emptyCard: { alignItems: "center", padding: 40, borderRadius: 20, borderWidth: 1, borderColor: "#1f2330", borderStyle: "dashed", backgroundColor: "#111318" },
  emptyIcon: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,212,126,0.1)", borderWidth: 1, borderColor: "rgba(0,212,126,0.2)", marginBottom: 14 },
  emptyTitle: { fontSize: 15, fontWeight: "800", marginBottom: 8, color: "#fff" },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 20, color: "#6b7280" },

  // List card
  listCard: { borderRadius: 20, borderWidth: 1, borderColor: "#1f2330", overflow: "hidden", backgroundColor: "#111318" },
  listHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 12 },
  listHeaderText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  editBtnText: { fontSize: 11, fontWeight: "700" },
  counterText: { fontSize: 11, color: "#4b5563" },
  sortRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: "transparent" },
  sortBtnText: { fontSize: 10, fontWeight: "700" },

  // Video cards
  videoCard: { borderRadius: 16, borderWidth: 1, borderColor: "#1f2330", flexDirection: "row", overflow: "hidden", backgroundColor: "#111318" },
  videoThumb: { width: 100, height: 80 },
  videoInfo: { flex: 1, padding: 10, gap: 4 },
  videoTitle: { fontSize: 13, fontWeight: "600", lineHeight: 18, color: "#fff" },
  videoSpeaker: { fontSize: 11, fontWeight: "400", color: "#6b7280" },
  videoTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: "rgba(0,212,126,0.1)" },
  videoTagText: { fontSize: 10, fontWeight: "600", color: "#00d47e" },
});
