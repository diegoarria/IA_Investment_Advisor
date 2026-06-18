import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Image, RefreshControl, Animated, Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useTheme } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import { useLearnStore } from "../../src/lib/learnStore";
import { useSubscriptionStore } from "../../src/lib/subscriptionStore";
import { hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { marketApi, notificationsApi } from "../../src/lib/api";
import StockAvatar from "../../src/components/StockAvatar";

const { width: W } = Dimensions.get("window");

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", JPY: "¥", MXN: "$", ARS: "$", BRL: "R$",
};

function fmt(n: number, currency = "USD") {
  const sym = CURRENCY_SYMBOL[currency] ?? "$";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(2)}M`;
  return `${sign}${sym}${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ── Skeleton placeholder ──────────────────────────────────────────────────────
function Skeleton({ w, h, r = 8 }: { w: number | string; h: number; r?: number }) {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={{
      width: w as any, height: h, borderRadius: r,
      backgroundColor: "#1a2540", opacity: anim,
    }} />
  );
}

// ── Streak Ring ───────────────────────────────────────────────────────────────
function StreakRing({ streak }: { streak: number }) {
  const { colors } = useTheme();
  const fire = streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "✨";
  return (
    <View style={[ss.streakRing, { borderColor: streak > 0 ? "#f59e0b" : colors.border }]}>
      <Text style={ss.streakEmoji}>{fire}</Text>
      <Text style={[ss.streakNum, { color: streak > 0 ? "#f59e0b" : colors.textMuted }]}>{streak}</Text>
      <Text style={[ss.streakLabel, { color: colors.textMuted }]}>días</Text>
    </View>
  );
}

