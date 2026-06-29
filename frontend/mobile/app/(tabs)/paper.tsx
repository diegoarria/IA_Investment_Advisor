import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import StockAvatar from "../../src/components/StockAvatar";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, SafeAreaView, Modal,
  Alert, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { marketApi, paperApi } from "../../src/lib/api";
import { posthog } from "../../src/config/posthog";
import { usePaperStore, PAPER_INITIAL_CASH } from "../../src/lib/paperStore";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
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
  const [qty, setQty] = useState("");
  const parsed = parseFloat(qty) || 0;
  const valid = parsed > 0 && parsed <= maxShares;
  useEffect(() => { if (visible) setQty(""); }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)" }} activeOpacity={1} onPress={onClose} />
        <View style={SM.sheet}>
          <View style={SM.handle} />
          <Text style={SM.title}>Vender {ticker}</Text>
          <Text style={SM.sub}>
            Precio actual: <Text style={{ color: "#fff", fontWeight: "700" }}>${price.toLocaleString("en-US", { minimumFractionDigits: 2 })}</Text>
            {"  ·  "}Tienes {maxShares} acciones
          </Text>
          <View style={SM.inputWrap}>
            <TextInput style={SM.input} value={qty} onChangeText={setQty}
              placeholder={`1 – ${maxShares}`} placeholderTextColor="#374151"
              keyboardType="decimal-pad" autoFocus />
            <TouchableOpacity onPress={() => setQty(String(maxShares))} style={SM.maxBtn}>
              <Text style={SM.maxBtnText}>MAX</Text>
            </TouchableOpacity>
          </View>
          {parsed > 0 && (
            <Text style={SM.proceeds}>
              Recibirás:{" "}
              <Text style={{ color: "#00d47e", fontWeight: "800" }}>{fmtMoney(parsed * price)}</Text>
            </Text>
          )}
          <View style={SM.actions}>
            <TouchableOpacity style={SM.cancelBtn} onPress={onClose}>
              <Text style={SM.cancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[SM.sellBtn, !valid && { opacity: 0.4 }]}
              onPress={() => { if (valid) { onSell(parsed); onClose(); } }} disabled={!valid}>
              <Text style={SM.sellBtnText}>Vender {qty || "—"} acc</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const SM = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderWidth: 1, borderColor: "#1f2330", backgroundColor: "#111318",
    padding: 24, paddingTop: 12,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#374151", alignSelf: "center", marginBottom: 20 },
  title: { fontSize: 20, fontWeight: "800", color: "#fff", marginBottom: 6 },
  sub: { fontSize: 13, color: "#6b7280", marginBottom: 18 },
  inputWrap: {
    flexDirection: "row", alignItems: "center", borderWidth: 1,
    borderColor: "#1f2330", backgroundColor: "#0a0d12",
    borderRadius: 14, paddingHorizontal: 14, marginBottom: 10,
  },
  input: { flex: 1, fontSize: 18, fontWeight: "700", paddingVertical: 14, color: "#fff" },
  maxBtn: { backgroundColor: "rgba(0,212,126,0.15)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  maxBtnText: { color: "#00d47e", fontSize: 11, fontWeight: "800" },
  proceeds: { fontSize: 14, color: "#9ca3af", marginBottom: 18 },
  actions: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: "#1f2330", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  cancelText: { fontWeight: "600", fontSize: 14, color: "#6b7280" },
  sellBtn: { flex: 2, backgroundColor: "#ef4444", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  sellBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function PaperScreen() {
  const s = darkStyles;
  const subStore = useSubscriptionStore();
  const isPremiumAccess = hasPremiumAccess(subStore);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const { cash, positions, trades, buy, sell, topUp, reset } = usePaperStore();

  const [query, setQuery]             = useState("");
  const [tickerInfo, setTickerInfo]   = useState<TickerInfo | null>(null);
  const [searching, setSearching]     = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[]>([]);
  const debounceRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [buyQty, setBuyQty]         = useState("");
  const [buyLoading, setBuyLoading] = useState(false);

  const [posPrices, setPosPrices]         = useState<Record<string, { price: number; change_pct: number }>>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  const [sellModal, setSellModal]       = useState<{ ticker: string; maxShares: number; price: number } | null>(null);
  const [historyOpen, setHistoryOpen]   = useState(false);
  const [analysis, setAnalysis]         = useState<PaperAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const runAnalysis = async () => {
    posthog.capture("paper_ai_analysis_requested", { trade_count: trades.length, return_pct: totalReturnPct });
    setAnalysisLoading(true);
    try {
      const res = await paperApi.analyze(positions, trades, totalReturnPct, cash, totalValue);
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
    setBuyLoading(true);
    const err = buy(tickerInfo.ticker, tickerInfo.name, shares, tickerInfo.price);
    if (err) { Alert.alert("Error", err); }
    else {
      posthog.capture("paper_trade_executed", { action: "buy", ticker: tickerInfo.ticker, shares, price: tickerInfo.price });
      setQuery(""); setBuyQty(""); setTickerInfo(null);
    }
    setBuyLoading(false);
  };

  const confirmSell = (shares: number) => {
    if (!sellModal) return;
    sell(sellModal.ticker, shares, sellModal.price);
    posthog.capture("paper_trade_executed", { action: "sell", ticker: sellModal.ticker, shares, price: sellModal.price });
    setPosPrices((prev) => ({ ...prev }));
  };

  const { virtualValue, totalValue, totalReturn, totalReturnPct } = useMemo(() => {
    const virtualValue = positions.reduce((acc, p) => acc + p.shares * (posPrices[p.ticker]?.price ?? p.avgPrice), 0);
    const totalValue   = cash + virtualValue;
    const totalReturn  = totalValue - PAPER_INITIAL_CASH;
    return { virtualValue, totalValue, totalReturn, totalReturnPct: (totalReturn / PAPER_INITIAL_CASH) * 100 };
  }, [cash, positions, posPrices]);

  const isUp = totalReturn >= 0;

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

          {/* Balance card */}
          <View style={[s.balanceCard, { borderColor: isUp ? "rgba(0,212,126,0.25)" : "rgba(239,68,68,0.25)" }]}>
            <View style={[s.topAccent, { backgroundColor: isUp ? "#00d47e" : "#ef4444" }]} />
            <View style={s.balanceCardInner}>
              <View style={s.balanceRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.balanceLabel}>Portafolio virtual</Text>
                  <Text style={s.balanceTotal}>{fmtMoney(totalValue)}</Text>
                  <View style={s.balanceReturnRow}>
                    <View style={[s.returnBadge, { backgroundColor: (isUp ? "#00d47e" : "#ef4444") + "18" }]}>
                      <Ionicons name={isUp ? "trending-up" : "trending-down"} size={13} color={isUp ? "#00d47e" : "#ef4444"} />
                      <Text style={[s.returnBadgeText, { color: isUp ? "#00d47e" : "#ef4444" }]}>
                        {isUp ? "+" : ""}{fmtMoney(Math.abs(totalReturn))} ({fmtPct(totalReturnPct)})
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={s.actionBtns}>
                  {[1000, 5000, 10000].map((amt) => (
                    <TouchableOpacity
                      key={amt}
                      style={[s.topUpBtn, { backgroundColor: "#00d47e12", borderColor: "#00d47e44" }]}
                      onPress={() => topUp(amt)}
                    >
                      <Ionicons name="add" size={12} color="#00d47e" />
                      <Text style={s.topUpBtnText}>{amt >= 1000 ? `+$${amt / 1000}K` : `+$${amt}`}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={s.resetBtn} onPress={() => Alert.alert("Reiniciar", "¿Volver a $10,000 virtuales?", [
                    { text: "Cancelar", style: "cancel" },
                    { text: "Reiniciar", style: "destructive", onPress: reset },
                  ])}>
                    <Ionicons name="refresh-outline" size={14} color="#ef4444" />
                    <Text style={s.resetBtnText}>Reset</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={s.balanceSplit}>
                <View style={s.balanceSplitItem}>
                  <Text style={s.balanceSplitLabel}>Efectivo</Text>
                  <Text style={[s.balanceSplitVal, { color: "#8b5cf6" }]}>{fmtMoney(cash)}</Text>
                </View>
                <View style={s.balanceSplitDivider} />
                <View style={s.balanceSplitItem}>
                  <Text style={s.balanceSplitLabel}>En acciones</Text>
                  <Text style={[s.balanceSplitVal, { color: "#fff" }]}>{fmtMoney(virtualValue)}</Text>
                </View>
                <View style={s.balanceSplitDivider} />
                <View style={s.balanceSplitItem}>
                  <Text style={s.balanceSplitLabel}>Posiciones</Text>
                  <Text style={[s.balanceSplitVal, { color: "#fff" }]}>{positions.length}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Search + buy */}
          <View style={s.buyCard}>
            <View style={s.buyCardHeader}>
              <View style={s.buyCardIcon}>
                <Ionicons name="add" size={16} color="#00d47e" />
              </View>
              <Text style={s.buyCardTitle}>Comprar acciones</Text>
            </View>
            <View style={s.searchBar}>
              <Ionicons name="search-outline" size={18} color="#6b7280" />
              <TextInput style={s.searchInput} value={query}
                onChangeText={handleQueryChange} placeholder="Busca ticker: NVDA, AAPL, TSLA…"
                placeholderTextColor="#374151" autoCapitalize="characters" autoCorrect={false} />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => { setQuery(""); setTickerInfo(null); setSearchError(null); setBuyQty(""); setSuggestions([]); }}>
                  <Ionicons name="close-circle" size={18} color="#4b5563" />
                </TouchableOpacity>
              )}
            </View>

            {suggestions.length > 0 && !tickerInfo && !searching && (
              <View style={s.suggestionsBox}>
                {suggestions.map((sg, i) => (
                  <TouchableOpacity key={sg.ticker}
                    style={[s.suggestionRow, i < suggestions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1f2330" }]}
                    onPress={() => selectSuggestion(sg.ticker)}>
                    <Text style={s.suggestionTicker}>{sg.ticker}</Text>
                    <Text style={s.suggestionName} numberOfLines={1}>{sg.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {searching && (
              <View style={s.searchState}>
                <ActivityIndicator size="small" color="#00d47e" />
                <Text style={s.searchStateText}>Buscando {query}…</Text>
              </View>
            )}
            {searchError && !searching && (
              <View style={s.searchState}>
                <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
                <Text style={[s.searchStateText, { color: "#ef4444" }]}>{searchError}</Text>
              </View>
            )}

            {tickerInfo && !searching && (
              <View style={s.tickerResult}>
                <View style={s.tickerResultLeft}>
                  <Text style={s.tickerSymbol}>{tickerInfo.ticker}</Text>
                  <Text style={s.tickerName} numberOfLines={1}>{tickerInfo.name}</Text>
                </View>
                <View style={s.tickerResultRight}>
                  <Text style={s.tickerPrice}>${tickerInfo.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}</Text>
                  <View style={[s.tickerChangeBadge, { backgroundColor: (tickerInfo.change_pct >= 0 ? "#22c55e" : "#ef4444") + "18" }]}>
                    <Ionicons name={tickerInfo.change_pct >= 0 ? "caret-up" : "caret-down"} size={10} color={tickerInfo.change_pct >= 0 ? "#22c55e" : "#ef4444"} />
                    <Text style={[s.tickerChangePct, { color: tickerInfo.change_pct >= 0 ? "#22c55e" : "#ef4444" }]}>{fmtPct(tickerInfo.change_pct)}</Text>
                  </View>
                </View>
              </View>
            )}

            {tickerInfo && !searching && (
              <View style={s.buyForm}>
                <View style={s.qtyWrap}>
                  <Text style={s.qtyLabel}>Acciones</Text>
                  <TextInput style={s.qtyInput} value={buyQty} onChangeText={setBuyQty}
                    placeholder="0" placeholderTextColor="#374151" keyboardType="decimal-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  {buyQty && parseFloat(buyQty) > 0 && (
                    <Text style={s.totalCost}>
                      Total: <Text style={{ color: "#fff", fontWeight: "700" }}>{fmtMoney(tickerInfo.price * parseFloat(buyQty))}</Text>
                    </Text>
                  )}
                  <TouchableOpacity style={[s.buyBtn, (!buyQty || parseFloat(buyQty) <= 0 || buyLoading) && s.buyBtnDisabled]}
                    onPress={handleBuy} disabled={!buyQty || parseFloat(buyQty) <= 0 || buyLoading}>
                    {buyLoading
                      ? <ActivityIndicator color="#000" size="small" />
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
                <Text style={s.sectionTitle}>Mis posiciones</Text>
                {pricesLoading && <ActivityIndicator size="small" color="#00d47e" />}
              </View>
              {positions.map((pos) => {
                const live = posPrices[pos.ticker];
                const cp   = live?.price ?? pos.avgPrice;
                const diff = pos.shares * cp - pos.shares * pos.avgPrice;
                const pct  = pos.avgPrice > 0 ? (diff / (pos.shares * pos.avgPrice)) * 100 : 0;
                const up   = diff >= 0;
                const col  = up ? "#00d47e" : "#ef4444";
                return (
                  <View key={pos.id} style={[s.posCardWrapper, { borderColor: col + "30" }]}>
                    <View style={[s.topAccent, { backgroundColor: col }]} />
                    <View style={s.posCard}>
                      <View style={s.posTop}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                          <StockAvatar ticker={pos.ticker} size={36} />
                          <View style={{ flex: 1 }}>
                            <Text style={s.posTicker}>{pos.ticker}</Text>
                            <Text style={s.posName}>{pos.name}</Text>
                          </View>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={s.posValue}>{fmtMoney(pos.shares * cp)}</Text>
                          <View style={[s.posChangeBadge, { backgroundColor: col + "18" }]}>
                            <Ionicons name={up ? "caret-up" : "caret-down"} size={10} color={col} />
                            <Text style={[s.posChangePct, { color: col }]}>{fmtPct(pct)} ({up ? "+" : ""}{fmtMoney(Math.abs(diff))})</Text>
                          </View>
                        </View>
                      </View>
                      <View style={s.posBottom}>
                        <Text style={s.posDetail}>
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
              <View style={s.emptyIcon}>
                <Ionicons name="game-controller-outline" size={28} color="#00d47e" />
              </View>
              <Text style={s.emptyTitle}>Empieza a operar</Text>
              <Text style={s.emptySub}>
                Busca cualquier ticker arriba y compra a precios reales con tus ${PAPER_INITIAL_CASH.toLocaleString()} virtuales
              </Text>
            </View>
          )}

          {/* History */}
          {trades.length > 0 && (
            <>
              <TouchableOpacity style={s.sectionRow} onPress={() => setHistoryOpen((v) => !v)}>
                <Text style={s.sectionTitle}>Historial ({trades.length})</Text>
                <Ionicons name={historyOpen ? "chevron-up" : "chevron-down"} size={16} color="#6b7280" />
              </TouchableOpacity>
              {historyOpen && (
                <View style={s.historyCard}>
                  {trades.slice(0, 30).map((t) => {
                    const isTopup = t.type === "topup";
                    const isBuy   = t.type === "buy";
                    return (
                      <View key={t.id} style={s.tradeRow}>
                        <View style={[s.tradeBadge, { backgroundColor: isTopup ? "#00d47e22" : isBuy ? "#00d47e22" : "#ef444422" }]}>
                          <Text style={[s.tradeBadgeText, { color: isTopup ? "#00d47e" : isBuy ? "#00d47e" : "#ef4444" }]}>
                            {isTopup ? "$" : isBuy ? "C" : "V"}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.tradeTicker}>{isTopup ? "Recarga" : t.ticker}</Text>
                          <Text style={s.tradeDetail}>
                            {isTopup ? "Fondos virtuales añadidos" : `${t.shares} acc @ $${t.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={[s.tradeTotal, { color: isBuy ? "#ef4444" : "#00d47e" }]}>
                            {isBuy ? "-" : "+"}{fmtMoney(t.total)}
                          </Text>
                          <Text style={s.tradeDate}>
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

          {/* AI Analysis card */}
          <View style={s.analysisCard}>
            <View style={s.analysisHeader}>
              <View style={s.analysisIcon}>
                <Ionicons name="sparkles" size={15} color="#a855f7" />
              </View>
              <Text style={s.analysisTitle}>Análisis IA de tu simulación</Text>
              {!isPremiumAccess && (
                <View style={s.premiumBadge}>
                  <Text style={s.premiumBadgeText}>Premium</Text>
                </View>
              )}
            </View>

            {!isPremiumAccess ? (
              <View style={s.lockedBody}>
                <View style={s.lockIcon}>
                  <Ionicons name="lock-closed" size={22} color="#a855f7" />
                </View>
                <Text style={s.lockTitle}>La IA evalúa si estás listo para invertir de verdad</Text>
                <Text style={s.lockSub}>
                  Recibe feedback personalizado sobre tu estrategia, diversificación y comportamiento. Solo Premium.
                </Text>
                <TouchableOpacity style={s.unlockBtn} onPress={() => setPaywallOpen(true)}>
                  <Text style={s.unlockBtnText}>Activar Premium</Text>
                </TouchableOpacity>
              </View>
            ) : analysis ? (
              <View style={s.analysisBody}>
                <View style={s.verdictRow}>
                  <Text style={{ fontSize: 32 }}>
                    {analysis.verdict === "ready" ? "🏆" : analysis.verdict === "promising" ? "📈" : "📚"}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.verdictHeadline, {
                      color: analysis.verdict === "ready" ? "#22c55e" : analysis.verdict === "promising" ? "#f59e0b" : "#fff",
                    }]}>
                      {analysis.headline}
                    </Text>
                    <View style={[s.verdictBadge, {
                      backgroundColor: analysis.verdict === "ready" ? "rgba(34,197,94,0.12)"
                                     : analysis.verdict === "promising" ? "rgba(245,158,11,0.12)"
                                     : "rgba(99,102,241,0.12)",
                    }]}>
                      <Text style={[s.verdictBadgeText, {
                        color: analysis.verdict === "ready" ? "#22c55e" : analysis.verdict === "promising" ? "#f59e0b" : "#818cf8",
                      }]}>
                        {analysis.verdict === "ready" ? "✓ Listo para invertir con responsabilidad"
                       : analysis.verdict === "promising" ? "↗ Vas por buen camino"
                       : "↺ Sigue practicando un poco más"}
                      </Text>
                    </View>
                  </View>
                </View>

                <Text style={s.analysisFeedback}>{analysis.feedback}</Text>

                {analysis.positives.length > 0 && (
                  <View style={s.analysisSection}>
                    <Text style={[s.analysisSectionLabel, { color: "#22c55e" }]}>LO QUE HACES BIEN</Text>
                    {analysis.positives.map((p, i) => (
                      <View key={i} style={s.analysisItem}>
                        <Text style={{ color: "#22c55e", fontSize: 12, marginTop: 1 }}>✓</Text>
                        <Text style={s.analysisItemText}>{p}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {analysis.improvements.length > 0 && (
                  <View style={s.analysisSection}>
                    <Text style={[s.analysisSectionLabel, { color: "#f59e0b" }]}>ÁREAS A MEJORAR</Text>
                    {analysis.improvements.map((imp, i) => (
                      <View key={i} style={s.analysisItem}>
                        <Text style={{ color: "#f59e0b", fontSize: 12, marginTop: 1 }}>→</Text>
                        <Text style={s.analysisItemText}>{imp}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {!!analysis.disclaimer && (
                  <View style={s.disclaimer}>
                    <Text style={s.disclaimerText}>⚠️ {analysis.disclaimer}</Text>
                  </View>
                )}

                <TouchableOpacity style={s.reanalyzeBtn} onPress={() => setAnalysis(null)}>
                  <Text style={s.reanalyzeBtnText}>Volver a analizar</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.analysisBody}>
                <Text style={s.analysisCta}>
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
                  <Text style={[s.analysisCta, { textAlign: "center", fontSize: 10, marginTop: 0 }]}>
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
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason="El análisis IA del simulador es exclusivo de Premium." />
    </SafeAreaView>
  );
}

const darkStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0d12" },
  content: { padding: 14, paddingBottom: 48, gap: 12 },

  // Balance card
  balanceCard: {
    borderRadius: 22, borderWidth: 1, overflow: "hidden", backgroundColor: "#111318",
    shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 18, elevation: 10,
  },
  topAccent: { height: 3 },
  balanceCardInner: { padding: 18 },
  balanceRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16 },
  balanceLabel: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, color: "#6b7280" },
  balanceTotal: { fontSize: 36, fontWeight: "900", marginBottom: 10, letterSpacing: -1.5, color: "#fff" },
  balanceReturnRow: { flexDirection: "row" },
  returnBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  returnBadgeText: { fontSize: 13, fontWeight: "800" },
  actionBtns: { flexDirection: "column", gap: 7, alignItems: "flex-end" },
  topUpBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  topUpBtnText: { fontSize: 11, fontWeight: "700", color: "#00d47e" },
  resetBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "#1f2330", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  resetBtnText: { fontSize: 11, fontWeight: "600", color: "#ef4444" },
  balanceSplit: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1f2330", paddingTop: 14, marginTop: 2 },
  balanceSplitItem: { flex: 1, alignItems: "center", gap: 4 },
  balanceSplitLabel: { fontSize: 9, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, color: "#6b7280" },
  balanceSplitVal: { fontSize: 15, fontWeight: "900" },
  balanceSplitDivider: { width: StyleSheet.hairlineWidth, marginVertical: 2, backgroundColor: "#1f2330" },

  // Buy card
  buyCard: { borderRadius: 20, borderWidth: 1, borderColor: "#1f2330", backgroundColor: "#111318", padding: 16 },
  buyCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  buyCardIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,212,126,0.12)" },
  buyCardTitle: { fontSize: 14, fontWeight: "700", color: "#fff" },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1,
    borderColor: "#1f2330", backgroundColor: "#0a0d12",
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 15, fontWeight: "600", letterSpacing: 0.3, color: "#fff" },
  searchState: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 4 },
  searchStateText: { fontSize: 13, color: "#6b7280" },
  suggestionsBox: { borderRadius: 14, borderWidth: 1, borderColor: "rgba(0,212,126,0.25)", marginBottom: 8, overflow: "hidden", backgroundColor: "#111318" },
  suggestionRow: { paddingHorizontal: 14, paddingVertical: 11 },
  suggestionTicker: { fontSize: 13, fontWeight: "700", color: "#00d47e" },
  suggestionName: { fontSize: 11, marginTop: 1, color: "#6b7280" },
  tickerResult: {
    flexDirection: "row", alignItems: "center", borderWidth: 1,
    borderColor: "rgba(0,212,126,0.25)", backgroundColor: "rgba(0,212,126,0.04)",
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
  },
  tickerResultLeft: { flex: 1, gap: 3 },
  tickerSymbol: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5, color: "#fff" },
  tickerName: { fontSize: 12, letterSpacing: 0.1, color: "#6b7280" },
  tickerResultRight: { alignItems: "flex-end", gap: 6 },
  tickerPrice: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5, color: "#fff" },
  tickerChangeBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  tickerChangePct: { fontSize: 12, fontWeight: "700" },
  buyForm: { flexDirection: "row", gap: 10, alignItems: "flex-end" },
  qtyWrap: { borderWidth: 1, borderColor: "#1f2330", backgroundColor: "#0a0d12", borderRadius: 14, padding: 12, width: 110 },
  qtyLabel: { fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4, color: "#6b7280" },
  qtyInput: { fontSize: 22, fontWeight: "900", padding: 0, letterSpacing: -0.5, color: "#fff" },
  totalCost: { fontSize: 12, marginBottom: 7, color: "#9ca3af" },
  buyBtn: {
    backgroundColor: "#00d47e", borderRadius: 14, paddingVertical: 14,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#00d47e", shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  buyBtnDisabled: { opacity: 0.35 },
  buyBtnText: { color: "#000", fontWeight: "900", fontSize: 14, letterSpacing: 0.1 },

  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, marginTop: 4 },
  sectionTitle: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, color: "#6b7280" },

  posCardWrapper: { borderRadius: 18, overflow: "hidden", borderWidth: 1, backgroundColor: "#111318" },
  posCard: { padding: 14 },
  posTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  posTicker: { fontSize: 20, fontWeight: "900", letterSpacing: -0.5, color: "#fff" },
  posName: { fontSize: 11, marginTop: 3, letterSpacing: 0.1, color: "#6b7280" },
  posValue: { fontSize: 20, fontWeight: "900", color: "#fff" },
  posChangeBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginTop: 5 },
  posChangePct: { fontSize: 12, fontWeight: "800" },
  posBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1f2330", paddingTop: 12 },
  posDetail: { fontSize: 11, flex: 1, marginRight: 10, lineHeight: 17, color: "#4b5563" },
  sellBtn: { borderWidth: 1, borderColor: "#ef444455", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "rgba(239,68,68,0.06)" },
  sellBtnText: { color: "#ef4444", fontSize: 12, fontWeight: "700" },

  emptyState: { alignItems: "center", paddingTop: 56, paddingHorizontal: 32 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 16, backgroundColor: "rgba(0,212,126,0.1)", borderWidth: 1, borderColor: "rgba(0,212,126,0.2)" },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8, letterSpacing: -0.3, color: "#9ca3af" },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 21, color: "#6b7280" },

  historyCard: { borderRadius: 18, borderWidth: 1, borderColor: "#1f2330", overflow: "hidden", backgroundColor: "#111318" },
  tradeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1f2330" },
  tradeBadge: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  tradeBadgeText: { fontSize: 13, fontWeight: "900" },
  tradeTicker: { fontSize: 14, fontWeight: "700", letterSpacing: -0.1, color: "#fff" },
  tradeDetail: { fontSize: 11, marginTop: 2, letterSpacing: 0.1, color: "#4b5563" },
  tradeTotal: { fontSize: 14, fontWeight: "800" },
  tradeDate: { fontSize: 10, marginTop: 3, color: "#4b5563" },

  analysisCard: { borderRadius: 20, borderWidth: 1, borderColor: "#1f2330", overflow: "hidden", backgroundColor: "#111318" },
  analysisHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1f2330" },
  analysisIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(168,85,247,0.12)" },
  analysisTitle: { fontSize: 14, fontWeight: "700", flex: 1, color: "#fff" },
  premiumBadge: { backgroundColor: "rgba(168,85,247,0.12)", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  premiumBadgeText: { fontSize: 9, fontWeight: "800", color: "#a855f7" },
  lockedBody: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 28, gap: 10 },
  lockIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(168,85,247,0.2)", backgroundColor: "rgba(168,85,247,0.08)", marginBottom: 4 },
  lockTitle: { fontSize: 14, fontWeight: "700", textAlign: "center", lineHeight: 20, color: "#fff" },
  lockSub: { fontSize: 12, textAlign: "center", lineHeight: 18, color: "#6b7280" },
  unlockBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginTop: 4, backgroundColor: "#a855f7" },
  unlockBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
  analysisBody: { padding: 16, gap: 14 },
  verdictRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  verdictHeadline: { fontSize: 16, fontWeight: "900", lineHeight: 20, marginBottom: 5 },
  verdictBadge: { alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  verdictBadgeText: { fontSize: 10, fontWeight: "700" },
  analysisFeedback: { fontSize: 13, lineHeight: 20, color: "#9ca3af" },
  analysisSection: { gap: 6 },
  analysisSectionLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  analysisItem: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  analysisItemText: { fontSize: 12, lineHeight: 18, flex: 1, color: "#9ca3af" },
  disclaimer: { borderRadius: 12, borderWidth: 1, borderColor: "#1f2330", backgroundColor: "#1a1d27", padding: 12 },
  disclaimerText: { fontSize: 11, lineHeight: 17, color: "#4b5563" },
  reanalyzeBtn: { borderWidth: 1, borderColor: "rgba(168,85,247,0.3)", backgroundColor: "rgba(168,85,247,0.06)", borderRadius: 14, paddingVertical: 12, alignItems: "center" },
  reanalyzeBtnText: { fontSize: 12, fontWeight: "600", color: "#a855f7" },
  analysisCta: { fontSize: 12, lineHeight: 19, color: "#6b7280" },
  analyzeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 14, backgroundColor: "#a855f7",
    shadowColor: "#a855f7", shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  analyzeBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
});
