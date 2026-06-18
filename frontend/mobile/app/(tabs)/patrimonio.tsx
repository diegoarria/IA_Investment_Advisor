import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../../src/lib/ThemeContext";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import { useWatchlistStore } from "../../src/lib/watchlistStore";
import { usePaperStore, PAPER_INITIAL_CASH } from "../../src/lib/paperStore";
import { marketApi } from "../../src/lib/api";
import StockAvatar from "../../src/components/StockAvatar";

// ─── Types ─────────────────────────────────────────────────────────────────

interface PriceData {
  price: number | null;
  change_pct: number;
  currency?: string;
  name?: string;
}

type PriceMap = Record<string, PriceData>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ─── Sub-tabs ────────────────────────────────────────────────────────────────

const TABS = ["Portafolio", "Watchlist", "Simulador"] as const;
type TabId = (typeof TABS)[number];

// ─── Portafolio Tab ──────────────────────────────────────────────────────────

function PortafolioTab({ prices, loading, colors }: { prices: PriceMap; loading: boolean; colors: any }) {
  const { positions } = usePortfolioStore();

  const totalValue = positions.reduce((sum, pos) => {
    const p = prices[pos.ticker]?.price ?? pos.avgPrice;
    return sum + pos.shares * p;
  }, 0);

  const totalCost = positions.reduce((sum, pos) => sum + pos.shares * pos.avgPrice, 0);
  const totalGain = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  const { dayGain, dayPrev } = positions.reduce((acc, pos) => {
    const pr = prices[pos.ticker];
    if (!pr?.price) return acc;
    const cp = pr.change_pct ?? 0;
    const prevPrice = cp !== -100 ? pr.price / (1 + cp / 100) : pr.price;
    return {
      dayGain: acc.dayGain + pos.shares * (pr.price - prevPrice),
      dayPrev: acc.dayPrev + pos.shares * prevPrice,
    };
  }, { dayGain: 0, dayPrev: 0 });
  const dayGainPct = dayPrev > 0 ? (dayGain / dayPrev) * 100 : 0;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 12 }}>
      {/* Summary Row */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={[ss.statCard, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ss.statLabel, { color: colors.textMuted }]}>Valor Total</Text>
          <Text style={[ss.statValue, { color: colors.text }]}>{fmtMoney(totalValue)}</Text>
        </View>
        <View style={[ss.statCard, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ss.statLabel, { color: colors.textMuted }]}>Ganancia Día</Text>
          <Text style={[ss.statValue, { color: dayGain >= 0 ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }]}>
            {fmtMoney(dayGain)}
          </Text>
          <Text style={{ fontSize: 11, fontWeight: "600", color: dayGain >= 0 ? colors.up ?? "#10b981" : colors.down ?? "#ef4444", marginTop: 2 }}>
            {fmtPct(dayGainPct)}
          </Text>
        </View>
      </View>

      <View style={[ss.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[ss.statLabel, { color: colors.textMuted }]}>Ganancia Total</Text>
        <Text style={[ss.statValue, { color: totalGain >= 0 ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }]}>
          {fmtMoney(totalGain)}{" "}
          <Text style={ss.statSubValue}>{fmtPct(totalGainPct)}</Text>
        </Text>
      </View>

      {/* Positions List */}
      <View style={[ss.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[ss.cardHeader, { borderBottomColor: colors.border }]}>
          <Text style={[ss.cardTitle, { color: colors.text }]}>Posiciones ({positions.length})</Text>
          {loading && <ActivityIndicator size="small" color={colors.accentLight} />}
        </View>

        {positions.length === 0 ? (
          <View style={ss.emptyState}>
            <Ionicons name="bar-chart-outline" size={32} color={colors.textMuted} style={{ opacity: 0.4 }} />
            <Text style={[ss.emptyText, { color: colors.textMuted }]}>No tienes posiciones aún</Text>
          </View>
        ) : (
          positions.map((pos, i) => {
            const pr = prices[pos.ticker];
            const currentPrice = pr?.price ?? pos.avgPrice;
            const currentValue = pos.shares * currentPrice;
            const cost = pos.shares * pos.avgPrice;
            const gainAbs = currentValue - cost;
            const gainPct = cost > 0 ? (gainAbs / cost) * 100 : 0;
            const dayChangePct = pr?.change_pct ?? 0;
            const positive = gainAbs >= 0;

            return (
              <View
                key={pos.id}
                style={[
                  ss.row,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
              >
                <StockAvatar ticker={pos.ticker} size={36} />
                <View style={ss.rowInfo}>
                  <Text style={[ss.rowTicker, { color: colors.text }]}>{pos.ticker}</Text>
                  <Text style={[ss.rowSub, { color: colors.textMuted }]}>
                    {pos.shares} acc · ${pos.avgPrice.toFixed(2)} prom.
                  </Text>
                </View>
                <View style={ss.rowRight}>
                  <Text style={[ss.rowValue, { color: colors.text }]}>{fmtMoney(currentValue)}</Text>
                  <View style={ss.rowBadgeRow}>
                    <Text style={[ss.rowBadge, { color: positive ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }]}>
                      {fmtPct(gainPct)}
                    </Text>
                    <Text style={[ss.rowSub, { color: colors.textMuted }]}>
                      {" · "}
                      <Text style={{ color: dayChangePct >= 0 ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }}>
                        {fmtPct(dayChangePct)}
                      </Text>
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>

      <TouchableOpacity
        onPress={() => router.push("/(tabs)/portfolio")}
        activeOpacity={0.8}
        style={[ss.btn, { backgroundColor: colors.accent }]}
      >
        <Text style={ss.btnText}>Ver portafolio completo →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Watchlist Tab ───────────────────────────────────────────────────────────

function WatchlistTab({ prices, loading, colors }: { prices: PriceMap; loading: boolean; colors: any }) {
  const { items } = useWatchlistStore();

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View style={[ss.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[ss.cardHeader, { borderBottomColor: colors.border }]}>
          <Text style={[ss.cardTitle, { color: colors.text }]}>Watchlist ({items.length})</Text>
          {loading && <ActivityIndicator size="small" color={colors.accentLight} />}
        </View>

        {items.length === 0 ? (
          <View style={ss.emptyState}>
            <Ionicons name="eye-outline" size={32} color={colors.textMuted} style={{ opacity: 0.4 }} />
            <Text style={[ss.emptyText, { color: colors.textMuted }]}>Tu watchlist está vacía</Text>
          </View>
        ) : (
          items.map((item, i) => {
            const pr = prices[item.ticker];
            const price = pr?.price ?? null;
            const changePct = pr?.change_pct ?? 0;
            const positive = changePct >= 0;

            return (
              <View
                key={item.ticker}
                style={[
                  ss.row,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
              >
                <StockAvatar ticker={item.ticker} size={36} />
                <View style={ss.rowInfo}>
                  <Text style={[ss.rowTicker, { color: colors.text }]}>{item.ticker}</Text>
                  <Text style={[ss.rowSub, { color: colors.textMuted }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>
                <View style={ss.rowRight}>
                  <Text style={[ss.rowValue, { color: colors.text }]}>
                    {price !== null ? `$${price.toFixed(2)}` : "—"}
                  </Text>
                  <Text style={[ss.rowBadge, { color: positive ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }]}>
                    {fmtPct(changePct)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      <TouchableOpacity
        onPress={() => router.push("/(tabs)/watchlist")}
        activeOpacity={0.8}
        style={[ss.btn, { backgroundColor: colors.accent }]}
      >
        <Text style={ss.btnText}>Ver watchlist completa →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Simulador Tab ───────────────────────────────────────────────────────────

function SimuladorTab({ prices, loading, colors }: { prices: PriceMap; loading: boolean; colors: any }) {
  const { cash, positions } = usePaperStore();

  const positionsValue = positions.reduce((sum, pos) => {
    const p = prices[pos.ticker]?.price ?? pos.avgPrice;
    return sum + pos.shares * p;
  }, 0);

  const totalValue = cash + positionsValue;
  const gain = totalValue - PAPER_INITIAL_CASH;
  const gainPct = (gain / PAPER_INITIAL_CASH) * 100;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 12 }}>
      {/* Summary Row */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={[ss.statCard, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ss.statLabel, { color: colors.textMuted }]}>Valor Total</Text>
          <Text style={[ss.statValue, { color: colors.text }]}>{fmtMoney(totalValue)}</Text>
        </View>
        <View style={[ss.statCard, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ss.statLabel, { color: colors.textMuted }]}>Efectivo</Text>
          <Text style={[ss.statValue, { color: colors.text }]}>{fmtMoney(cash)}</Text>
        </View>
      </View>

      <View style={[ss.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[ss.statLabel, { color: colors.textMuted }]}>Ganancia vs capital inicial</Text>
        <Text style={[ss.statValue, { color: gain >= 0 ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }]}>
          {fmtMoney(gain)}{" "}
          <Text style={ss.statSubValue}>{fmtPct(gainPct)}</Text>
        </Text>
      </View>

      {/* Paper Positions */}
      <View style={[ss.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[ss.cardHeader, { borderBottomColor: colors.border }]}>
          <Text style={[ss.cardTitle, { color: colors.text }]}>Posiciones Paper ({positions.length})</Text>
          {loading && <ActivityIndicator size="small" color={colors.accentLight} />}
        </View>

        {positions.length === 0 ? (
          <View style={ss.emptyState}>
            <Ionicons name="wallet-outline" size={32} color={colors.textMuted} style={{ opacity: 0.4 }} />
            <Text style={[ss.emptyText, { color: colors.textMuted }]}>No tienes posiciones paper</Text>
          </View>
        ) : (
          positions.map((pos, i) => {
            const pr = prices[pos.ticker];
            const currentPrice = pr?.price ?? pos.avgPrice;
            const currentValue = pos.shares * currentPrice;
            const cost = pos.shares * pos.avgPrice;
            const gainAbs = currentValue - cost;
            const gainPct2 = cost > 0 ? (gainAbs / cost) * 100 : 0;
            const positive = gainAbs >= 0;

            return (
              <View
                key={pos.id}
                style={[
                  ss.row,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
              >
                <StockAvatar ticker={pos.ticker} size={36} />
                <View style={ss.rowInfo}>
                  <Text style={[ss.rowTicker, { color: colors.text }]}>{pos.ticker}</Text>
                  <Text style={[ss.rowSub, { color: colors.textMuted }]}>
                    {pos.shares} acc · ${pos.avgPrice.toFixed(2)} prom.
                  </Text>
                </View>
                <View style={ss.rowRight}>
                  <Text style={[ss.rowValue, { color: colors.text }]}>{fmtMoney(currentValue)}</Text>
                  <Text style={[ss.rowBadge, { color: positive ? colors.up ?? "#10b981" : colors.down ?? "#ef4444" }]}>
                    {fmtPct(gainPct2)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      <TouchableOpacity
        onPress={() => router.push("/(tabs)/paper")}
        activeOpacity={0.8}
        style={[ss.btn, { backgroundColor: colors.accent }]}
      >
        <Text style={ss.btnText}>Abrir simulador →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function PatrimonioScreen() {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<TabId>("Portafolio");
  const [prices, setPrices] = useState<PriceMap>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  const { positions: portfolioPositions } = usePortfolioStore();
  const { items: watchItems } = useWatchlistStore();
  const { positions: paperPositions } = usePaperStore();

  useEffect(() => {
    const allTickers = [
      ...portfolioPositions.map((p) => p.ticker),
      ...watchItems.map((w) => w.ticker),
      ...paperPositions.map((p) => p.ticker),
    ];
    const unique = [...new Set(allTickers)];
    if (unique.length === 0) return;

    const fetchPrices = (initial = false) => {
      if (initial) setPricesLoading(true);
      marketApi
        .getPrices(unique)
        .then((res: any) => { if (res?.data) setPrices(res.data as PriceMap); })
        .catch(() => {})
        .finally(() => { if (initial) setPricesLoading(false); });
    };

    fetchPrices(true);
    const id = setInterval(() => fetchPrices(false), 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView edges={["top"]} style={[ss.safe, { backgroundColor: colors.bg }]}>
      {/* Header */}
      <View style={[ss.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[ss.headerSub, { color: colors.textMuted }]}>Mi dinero</Text>
          <Text style={[ss.headerTitle, { color: colors.text }]}>Patrimonio</Text>
        </View>
      </View>

      {/* Sub-tab switcher */}
      <View style={[ss.tabBar, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.8}
            style={[
              ss.tabBtn,
              activeTab === tab && { backgroundColor: colors.accent },
            ]}
          >
            <Text
              style={[
                ss.tabBtnText,
                { color: activeTab === tab ? "#fff" : colors.textMuted },
              ]}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {activeTab === "Portafolio" && (
        <PortafolioTab prices={prices} loading={pricesLoading} colors={colors} />
      )}
      {activeTab === "Watchlist" && (
        <WatchlistTab prices={prices} loading={pricesLoading} colors={colors} />
      )}
      {activeTab === "Simulador" && (
        <SimuladorTab prices={prices} loading={pricesLoading} colors={colors} />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  safe: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  statCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  statSubValue: {
    fontSize: 14,
    fontWeight: "600",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowTicker: {
    fontSize: 14,
    fontWeight: "700",
  },
  rowSub: {
    fontSize: 11,
    marginTop: 1,
  },
  rowRight: {
    alignItems: "flex-end",
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  rowBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  rowBadge: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  btn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
