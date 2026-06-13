import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import StockAvatar from "../../src/components/StockAvatar";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, SafeAreaView, Modal,
  Alert, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { marketApi, paperApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { usePaperStore, PAPER_INITIAL_CASH, FREE_PAPER_INITIAL_CASH, FREE_PAPER_MONTHLY_TRADES, TOP_UP_PLANS } from "../../src/lib/paperStore";
import { useSubscriptionStore, hasPremiumAccess, isTrialActive, trialDaysLeft } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";

interface PaperAnalysis {
  verdict: "practice_more" | "promising" | "ready";
  headline: string;
  feedback: string;
  positives: string[];
  improvements: string[];
  disclaimer: string;
}

interface TickerInfo {
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
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

  // AI analysis
  const [analysis, setAnalysis] = useState<PaperAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const runAnalysis = async () => {
    setAnalysisLoading(true);
    try {
      const res = await paperApi.analyze(
        positions, trades, totalReturnPct, cash, totalValue,
      );
      setAnalysis(res.data as PaperAnalysis);
    } catch {
      setAnalysis({
        verdict: "promising",
        headline: "Error al generar análisis",
        feedback: "No se pudo conectar con la IA. Intenta de nuevo.",
        positives: [],
        improvements: [],
        disclaimer: "",
      });
    }
    setAnalysisLoading(false);
  };

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

          {/* Balance card */}
              <View style={[s.balanceCard, { backgroundColor: colors.card, borderColor: isUp ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)" }]}>
                {/* Colored top accent */}
                <View style={[s.posCardAccent, { backgroundColor: isUp ? "#22c55e" : "#ef4444", height: 3 }]} />
                <View style={s.balanceCardInner}>
                  <View style={s.balanceRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.balanceLabel, { color: colors.textMuted }]}>Portafolio virtual</Text>
                      <Text style={[s.balanceTotal, { color: colors.text }]}>{fmtMoney(totalValue)}</Text>
                      <View style={s.balanceReturnRow}>
                        <View style={[s.returnBadge, { backgroundColor: (isUp ? "#22c55e" : "#ef4444") + "18" }]}>
                          <Ionicons name={isUp ? "trending-up" : "trending-down"} size={13} color={isUp ? "#22c55e" : "#ef4444"} />
                          <Text style={[s.returnBadgeText, { color: isUp ? "#22c55e" : "#ef4444" }]}>
                            {isUp ? "+" : ""}{fmtMoney(Math.abs(totalReturn))} ({fmtPct(totalReturnPct)})
                          </Text>
                        </View>
                      </View>
                    </View>
                    <View style={s.actionBtns}>
                      <TouchableOpacity style={[s.resetBtn, { backgroundColor: "#22c55e12", borderColor: "#22c55e44" }]} onPress={() => setTopUpOpen(true)}>
                        <Ionicons name="add-circle-outline" size={14} color="#22c55e" />
                        <Text style={s.topUpBtnText}>Recargar</Text>
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
              </View>

              {/* Search + buy */}
              <View style={[s.buyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={s.buyCardHeader}>
                  <View style={s.buyCardIcon}>
                    <Ionicons name="add" size={16} color="#00d47e" />
                  </View>
                  <Text style={[s.buyCardTitle, { color: colors.text }]}>Comprar acciones</Text>
                </View>
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
                  <View style={[s.suggestionsBox, { backgroundColor: "#dbeafe", borderColor: "#93c5fd" }]}>
                    {suggestions.map((s2, i) => (
                      <TouchableOpacity key={s2.ticker}
                        style={[s.suggestionRow, i < suggestions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#bfdbfe" }]}
                        onPress={() => selectSuggestion(s2.ticker)}>
                        <Text style={[s.suggestionTicker, { color: "#1d4ed8" }]}>{s2.ticker}</Text>
                        <Text style={[s.suggestionName, { color: "#2563eb" }]} numberOfLines={1}>{s2.name}</Text>
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
                    const col  = up ? "#22c55e" : "#ef4444";
                    return (
                      <View key={pos.id} style={[s.posCardWrapper, { backgroundColor: colors.card, borderColor: col + "30" }]}>
                        <View style={[s.posCardAccent, { backgroundColor: col }]} />
                        <View style={s.posCard}>
                          <View style={s.posTop}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                              <StockAvatar ticker={pos.ticker} size={36} />
                              <View style={{ flex: 1 }}>
                                <Text style={[s.posTicker, { color: colors.text }]}>{pos.ticker}</Text>
                                <Text style={[s.posName, { color: colors.textMuted }]}>{pos.name}</Text>
                              </View>
                            </View>
                            <View style={{ alignItems: "flex-end" }}>
                              <Text style={[s.posValue, { color: colors.text }]}>{fmtMoney(pos.shares * cp)}</Text>
                              <View style={[s.posChangeBadge, { backgroundColor: col + "18" }]}>
                                <Ionicons name={up ? "caret-up" : "caret-down"} size={10} color={col} />
                                <Text style={[s.posChangePct, { color: col }]}>{fmtPct(pct)} ({up ? "+" : ""}{fmtMoney(Math.abs(diff))})</Text>
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
              {/* ── AI Analysis card ── */}
              <View style={[s.analysisCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {/* Header */}
                <View style={s.analysisHeader}>
                  <View style={s.analysisIcon}>
                    <Ionicons name="sparkles" size={15} color="#a855f7" />
                  </View>
                  <Text style={[s.analysisTitle, { color: colors.text }]}>Análisis IA de tu simulación</Text>
                  {!isPremiumAccess && (
                    <View style={s.premiumBadge}>
                      <Text style={s.premiumBadgeText}>Premium</Text>
                    </View>
                  )}
                </View>

                {!isPremiumAccess ? (
                  /* Locked */
                  <View style={s.lockedBody}>
                    <View style={[s.lockIcon, { borderColor: "rgba(168,85,247,0.2)", backgroundColor: "rgba(168,85,247,0.08)" }]}>
                      <Ionicons name="lock-closed" size={22} color="#a855f7" />
                    </View>
                    <Text style={[s.lockTitle, { color: colors.text }]}>
                      La IA evalúa si estás listo para invertir de verdad
                    </Text>
                    <Text style={[s.lockSub, { color: colors.textMuted }]}>
                      Recibe feedback personalizado sobre tu estrategia, diversificación y comportamiento. Solo Premium.
                    </Text>
                    <TouchableOpacity style={s.unlockBtn} onPress={() => setPaywallOpen(true)}>
                      <Text style={s.unlockBtnText}>Activar Premium</Text>
                    </TouchableOpacity>
                  </View>
                ) : analysis ? (
                  /* Results */
                  <View style={s.analysisBody}>
                    {/* Verdict badge */}
                    <View style={s.verdictRow}>
                      <Text style={{ fontSize: 32 }}>
                        {analysis.verdict === "ready" ? "🏆" : analysis.verdict === "promising" ? "📈" : "📚"}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.verdictHeadline, {
                          color: analysis.verdict === "ready" ? "#22c55e"
                               : analysis.verdict === "promising" ? "#f59e0b"
                               : colors.text,
                        }]}>
                          {analysis.headline}
                        </Text>
                        <View style={[s.verdictBadge, {
                          backgroundColor: analysis.verdict === "ready" ? "rgba(34,197,94,0.12)"
                                         : analysis.verdict === "promising" ? "rgba(245,158,11,0.12)"
                                         : "rgba(99,102,241,0.12)",
                        }]}>
                          <Text style={[s.verdictBadgeText, {
                            color: analysis.verdict === "ready" ? "#22c55e"
                                 : analysis.verdict === "promising" ? "#f59e0b"
                                 : "#818cf8",
                          }]}>
                            {analysis.verdict === "ready" ? "✓ Listo para invertir con responsabilidad"
                           : analysis.verdict === "promising" ? "↗ Vas por buen camino"
                           : "↺ Sigue practicando un poco más"}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Main feedback */}
                    <Text style={[s.analysisFeedback, { color: colors.textSub }]}>{analysis.feedback}</Text>

                    {/* Positives */}
                    {analysis.positives.length > 0 && (
                      <View style={s.analysisSection}>
                        <Text style={[s.analysisSectionLabel, { color: "#22c55e" }]}>LO QUE HACES BIEN</Text>
                        {analysis.positives.map((p, i) => (
                          <View key={i} style={s.analysisItem}>
                            <Text style={{ color: "#22c55e", fontSize: 12, marginTop: 1 }}>✓</Text>
                            <Text style={[s.analysisItemText, { color: colors.textSub }]}>{p}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Improvements */}
                    {analysis.improvements.length > 0 && (
                      <View style={s.analysisSection}>
                        <Text style={[s.analysisSectionLabel, { color: "#f59e0b" }]}>ÁREAS A MEJORAR</Text>
                        {analysis.improvements.map((imp, i) => (
                          <View key={i} style={s.analysisItem}>
                            <Text style={{ color: "#f59e0b", fontSize: 12, marginTop: 1 }}>→</Text>
                            <Text style={[s.analysisItemText, { color: colors.textSub }]}>{imp}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Disclaimer */}
                    {!!analysis.disclaimer && (
                      <View style={[s.disclaimer, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
                        <Text style={[s.disclaimerText, { color: colors.textDim }]}>⚠️ {analysis.disclaimer}</Text>
                      </View>
                    )}

                    {/* Re-analyze */}
                    <TouchableOpacity
                      style={[s.reanalyzeBtn, { borderColor: "rgba(168,85,247,0.3)", backgroundColor: "rgba(168,85,247,0.06)" }]}
                      onPress={() => setAnalysis(null)}
                    >
                      <Text style={[s.reanalyzeBtnText, { color: "#a855f7" }]}>Volver a analizar</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  /* CTA */
                  <View style={s.analysisBody}>
                    <Text style={[s.analysisCta, { color: colors.textMuted }]}>
                      La IA analiza tu estrategia, diversificación y comportamiento para decirte si estás listo para invertir dinero real en acciones individuales — siempre con responsabilidad e investigación previa.
                    </Text>
                    <TouchableOpacity
                      style={[s.analyzeBtn, (analysisLoading || trades.length === 0) && { opacity: 0.5 }]}
                      onPress={runAnalysis}
                      disabled={analysisLoading || trades.length === 0}
                    >
                      {analysisLoading ? (
                        <>
                          <ActivityIndicator color="white" size="small" />
                          <Text style={s.analyzeBtnText}>Analizando tu simulación…</Text>
                        </>
                      ) : (
                        <>
                          <Ionicons name="sparkles" size={16} color="white" />
                          <Text style={s.analyzeBtnText}>Analizar mi portafolio con IA</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    {trades.length === 0 && (
                      <Text style={[s.analysisCta, { color: colors.textDim, textAlign: "center", fontSize: 10, marginTop: 0 }]}>
                        Realiza al menos una operación para desbloquear el análisis
                      </Text>
                    )}
                  </View>
                )}
              </View>

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

    // Balance card — hero section
    balanceCard: {
      borderRadius: 22, borderWidth: 1, overflow: "hidden",
      shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12, shadowRadius: 12, elevation: 6,
    },
    balanceCardInner: { padding: 18 },
    balanceRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16 },
    balanceLabel: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 },
    balanceTotal: { fontSize: 36, fontWeight: "900", marginBottom: 10, letterSpacing: -1.5 },
    balanceReturnRow: { flexDirection: "row" },
    returnBadge: {
      flexDirection: "row", alignItems: "center", gap: 6,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6,
    },
    returnBadgeText: { fontSize: 13, fontWeight: "800" },
    actionBtns: { flexDirection: "column", gap: 7, alignItems: "flex-end" },
    resetBtn: {
      flexDirection: "row", alignItems: "center", gap: 5,
      borderWidth: 1, borderColor: c.border, borderRadius: 10,
      paddingHorizontal: 10, paddingVertical: 7,
    },
    resetBtnText: { fontSize: 11, fontWeight: "600", color: "#ef4444" },
    topUpBtnText: { fontSize: 11, fontWeight: "700", color: "#22c55e" },
    balanceSplit: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, marginTop: 2 },
    balanceSplitItem: { flex: 1, alignItems: "center", gap: 4 },
    balanceSplitLabel: { fontSize: 9, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
    balanceSplitVal: { fontSize: 15, fontWeight: "900" },
    balanceSplitDivider: { width: StyleSheet.hairlineWidth, marginVertical: 2 },

    // Buy card
    buyCard: { borderRadius: 20, borderWidth: 1, padding: 16 },
    buyCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
    buyCardIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,212,126,0.12)" },
    buyCardTitle: { fontSize: 14, fontWeight: "700" },
    searchBar: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 },
    searchInput: { flex: 1, fontSize: 15, fontWeight: "600", letterSpacing: 0.3 },
    searchState: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 4 },
    searchStateText: { fontSize: 13 },
    tickerResult: {
      flexDirection: "row", alignItems: "center", borderWidth: 1,
      borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
      borderColor: "rgba(0,212,126,0.25)", backgroundColor: "rgba(0,212,126,0.04)",
    },
    tickerResultLeft: { flex: 1, gap: 3 },
    tickerSymbol: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
    tickerName: { fontSize: 12, letterSpacing: 0.1 },
    tickerResultRight: { alignItems: "flex-end", gap: 6 },
    tickerPrice: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
    tickerChangeBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
    tickerChangePct: { fontSize: 12, fontWeight: "700" },
    buyForm: { flexDirection: "row", gap: 10, alignItems: "flex-end" },
    qtyWrap: { borderWidth: 1, borderRadius: 14, padding: 12, width: 110 },
    qtyLabel: { fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
    qtyInput: { fontSize: 22, fontWeight: "900", padding: 0, letterSpacing: -0.5 },
    totalCost: { fontSize: 12, marginBottom: 7 },
    buyBtn: {
      backgroundColor: c.accent, borderRadius: 14, paddingVertical: 14,
      alignItems: "center", justifyContent: "center",
      shadowColor: "#00a85e", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    },
    buyBtnDisabled: { opacity: 0.35 },
    buyBtnText: { color: "white", fontWeight: "800", fontSize: 14, letterSpacing: 0.1 },

    // Sections
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, marginTop: 4 },
    sectionTitle: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },

    // Position card — with colored top border via wrapper
    posCardWrapper: { borderRadius: 18, overflow: "hidden", borderWidth: 1 },
    posCardAccent: { height: 3 },
    posCard: { padding: 14 },
    posTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
    posTicker: { fontSize: 20, fontWeight: "900", letterSpacing: -0.5 },
    posName: { fontSize: 11, marginTop: 3, letterSpacing: 0.1 },
    posValue: { fontSize: 20, fontWeight: "900" },
    posChangeBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginTop: 5 },
    posChangePct: { fontSize: 12, fontWeight: "800" },
    posBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
    posDetail: { fontSize: 11, flex: 1, marginRight: 10, lineHeight: 17 },
    sellBtn: {
      borderWidth: 1, borderColor: c.down + "55", borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 8,
      backgroundColor: "rgba(239,68,68,0.06)",
    },
    sellBtnText: { color: c.down, fontSize: 12, fontWeight: "700" },

    // Empty state
    emptyState: { alignItems: "center", paddingTop: 56, paddingHorizontal: 32 },
    emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 16, backgroundColor: "rgba(0,212,126,0.1)" },
    emptyTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8, letterSpacing: -0.3 },
    emptySub: { fontSize: 13, textAlign: "center", lineHeight: 21 },

    // History
    historyCard: { borderRadius: 18, borderWidth: 1, overflow: "hidden" },
    tradeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
    tradeBadge: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    tradeBadgeText: { fontSize: 13, fontWeight: "900" },
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
    suggestionsBox: { borderRadius: 14, borderWidth: 1, marginBottom: 8, overflow: "hidden", backgroundColor: "#0f172a", borderColor: "rgba(0,212,126,0.25)" },
    suggestionRow: { paddingHorizontal: 14, paddingVertical: 11 },
    suggestionTicker: { fontSize: 13, fontWeight: "700", color: "#00d47e" },
    suggestionName: { fontSize: 11, marginTop: 1 },

    // AI Analysis card
    analysisCard: { borderRadius: 20, borderWidth: 1, overflow: "hidden" },
    analysisHeader: {
      flexDirection: "row", alignItems: "center", gap: 8,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
    },
    analysisIcon: {
      width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center",
      backgroundColor: "rgba(168,85,247,0.12)",
    },
    analysisTitle: { fontSize: 14, fontWeight: "700", flex: 1 },
    premiumBadge: { backgroundColor: "rgba(168,85,247,0.12)", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
    premiumBadgeText: { fontSize: 9, fontWeight: "800", color: "#a855f7" },

    // Locked state
    lockedBody: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 28, gap: 10 },
    lockIcon: {
      width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center",
      borderWidth: 1, marginBottom: 4,
    },
    lockTitle: { fontSize: 14, fontWeight: "700", textAlign: "center", lineHeight: 20 },
    lockSub: { fontSize: 12, textAlign: "center", lineHeight: 18 },
    unlockBtn: {
      paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginTop: 4,
      backgroundColor: "#a855f7",
    },
    unlockBtnText: { color: "white", fontWeight: "700", fontSize: 13 },

    // Results + CTA body
    analysisBody: { padding: 16, gap: 14 },
    verdictRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    verdictHeadline: { fontSize: 16, fontWeight: "900", lineHeight: 20, marginBottom: 5 },
    verdictBadge: { alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
    verdictBadgeText: { fontSize: 10, fontWeight: "700" },
    analysisFeedback: { fontSize: 13, lineHeight: 20 },
    analysisSection: { gap: 6 },
    analysisSectionLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
    analysisItem: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    analysisItemText: { fontSize: 12, lineHeight: 18, flex: 1 },
    disclaimer: { borderRadius: 12, borderWidth: 1, padding: 12 },
    disclaimerText: { fontSize: 11, lineHeight: 17 },
    reanalyzeBtn: { borderWidth: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center" },
    reanalyzeBtnText: { fontSize: 12, fontWeight: "600" },
    analysisCta: { fontSize: 12, lineHeight: 19 },
    analyzeBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      paddingVertical: 14, borderRadius: 14,
      backgroundColor: "#a855f7",
    },
    analyzeBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
  });
}
