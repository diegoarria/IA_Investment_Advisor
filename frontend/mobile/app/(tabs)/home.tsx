import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Image, RefreshControl, Animated, Dimensions,
  Modal, Pressable, ActivityIndicator, Linking, TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path, Defs, LinearGradient, Stop } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useTheme } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";
import { profileApi, syncApi } from "../../src/lib/api";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import { useLearnStore } from "../../src/lib/learnStore";
import { useSubscriptionStore } from "../../src/lib/subscriptionStore";
import { hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { marketApi, notificationsApi } from "../../src/lib/api";
import { useChatStore } from "../../src/lib/chatStore";
import { useWatchlistStore } from "../../src/lib/watchlistStore";
import StockAvatar from "../../src/components/StockAvatar";
import MobileOnboardingChecklist, { type OnboardingStep } from "../../src/components/MobileOnboardingChecklist";
import MobileHomeScreenPickerModal, { HOME_SCREEN_KEY } from "../../src/components/MobileHomeScreenPickerModal";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// ── Sparkline helpers ─────────────────────────────────────────────────────────
function sparkPath(prices: number[], w: number, h: number, close = false): string {
  if (prices.length < 2) return "";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const rng = max - min || 1;
  const pad = 1.5;
  const pts = prices.map((p, i) => {
    const x = pad + (i / (prices.length - 1)) * (w - pad * 2);
    const y = pad + (h - pad * 2) - ((p - min) / rng) * (h - pad * 2);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line = pts.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt}`).join(" ");
  return close ? `${line} L ${(w - pad).toFixed(1)} ${h} L ${pad.toFixed(1)} ${h} Z` : line;
}

function Sparkline({ prices, color, width = 72, height = 32 }: {
  prices: number[]; color: string; width?: number; height?: number;
}) {
  const gradId = `g${color.replace("#","")}`;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0"   stopColor={color} stopOpacity="0.28" />
          <Stop offset="1"   stopColor={color} stopOpacity="0"    />
        </LinearGradient>
      </Defs>
      <Path d={sparkPath(prices, width, height, true)} fill={`url(#${gradId})`} />
      <Path d={sparkPath(prices, width, height)} stroke={color} strokeWidth="1.6"
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ── Index detail modal ────────────────────────────────────────────────────────
interface IdxData { name: string; symbol: string; price: number | null; change: number; change_pct: number; }
interface NewsItem { uuid: string; title: string; publisher: string; url: string; timestamp: number; thumbnail: string | null; }

const SHORT: Record<string, string> = {
  "^GSPC": "S&P 500", "^IXIC": "Nasdaq", "^DJI": "Dow Jones", "^RUT": "Russell", "^VIX": "VIX",
};

function relTime(ts: number): string {
  const h = Math.floor((Date.now() / 1000 - ts) / 3600);
  if (h < 1) return "Ahora";
  if (h === 1) return "Hace 1h";
  if (h < 24) return `Hace ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Ayer" : `Hace ${d}d`;
}

const IDX_PERIODS: { key: string; label: string }[] = [
  { key: "1d",  label: "1D"  },
  { key: "5d",  label: "5D"  },
  { key: "6m",  label: "6M"  },
  { key: "ytd", label: "YTD" },
  { key: "1y",  label: "1A"  },
  { key: "5y",  label: "5A"  },
  { key: "max", label: "MÁX" },
];

function calcReturn(prices: number[]): number | null {
  if (prices.length < 2 || prices[0] === 0) return null;
  return ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
}

function IndexDetailModal({ idx, chartPrices, onClose, colors }: {
  idx: IdxData; chartPrices: number[]; onClose: () => void; colors: any;
}) {
  const [period, setPeriod] = useState("1d");
  const [periodPrices, setPeriodPrices] = useState(chartPrices);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [news, setNews]     = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const priceCache = useRef<Record<string, number[]>>({ "1d": chartPrices });

  useEffect(() => {
    marketApi.getIndexNews(idx.symbol)
      .then((res: any) => setNews((res.data ?? []).slice(0, 3)))
      .catch(() => {})
      .finally(() => setNewsLoading(false));
  }, [idx.symbol]);

  const loadPeriod = async (p: string) => {
    setPeriod(p);
    if (priceCache.current[p]) { setPeriodPrices(priceCache.current[p]); return; }
    setPeriodLoading(true);
    try {
      const res: any = await marketApi.getChart(idx.symbol, p);
      const prices: number[] = res?.data?.prices ?? [];
      priceCache.current[p] = prices;
      setPeriodPrices(prices);
    } catch {}
    setPeriodLoading(false);
  };

  const isHistorical = period !== "1d" && period !== "5d";
  const periodReturn  = isHistorical ? calcReturn(periodPrices) : null;
  const displayPct    = periodReturn ?? idx.change_pct;
  const up   = displayPct >= 0;
  const col  = up ? "#22c55e" : "#ef4444";
  const CHDIMS = { w: W - 80, h: 140 };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={idxMStyles.overlay} onPress={onClose}>
        <Pressable style={[idxMStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                   onPress={(e) => e.stopPropagation()}>

          {/* Header */}
          <View style={idxMStyles.header}>
            <View>
              <Text style={[idxMStyles.name, { color: colors.text }]}>
                {SHORT[idx.symbol] ?? idx.name}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}>
                <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>
                  {idx.price != null
                    ? idx.symbol === "^VIX"
                      ? idx.price.toFixed(2)
                      : idx.price >= 10000
                        ? idx.price.toLocaleString("en-US", { maximumFractionDigits: 0 })
                        : idx.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : "—"}
                </Text>
                <View style={[idxMStyles.changePill, { backgroundColor: col + "18" }]}>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: col }}>
                    {up ? "▲" : "▼"} {Math.abs(displayPct).toFixed(2)}%
                  </Text>
                </View>
                {isHistorical && (
                  <Text style={{ fontSize: 10, color: colors.textDim, fontWeight: "600" }}>
                    {IDX_PERIODS.find(p => p.key === period)?.label}
                  </Text>
                )}
              </View>
              {isHistorical && (
                <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 3 }}>
                  Hoy:{" "}
                  <Text style={{ color: idx.change_pct >= 0 ? "#22c55e" : "#ef4444", fontWeight: "700" }}>
                    {idx.change_pct >= 0 ? "+" : ""}{idx.change_pct.toFixed(2)}%
                  </Text>
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Period selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
                      contentContainerStyle={idxMStyles.periods}>
            {IDX_PERIODS.map(({ key, label }) => (
              <TouchableOpacity key={key} onPress={() => loadPeriod(key)}
                                style={[idxMStyles.periodBtn,
                                        period === key && { backgroundColor: col + "22", borderColor: col + "60" }]}>
                <Text style={{ fontSize: 11, fontWeight: "700",
                               color: period === key ? col : colors.textMuted }}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Chart */}
          <View style={{ alignItems: "center", paddingVertical: 8, paddingHorizontal: 20 }}>
            {periodLoading ? (
              <View style={{ width: CHDIMS.w, height: CHDIMS.h, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator color={col} />
              </View>
            ) : periodPrices.length > 1 ? (
              <Sparkline prices={periodPrices} color={col} width={CHDIMS.w} height={CHDIMS.h} />
            ) : (
              <View style={{ width: CHDIMS.w, height: CHDIMS.h, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: colors.textDim, fontSize: 12 }}>Sin datos</Text>
              </View>
            )}
          </View>

          {/* Divider */}
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 20 }} />

          {/* News */}
          <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.textMuted,
                           letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 }}>
              Noticias
            </Text>
            {newsLoading ? (
              <ActivityIndicator color={colors.accentLight} style={{ marginTop: 8 }} />
            ) : news.length === 0 ? (
              <Text style={{ color: colors.textDim, fontSize: 12 }}>Sin noticias disponibles</Text>
            ) : (
              news.map((item, i) => (
                <TouchableOpacity key={item.uuid || i} onPress={() => Linking.openURL(item.url)}
                                  activeOpacity={0.75}
                                  style={[idxMStyles.newsRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                      <Text style={{ fontSize: 12, fontWeight: "800", color: colors.accentLight, flexShrink: 0 }}>{i + 1}.</Text>
                      <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: colors.text, lineHeight: 18 }} numberOfLines={2}>
                        {item.title}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 4 }}>
                      {item.publisher} · {relTime(item.timestamp)}
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: colors.accentLight, marginTop: 4 }}>
                      Leer artículo →
                    </Text>
                  </View>
                  {item.thumbnail && (
                    <Image source={{ uri: item.thumbnail }} style={idxMStyles.thumb} resizeMode="cover" />
                  )}
                </TouchableOpacity>
              ))
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const idxMStyles = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  card:       { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden",
                maxHeight: "88%", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  header:     { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between",
                paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  name:       { fontSize: 13, fontWeight: "600", letterSpacing: 0.3, textTransform: "uppercase", opacity: 0.6 },
  changePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  periods:    { flexDirection: "row", gap: 6, paddingHorizontal: 20, marginBottom: 4 },
  periodBtn:  { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  newsRow:    { flexDirection: "row", gap: 12, paddingVertical: 12, alignItems: "flex-start" },
  thumb:      { width: 72, height: 56, borderRadius: 10, flexShrink: 0 },
});

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
  const profile    = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);
  const maturity   = useAppStore((s) => s.maturityScore);
  const streak         = useLearnStore((s) => s.streak);
  const completedToday = useLearnStore((s) => s.completedToday);
  const { positions, portfolioCurrency } = usePortfolioStore();
  const hasChatted = useChatStore((s) => s.sessions.some((sess) => sess.messages.length > 0));
  const watchlistItems = useWatchlistStore((s) => s.items);
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);

  const [prices,     setPrices]    = useState<Record<string, any>>({});
  const [news,       setNews]      = useState<any[]>([]);
  const [indices,    setIndices]       = useState<any[]>([]);
  const [indexCharts, setIndexCharts]     = useState<Record<string, number[]>>({});
  const [selectedIdx, setSelectedIdx]     = useState<IdxData | null>(null);
  const [idxRefresh,  setIdxRefresh]      = useState<Date | null>(null);
  const [unread,      setUnread]     = useState(0);
  const [totalNotifs, setTotalNotifs] = useState(0);
  const [topNotifs,   setTopNotifs]  = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading,    setLoading]   = useState(true);
  const [ytdGain,    setYtdGain]   = useState<number | null>(null);
  const [ytdPct,     setYtdPct]    = useState<number | null>(null);
  const BROKER_PREVIEW_UID = "86961402-9072-4670-9f73-b2aa91930b04";
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showScreenPicker, setShowScreenPicker] = useState(false);
  const [showBrokerModal, setShowBrokerModal] = useState(false);
  const [showBrokerUpsell, setShowBrokerUpsell] = useState(false);
  const [brokerCountry, setBrokerCountry] = useState<{ label: string; items: string[] }>({ label: "Internacional", items: ["Interactive Brokers"] });
  const [upsellCountdown, setUpsellCountdown] = useState<number | null>(null);
  const upsellTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const BROKER_MAP: Record<string, { label: string; items: string[] }> = {
    MX: { label: "México",         items: ["GBM+", "Actinver", "Interactive Brokers México"] },
    AR: { label: "Argentina",      items: ["Invertir Online (IOL)", "Balanz"] },
    US: { label: "Estados Unidos", items: ["Interactive Brokers", "Robinhood", "Charles Schwab"] },
    CO: { label: "Colombia",       items: ["Acciones & Valores", "Davivienda Corredores", "Interactive Brokers"] },
    VE: { label: "Venezuela",      items: ["Interactive Brokers", "Charles Schwab"] },
    CL: { label: "Chile",          items: ["Fintual", "Banchile Inversiones", "Interactive Brokers"] },
    PE: { label: "Perú",           items: ["Credicorp Capital", "Renta 4", "Interactive Brokers"] },
    BR: { label: "Brasil",         items: ["XP Investimentos", "BTG Pactual", "Interactive Brokers"] },
  };

  const openBrokerModal = () => {
    fetch("https://ipapi.co/json/")
      .then(r => r.json())
      .then(d => { setBrokerCountry(BROKER_MAP[d.country_code] ?? { label: "Internacional", items: ["Interactive Brokers"] }); })
      .catch(() => {});
    setShowBrokerModal(true);
  };

  const startUpsellCountdown = async () => {
    const DURATION = 24 * 60 * 60 * 1000;
    let seenAt = await AsyncStorage.getItem("nuvos_broker_upsell_seen_at");
    if (!seenAt) {
      seenAt = String(Date.now());
      await AsyncStorage.setItem("nuvos_broker_upsell_seen_at", seenAt);
    }
    const tick = () => {
      const remaining = DURATION - (Date.now() - Number(seenAt));
      setUpsellCountdown(remaining > 0 ? remaining : 0);
    };
    tick();
    upsellTimerRef.current = setInterval(tick, 1000);
  };

  const fmtCountdown = (ms: number) => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  };

  useEffect(() => {
    SecureStore.getItemAsync("user_id").then(id => { if (id) setCurrentUserId(id); });
  }, []);

  useEffect(() => {
    if (!showBrokerUpsell) return;
    startUpsellCountdown();
    return () => { if (upsellTimerRef.current) clearInterval(upsellTimerRef.current); };
  }, [showBrokerUpsell]);
  const [goalDraft,     setGoalDraft]     = useState("");
  const [goalAmtDraft,  setGoalAmtDraft]  = useState("");
  const [savingGoal,    setSavingGoal]    = useState(false);
  const [goalError,     setGoalError]     = useState("");

  const DAILY_LESSONS = [
    { emoji: "🥧", title: "Diversificación",       topicId: "diversif"  },
    { emoji: "📅", title: "Dollar Cost Averaging",  topicId: "dca"       },
    { emoji: "💰", title: "Dividendos",             topicId: "dividendo" },
    { emoji: "📈", title: "Análisis Fundamental",   topicId: "fund"      },
    { emoji: "🛡️", title: "Ventaja Competitiva",   topicId: "moat"      },
    { emoji: "⚠️", title: "Aversión a la Pérdida", topicId: "aversion"  },
    { emoji: "🔄", title: "Rebalanceo",             topicId: "rebalanceo"},
  ];
  const dailyLesson = DAILY_LESSONS[new Date().getDay() % DAILY_LESSONS.length];

  const goalName   = profile?.investment_goal ?? null;
  const goalAmount = parseFloat((profile as any)?.investment_goal_amount ?? "0") || 0;

  const yearsToGoal = React.useMemo(() => {
    const pmt = parseFloat(profile?.monthly_contribution ?? "0") || 0;
    if (pmt <= 0 || goalAmount <= 0) return null;
    const rate = profile?.risk_tolerance === "aggressive" ? 0.12 : profile?.risk_tolerance === "conservative" ? 0.07 : 0.10;
    const r = rate / 12;
    const n = Math.log(1 + (goalAmount * r) / pmt) / Math.log(1 + r);
    if (!isFinite(n) || n <= 0) return null;
    const yrs = Math.ceil(n / 12);
    return yrs;
  }, [profile?.monthly_contribution, goalAmount, profile?.risk_tolerance]);

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

  // ── Top gainers today (positive movers only, sorted best first, max 4) ──────
  const movers = React.useMemo(() => {
    return [...positions]
      .map((p) => {
        const px  = prices[p.ticker];
        const curr = px?.price ?? p.avgPrice;
        const chg  = px?.change_pct ?? 0;
        return { ...p, curr, chg };
      })
      .filter((m) => m.chg > 0)
      .sort((a, b) => b.chg - a.chg)
      .slice(0, 4);
  }, [positions, prices]);

  // ── Top losers (only negative, sorted worst first, max 4) ─────────────────
  const losers = React.useMemo(() => {
    return [...positions]
      .map((p) => {
        const px   = prices[p.ticker];
        const curr = px?.price ?? p.avgPrice;
        const chg  = px?.change_pct ?? 0;
        return { ...p, curr, chg };
      })
      .filter((m) => m.chg < 0)
      .sort((a, b) => a.chg - b.chg)
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
        setTotalNotifs(items.length);
        setTopNotifs(items.slice(0, 2));
      }
      if (idxRes.status === "fulfilled") {
        const idxData: IdxData[] = idxRes.value.data ?? [];
        setIndices(idxData);
        setIdxRefresh(new Date());
        // Fetch 1D sparklines in background — no await, fire and forget
        idxData.forEach((idx: IdxData) => {
          marketApi.getChart(idx.symbol, "1d").then((res: any) => {
            const prices: number[] = res?.data?.prices ?? [];
            if (prices.length > 1) setIndexCharts(prev => ({ ...prev, [idx.symbol]: prices }));
          }).catch(() => {});
        });
      }

      // News + YTD only when we have positions
      if (tickers.length) {
        const newsRes = await marketApi.getNews(tickers.slice(0, 6)).catch(() => null);
        if (newsRes) setNews((newsRes.data?.articles ?? newsRes.data?.news ?? []).slice(0, 6));

        marketApi.getPortfolioChart(
          positions.map((p) => ({ ticker: p.ticker, shares: p.shares, avg_price: p.avgPrice })),
          "ytd"
        ).then((res: any) => {
          if (res?.data) {
            setYtdGain(res.data.period_amount ?? null);
            setYtdPct(res.data.period_pct ?? null);
          }
        }).catch(() => {});
      }
    } catch {}
    // Full sync from server: maturity + investment goal
    syncApi.getAll().then((res: any) => {
      const d = res.data;
      // Maturity — bidirectional, keep highest
      const serverScore: number = d?.maturity?.score ?? 0;
      const serverHistory = d?.maturity?.history ?? [];
      const { maturityScore: localScore, maturityHistory: localHistory, profile } = useAppStore.getState();
      if (serverScore > localScore) {
        useAppStore.setState({ maturityScore: serverScore, maturityHistory: serverHistory });
      } else if (localScore > serverScore) {
        syncApi.pushMaturity(localScore, localHistory).catch(() => {});
      }
      // Investment goal — server is always source of truth
      if (profile && (d?.investment_goal !== undefined)) {
        useAppStore.setState({
          profile: {
            ...profile,
            investment_goal: d.investment_goal ?? profile.investment_goal,
            investment_goal_amount: d.investment_goal_amount ?? profile.investment_goal_amount,
          },
        });
      }
    }).catch(() => {});
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
        .then((res: any) => { if (res?.data) { setIndices(res.data ?? []); setIdxRefresh(new Date()); } })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [loadData, positions])); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const GOAL_OPTIONS = [
    { key: "house",             label: "Comprar una casa",         emoji: "🏠" },
    { key: "car",               label: "Comprar un carro",         emoji: "🚗" },
    { key: "passive_income",    label: "Vivir de inversiones",     emoji: "💸" },
    { key: "retirement",        label: "Retiro / pensión",         emoji: "👴" },
    { key: "financial_freedom", label: "Libertad financiera",      emoji: "🦅" },
    { key: "long_term_wealth",  label: "Patrimonio a largo plazo", emoji: "🏛️" },
  ];

  const openGoalModal = () => {
    setGoalDraft(profile?.investment_goal ?? "");
    setGoalAmtDraft((profile as any)?.investment_goal_amount ?? "");
    setShowGoalModal(true);
  };

  const saveGoal = async () => {
    if (!goalDraft) return;
    setSavingGoal(true);
    setGoalError("");
    try {
      await profileApi.update({ investment_goal: goalDraft, investment_goal_amount: goalAmtDraft || null });
      const fresh = await profileApi.get();
      if (fresh?.data) setProfile(fresh.data);
      setShowGoalModal(false);
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? err?.message ?? "Error al guardar";
      setGoalError(msg);
      console.error("saveGoal error:", err?.response ?? err);
    }
    setSavingGoal(false);
  };

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

  // ── Onboarding checklist ──────────────────────────────────────────────────
  const onboardingSteps: OnboardingStep[] = [
    { emoji: "💼", title: "Agrega tu primera posición",       description: "Registra tus acciones y activa el análisis IA",   completed: positions.length > 0 },
    { emoji: "🎯", title: "Configura tu meta financiera",     description: "¿Para qué estás invirtiendo?",                    completed: !!goalName },
    { emoji: "🤖", title: "Habla con Nuvos por primera vez",  description: "Pregunta cualquier cosa sobre inversiones",        completed: hasChatted },
    { emoji: "📚", title: "Completa tu primera lección",      description: "Empieza tu racha de aprendizaje diario",          completed: streak > 0 },
    { emoji: "👀", title: "Agrega una acción a tu watchlist", description: "Monitorea empresas que te interesan",             completed: watchlistItems.length > 0 },
    { emoji: "🏦", title: "Abre tu cuenta en un broker",     description: "Invierte de verdad — te sugerimos el ideal para ti", completed: currentUserId !== BROKER_PREVIEW_UID },
  ];
  const allOnboardingDone = onboardingSteps.every((s) => s.completed);

  // Redirect to saved start-screen preference on first focus (before data loads)
  const hasRedirected = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (hasRedirected.current) return;
      hasRedirected.current = true;
      AsyncStorage.getItem(HOME_SCREEN_KEY).then((saved) => {
        if (!saved) return; // picker will show once onboarding is done
        const routes: Record<string, string> = {
          patrimonio:    "/(tabs)/patrimonio",
          chat:          "/(tabs)/chat",
          notifications: "/(tabs)/notifications",
          academy:       "/(tabs)/academy",
          portfolio:     "/(tabs)/portfolio",
          learn:         "/(tabs)/learn",
        };
        const route = routes[saved];
        if (route) router.replace(route as any);
      });
    }, [])
  );

  // Show picker after onboarding is done (only if no preference saved yet)
  useEffect(() => {
    if (loading || !allOnboardingDone) return;
    AsyncStorage.getItem(HOME_SCREEN_KEY).then((saved) => {
      if (!saved) setShowScreenPicker(true);
    });
  }, [loading, allOnboardingDone]);

  const handleOnboardingStep = (index: number) => {
    if (index === 1) { openGoalModal(); return; }
    if (index === 5) { openBrokerModal(); return; }
    const routes: (string | null)[] = [
      "/(tabs)/portfolio",
      null,
      "/(tabs)/chat",
      "/(tabs)/academy",
      "/(tabs)/watchlist",
    ];
    const route = routes[index];
    if (route) router.push({ pathname: route as any, params: { tour: String(index + 1) } });
  };

  return (
    <SafeAreaView style={[ss.root, { backgroundColor: colors.bg }]} edges={["top"]}>

      {/* ── Goal Modal ───────────────────────────────────────────────────────── */}
      <Modal visible={showGoalModal} transparent animationType="fade" onRequestClose={() => setShowGoalModal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 20 }}
                   onPress={() => setShowGoalModal(false)}>
          <Pressable onPress={e => e.stopPropagation()}
                     style={{ width: "100%", maxWidth: 400, backgroundColor: colors.card, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 16, fontWeight: "900", color: colors.text, marginBottom: 4 }}>🎯 Tu meta financiera</Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>¿Cuál es tu objetivo de inversión?</Text>

            {/* Goal options grid */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {GOAL_OPTIONS.map(g => (
                <TouchableOpacity key={g.key} onPress={() => setGoalDraft(g.key)} activeOpacity={0.7}
                  style={{ width: "47%", flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12,
                    backgroundColor: goalDraft === g.key ? "rgba(0,212,126,0.10)" : colors.bgRaised,
                    borderWidth: 1, borderColor: goalDraft === g.key ? "rgba(0,212,126,0.50)" : colors.border }}>
                  <Text style={{ fontSize: 20 }}>{g.emoji}</Text>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: goalDraft === g.key ? "#00d47e" : colors.textSub, flex: 1 }} numberOfLines={2}>{g.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Amount input */}
            <Text style={{ fontSize: 10, fontWeight: "700", color: colors.textMuted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 }}>
              Patrimonio objetivo (opcional)
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.bgRaised, borderRadius: 12,
              borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 18 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textDim }}>$</Text>
              <TextInput
                value={goalAmtDraft}
                onChangeText={setGoalAmtDraft}
                placeholder="100,000"
                placeholderTextColor={colors.textDim}
                keyboardType="numeric"
                style={{ flex: 1, fontSize: 14, fontWeight: "600", color: colors.text }}
              />
              <Text style={{ fontSize: 12, color: colors.textDim }}>USD</Text>
            </View>

            {/* Error */}
            {!!goalError && (
              <Text style={{ fontSize: 12, color: "#f87171", textAlign: "center", marginTop: -4 }}>{goalError}</Text>
            )}

            {/* Actions */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity onPress={() => setShowGoalModal(false)} activeOpacity={0.7}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textSub }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveGoal} disabled={!goalDraft || savingGoal} activeOpacity={0.7}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: goalDraft ? "#00d47e" : colors.border, alignItems: "center" }}>
                <Text style={{ fontSize: 14, fontWeight: "900", color: goalDraft ? "#000" : colors.textDim }}>
                  {savingGoal ? "Guardando…" : "Guardar"}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Broker Modal ─────────────────────────────────────────────────────── */}
      <Modal visible={showBrokerModal} transparent animationType="slide" onRequestClose={() => { setShowBrokerModal(false); setShowBrokerUpsell(false); }}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}
                   onPress={() => { setShowBrokerModal(false); setShowBrokerUpsell(false); }}>
          <Pressable onPress={e => e.stopPropagation()}
                     style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 }}>

            {/* Handle */}
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 16 }} />

            {!showBrokerUpsell ? (
              <>
                <Text style={{ fontSize: 22 }}>🏦</Text>
                <Text style={{ fontSize: 17, fontWeight: "900", color: colors.text, marginTop: 8, marginBottom: 4 }}>
                  Abre tu cuenta en un broker
                </Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
                  Detectamos que estás en{" "}
                  <Text style={{ fontWeight: "700", color: "#f59e0b" }}>{brokerCountry.label}</Text>.{" "}
                  Estas son tus mejores opciones:
                </Text>

                {brokerCountry.items.map(b => (
                  <View key={b} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: "rgba(245,158,11,0.07)", borderWidth: 1, borderColor: "rgba(245,158,11,0.2)", marginBottom: 8 }}>
                    <Text style={{ color: "#f59e0b", fontSize: 13 }}>✦</Text>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>{b}</Text>
                  </View>
                ))}

                <TouchableOpacity onPress={() => { setShowBrokerModal(false); setShowBrokerUpsell(false); }} activeOpacity={0.8}
                  style={{ marginTop: 12, paddingVertical: 14, borderRadius: 14, backgroundColor: "#f59e0b", alignItems: "center" }}>
                  <Text style={{ fontSize: 14, fontWeight: "900", color: "#000" }}>Ya tengo una cuenta, ¡listo!</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowBrokerUpsell(true)} activeOpacity={0.7}
                  style={{ marginTop: 10, alignItems: "center", paddingVertical: 10 }}>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>No sé cómo abrirla / quiero ayuda</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Countdown */}
                {upsellCountdown !== null && upsellCountdown > 0 && (
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1, borderColor: "rgba(239,68,68,0.2)", marginBottom: 16 }}>
                    <Text style={{ fontSize: 12, color: "#ef4444" }}>⏱</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#ef4444" }}>
                      Oferta expira en {fmtCountdown(upsellCountdown)}
                    </Text>
                  </View>
                )}
                {upsellCountdown === 0 && (
                  <View style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "rgba(107,114,128,0.1)", borderWidth: 1, borderColor: colors.border, marginBottom: 16, alignItems: "center" }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: colors.textMuted }}>La oferta especial ha expirado</Text>
                  </View>
                )}

                <View style={{ borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "rgba(0,212,126,0.25)", backgroundColor: "rgba(0,212,126,0.04)", padding: 16, marginBottom: 12 }}>
                  <Text style={{ fontSize: 10, fontWeight: "700", color: "#00d47e", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Sesión 1:1 con Nuvos AI</Text>
                  <Text style={{ fontSize: 16, fontWeight: "900", color: colors.text, lineHeight: 22, marginBottom: 8 }}>
                    Te acompañamos a abrir tu cuenta en el broker ideal para ti
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18, marginBottom: 14 }}>
                    Un experto de Nuvos te guía paso a paso: qué broker elegir, cómo depositar tu primer dinero y cómo conectarlo a la app.
                  </Text>

                  {/* Price */}
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
                    <Text style={{ fontSize: 24, fontWeight: "900", color: colors.text }}>$49 USD</Text>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textDim, textDecorationLine: "line-through" }}>$89 USD</Text>
                    <View style={{ backgroundColor: "rgba(239,68,68,0.12)", borderRadius: 20, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: "#ef4444" }}>-45%</Text>
                    </View>
                  </View>

                  <TouchableOpacity onPress={() => Linking.openURL("https://calendly.com/nuvosai/onboarding")} activeOpacity={0.8}
                    style={{ paddingVertical: 14, borderRadius: 14, backgroundColor: "#00d47e", alignItems: "center" }}>
                    <Text style={{ fontSize: 14, fontWeight: "900", color: "#000" }}>Agendar mi llamada ahora</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity onPress={() => { setShowBrokerModal(false); setShowBrokerUpsell(false); }} activeOpacity={0.7}
                  style={{ alignItems: "center", paddingVertical: 10 }}>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>Lo haré yo solo, gracias</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

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
        {/* ── Onboarding checklist ─────────────────────────────────────────── */}
        {!allOnboardingDone && (
          <MobileOnboardingChecklist steps={onboardingSteps} onStepPress={handleOnboardingStep} />
        )}

        {/* ── Portfolio Hero Card ──────────────────────────────────────────── */}
        <TouchableOpacity
          activeOpacity={0.92}
          onPress={() => router.navigate("/(tabs)/portfolio")}
          style={[ss.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={ss.heroTop}>
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[ss.heroLabel, { color: colors.textMuted }]}>Mi Portafolio</Text>
                <View style={{ backgroundColor: colors.bgRaised ?? colors.card, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
                  <Text style={{ fontSize: 9, fontWeight: "900", color: colors.textMuted, letterSpacing: 0.8 }}>{portfolioCurrency}</Text>
                </View>
              </View>
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
              {/* Hoy */}
              <View style={ss.heroStat}>
                <Text style={[ss.heroStatLabel, { color: colors.textMuted }]}>Hoy</Text>
                <Text style={{ fontSize: 15, fontWeight: "800", color: dayGain >= 0 ? colors.up : colors.down }}>
                  {fmtPct(dayGainPct)}
                </Text>
                <Text style={[ss.heroStatVal, { color: dayGain >= 0 ? colors.up : colors.down }]}>
                  {dayGain >= 0 ? "+" : ""}{fmt(dayGain, portfolioCurrency)}
                </Text>
              </View>
              <View style={[ss.heroDivider, { backgroundColor: colors.border }]} />
              {/* YTD */}
              <View style={ss.heroStat}>
                <Text style={[ss.heroStatLabel, { color: colors.textMuted }]}>YTD</Text>
                {ytdGain !== null ? (
                  <>
                    <Text style={{ fontSize: 15, fontWeight: "800", color: (ytdPct ?? 0) >= 0 ? colors.up : colors.down }}>
                      {fmtPct(ytdPct ?? 0)}
                    </Text>
                    <Text style={[ss.heroStatVal, { color: (ytdGain ?? 0) >= 0 ? colors.up : colors.down }]}>
                      {(ytdGain ?? 0) >= 0 ? "+" : ""}{fmt(ytdGain ?? 0, portfolioCurrency)}
                    </Text>
                  </>
                ) : (
                  <Text style={[ss.heroStatVal, { color: colors.textMuted }]}>—</Text>
                )}
              </View>
              <View style={[ss.heroDivider, { backgroundColor: colors.border }]} />
              {/* Total */}
              <View style={ss.heroStat}>
                <Text style={[ss.heroStatLabel, { color: colors.textMuted }]}>Total</Text>
                <Text style={{ fontSize: 15, fontWeight: "800", color: totalGain >= 0 ? colors.up : colors.down }}>
                  {fmtPct(totalGainPct)}
                </Text>
                <Text style={[ss.heroStatVal, { color: totalGain >= 0 ? colors.up : colors.down }]}>
                  {totalGain >= 0 ? "+" : ""}{fmt(totalGain, portfolioCurrency)}
                </Text>
              </View>
            </View>
          )}

          {!positions.length && !loading && (
            <View style={[ss.emptyPortfolio, { borderColor: colors.border, gap: 10 }]}>
              <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }}>Agrega tu primera acción</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17 }}>
                Registra tus posiciones y Nuvos te dará análisis IA, alertas de precio y seguimiento en tiempo real.
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
              <TouchableOpacity
                onPress={() => router.navigate("/(tabs)/portfolio")}
                activeOpacity={0.8}
                style={{ backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 11, alignItems: "center" }}
              >
                <Text style={{ fontSize: 13, fontWeight: "800", color: "#fff" }}>+ Agregar posición →</Text>
              </TouchableOpacity>
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
            onPress={openGoalModal}
            style={[ss.statChip, { backgroundColor: colors.card, borderColor: goalName ? "rgba(0,212,126,0.30)" : colors.border }]}>
            <Text style={{ fontSize: 18 }}>🎯</Text>
            <View>
              <Text style={{ fontSize: 13, fontWeight: "800", color: goalName ? "#00d47e" : colors.text }} numberOfLines={1}>
                {goalName ? (GOAL_OPTIONS.find(g => g.key === goalName)?.label ?? goalName) : "Sin meta"}
              </Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>
                {yearsToGoal ? `en ~${yearsToGoal} años` : "Meta"}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.8}
            onPress={() => router.navigate("/(tabs)/notifications")}
            style={[ss.statChip, { backgroundColor: colors.card, borderColor: unread > 0 ? "#ef444450" : colors.border }]}>
            <Ionicons name="notifications-outline" size={16} color={unread > 0 ? "#ef4444" : colors.textSub} />
            <View>
              <Text style={{ fontSize: 13, fontWeight: "800", color: unread > 0 ? "#ef4444" : colors.text }}>
                {unread > 0 ? `${unread} nuevas` : totalNotifs > 0 ? `${totalNotifs} alertas` : "Sin alertas"}
              </Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>Alertas</Text>
            </View>
          </TouchableOpacity>
        </ScrollView>

        {/* ── Índices de mercado ───────────────────────────────────────────── */}
        {indices.length > 0 && (() => {
          // Derived values used in this block
          const nonVix  = indices.filter((i: IdxData) => i.symbol !== "^VIX");
          const best    = nonVix.length
            ? nonVix.reduce((a: IdxData, b: IdxData) => b.change_pct > a.change_pct ? b : a, nonVix[0])
            : null;
          const vixIdx  = indices.find((i: IdxData) => i.symbol === "^VIX");
          const vixPrice = vixIdx?.price ?? null;
          const sentiment = vixPrice == null ? null
            : vixPrice < 15 ? { label: "Calma",           color: "#22c55e", bar: 15  }
            : vixPrice < 20 ? { label: "Normal",           color: "#84cc16", bar: 35  }
            : vixPrice < 30 ? { label: "Cauteloso",        color: "#f59e0b", bar: 65  }
            :                 { label: "Alta volatilidad", color: "#ef4444", bar: 100 };
          const secsSince = idxRefresh ? Math.round((Date.now() - idxRefresh.getTime()) / 1000) : null;
          const updLabel  = secsSince == null ? null : secsSince < 5 ? "Ahora" : secsSince < 60 ? `${secsSince}s` : `${Math.round(secsSince / 60)}min`;

          return (
            <View>
              {/* Section header */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                             paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
                <Text style={{ fontSize: 10, fontWeight: "700", color: colors.textMuted,
                               textTransform: "uppercase", letterSpacing: 1.2 }}>
                  Mercados
                </Text>
                {updLabel && (
                  <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10,
                                 backgroundColor: colors.bgRaised ?? colors.card }}>
                    <Text style={{ fontSize: 9, color: colors.textDim, fontWeight: "600" }}>
                      {updLabel === "Ahora" ? "Ahora" : `Hace ${updLabel}`}
                    </Text>
                  </View>
                )}
              </View>

              {/* Cards */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 10, flexDirection: "row" }}
              >
                {indices.map((idx: IdxData) => {
                  const up     = idx.change_pct >= 0;
                  const col    = up ? colors.up : colors.down;
                  const prices = indexCharts[idx.symbol];
                  const isBest = best?.symbol === idx.symbol;
                  return (
                    <TouchableOpacity
                      key={idx.symbol}
                      activeOpacity={0.75}
                      onPress={() => setSelectedIdx(idx)}
                      style={[ss.idxChip, {
                        backgroundColor: colors.card,
                        borderColor: up ? colors.up + "45" : colors.down + "45",
                      }]}
                    >
                      {/* Best performer badge */}
                      {isBest && (
                        <View style={{ position: "absolute", top: 0, right: 0,
                                       backgroundColor: "#f59e0b", borderBottomLeftRadius: 8,
                                       paddingHorizontal: 5, paddingVertical: 2, zIndex: 1 }}>
                          <Text style={{ fontSize: 8, fontWeight: "900", color: "#000" }}>★ MEJOR</Text>
                        </View>
                      )}
                      <Text style={[ss.idxName, { color: colors.textSub }]}>{idx.name}</Text>
                      {idx.price != null && (
                        <Text style={[ss.idxPrice, { color: colors.text }]}>
                          {idx.price >= 10000
                            ? idx.price.toLocaleString("en-US", { maximumFractionDigits: 0 })
                            : idx.price >= 1000
                              ? (idx.price / 1000).toFixed(1) + "K"
                              : idx.price.toFixed(2)}
                        </Text>
                      )}
                      <Text style={[ss.idxChange, { color: col }]}>
                        {up ? "+" : ""}{idx.change_pct.toFixed(2)}%
                      </Text>
                      {/* Sparkline */}
                      <View style={{ marginTop: 6 }}>
                        {prices && prices.length > 1 ? (
                          <Sparkline prices={prices} color={col} width={88} height={34} />
                        ) : (
                          <View style={{ width: 88, height: 34, opacity: 0.15,
                                         borderRadius: 4, backgroundColor: col }} />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* VIX sentiment */}
              {sentiment && vixPrice != null && (
                <View style={{ marginHorizontal: 16, marginTop: 10, borderRadius: 14,
                               paddingHorizontal: 14, paddingVertical: 9, flexDirection: "row",
                               alignItems: "center", gap: 10,
                               backgroundColor: sentiment.color + "12",
                               borderWidth: StyleSheet.hairlineWidth, borderColor: sentiment.color + "30" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 10, fontWeight: "700", color: colors.textMuted,
                                   textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>
                      Sentimiento de mercado
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: "800", color: sentiment.color }}>
                        {sentiment.label}
                      </Text>
                      <Text style={{ fontSize: 10, color: colors.textDim }}>
                        VIX {vixPrice.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                  {/* Progress bar */}
                  <View style={{ width: 72, height: 5, borderRadius: 3,
                                 backgroundColor: colors.border, overflow: "hidden" }}>
                    <View style={{ width: `${sentiment.bar}%` as any, height: "100%",
                                   borderRadius: 3, backgroundColor: sentiment.color }} />
                  </View>
                </View>
              )}
            </View>
          );
        })()}

        {/* ── Index detail modal ───────────────────────────────────────────── */}
        {selectedIdx && (
          <IndexDetailModal
            idx={selectedIdx}
            chartPrices={indexCharts[selectedIdx.symbol] ?? []}
            onClose={() => setSelectedIdx(null)}
            colors={colors}
          />
        )}

        {/* ── Lección recomendada ──────────────────────────────────────────── */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => router.navigate({ pathname: "/(tabs)/learn", params: { topicId: dailyLesson.topicId } })}
          style={[ss.lessonCard, {
            backgroundColor: completedToday ? "rgba(34,197,94,0.06)" : colors.card,
            borderColor: completedToday ? "rgba(34,197,94,0.35)" : colors.border,
          }]}>
          <View style={[ss.lessonIcon, { backgroundColor: completedToday ? "rgba(34,197,94,0.14)" : "#7c3aed18" }]}>
            <Text style={{ fontSize: 22 }}>{completedToday ? "✅" : dailyLesson.emoji}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: "600", marginBottom: 2,
              color: completedToday ? "#22c55e" : colors.textMuted }}>
              {completedToday ? "Completada hoy" : "Lección del día"}
            </Text>
            <Text style={{ fontSize: 15, fontWeight: "800", color: colors.text }}>{dailyLesson.title}</Text>
          </View>
          {completedToday
            ? <View style={{ backgroundColor: "rgba(34,197,94,0.14)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(34,197,94,0.3)" }}>
                <Text style={{ color: "#22c55e", fontSize: 12, fontWeight: "700" }}>✓</Text>
              </View>
            : <Text style={{ fontSize: 16, fontWeight: "700", color: colors.accentLight }}>→</Text>
          }
        </TouchableOpacity>

        {/* ── Quick Actions ────────────────────────────────────────────────── */}
        <View style={ss.actions}>
          <ActionChip icon="chatbubble-ellipses-outline" label="Mentor IA"
            onPress={() => router.navigate("/(tabs)/chat")} accent colors={colors} />
          <ActionChip icon="wallet-outline" label="Patrimonio"
            onPress={() => router.navigate("/(tabs)/patrimonio")} colors={colors} />
          <ActionChip icon="school-outline" label="Academy"
            onPress={() => router.navigate("/(tabs)/academy")} colors={colors} />

        </View>

        {/* ── Top Movers ───────────────────────────────────────────────────── */}
        {(loading || movers.length > 0) && (
          <View style={ss.section}>
            <View style={ss.sectionHeader}>
              <Text style={[ss.sectionTitle, { color: colors.text }]}>Subiendo hoy</Text>
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

        {/* ── Más caídas hoy ───────────────────────────────────────────────── */}
        {losers.length > 0 && (
          <View style={ss.section}>
            <View style={ss.sectionHeader}>
              <Text style={[ss.sectionTitle, { color: colors.text }]}>📉 Cayendo hoy</Text>
              <TouchableOpacity onPress={() => router.navigate("/(tabs)/portfolio")}>
                <Text style={[ss.sectionLink, { color: colors.accentLight }]}>Ver todo →</Text>
              </TouchableOpacity>
            </View>
            <View style={[ss.moversCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {losers.map((m, i) => (
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
                    <View style={[ss.moverBadge, { backgroundColor: colors.down + "18" }]}>
                      <Text style={[ss.moverBadgeText, { color: colors.down }]}>
                        {fmtPct(m.chg)}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
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

      <MobileHomeScreenPickerModal
        visible={showScreenPicker}
        onDone={async (route) => {
          const key = route.replace("/(tabs)/", "");
          await AsyncStorage.setItem(HOME_SCREEN_KEY, key);
          setShowScreenPicker(false);
          if (route !== "/(tabs)/home") router.replace(route as any);
        }}
      />
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
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10,
    gap: 2, alignItems: "flex-start", minWidth: 112,
  },
  idxName:   { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  idxPrice:  { fontSize: 14, fontWeight: "800", letterSpacing: -0.3 },
  idxChange: { fontSize: 11, fontWeight: "700" },

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
  heroStatVal:   { fontSize: 11, fontWeight: "700" },
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
