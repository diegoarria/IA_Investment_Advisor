import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, SafeAreaView, Modal,
  Alert, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { marketApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { usePaperStore, PAPER_INITIAL_CASH, FREE_PAPER_INITIAL_CASH, FREE_PAPER_MONTHLY_TRADES, TOP_UP_PLANS } from "../../src/lib/paperStore";
import { useSubscriptionStore, hasPremiumAccess, isTrialActive, trialDaysLeft } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";

interface TickerInfo {
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
}

interface LeagueEntry {
  rank: number; alias: string; returnPct: number;
  topHolding: string; rankChange: number; isMe?: boolean;
}

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const neg = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${neg}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${neg}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${neg}$${(abs / 1e3).toFixed(2)}K`;
  return `${neg}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number, sign = true): string {
  return `${sign && n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ─── Liga mock data (reemplazar con GET /paper/leaderboard) ──────────────────
const MOCK_OTHERS = [
  { alias: "InversorPro",    returnPct: 18.4, topHolding: "NVDA",  rankChange:  0 },
  { alias: "TauroMX",        returnPct: 14.2, topHolding: "AAPL",  rankChange:  2 },
  { alias: "BullMkt99",      returnPct: 11.8, topHolding: "MSFT",  rankChange: -1 },
  { alias: "WallStLearner",  returnPct:  9.3, topHolding: "TSLA",  rankChange:  1 },
  { alias: "PipoCapital",    returnPct:  7.1, topHolding: "AMZN",  rankChange:  3 },
  { alias: "Sigma_Returns",  returnPct:  5.8, topHolding: "GOOGL", rankChange:  0 },
  { alias: "CrackMercado",   returnPct:  4.6, topHolding: "META",  rankChange: -2 },
  { alias: "PatternBreaker", returnPct:  2.1, topHolding: "BRK-B", rankChange:  0 },
  { alias: "ETFQueen",       returnPct:  1.4, topHolding: "SPY",   rankChange:  4 },
  { alias: "LongTermLeo",    returnPct: -0.8, topHolding: "BABA",  rankChange: -3 },
];

const LEAGUE_LESSONS: Record<"week" | "month" | "all", string> = {
  week:  "Los líderes concentraron en semiconductores (NVDA, AMD +8.2% esta semana). Apostar a un sector en tendencia clara pagó.",
  month: "Los portfolios top mantuvieron Big Tech (MSFT, AAPL, META) sin rotar. Paciencia > timing de mercado.",
  all:   "Los mejores inversores balancearon crecimiento y dividendos. La consistencia supera al timing.",
};

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
const TOTAL_PARTICIPANTS = 847;

// ─── LeagueRow ────────────────────────────────────────────────────────────────
function LeagueRow({ entry, colors }: { entry: LeagueEntry; colors: Colors }) {
  const medal = MEDALS[entry.rank];
  const up = entry.returnPct >= 0;
  return (
    <View style={{
      flexDirection: "row", alignItems: "center",
      paddingHorizontal: 14, paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
      backgroundColor: entry.isMe
        ? "rgba(0,168,94,0.07)"
        : entry.rank === 1 ? "rgba(251,191,36,0.03)" : "transparent",
    }}>
      {/* Rank */}
      <View style={{ width: 26, alignItems: "center" }}>
        {medal
          ? <Text style={{ fontSize: 16 }}>{medal}</Text>
          : <Text style={{ fontSize: 11, fontWeight: "700", color: colors.textDim }}>#{entry.rank}</Text>}
      </View>

      {/* Avatar */}
      <View style={{
        width: 30, height: 30, borderRadius: 15,
        alignItems: "center", justifyContent: "center",
        marginHorizontal: 10,
        backgroundColor: entry.isMe
          ? "#00a85e"
          : entry.rank <= 3 ? "rgba(251,191,36,0.18)" : colors.bgRaised,
      }}>
        <Text style={{
          fontSize: 11, fontWeight: "800",
          color: entry.isMe ? "white" : entry.rank <= 3 ? "#fbbf24" : colors.textMuted,
        }}>
          {entry.alias[0].toUpperCase()}
        </Text>
      </View>

      {/* Name + holding */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: entry.isMe ? colors.accentLight : colors.text }}>
            {entry.isMe ? "Tú" : entry.alias}
          </Text>
          {entry.isMe && (
            <View style={{ backgroundColor: "rgba(0,168,94,0.15)", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ fontSize: 9, fontWeight: "800", color: colors.accentLight }}>★</Text>
            </View>
          )}
        </View>
        <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>Top: {entry.topHolding}</Text>
      </View>

      {/* Return + rank change */}
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontSize: 14, fontWeight: "800", color: up ? "#22c55e" : "#ef4444" }}>
          {up ? "+" : ""}{entry.returnPct.toFixed(1)}%
        </Text>
        <Text style={{
          fontSize: 11, fontWeight: "600", marginTop: 1,
          color: entry.rankChange > 0 ? "#22c55e" : entry.rankChange < 0 ? "#ef4444" : colors.textDim,
        }}>
          {entry.rankChange > 0 ? `↑${entry.rankChange}` : entry.rankChange < 0 ? `↓${Math.abs(entry.rankChange)}` : "—"}
        </Text>
      </View>
    </View>
  );
}

// ─── Sell Modal ───────────────────────────────────────────────────────────────
function SellModal({
  visible, ticker, maxShares, price, onClose, onSell,
}: {
  visible: boolean; ticker: string; maxShares: number;
  price: number; onClose: () => void; onSell: (shares: number) => void;
}) {
  const { colors } = useTheme();
  const [qty, setQty] = useState("");
  const parsed = parseFloat(qty) || 0;
  const valid = parsed > 0 && parsed <= maxShares;
  useEffect(() => { if (visible) setQty(""); }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} activeOpacity={1} onPress={onClose} />
        <View style={[sellStyles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={sellStyles.handle} />
          <Text style={[sellStyles.title, { color: colors.text }]}>Vender {ticker}</Text>
          <Text style={[sellStyles.sub, { color: colors.textMuted }]}>
            Precio actual: <Text style={{ color: colors.text, fontWeight: "700" }}>${price.toLocaleString("en-US", { minimumFractionDigits: 2 })}</Text>
            {"  ·  "}Tienes {maxShares} acciones
          </Text>
          <View style={[sellStyles.inputWrap, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <TextInput style={[sellStyles.input, { color: colors.text }]} value={qty} onChangeText={setQty}
              placeholder={`1 – ${maxShares}`} placeholderTextColor={colors.placeholder}
              keyboardType="decimal-pad" autoFocus />
            <TouchableOpacity onPress={() => setQty(String(maxShares))} style={sellStyles.maxBtn}>
              <Text style={sellStyles.maxBtnText}>MAX</Text>
            </TouchableOpacity>
          </View>
          {parsed > 0 && (
            <Text style={[sellStyles.proceeds, { color: colors.textSub }]}>
              Recibirás:{" "}
              <Text style={{ color: "#22c55e", fontWeight: "800" }}>{fmtMoney(parsed * price)}</Text>
            </Text>
          )}
          <View style={sellStyles.actions}>
            <TouchableOpacity style={[sellStyles.cancelBtn, { borderColor: colors.border }]} onPress={onClose}>
              <Text style={[sellStyles.cancelText, { color: colors.textMuted }]}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[sellStyles.sellBtn, !valid && { opacity: 0.4 }]}
              onPress={() => { if (valid) { onSell(parsed); onClose(); } }} disabled={!valid}>
              <Text style={sellStyles.sellText}>Vender {qty || "—"} acc</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const sellStyles = StyleSheet.create({
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 24, paddingTop: 12 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#374151", alignSelf: "center", marginBottom: 20 },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 6 },
  sub: { fontSize: 13, marginBottom: 18 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, marginBottom: 10 },
  input: { flex: 1, fontSize: 18, fontWeight: "700", paddingVertical: 14 },
  maxBtn: { backgroundColor: "rgba(34,197,94,0.15)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  maxBtnText: { color: "#22c55e", fontSize: 11, fontWeight: "800" },
  proceeds: { fontSize: 14, marginBottom: 18 },
  actions: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  cancelText: { fontWeight: "600", fontSize: 14 },
  sellBtn: { flex: 2, backgroundColor: "#ef4444", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  sellText: { color: "white", fontWeight: "700", fontSize: 14 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function PaperScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const subStore = useSubscriptionStore();
  const isPremiumAccess = hasPremiumAccess(subStore);
  const inTrial = isTrialActive(subStore);
  const daysLeft = trialDaysLeft(subStore.trialStartDate);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const { cash, positions, trades, buy, sell, topUp, reset, freeTradesThisMonth, incrementFreeTrade } = usePaperStore();
  const [topUpOpen, setTopUpOpen] = useState(false);

  // Tab state
  const [activeTab, setActiveTab]       = useState<"portfolio" | "liga">("portfolio");
  const [leaguePeriod, setLeaguePeriod] = useState<"week" | "month" | "all">("week");

  // Ticker search
  const [query, setQuery]             = useState("");
  const [tickerInfo, setTickerInfo]   = useState<TickerInfo | null>(null);
  const [searching, setSearching]     = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[]>([]);
  const debounceRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Buy form
  const [buyQty, setBuyQty]       = useState("");
  const [buyLoading, setBuyLoading] = useState(false);

  // Position prices
  const [posPrices, setPosPrices]       = useState<Record<string, { price: number; change_pct: number }>>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  // Sell modal
  const [sellModal, setSellModal] = useState<{ ticker: string; maxShares: number; price: number } | null>(null);

  // History expand
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadPosPrices = useCallback(async () => {
    if (positions.length === 0) return;
    setPricesLoading(true);
    try {
      const res = await marketApi.getPrices(positions.map((p) => p.ticker));
      const results: Record<string, { price: number; change_pct: number }> = {};
      for (const pos of positions) {
        const d = res.data[pos.ticker];
        results[pos.ticker] = { price: d?.price ?? pos.avgPrice, change_pct: d?.change_pct ?? 0 };
      }
      setPosPrices(results);
    } catch {}
    setPricesLoading(false);
  }, [positions.length]);

  useEffect(() => { loadPosPrices(); }, [positions.length]);

  const searchTicker = useCallback((raw: string) => {
    const t = raw.trim().toUpperCase();
    if (!t) { setTickerInfo(null); setSearchError(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true); setSearchError(null); setTickerInfo(null);
      try {
        const res = await marketApi.getPrices([t]);
        const d = res.data[t];
        if (d?.price) setTickerInfo({ ticker: t, name: d.name ?? t, price: d.price, change_pct: d.change_pct ?? 0 });
        else setSearchError("Ticker no encontrado");
      } catch { setSearchError("No se pudo obtener precio"); }
      setSearching(false);
    }, 500);
  }, []);

  const handleQueryChange = (v: string) => {
    const upper = v.toUpperCase();
    setQuery(upper); setBuyQty(""); setTickerInfo(null); setSearchError(null);
    if (!upper.trim()) { setSuggestions([]); return; }
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
    suggestDebounceRef.current = setTimeout(async () => {
      try {
        const res = await marketApi.searchTickers(upper);
        setSuggestions(res.data.results || []);
      } catch { setSuggestions([]); }
    }, 250);
  };

  const selectSuggestion = (ticker: string) => {
    setQuery(ticker); setSuggestions([]); setBuyQty(""); searchTicker(ticker);
  };

  const handleBuy = async () => {
    if (!tickerInfo || !buyQty) return;
    const shares = parseFloat(buyQty);
    if (!shares || shares <= 0) return;
    if (!isPremiumAccess) {
      if (freeTradesThisMonth() >= FREE_PAPER_MONTHLY_TRADES) { setPaywallOpen(true); return; }
      const newTotal = cash - shares * tickerInfo.price + positions.reduce((a, p) => a + p.shares * (posPrices[p.ticker]?.price ?? p.avgPrice), 0) + shares * tickerInfo.price;
      if (newTotal > FREE_PAPER_INITIAL_CASH) { setPaywallOpen(true); return; }
    }
    setBuyLoading(true);
    const err = buy(tickerInfo.ticker, tickerInfo.name, shares, tickerInfo.price);
    if (err) { Alert.alert("Error", err); }
    else {
      if (!isPremiumAccess) incrementFreeTrade();
      setQuery(""); setBuyQty(""); setTickerInfo(null);
    }
    setBuyLoading(false);
  };

  const confirmSell = (shares: number) => {
    if (!sellModal) return;
    if (!isPremiumAccess) {
      if (freeTradesThisMonth() >= FREE_PAPER_MONTHLY_TRADES) { setSellModal(null); setPaywallOpen(true); return; }
      incrementFreeTrade();
    }
    sell(sellModal.ticker, shares, sellModal.price);
    setPosPrices((prev) => ({ ...prev }));
  };

  const { virtualValue, totalValue, totalReturn, totalReturnPct } = useMemo(() => {
    const virtualValue = positions.reduce((acc, p) => acc + p.shares * (posPrices[p.ticker]?.price ?? p.avgPrice), 0);
    const totalValue   = cash + virtualValue;
    const totalReturn  = totalValue - PAPER_INITIAL_CASH;
    return { virtualValue, totalValue, totalReturn, totalReturnPct: (totalReturn / PAPER_INITIAL_CASH) * 100 };
  }, [cash, positions, posPrices]);

  const isUp = totalReturn >= 0;

  // Liga — insertar al usuario según su retorno real
  const allLeagueEntries = useMemo<LeagueEntry[]>(() => {
    const me: LeagueEntry = {
      alias: "Tú", returnPct: parseFloat(totalReturnPct.toFixed(1)),
      topHolding: positions[0]?.ticker ?? "—", rankChange: 2, isMe: true, rank: 0,
    };
    return [...MOCK_OTHERS, me]
      .sort((a, b) => b.returnPct - a.returnPct)
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }, [totalReturnPct, positions]);

  const myEntry      = allLeagueEntries.find((e) => e.isMe)!;
  const top5         = allLeagueEntries.slice(0, 5);
  const showEllipsis = myEntry?.rank > 5;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>

        {/* Trial / free-mode banner */}
        {inTrial && (
          <TouchableOpacity
            style={{ backgroundColor: "#f59e0b18", borderBottomWidth: 1, borderBottomColor: "#f59e0b33", flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
            onPress={() => setPaywallOpen(true)} activeOpacity={0.8}>
            <Ionicons name="star" size={14} color="#f59e0b" />
            <Text style={{ color: "#f59e0b", fontSize: 12, fontWeight: "700", flex: 1 }}>
              Premium de prueba — {daysLeft} {daysLeft === 1 ? "día" : "días"} restantes
            </Text>
            <Text style={{ color: "#f59e0b", fontSize: 11 }}>Activar →</Text>
          </TouchableOpacity>
        )}
        {!isPremiumAccess && !inTrial && (
          <TouchableOpacity
            style={{ backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
            onPress={() => setPaywallOpen(true)} activeOpacity={0.8}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}>
              Modo gratuito: ${FREE_PAPER_INITIAL_CASH.toLocaleString()} cap · {FREE_PAPER_MONTHLY_TRADES - freeTradesThisMonth()} operaciones restantes
            </Text>
            <Text style={{ color: "#f59e0b", fontSize: 11, fontWeight: "700" }}>Premium →</Text>
          </TouchableOpacity>
        )}

        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

          {/* ── Tab switcher ── */}
          <View style={[s.tabBar, { backgroundColor: colors.bgRaised }]}>
            <TouchableOpacity
              style={[s.tabBtn, activeTab === "portfolio" && { backgroundColor: colors.card }]}
              onPress={() => setActiveTab("portfolio")} activeOpacity={0.8}>
              <Text style={[s.tabBtnText, { color: activeTab === "portfolio" ? colors.text : colors.textMuted }]}>
                Mi Portafolio
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tabBtn, activeTab === "liga" && { backgroundColor: colors.card }]}
              onPress={() => setActiveTab("liga")} activeOpacity={0.8}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Ionicons name="trophy-outline" size={13}
                  color={activeTab === "liga" ? colors.accentLight : colors.textMuted} />
                <Text style={[s.tabBtnText, { color: activeTab === "liga" ? colors.accentLight : colors.textMuted }]}>
                  Liga
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* ══════════════════ PORTAFOLIO TAB ══════════════════ */}
          {activeTab === "portfolio" && (
            <>
              {/* Balance card */}
              <View style={[s.balanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={s.balanceRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.balanceLabel, { color: colors.textMuted }]}>Portafolio virtual</Text>
                    <Text style={[s.balanceTotal, { color: colors.text }]}>{fmtMoney(totalValue)}</Text>
                    <View style={s.balanceReturnRow}>
                      <View style={[s.returnBadge, { backgroundColor: (isUp ? "#22c55e" : "#ef4444") + "18" }]}>
                        <Ionicons name={isUp ? "trending-up" : "trending-down"} size={12} color={isUp ? "#22c55e" : "#ef4444"} />
                        <Text style={[s.returnBadgeText, { color: isUp ? "#22c55e" : "#ef4444" }]}>
                          {fmtMoney(Math.abs(totalReturn))} ({fmtPct(totalReturnPct)})
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <TouchableOpacity style={[s.resetBtn, { backgroundColor: "#22c55e18", borderColor: "#22c55e55" }]} onPress={() => setTopUpOpen(true)}>
                      <Ionicons name="add-circle-outline" size={14} color="#22c55e" />
                      <Text style={[s.resetBtnText, { color: "#22c55e" }]}>Recargar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.resetBtn} onPress={() => Alert.alert("Reiniciar", "¿Volver a $10,000 virtuales?", [
                      { text: "Cancelar", style: "cancel" },
                      { text: "Reiniciar", style: "destructive", onPress: reset },
                    ])}>
                      <Ionicons name="refresh-outline" size={14} color="#ef4444" />
                      <Text style={s.resetBtnText}>Reset</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={[s.balanceSplit, { borderTopColor: colors.border }]}>
                  <View style={s.balanceSplitItem}>
                    <Text style={[s.balanceSplitLabel, { color: colors.textMuted }]}>Efectivo</Text>
                    <Text style={[s.balanceSplitVal, { color: "#8b5cf6" }]}>{fmtMoney(cash)}</Text>
                  </View>
                  <View style={[s.balanceSplitDivider, { backgroundColor: colors.border }]} />
                  <View style={s.balanceSplitItem}>
                    <Text style={[s.balanceSplitLabel, { color: colors.textMuted }]}>En acciones</Text>
                    <Text style={[s.balanceSplitVal, { color: colors.text }]}>{fmtMoney(virtualValue)}</Text>
                  </View>
                  <View style={[s.balanceSplitDivider, { backgroundColor: colors.border }]} />
                  <View style={s.balanceSplitItem}>
                    <Text style={[s.balanceSplitLabel, { color: colors.textMuted }]}>Posiciones</Text>
                    <Text style={[s.balanceSplitVal, { color: colors.text }]}>{positions.length}</Text>
                  </View>
                </View>
              </View>

              {/* Search + buy */}
              <View style={[s.buyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[s.searchBar, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                  <Ionicons name="search-outline" size={18} color={colors.textMuted} />
                  <TextInput style={[s.searchInput, { color: colors.text }]} value={query}
                    onChangeText={handleQueryChange} placeholder="Busca ticker: NVDA, AAPL, TSLA…"
                    placeholderTextColor={colors.placeholder} autoCapitalize="characters" autoCorrect={false} />
                  {query.length > 0 && (
                    <TouchableOpacity onPress={() => { setQuery(""); setTickerInfo(null); setSearchError(null); setBuyQty(""); setSuggestions([]); }}>
                      <Ionicons name="close-circle" size={18} color={colors.textDim} />
                    </TouchableOpacity>
                  )}
                </View>

                {suggestions.length > 0 && !tickerInfo && !searching && (
                  <View style={[s.suggestionsBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    {suggestions.map((s2, i) => (
                      <TouchableOpacity key={s2.ticker}
                        style={[s.suggestionRow, i < suggestions.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                        onPress={() => selectSuggestion(s2.ticker)}>
                        <Text style={[s.suggestionTicker, { color: colors.text }]}>{s2.ticker}</Text>
                        <Text style={[s.suggestionName, { color: colors.textMuted }]} numberOfLines={1}>{s2.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {searching && (
                  <View style={s.searchState}>
                    <ActivityIndicator size="small" color={colors.accentLight} />
                    <Text style={[s.searchStateText, { color: colors.textMuted }]}>Buscando {query}…</Text>
                  </View>
                )}
                {searchError && !searching && (
                  <View style={s.searchState}>
                    <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
                    <Text style={[s.searchStateText, { color: "#ef4444" }]}>{searchError}</Text>
                  </View>
                )}

                {tickerInfo && !searching && (
                  <View style={[s.tickerResult, { borderColor: colors.border }]}>
                    <View style={s.tickerResultLeft}>
                      <Text style={[s.tickerSymbol, { color: colors.text }]}>{tickerInfo.ticker}</Text>
                      <Text style={[s.tickerName, { color: colors.textMuted }]} numberOfLines={1}>{tickerInfo.name}</Text>
                    </View>
                    <View style={s.tickerResultRight}>
                      <Text style={[s.tickerPrice, { color: colors.text }]}>${tickerInfo.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}</Text>
                      <View style={[s.tickerChangeBadge, { backgroundColor: (tickerInfo.change_pct >= 0 ? "#22c55e" : "#ef4444") + "18" }]}>
                        <Ionicons name={tickerInfo.change_pct >= 0 ? "caret-up" : "caret-down"} size={10} color={tickerInfo.change_pct >= 0 ? "#22c55e" : "#ef4444"} />
                        <Text style={[s.tickerChangePct, { color: tickerInfo.change_pct >= 0 ? "#22c55e" : "#ef4444" }]}>{fmtPct(tickerInfo.change_pct)}</Text>
                      </View>
                    </View>
                  </View>
                )}

                {tickerInfo && !searching && (
                  <View style={s.buyForm}>
                    <View style={[s.qtyWrap, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                      <Text style={[s.qtyLabel, { color: colors.textMuted }]}>Acciones</Text>
                      <TextInput style={[s.qtyInput, { color: colors.text }]} value={buyQty} onChangeText={setBuyQty}
                        placeholder="0" placeholderTextColor={colors.placeholder} keyboardType="decimal-pad" />
                    </View>
                    <View style={{ flex: 1 }}>
                      {buyQty && parseFloat(buyQty) > 0 && (
                        <Text style={[s.totalCost, { color: colors.textSub }]}>
                          Total: <Text style={{ color: colors.text, fontWeight: "700" }}>{fmtMoney(tickerInfo.price * parseFloat(buyQty))}</Text>
                        </Text>
                      )}
                      <TouchableOpacity style={[s.buyBtn, (!buyQty || parseFloat(buyQty) <= 0 || buyLoading) && s.buyBtnDisabled]}
                        onPress={handleBuy} disabled={!buyQty || parseFloat(buyQty) <= 0 || buyLoading}>
                        {buyLoading
                          ? <ActivityIndicator color="white" size="small" />
                          : <Text style={s.buyBtnText}>Comprar {buyQty || "—"} {tickerInfo.ticker}</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {/* Positions */}
              {positions.length > 0 && (
                <>
                  <View style={s.sectionRow}>
                    <Text style={[s.sectionTitle, { color: colors.text }]}>Mis posiciones</Text>
                    {pricesLoading && <ActivityIndicator size="small" color={colors.accentLight} />}
                  </View>
                  {positions.map((pos) => {
                    const live = posPrices[pos.ticker];
                    const cp   = live?.price ?? pos.avgPrice;
                    const diff = pos.shares * cp - pos.shares * pos.avgPrice;
                    const pct  = pos.avgPrice > 0 ? (diff / (pos.shares * pos.avgPrice)) * 100 : 0;
                    const up   = diff >= 0;
                    return (
                      <View key={pos.id} style={[s.posCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={s.posTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={[s.posTicker, { color: colors.text }]}>{pos.ticker}</Text>
                            <Text style={[s.posName, { color: colors.textMuted }]}>{pos.name}</Text>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={[s.posValue, { color: colors.text }]}>{fmtMoney(pos.shares * cp)}</Text>
                            <View style={[s.posChangeBadge, { backgroundColor: (up ? "#22c55e" : "#ef4444") + "18" }]}>
                              <Ionicons name={up ? "caret-up" : "caret-down"} size={10} color={up ? "#22c55e" : "#ef4444"} />
                              <Text style={[s.posChangePct, { color: up ? "#22c55e" : "#ef4444" }]}>{fmtPct(pct)} ({up ? "+" : ""}{fmtMoney(Math.abs(diff))})</Text>
                            </View>
                          </View>
                        </View>
                        <View style={[s.posBottom, { borderTopColor: colors.border }]}>
                          <Text style={[s.posDetail, { color: colors.textDim }]}>
                            {pos.shares} acc · Costo ${pos.avgPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })} · Actual ${cp.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                          </Text>
                          <TouchableOpacity style={s.sellBtn} onPress={() => setSellModal({ ticker: pos.ticker, maxShares: pos.shares, price: cp })}>
                            <Text style={s.sellBtnText}>Vender</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </>
              )}

              {positions.length === 0 && trades.length === 0 && (
                <View style={s.emptyState}>
                  <Ionicons name="game-controller-outline" size={48} color={colors.textMuted} style={{ marginBottom: 12 }} />
                  <Text style={[s.emptyTitle, { color: colors.textMuted }]}>Empieza a operar</Text>
                  <Text style={[s.emptySub, { color: colors.textDim }]}>
                    Busca cualquier ticker arriba y compra a precios reales con tus ${PAPER_INITIAL_CASH.toLocaleString()} virtuales
                  </Text>
                </View>
              )}

              {/* History */}
              {trades.length > 0 && (
                <>
                  <TouchableOpacity style={s.sectionRow} onPress={() => setHistoryOpen((v) => !v)}>
                    <Text style={[s.sectionTitle, { color: colors.text }]}>Historial ({trades.length})</Text>
                    <Ionicons name={historyOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                  {historyOpen && (
                    <View style={[s.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      {trades.slice(0, 30).map((t) => {
                        const isTopup = t.type === "topup";
                        const isBuy   = t.type === "buy";
                        return (
                          <View key={t.id} style={[s.tradeRow, { borderBottomColor: colors.border }]}>
                            <View style={[s.tradeBadge, { backgroundColor: isTopup ? "#22c55e22" : isBuy ? "#22c55e22" : "#ef444422" }]}>
                              <Text style={[s.tradeBadgeText, { color: isTopup ? "#22c55e" : isBuy ? "#22c55e" : "#ef4444" }]}>
                                {isTopup ? "$" : isBuy ? "C" : "V"}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[s.tradeTicker, { color: colors.text }]}>{isTopup ? "Recarga" : t.ticker}</Text>
                              <Text style={[s.tradeDetail, { color: colors.textDim }]}>
                                {isTopup ? "Fondos virtuales añadidos" : `${t.shares} acc @ $${t.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
                              </Text>
                            </View>
                            <View style={{ alignItems: "flex-end" }}>
                              <Text style={[s.tradeTotal, { color: isBuy ? "#ef4444" : "#22c55e" }]}>
                                {isBuy ? "-" : "+"}{fmtMoney(t.total)}
                              </Text>
                              <Text style={[s.tradeDate, { color: colors.textDim }]}>
                                {new Date(t.timestamp).toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </>
              )}
            </>
          )}

          {/* ══════════════════ LIGA TAB ══════════════════ */}
          {activeTab === "liga" && (
            <View style={{ gap: 12 }}>

              {/* Period selector */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([
                  { id: "week",  label: "Esta semana" },
                  { id: "month", label: "Este mes" },
                  { id: "all",   label: "Todo tiempo" },
                ] as const).map((p) => (
                  <TouchableOpacity key={p.id} onPress={() => setLeaguePeriod(p.id)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, borderWidth: 1,
                      borderColor: leaguePeriod === p.id ? "rgba(0,168,94,0.4)" : colors.border,
                      backgroundColor: leaguePeriod === p.id ? "rgba(0,168,94,0.12)" : "transparent",
                    }}>
                    <Text style={{
                      fontSize: 12, fontWeight: "600",
                      color: leaguePeriod === p.id ? colors.accentLight : colors.textMuted,
                    }}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* My rank card */}
              <View style={{
                borderRadius: 20, borderWidth: 1, padding: 18,
                borderColor: (myEntry?.returnPct ?? 0) >= 0 ? "rgba(0,168,94,0.25)" : "rgba(255,71,87,0.25)",
                backgroundColor: (myEntry?.returnPct ?? 0) >= 0 ? "rgba(0,168,94,0.07)" : "rgba(255,71,87,0.07)",
              }}>
                <Text style={{ fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, color: colors.textMuted, marginBottom: 12 }}>
                  Tu posición
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                    <Text style={{ fontSize: 44, fontWeight: "900", letterSpacing: -2, color: colors.text }}>
                      #{myEntry?.rank ?? "—"}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.textMuted }}>
                      de {TOTAL_PARTICIPANTS.toLocaleString()}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{
                      fontSize: 28, fontWeight: "900", letterSpacing: -1,
                      color: (myEntry?.returnPct ?? 0) >= 0 ? "#22c55e" : "#ef4444",
                    }}>
                      {(myEntry?.returnPct ?? 0) >= 0 ? "+" : ""}{(myEntry?.returnPct ?? 0).toFixed(1)}%
                    </Text>
                    <Text style={{ fontSize: 11, color: "#f59e0b", fontWeight: "600", marginTop: 3 }}>
                      ↑ Subiste 2 posiciones
                    </Text>
                  </View>
                </View>
              </View>

              {/* Lesson card */}
              <View style={{
                borderRadius: 16, borderWidth: 1, padding: 14,
                borderColor: "rgba(59,130,246,0.2)", backgroundColor: "rgba(59,130,246,0.05)",
              }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 7 }}>
                  <Ionicons name="bulb-outline" size={14} color="#60a5fa" />
                  <Text style={{ fontSize: 12, fontWeight: "700", color: "#60a5fa" }}>Lección del mercado</Text>
                </View>
                <Text style={{ fontSize: 12, color: colors.textSub, lineHeight: 19 }}>
                  {LEAGUE_LESSONS[leaguePeriod]}
                </Text>
              </View>

              {/* Leaderboard */}
              <View style={{ borderRadius: 20, borderWidth: 1, overflow: "hidden", backgroundColor: colors.card, borderColor: colors.border }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>Tabla de líderes</Text>
                  <Text style={{ fontSize: 11, color: colors.textDim }}>{TOTAL_PARTICIPANTS.toLocaleString()} inversores</Text>
                </View>
                {top5.map((entry) => <LeagueRow key={entry.rank} entry={entry} colors={colors} />)}
                {showEllipsis && (
                  <>
                    <Text style={{ textAlign: "center", paddingVertical: 8, fontSize: 14, letterSpacing: 3, color: colors.textDim }}>···</Text>
                    {myEntry && <LeagueRow entry={myEntry} colors={colors} />}
                  </>
                )}
              </View>

              <Text style={{ textAlign: "center", fontSize: 11, color: colors.textDim, paddingBottom: 8 }}>
                Retorno % desde $10,000 virtuales · Actualizado en tiempo real
              </Text>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      <SellModal
        visible={!!sellModal} ticker={sellModal?.ticker ?? ""}
        maxShares={sellModal?.maxShares ?? 0} price={sellModal?.price ?? 0}
        onClose={() => setSellModal(null)} onSell={confirmSell}
      />

      {/* Top-up modal */}
      <Modal visible={topUpOpen} transparent animationType="slide" onRequestClose={() => setTopUpOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={[s.topUpSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.topUpHandle} />
            <Text style={[s.topUpTitle, { color: colors.text }]}>Recargar saldo virtual</Text>
            <Text style={[s.topUpSub, { color: colors.textMuted }]}>Añade fondos para seguir practicando sin riesgo</Text>
            <View style={s.planGrid}>
              {TOP_UP_PLANS.map((plan) => (
                <TouchableOpacity key={plan.id}
                  style={[s.planCard, { borderColor: plan.color + "55", backgroundColor: plan.color + "12" }]}
                  onPress={() => { topUp(plan.amount); setTopUpOpen(false); Alert.alert("¡Recarga exitosa!", `Se añadieron ${plan.label} a tu cuenta virtual.`); }}>
                  {plan.tag && (
                    <View style={[s.planTag, { backgroundColor: plan.color }]}>
                      <Text style={s.planTagText}>{plan.tag}</Text>
                    </View>
                  )}
                  <Text style={[s.planAmount, { color: plan.color }]}>{plan.label}</Text>
                  <Text style={[s.planPrice, { color: colors.text }]}>{plan.price}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[s.topUpCloseBtn, { borderColor: colors.border }]} onPress={() => setTopUpOpen(false)}>
              <Text style={[s.topUpCloseBtnText, { color: colors.textMuted }]}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <PaywallModal
        visible={paywallOpen} onClose={() => setPaywallOpen(false)}
        reason={
          !isPremiumAccess && freeTradesThisMonth() >= FREE_PAPER_MONTHLY_TRADES
            ? `Alcanzaste el límite de ${FREE_PAPER_MONTHLY_TRADES} operaciones gratuitas este mes. Activa Premium para trading ilimitado con $100,000 virtuales.`
            : "Activa Premium para trading ilimitado con $100,000 virtuales y sin restricciones de capital."
        }
      />
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 14, paddingBottom: 48, gap: 12 },

    // Tab switcher
    tabBar: { flexDirection: "row", borderRadius: 16, padding: 4, gap: 4, marginBottom: 2 },
    tabBtn: { flex: 1, paddingVertical: 9, alignItems: "center", justifyContent: "center", borderRadius: 12 },
    tabBtnText: { fontSize: 13, fontWeight: "700", letterSpacing: -0.2 },

    // Balance card
    balanceCard: { borderRadius: 20, borderWidth: 1, padding: 18 },
    balanceRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 14 },
    balanceLabel: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
    balanceTotal: { fontSize: 34, fontWeight: "900", marginBottom: 8, letterSpacing: -1 },
    balanceReturnRow: { flexDirection: "row" },
    returnBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
    returnBadgeText: { fontSize: 12, fontWeight: "700" },
    resetBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 },
    resetBtnText: { fontSize: 11, fontWeight: "600", color: "#ef4444" },
    balanceSplit: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
    balanceSplitItem: { flex: 1, alignItems: "center", gap: 3 },
    balanceSplitLabel: { fontSize: 10, letterSpacing: 0.3 },
    balanceSplitVal: { fontSize: 14, fontWeight: "800" },
    balanceSplitDivider: { width: StyleSheet.hairlineWidth, marginVertical: 2 },

    // Buy card
    buyCard: { borderRadius: 20, borderWidth: 1, padding: 16 },
    searchBar: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 },
    searchInput: { flex: 1, fontSize: 15, fontWeight: "600", letterSpacing: 0.3 },
    searchState: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 4 },
    searchStateText: { fontSize: 13 },
    tickerResult: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 },
    tickerResultLeft: { flex: 1, gap: 3 },
    tickerSymbol: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
    tickerName: { fontSize: 12, letterSpacing: 0.1 },
    tickerResultRight: { alignItems: "flex-end", gap: 5 },
    tickerPrice: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
    tickerChangeBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
    tickerChangePct: { fontSize: 12, fontWeight: "700" },
    buyForm: { flexDirection: "row", gap: 10, alignItems: "flex-end" },
    qtyWrap: { borderWidth: 1, borderRadius: 14, padding: 12, width: 110 },
    qtyLabel: { fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
    qtyInput: { fontSize: 22, fontWeight: "900", padding: 0, letterSpacing: -0.5 },
    totalCost: { fontSize: 12, marginBottom: 7 },
    buyBtn: { backgroundColor: c.accent, borderRadius: 14, paddingVertical: 14, alignItems: "center", justifyContent: "center", shadowColor: c.accentLight, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
    buyBtnDisabled: { opacity: 0.35 },
    buyBtnText: { color: "white", fontWeight: "800", fontSize: 14, letterSpacing: 0.1 },

    // Sections
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, marginTop: 6 },
    sectionTitle: { fontSize: 16, fontWeight: "700", letterSpacing: -0.2 },

    // Position card
    posCard: { borderRadius: 18, borderWidth: 1, padding: 14 },
    posTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
    posTicker: { fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
    posName: { fontSize: 11, marginTop: 2, letterSpacing: 0.1 },
    posValue: { fontSize: 18, fontWeight: "800" },
    posChangeBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, marginTop: 4 },
    posChangePct: { fontSize: 12, fontWeight: "700" },
    posBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 11 },
    posDetail: { fontSize: 11, flex: 1, marginRight: 10, lineHeight: 17 },
    sellBtn: { borderWidth: 1, borderColor: c.down + "66", borderRadius: 10, paddingHorizontal: 13, paddingVertical: 7 },
    sellBtnText: { color: c.down, fontSize: 12, fontWeight: "700" },

    // Empty state
    emptyState: { alignItems: "center", paddingTop: 56, paddingHorizontal: 32 },
    emptyTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8, letterSpacing: -0.3 },
    emptySub: { fontSize: 13, textAlign: "center", lineHeight: 21 },

    // History
    historyCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
    tradeRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
    tradeBadge: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    tradeBadgeText: { fontSize: 12, fontWeight: "800" },
    tradeTicker: { fontSize: 14, fontWeight: "700", letterSpacing: -0.1 },
    tradeDetail: { fontSize: 11, marginTop: 2, letterSpacing: 0.1 },
    tradeTotal: { fontSize: 14, fontWeight: "800" },
    tradeDate: { fontSize: 10, marginTop: 3 },

    // TopUp modal
    topUpSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, padding: 24, paddingTop: 14 },
    topUpHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, alignSelf: "center", marginBottom: 22 },
    topUpTitle: { fontSize: 20, fontWeight: "800", marginBottom: 5, letterSpacing: -0.4 },
    topUpSub: { fontSize: 13, marginBottom: 20, lineHeight: 19 },
    planGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
    planCard: { width: "47%", borderWidth: 1, borderRadius: 18, padding: 16, overflow: "hidden" },
    planTag: { alignSelf: "flex-start", borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, marginBottom: 10 },
    planTagText: { color: "white", fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },
    planAmount: { fontSize: 24, fontWeight: "900", marginBottom: 4, letterSpacing: -0.5 },
    planPrice: { fontSize: 14, fontWeight: "600" },
    topUpCloseBtn: { borderWidth: 1, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
    topUpCloseBtnText: { fontWeight: "600", fontSize: 14 },
    suggestionsBox: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: "hidden" },
    suggestionRow: { paddingHorizontal: 14, paddingVertical: 10 },
    suggestionTicker: { fontSize: 13, fontWeight: "700" },
    suggestionName: { fontSize: 11, marginTop: 1 },
  });
}