// ── Quick Action Chip ─────────────────────────────────────────────────────────
function ActionChip({ icon, label, onPress, accent = false, colors }: any) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[ss.chip, {
        backgroundColor: accent ? colors.accent + "18" : colors.bgRaised,
        borderColor:     accent ? colors.accent + "50" : colors.border,
      }]}
    >
      <Ionicons name={icon} size={18} color={accent ? colors.accentLight : colors.textSub} />
      <Text style={[ss.chipLabel, { color: accent ? colors.accentLight : colors.textSub }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const { colors } = useTheme();
  const profile  = useAppStore((s) => s.profile);
  const maturity = useAppStore((s) => s.maturityScore);
  const streak   = useLearnStore((s) => s.streak);
  const { positions, portfolioCurrency } = usePortfolioStore();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);

  const [prices,     setPrices]    = useState<Record<string, any>>({});
  const [news,       setNews]      = useState<any[]>([]);
  const [indices,    setIndices]   = useState<any[]>([]);
  const [unread,     setUnread]    = useState(0);
  const [topNotifs,  setTopNotifs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading,    setLoading]   = useState(true);

  const DAILY_LESSONS = [
    { emoji: "🥧", title: "Diversificación" },
    { emoji: "📅", title: "Dollar Cost Averaging" },
    { emoji: "💰", title: "Dividendos" },
    { emoji: "📈", title: "Análisis Fundamental" },
    { emoji: "🛡️", title: "Ventaja Competitiva" },
    { emoji: "⚠️", title: "Aversión a la Pérdida" },
    { emoji: "🔄", title: "Rebalanceo" },
  ];
  const dailyLesson = DAILY_LESSONS[new Date().getDay() % DAILY_LESSONS.length];

  const goalName   = profile?.investment_goal ?? null;
  const goalAmount = parseFloat((profile as any)?.investment_goal_amount ?? "0") || 0;

  const sym = CURRENCY_SYMBOL[portfolioCurrency] ?? "$";

  // ── Computed portfolio totals ─────────────────────────────────────────────
  const { total, dayGain, dayGainPct, totalGain, totalGainPct } = React.useMemo(() => {
    if (!positions.length) return { total: 0, dayGain: 0, dayGainPct: 0, totalGain: 0, totalGainPct: 0 };
    let total = 0, dayGain = 0, costBasis = 0;
    for (const p of positions) {
      const px       = prices[p.ticker];
      const curr     = px?.price ?? p.avgPrice;
      // Derive previous close from change_pct: prev = curr / (1 + change_pct/100)
      const cp       = px?.change_pct ?? 0;
      const prev     = cp !== -100 ? curr / (1 + cp / 100) : curr;
      total     += curr * p.shares;
      dayGain   += (curr - prev) * p.shares;
      costBasis += p.avgPrice * p.shares;
    }
    const dayGainPct   = total > 0 ? (dayGain / (total - dayGain)) * 100 : 0;
    const totalGain    = total - costBasis;
    const totalGainPct = costBasis > 0 ? (totalGain / costBasis) * 100 : 0;
    return { total, dayGain, dayGainPct, totalGain, totalGainPct };
  }, [positions, prices]);

  // ── Top movers (sorted by day % change) ──────────────────────────────────
  const movers = React.useMemo(() => {
    return [...positions]
      .map((p) => {
        const px  = prices[p.ticker];
        const curr = px?.price ?? p.avgPrice;
        const chg  = px?.change_pct ?? 0;
        return { ...p, curr, chg };
      })
      .sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg))
      .slice(0, 4);
  }, [positions, prices]);

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const tickers = positions.map((p) => p.ticker);
      const [priceRes, notifRes, idxRes] = await Promise.allSettled([
        tickers.length ? marketApi.getPrices(tickers) : Promise.resolve({ data: {} }),
        notificationsApi.getAll(),
        marketApi.getIndices(),
      ]);
      if (priceRes.status === "fulfilled") setPrices(priceRes.value.data ?? {});
      if (notifRes.status === "fulfilled") {
        const d = notifRes.value.data;
        setUnread(d?.unread_count ?? 0);
        const items: any[] = d?.notifications ?? d?.items ?? [];
        setTopNotifs(items.slice(0, 2));
      }
      if (idxRes.status === "fulfilled") setIndices(idxRes.value.data ?? []);

      // News only when we have positions
      if (tickers.length) {
        const newsRes = await marketApi.getNews(tickers.slice(0, 6)).catch(() => null);
        if (newsRes) setNews((newsRes.data?.articles ?? newsRes.data?.news ?? []).slice(0, 6));
      }
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [positions]);

  useFocusEffect(useCallback(() => {
    loadData(true);
    // Refresh prices + indices every 30s while screen is focused
    const id = setInterval(() => {
      const tickers = positions.map((p) => p.ticker);
      if (tickers.length) {
        marketApi.getPrices(tickers)
          .then((res: any) => { if (res?.data) setPrices(res.data ?? {}); })
          .catch(() => {});
      }
      marketApi.getIndices()
        .then((res: any) => { if (res?.data) setIndices(res.data ?? []); })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [loadData, positions])); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Buenos días";
    if (h < 19) return "Buenas tardes";
    return "Buenas noches";
  };

  // NYSE trading hours: Mon–Fri 09:30–16:00 ET (UTC-4 in summer, UTC-5 in winter)
  const isMarketOpen = React.useMemo(() => {
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return false;
    // Rough ET offset (no DST precision needed for a UI hint)
    const etOffset = -4; // EDT; use -5 for EST
    const etH = now.getUTCHours() + etOffset;
    const etM = now.getUTCMinutes();
    const minutesSinceMidnight = etH * 60 + etM;
    return minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight < 16 * 60;
  }, []);

  const firstName = profile?.name?.split(" ")[0] ?? "Inversor";

  return (
    <SafeAreaView style={[ss.root, { backgroundColor: colors.bg }]} edges={["top"]}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[ss.header, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[ss.greeting, { color: colors.textMuted }]}>{greeting()},</Text>
          <Text style={[ss.name, { color: colors.text }]}>{firstName} 👋</Text>
        </View>
        <View style={ss.headerRight}>
          {/* Market open/closed dot */}
          <View style={ss.marketDotWrap}>
            <View style={[ss.marketDot, { backgroundColor: isMarketOpen ? "#22c55e" : colors.textDim }]} />
            <Text style={[ss.marketDotLabel, { color: isMarketOpen ? "#22c55e" : colors.textDim }]}>
              {isMarketOpen ? "Abierto" : "Cerrado"}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => router.navigate("/(tabs)/notifications")}
            style={[ss.iconBtn, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}
          >
            <Ionicons name="notifications-outline" size={20} color={colors.textSub} />
            {unread > 0 && (
              <View style={ss.badge}>
                <Text style={ss.badgeText}>{unread > 9 ? "9+" : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.navigate("/(tabs)/profile")}
            style={[ss.avatar, {
              backgroundColor: colors.accent + "22",
              borderColor: colors.accent + "60",
            }]}
          >
            {profile?.avatarUri
              ? <Image source={{ uri: profile.avatarUri }} style={ss.avatarImg} />
              : <Text style={[ss.avatarInitial, { color: colors.accentLight }]}>
                  {(profile?.name ?? "U").charAt(0).toUpperCase()}
                </Text>
            }
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={ss.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
            tintColor={colors.accentLight} colors={[colors.accentLight]} />
        }
      >
        {/* ── Portfolio Hero Card ──────────────────────────────────────────── */}
        <TouchableOpacity
          activeOpacity={0.92}
          onPress={() => router.navigate("/(tabs)/portfolio")}
          style={[ss.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={ss.heroTop}>
            <View>
              <Text style={[ss.heroLabel, { color: colors.textMuted }]}>Mi Portafolio</Text>
              {loading
                ? <Skeleton w={160} h={36} r={8} />
                : <Text style={[ss.heroBalance, { color: colors.text }]}>
                    {fmt(total, portfolioCurrency)}
                  </Text>
              }
            </View>
            <View style={[ss.heroGainBadge, {
              backgroundColor: dayGain >= 0 ? colors.up + "18" : colors.down + "18",
            }]}>
              <Ionicons
                name={dayGain >= 0 ? "trending-up" : "trending-down"}
                size={14}
                color={dayGain >= 0 ? colors.up : colors.down}
              />
              {loading
                ? <Skeleton w={60} h={14} r={4} />
                : <Text style={[ss.heroGainText, { color: dayGain >= 0 ? colors.up : colors.down }]}>
                    {fmtPct(dayGainPct)} hoy
                  </Text>
              }
            </View>
          </View>

          {!loading && (
            <View style={ss.heroStats}>
              <View style={ss.heroStat}>
                <Text style={[ss.heroStatLabel, { color: colors.textMuted }]}>Ganancia total</Text>
                <Text style={[ss.heroStatVal, { color: totalGain >= 0 ? colors.up : colors.down }]}>
                  {totalGain >= 0 ? "+" : ""}{fmt(totalGain, portfolioCurrency)} ({fmtPct(totalGainPct)})
                </Text>
              </View>
              <View style={[ss.heroDivider, { backgroundColor: colors.border }]} />
              <View style={ss.heroStat}>
                <Text style={[ss.heroStatLabel, { color: colors.textMuted }]}>Posiciones</Text>
                <Text style={[ss.heroStatVal, { color: colors.text }]}>{positions.length}</Text>
              </View>
            </View>
          )}

          {!positions.length && !loading && (
            <View style={[ss.emptyPortfolio, { borderColor: colors.border }]}>
              <Text style={[ss.emptyPortfolioText, { color: colors.textMuted }]}>
                Empieza agregando acciones:
              </Text>
              <View style={ss.popularRow}>
                {["AAPL", "NVDA", "MSFT", "TSLA", "GOOGL"].map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => router.navigate("/(tabs)/portfolio")}
                    style={[ss.popularChip, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}
                  >
                    <Text style={[ss.popularChipText, { color: colors.accentLight }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Chevron hint */}
          <View style={ss.heroChevron}>
            <Ionicons name="chevron-forward" size={14} color={colors.textDim} />
          </View>
        </TouchableOpacity>

        {/* ── Stat Strip ───────────────────────────────────────────────────── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, gap: 8, flexDirection: "row" }}>
          <TouchableOpacity activeOpacity={0.8}
            onPress={() => router.navigate("/(tabs)/patrimonio")}
            style={[ss.statChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name={dayGain >= 0 ? "trending-up" : "trending-down"} size={16}
              color={dayGain >= 0 ? colors.up : colors.down} />
            <View>
              <Text style={{ fontSize: 13, fontWeight: "800", color: dayGain >= 0 ? colors.up : colors.down }}>
                {fmtPct(dayGainPct)}
              </Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>Portafolio hoy</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.8}
            onPress={() => router.navigate("/(tabs)/academy")}
            style={[ss.statChip, { backgroundColor: colors.card, borderColor: streak > 0 ? "#f59e0b50" : colors.border }]}>
            <Text style={{ fontSize: 18 }}>{streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "✨"}</Text>
            <View>
              <Text style={{ fontSize: 13, fontWeight: "800", color: streak > 0 ? "#f59e0b" : colors.text }}>
                {streak} días
              </Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>Racha</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.8}
            onPress={() => router.navigate("/(tabs)/profile")}
            style={[ss.statChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 18 }}>🎯</Text>
            <View>
              <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }} numberOfLines={1}>
                {goalName ?? "Sin meta"}
              </Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>Meta</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.8}
            onPress={() => router.navigate("/(tabs)/notifications")}
            style={[ss.statChip, { backgroundColor: colors.card, borderColor: unread > 0 ? "#ef444450" : colors.border }]}>
            <Ionicons name="notifications-outline" size={16} color={unread > 0 ? "#ef4444" : colors.textSub} />
            <View>
              <Text style={{ fontSize: 13, fontWeight: "800", color: unread > 0 ? "#ef4444" : colors.text }}>
                {unread > 0 ? `${unread} nuevas` : "Sin alertas"}
              </Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>Alertas</Text>
            </View>
          </TouchableOpacity>
        </ScrollView>

        {/* ── Índices de mercado ───────────────────────────────────────────── */}
        {indices.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, gap: 8, flexDirection: "row" }}
          >
            {indices.map((idx) => {
              const up = idx.change_pct >= 0;
              return (
                <View key={idx.symbol}
                  style={[ss.idxChip, {
                    backgroundColor: colors.card,
                    borderColor: up ? colors.up + "40" : colors.down + "40",
                  }]}
                >
                  <Text style={[ss.idxName, { color: colors.textSub }]}>{idx.name}</Text>
                  {idx.price != null && (
                    <Text style={[ss.idxPrice, { color: colors.text }]}>
                      {idx.price >= 1000 ? (idx.price / 1000).toFixed(1) + "K" : idx.price.toFixed(2)}
                    </Text>
                  )}
                  <Text style={[ss.idxChange, { color: up ? colors.up : colors.down }]}>
                    {up ? "+" : ""}{idx.change_pct.toFixed(2)}%
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* ── Lección recomendada ──────────────────────────────────────────── */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => router.navigate("/(tabs)/academy")}
          style={[ss.lessonCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[ss.lessonIcon, { backgroundColor: "#7c3aed18" }]}>
            <Text style={{ fontSize: 22 }}>{dailyLesson.emoji}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.textMuted, marginBottom: 2 }}>
              Lección del día
            </Text>
            <Text style={{ fontSize: 15, fontWeight: "800", color: colors.text }}>{dailyLesson.title}</Text>
          </View>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.accentLight }}>→</Text>
        </TouchableOpacity>

        {/* ── Quick Actions ────────────────────────────────────────────────── */}
        <View style={ss.actions}>
          <ActionChip icon="chatbubble-ellipses-outline" label="Mentor IA"
            onPress={() => router.navigate("/(tabs)/chat")} accent colors={colors} />
          <ActionChip icon="wallet-outline" label="Patrimonio"
            onPress={() => router.navigate("/(tabs)/patrimonio")} colors={colors} />
          <ActionChip icon="school-outline" label="Academy"
            onPress={() => router.navigate("/(tabs)/academy")} colors={colors} />
          <ActionChip icon="search-outline" label="Screener"
            onPress={() => router.navigate("/(tabs)/explore")} colors={colors} />
        </View>

        {/* ── Top Movers ───────────────────────────────────────────────────── */}
        {positions.length > 0 && (
          <View style={ss.section}>
            <View style={ss.sectionHeader}>
              <Text style={[ss.sectionTitle, { color: colors.text }]}>Hoy en tu portafolio</Text>
              <TouchableOpacity onPress={() => router.navigate("/(tabs)/portfolio")}>
                <Text style={[ss.sectionLink, { color: colors.accentLight }]}>Ver todo →</Text>
              </TouchableOpacity>
            </View>
            <View style={[ss.moversCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {loading
                ? [0,1,2].map((i) => (
                    <View key={i} style={[ss.moverRow, i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                      <Skeleton w={36} h={36} r={10} />
                      <View style={{ flex: 1, gap: 6 }}>
                        <Skeleton w={60} h={13} />
                        <Skeleton w={100} h={11} />
                      </View>
                      <Skeleton w={50} h={20} r={6} />
                    </View>
                  ))
                : movers.map((m, i) => (
                    <View key={m.ticker}
                      style={[ss.moverRow,
                        i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }
                      ]}
                    >
                      <StockAvatar ticker={m.ticker} size={38} />
                      <View style={{ flex: 1 }}>
                        <Text style={[ss.moverTicker, { color: colors.text }]}>{m.ticker}</Text>
                        <Text style={[ss.moverName, { color: colors.textMuted }]}
                          numberOfLines={1}>{m.name ?? m.ticker}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[ss.moverPrice, { color: colors.text }]}>{sym}{m.curr.toFixed(2)}</Text>
                        <View style={[ss.moverBadge, { backgroundColor: m.chg >= 0 ? colors.up + "18" : colors.down + "18" }]}>
                          <Text style={[ss.moverBadgeText, { color: m.chg >= 0 ? colors.up : colors.down }]}>
                            {fmtPct(m.chg)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))
              }
            </View>
          </View>
        )}

        {/* ── Lo más importante hoy ────────────────────────────────────────── */}
        {topNotifs.length > 0 && (
          <View style={ss.section}>
            <View style={ss.sectionHeader}>
              <Text style={[ss.sectionTitle, { color: colors.text }]}>Lo más importante hoy</Text>
              <TouchableOpacity onPress={() => router.navigate("/(tabs)/notifications")}>
                <Text style={[ss.sectionLink, { color: colors.accentLight }]}>Ver todo →</Text>
              </TouchableOpacity>
            </View>
            <View style={[ss.moversCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {topNotifs.map((n: any, i: number) => {
                const icon =
                  n.type === "price_alert" ? "📈" :
                  n.type === "earnings"    ? "📊" :
                  n.type === "news"        ? "📰" :
                  n.type === "portfolio"   ? "💼" : "🔔";
                return (
                  <TouchableOpacity key={n.id ?? i}
                    activeOpacity={0.8}
                    onPress={() => router.navigate("/(tabs)/notifications")}
                    style={[ss.moverRow, i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                    <View style={[ss.lessonIcon, { backgroundColor: colors.bgRaised }]}>
                      <Text style={{ fontSize: 18 }}>{icon}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}
                            numberOfLines={1}>{n.title}</Text>
                      {n.body && (
                        <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}
                              numberOfLines={2}>{n.body}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Streak + Madurez ─────────────────────────────────────────────── */}
        <View style={ss.statsRow}>
          {/* Racha */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.navigate("/(tabs)/learn")}
            style={[ss.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <StreakRing streak={streak} />
            <Text style={[ss.statCardTitle, { color: colors.text }]}>Racha</Text>
            <Text style={[ss.statCardSub, { color: colors.textMuted }]}>
              {streak === 0 ? "¡Empieza hoy!" : streak === 1 ? "1 día seguido" : `${streak} días seguidos`}
            </Text>
          </TouchableOpacity>

          {/* Madurez */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.navigate("/(tabs)/profile")}
            style={[ss.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[ss.maturityRing, {
              borderColor: maturity >= 70 ? colors.up : maturity >= 40 ? "#f59e0b" : colors.info,
            }]}>
              <Text style={[ss.maturityScore, {
                color: maturity >= 70 ? colors.up : maturity >= 40 ? "#f59e0b" : colors.info,
              }]}>{maturity}</Text>
            </View>
            <Text style={[ss.statCardTitle, { color: colors.text }]}>Madurez</Text>
            <Text style={[ss.statCardSub, { color: colors.textMuted }]}>
              {maturity >= 70 ? "Inversor maduro" : maturity >= 40 ? "En progreso" : "Desarrollando"}
            </Text>
          </TouchableOpacity>

          {/* Premium CTA o Learn CTA */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => !isPremium
              ? router.navigate("/(tabs)/profile")
              : router.navigate("/(tabs)/learn")
            }
            style={[ss.statCard, {
              backgroundColor: !isPremium ? "#7c3aed18" : colors.card,
              borderColor: !isPremium ? "#7c3aed50" : colors.border,
            }]}
          >
            <View style={[ss.maturityRing, { borderColor: !isPremium ? "#7c3aed" : colors.accentLight }]}>
              <Ionicons
                name={!isPremium ? "diamond-outline" : "school-outline"}
                size={20}
                color={!isPremium ? "#a78bfa" : colors.accentLight}
              />
            </View>
            <Text style={[ss.statCardTitle, { color: colors.text }]}>
              {!isPremium ? "Premium" : "Aprender"}
            </Text>
            <Text style={[ss.statCardSub, { color: !isPremium ? "#a78bfa" : colors.textMuted }]}>
              {!isPremium ? "Desbloquear" : "Ver lecciones"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Portfolio News ───────────────────────────────────────────────── */}
        {news.length > 0 && (
          <View style={ss.section}>
            <View style={ss.sectionHeader}>
              <Text style={[ss.sectionTitle, { color: colors.text }]}>Noticias de tu portafolio</Text>
              <TouchableOpacity onPress={() => router.navigate("/(tabs)/notifications")}>
                <Text style={[ss.sectionLink, { color: colors.accentLight }]}>Ver más →</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ss.newsScroll}>
              {news.map((item: any, i: number) => (
                <View key={i} style={[ss.newsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {item.thumbnail_url || item.thumbnail ? (
                    <Image
                      source={{ uri: item.thumbnail_url ?? item.thumbnail }}
                      style={ss.newsThumb}
                    />
                  ) : (
                    <View style={[ss.newsThumb, { backgroundColor: colors.bgRaised, alignItems: "center", justifyContent: "center" }]}>
                      <Ionicons name="newspaper-outline" size={24} color={colors.textDim} />
                    </View>
                  )}
                  <View style={ss.newsBody}>
                    <Text style={[ss.newsTicker, { color: colors.accentLight }]}>
                      {item.ticker ?? ""}
                    </Text>
                    <Text style={[ss.newsTitle, { color: colors.text }]} numberOfLines={3}>
                      {item.title}
                    </Text>
                    <Text style={[ss.newsPublisher, { color: colors.textMuted }]} numberOfLines={1}>
                      {item.publisher ?? item.source}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── AI Insight CTA ───────────────────────────────────────────────── */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => router.navigate("/(tabs)/chat")}
          style={[ss.insightCard, { backgroundColor: colors.accent + "12", borderColor: colors.accent + "40" }]}
        >
          <View style={[ss.insightIcon, { backgroundColor: colors.accent + "20" }]}>
            <Ionicons name="sparkles" size={22} color={colors.accentLight} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[ss.insightTitle, { color: colors.text }]}>Pregúntale a la IA</Text>
            <Text style={[ss.insightSub, { color: colors.textMuted }]}>
              {positions.length
                ? `Analiza tus ${positions.length} posiciones o pide consejo de inversión`
                : "Chatea sobre inversiones, acciones o estrategias"
              }
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  greeting: { fontSize: 13, fontWeight: "500" },
  name:     { fontSize: 20, fontWeight: "800", letterSpacing: -0.4, marginTop: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  badge: {
    position: "absolute", top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },

  // Market status dot
  marketDotWrap: { flexDirection: "row", alignItems: "center", gap: 5 },
  marketDot: { width: 7, height: 7, borderRadius: 4 },
  marketDotLabel: { fontSize: 11, fontWeight: "600" },

  // Index chips
  idxChip: {
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 9, gap: 2,
    alignItems: "center", minWidth: 78,
  },
  idxName:   { fontSize: 10, fontWeight: "500" },
  idxPrice:  { fontSize: 13, fontWeight: "700" },
  idxChange: { fontSize: 11, fontWeight: "600" },

  avatar: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  avatarImg:     { width: 38, height: 38, borderRadius: 19 },
  avatarInitial: { fontSize: 16, fontWeight: "800" },

  scroll: { paddingBottom: 24 },

  // Hero card
  heroCard: {
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 20, borderWidth: 1,
    padding: 20,
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroLabel:    { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  heroBalance:  { fontSize: 34, fontWeight: "800", letterSpacing: -1 },
  heroGainBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
  },
  heroGainText: { fontSize: 13, fontWeight: "700" },
  heroStats: { flexDirection: "row", marginTop: 16, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#162035" },
  heroStat:      { flex: 1 },
  heroStatLabel: { fontSize: 11, fontWeight: "500", marginBottom: 3 },
  heroStatVal:   { fontSize: 14, fontWeight: "700" },
  heroDivider:   { width: 1, marginHorizontal: 16 },
  heroChevron:   { position: "absolute", right: 14, top: "50%" },
  emptyPortfolio: {
    marginTop: 12, paddingVertical: 14, paddingHorizontal: 14,
    borderRadius: 12, borderWidth: 1, borderStyle: "dashed",
  },
  emptyPortfolioText: { fontSize: 12, fontWeight: "500", marginBottom: 10 },
  popularRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  popularChip: {
    borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 11, paddingVertical: 5,
  },
  popularChipText: { fontSize: 12, fontWeight: "700" },

  // Quick actions
  actions: {
    flexDirection: "row", paddingHorizontal: 16, marginTop: 14, gap: 8, flexWrap: "wrap",
  },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: 12, borderWidth: 1,
  },
  chipLabel: { fontSize: 13, fontWeight: "600" },

  // Sections
  section:       { marginTop: 24 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, marginBottom: 12 },
  sectionTitle:  { fontSize: 16, fontWeight: "700", letterSpacing: -0.3 },
  sectionLink:   { fontSize: 13, fontWeight: "600" },

  // Movers card
  moversCard: { marginHorizontal: 16, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  moverRow:   { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  moverDot:   { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  moverDotText:    { fontSize: 12, fontWeight: "800", color: "#fff" },
  moverTicker:     { fontSize: 14, fontWeight: "700" },
  moverName:       { fontSize: 12, fontWeight: "400", marginTop: 1 },
  moverPrice:      { fontSize: 14, fontWeight: "600" },
  moverBadge:      { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, marginTop: 3 },
  moverBadgeText:  { fontSize: 11, fontWeight: "700" },

  // Stats row
  statsRow: { flexDirection: "row", paddingHorizontal: 16, marginTop: 24, gap: 10 },
  statCard: {
    flex: 1, borderRadius: 16, borderWidth: 1,
    alignItems: "center", paddingVertical: 16, paddingHorizontal: 8, gap: 6,
  },
  statCardTitle: { fontSize: 13, fontWeight: "700", textAlign: "center" },
  statCardSub:   { fontSize: 10, fontWeight: "500", textAlign: "center" },

  // Streak ring
  streakRing: {
    width: 52, height: 52, borderRadius: 26, borderWidth: 2,
    alignItems: "center", justifyContent: "center", gap: 0,
  },
  streakEmoji: { fontSize: 18, lineHeight: 22 },
  streakNum:   { fontSize: 14, fontWeight: "800", lineHeight: 18 },
  streakLabel: { fontSize: 9, fontWeight: "600" },

  // Maturity ring
  maturityRing: {
    width: 52, height: 52, borderRadius: 26, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  maturityScore: { fontSize: 18, fontWeight: "800" },

  // News
  newsScroll: { paddingLeft: 16 },
  newsCard: {
    width: W * 0.62, borderRadius: 16, borderWidth: 1,
    marginRight: 10, overflow: "hidden",
  },
  newsThumb:     { width: "100%", height: 110 },
  newsBody:      { padding: 12 },
  newsTicker:    { fontSize: 11, fontWeight: "700", marginBottom: 4 },
  newsTitle:     { fontSize: 13, fontWeight: "600", lineHeight: 18, marginBottom: 6 },
  newsPublisher: { fontSize: 11, fontWeight: "400" },

  // Insight CTA
  insightCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, marginTop: 24,
    borderRadius: 16, borderWidth: 1, padding: 16,
  },
  insightIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  insightTitle: { fontSize: 15, fontWeight: "700", marginBottom: 3 },
  insightSub:   { fontSize: 12, fontWeight: "400", lineHeight: 17 },

  // Stat strip chips
  statChip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1, minWidth: 110,
  },

  // Lesson card
  lessonCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, marginTop: 14,
    borderRadius: 16, borderWidth: 1, padding: 14,
  },
  lessonIcon: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
});
