import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, SafeAreaView, Modal,
  Alert, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { marketApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { usePaperStore, PAPER_INITIAL_CASH, TOP_UP_PLANS } from "../../src/lib/paperStore";

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

// ─── Sell Modal ──────────────────────────────────────────────────────────────

function SellModal({
  visible, ticker, maxShares, price, onClose, onSell,
}: {
  visible: boolean; ticker: string; maxShares: number;
  price: number; onClose: () => void;
  onSell: (shares: number) => void;
}) {
  const { colors } = useTheme();
  const [qty, setQty] = useState("");

  const parsed = parseFloat(qty) || 0;
  const valid = parsed > 0 && parsed <= maxShares;

  useEffect(() => { if (visible) setQty(""); }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <View style={[sellStyles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={sellStyles.handle} />
          <Text style={[sellStyles.title, { color: colors.text }]}>Vender {ticker}</Text>
          <Text style={[sellStyles.sub, { color: colors.textMuted }]}>
            Precio actual: <Text style={{ color: colors.text, fontWeight: "700" }}>${price.toLocaleString("en-US", { minimumFractionDigits: 2 })}</Text>
            {"  ·  "}Tienes {maxShares} acciones
          </Text>

          <View style={[sellStyles.inputWrap, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <TextInput
              style={[sellStyles.input, { color: colors.text }]}
              value={qty}
              onChangeText={setQty}
              placeholder={`1 – ${maxShares}`}
              placeholderTextColor={colors.placeholder}
              keyboardType="decimal-pad"
              autoFocus
            />
            <TouchableOpacity onPress={() => setQty(String(maxShares))} style={sellStyles.maxBtn}>
              <Text style={sellStyles.maxBtnText}>MAX</Text>
            </TouchableOpacity>
          </View>

          {parsed > 0 && (
            <Text style={[sellStyles.proceeds, { color: colors.textSub }]}>
              Recibirás:{" "}
              <Text style={{ color: "#22c55e", fontWeight: "800" }}>
                {fmtMoney(parsed * price)}
              </Text>
            </Text>
          )}

          <View style={sellStyles.actions}>
            <TouchableOpacity style={[sellStyles.cancelBtn, { borderColor: colors.border }]} onPress={onClose}>
              <Text style={[sellStyles.cancelText, { color: colors.textMuted }]}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[sellStyles.sellBtn, !valid && { opacity: 0.4 }]}
              onPress={() => { if (valid) { onSell(parsed); onClose(); } }}
              disabled={!valid}
            >
              <Text style={sellStyles.sellText}>
                Vender {qty || "—"} acc
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const sellStyles = StyleSheet.create({
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 24, paddingTop: 12 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#374151", alignSelf: "center", marginBottom: 20 },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 6 },
  sub: { fontSize: 13, marginBottom: 18 },
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, marginBottom: 10,
  },
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

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function PaperScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { cash, positions, trades, buy, sell, topUp, reset } = usePaperStore();
  const [topUpOpen, setTopUpOpen] = useState(false);

  // Ticker search
  const [query, setQuery] = useState("");
  const [tickerInfo, setTickerInfo] = useState<TickerInfo | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Buy form
  const [buyQty, setBuyQty] = useState("");
  const [buyLoading, setBuyLoading] = useState(false);

  // Position prices
  const [posPrices, setPosPrices] = useState<Record<string, { price: number; change_pct: number }>>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  // Sell modal
  const [sellModal, setSellModal] = useState<{ ticker: string; maxShares: number; price: number } | null>(null);

  // History expand
  const [historyOpen, setHistoryOpen] = useState(false);

  // Load position prices — single batch call instead of N chart requests
  const loadPosPrices = useCallback(async () => {
    if (positions.length === 0) return;
    setPricesLoading(true);
    try {
      const res = await marketApi.getPrices(positions.map((p) => p.ticker));
      const results: Record<string, { price: number; change_pct: number }> = {};
      for (const pos of positions) {
        const d = res.data[pos.ticker];
        results[pos.ticker] = {
          price: d?.price ?? pos.avgPrice,
          change_pct: d?.change_pct ?? 0,
        };
      }
      setPosPrices(results);
    } catch {}
    setPricesLoading(false);
  }, [positions.length]);

  useEffect(() => { loadPosPrices(); }, [positions.length]);

  // Debounced ticker search
  const searchTicker = useCallback((raw: string) => {
    const t = raw.trim().toUpperCase();
    if (!t) { setTickerInfo(null); setSearchError(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      setTickerInfo(null);
      try {
        const res = await marketApi.getPrices([t]);
        const d = res.data[t];
        if (d?.price) {
          setTickerInfo({ ticker: t, name: d.name ?? t, price: d.price, change_pct: d.change_pct ?? 0 });
        } else {
          setSearchError("Ticker no encontrado");
        }
      } catch {
        setSearchError("No se pudo obtener precio");
      }
      setSearching(false);
    }, 500);
  }, []);

  const handleQueryChange = (v: string) => {
    setQuery(v.toUpperCase());
    setBuyQty("");
    searchTicker(v);
  };

  const handleBuy = async () => {
    if (!tickerInfo || !buyQty) return;
    const shares = parseFloat(buyQty);
    if (!shares || shares <= 0) return;
    setBuyLoading(true);
    const err = buy(tickerInfo.ticker, tickerInfo.name, shares, tickerInfo.price);
    if (err) {
      Alert.alert("Error", err);
    } else {
      setQuery("");
      setBuyQty("");
      setTickerInfo(null);
    }
    setBuyLoading(false);
  };

  const handleSell = (ticker: string, shares: number, price: number) => {
    setSellModal({ ticker, maxShares: shares, price });
  };

  const confirmSell = (shares: number) => {
    if (!sellModal) return;
    sell(sellModal.ticker, shares, sellModal.price);
    setPosPrices((prev) => ({ ...prev })); // re-render
  };

  // Totals
  const { virtualValue, totalValue, totalReturn, totalReturnPct } = useMemo(() => {
    const virtualValue = positions.reduce((acc, p) => acc + p.shares * (posPrices[p.ticker]?.price ?? p.avgPrice), 0);
    const totalValue = cash + virtualValue;
    const totalReturn = totalValue - PAPER_INITIAL_CASH;
    return {
      virtualValue,
      totalValue,
      totalReturn,
      totalReturnPct: (totalReturn / PAPER_INITIAL_CASH) * 100,
    };
  }, [cash, positions, posPrices]);

  const isUp = totalReturn >= 0;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

          {/* ── BALANCE ── */}
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
                <TouchableOpacity
                  style={[s.resetBtn, { backgroundColor: "#22c55e18", borderColor: "#22c55e55" }]}
                  onPress={() => setTopUpOpen(true)}
                >
                  <Ionicons name="add-circle-outline" size={14} color="#22c55e" />
                  <Text style={[s.resetBtnText, { color: "#22c55e" }]}>Recargar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.resetBtn}
                  onPress={() => Alert.alert("Reiniciar", "¿Volver a $10,000 virtuales?", [
                    { text: "Cancelar", style: "cancel" },
                    { text: "Reiniciar", style: "destructive", onPress: reset },
                  ])}
                >
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

          {/* ── SEARCH + BUY ── */}
          <View style={[s.buyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/* Search bar */}
            <View style={[s.searchBar, { backgroundColor: colors.bg, borderColor: colors.border }]}>
              <Ionicons name="search-outline" size={18} color={colors.textMuted} />
              <TextInput
                style={[s.searchInput, { color: colors.text }]}
                value={query}
                onChangeText={handleQueryChange}
                placeholder="Busca ticker: NVDA, AAPL, TSLA…"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => { setQuery(""); setTickerInfo(null); setSearchError(null); setBuyQty(""); }}>
                  <Ionicons name="close-circle" size={18} color={colors.textDim} />
                </TouchableOpacity>
              )}
            </View>

            {/* Searching indicator */}
            {searching && (
              <View style={s.searchState}>
                <ActivityIndicator size="small" color={colors.accentLight} />
                <Text style={[s.searchStateText, { color: colors.textMuted }]}>Buscando {query}…</Text>
              </View>
            )}

            {/* Error */}
            {searchError && !searching && (
              <View style={s.searchState}>
                <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
                <Text style={[s.searchStateText, { color: "#ef4444" }]}>{searchError}</Text>
              </View>
            )}

            {/* Ticker result card */}
            {tickerInfo && !searching && (
              <View style={[s.tickerResult, { borderColor: colors.border }]}>
                <View style={s.tickerResultLeft}>
                  <Text style={[s.tickerSymbol, { color: colors.text }]}>{tickerInfo.ticker}</Text>
                  <Text style={[s.tickerName, { color: colors.textMuted }]} numberOfLines={1}>{tickerInfo.name}</Text>
                </View>
                <View style={s.tickerResultRight}>
                  <Text style={[s.tickerPrice, { color: colors.text }]}>
                    ${tickerInfo.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </Text>
                  <View style={[s.tickerChangeBadge, { backgroundColor: (tickerInfo.change_pct >= 0 ? "#22c55e" : "#ef4444") + "18" }]}>
                    <Ionicons
                      name={tickerInfo.change_pct >= 0 ? "caret-up" : "caret-down"}
                      size={10}
                      color={tickerInfo.change_pct >= 0 ? "#22c55e" : "#ef4444"}
                    />
                    <Text style={[s.tickerChangePct, { color: tickerInfo.change_pct >= 0 ? "#22c55e" : "#ef4444" }]}>
                      {fmtPct(tickerInfo.change_pct)}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Buy form */}
            {tickerInfo && !searching && (
              <View style={s.buyForm}>
                <View style={[s.qtyWrap, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                  <Text style={[s.qtyLabel, { color: colors.textMuted }]}>Acciones</Text>
                  <TextInput
                    style={[s.qtyInput, { color: colors.text }]}
                    value={buyQty}
                    onChangeText={setBuyQty}
                    placeholder="0"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  {buyQty && parseFloat(buyQty) > 0 && (
                    <Text style={[s.totalCost, { color: colors.textSub }]}>
                      Total:{" "}
                      <Text style={{ color: colors.text, fontWeight: "700" }}>
                        {fmtMoney(tickerInfo.price * parseFloat(buyQty))}
                      </Text>
                    </Text>
                  )}
                  <TouchableOpacity
                    style={[
                      s.buyBtn,
                      (!buyQty || parseFloat(buyQty) <= 0 || buyLoading) && s.buyBtnDisabled,
                    ]}
                    onPress={handleBuy}
                    disabled={!buyQty || parseFloat(buyQty) <= 0 || buyLoading}
                  >
                    {buyLoading ? (
                      <ActivityIndicator color="white" size="small" />
                    ) : (
                      <Text style={s.buyBtnText}>
                        Comprar {buyQty || "—"} {tickerInfo.ticker}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* ── POSITIONS ── */}
          {positions.length > 0 && (
            <>
              <View style={s.sectionRow}>
                <Text style={[s.sectionTitle, { color: colors.text }]}>Mis posiciones</Text>
                {pricesLoading && <ActivityIndicator size="small" color={colors.accentLight} />}
              </View>

              {positions.map((pos) => {
                const live = posPrices[pos.ticker];
                const cp = live?.price ?? pos.avgPrice;
                const currentVal = pos.shares * cp;
                const investedVal = pos.shares * pos.avgPrice;
                const diff = currentVal - investedVal;
                const pct = investedVal > 0 ? (diff / investedVal) * 100 : 0;
                const up = diff >= 0;

                return (
                  <View key={pos.id} style={[s.posCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={s.posTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.posTicker, { color: colors.text }]}>{pos.ticker}</Text>
                        <Text style={[s.posName, { color: colors.textMuted }]}>{pos.name}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[s.posValue, { color: colors.text }]}>{fmtMoney(currentVal)}</Text>
                        <View style={[s.posChangeBadge, { backgroundColor: (up ? "#22c55e" : "#ef4444") + "18" }]}>
                          <Ionicons name={up ? "caret-up" : "caret-down"} size={10} color={up ? "#22c55e" : "#ef4444"} />
                          <Text style={[s.posChangePct, { color: up ? "#22c55e" : "#ef4444" }]}>
                            {fmtPct(pct)} ({up ? "+" : ""}{fmtMoney(Math.abs(diff))})
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={[s.posBottom, { borderTopColor: colors.border }]}>
                      <Text style={[s.posDetail, { color: colors.textDim }]}>
                        {pos.shares} acc · Costo ${pos.avgPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })} · Actual ${cp.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </Text>
                      <TouchableOpacity
                        style={s.sellBtn}
                        onPress={() => handleSell(pos.ticker, pos.shares, cp)}
                      >
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
                Busca cualquier ticker arriba y compra a precios reales de mercado con tus ${PAPER_INITIAL_CASH.toLocaleString()} virtuales
              </Text>
            </View>
          )}

          {/* ── HISTORY ── */}
          {trades.length > 0 && (
            <>
              <TouchableOpacity style={s.sectionRow} onPress={() => setHistoryOpen((v) => !v)}>
                <Text style={[s.sectionTitle, { color: colors.text }]}>
                  Historial ({trades.length})
                </Text>
                <Ionicons name={historyOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
              </TouchableOpacity>

              {historyOpen && (
                <View style={[s.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {trades.slice(0, 30).map((t) => {
                    const isTopup = t.type === "topup";
                    const isBuy = t.type === "buy";
                    const badgeBg = isTopup ? "#22c55e22" : isBuy ? "#22c55e22" : "#ef444422";
                    const badgeColor = isTopup ? "#22c55e" : isBuy ? "#22c55e" : "#ef4444";
                    const totalColor = isBuy ? "#ef4444" : "#22c55e";
                    return (
                      <View key={t.id} style={[s.tradeRow, { borderBottomColor: colors.border }]}>
                        <View style={[s.tradeBadge, { backgroundColor: badgeBg }]}>
                          <Text style={[s.tradeBadgeText, { color: badgeColor }]}>
                            {isTopup ? "$" : isBuy ? "C" : "V"}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.tradeTicker, { color: colors.text }]}>
                            {isTopup ? "Recarga" : t.ticker}
                          </Text>
                          <Text style={[s.tradeDetail, { color: colors.textDim }]}>
                            {isTopup ? "Fondos virtuales añadidos" : `${t.shares} acc @ $${t.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={[s.tradeTotal, { color: totalColor }]}>
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

        </ScrollView>
      </KeyboardAvoidingView>

      <SellModal
        visible={!!sellModal}
        ticker={sellModal?.ticker ?? ""}
        maxShares={sellModal?.maxShares ?? 0}
        price={sellModal?.price ?? 0}
        onClose={() => setSellModal(null)}
        onSell={confirmSell}
      />

      {/* ── TOP-UP MODAL ── */}
      <Modal visible={topUpOpen} transparent animationType="slide" onRequestClose={() => setTopUpOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={[s.topUpSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.topUpHandle} />
            <Text style={[s.topUpTitle, { color: colors.text }]}>Recargar saldo virtual</Text>
            <Text style={[s.topUpSub, { color: colors.textMuted }]}>
              Añade fondos para seguir practicando sin riesgo
            </Text>

            <View style={s.planGrid}>
              {TOP_UP_PLANS.map((plan) => (
                <TouchableOpacity
                  key={plan.id}
                  style={[s.planCard, { borderColor: plan.color + "55", backgroundColor: plan.color + "12" }]}
                  onPress={() => {
                    topUp(plan.amount);
                    setTopUpOpen(false);
                    Alert.alert("¡Recarga exitosa!", `Se añadieron ${plan.label} a tu cuenta virtual.`);
                  }}
                >
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

            <TouchableOpacity
              style={[s.topUpCloseBtn, { borderColor: colors.border }]}
              onPress={() => setTopUpOpen(false)}
            >
              <Text style={[s.topUpCloseBtnText, { color: colors.textMuted }]}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 14, paddingBottom: 48, gap: 0 },

    // Balance card
    balanceCard: { borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 12 },
    balanceRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 14 },
    balanceLabel: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
    balanceTotal: { fontSize: 34, fontWeight: "900", marginBottom: 8, letterSpacing: -1 },
    balanceReturnRow: { flexDirection: "row" },
    returnBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
    returnBadgeText: { fontSize: 12, fontWeight: "700" },
    resetBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 },
    resetBtnText: { fontSize: 11, fontWeight: "600" },
    balanceSplit: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
    balanceSplitItem: { flex: 1, alignItems: "center", gap: 3 },
    balanceSplitLabel: { fontSize: 10, letterSpacing: 0.3 },
    balanceSplitVal: { fontSize: 14, fontWeight: "800" },
    balanceSplitDivider: { width: StyleSheet.hairlineWidth, marginVertical: 2 },

    // Buy card
    buyCard: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 14 },
    searchBar: {
      flexDirection: "row", alignItems: "center", gap: 10,
      borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
      marginBottom: 10,
    },
    searchInput: { flex: 1, fontSize: 15, fontWeight: "600", letterSpacing: 0.3 },
    searchState: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 4 },
    searchStateText: { fontSize: 13 },
    tickerResult: {
      flexDirection: "row", alignItems: "center",
      borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
    },
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
    buyBtn: {
      backgroundColor: c.accent, borderRadius: 14, paddingVertical: 14,
      alignItems: "center", justifyContent: "center",
      shadowColor: c.accentLight, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    },
    buyBtnDisabled: { opacity: 0.35 },
    buyBtnText: { color: "white", fontWeight: "800", fontSize: 14, letterSpacing: 0.1 },

    // Sections
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, marginTop: 6 },
    sectionTitle: { fontSize: 16, fontWeight: "700", letterSpacing: -0.2 },

    // Position card
    posCard: { borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 9 },
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
    tradeRow: {
      flexDirection: "row", alignItems: "center", gap: 10,
      paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
    },
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
  });
}
