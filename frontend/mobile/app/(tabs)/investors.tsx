import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import StockAvatar from "../../src/components/StockAvatar";
import { investorsApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";

interface Investor {
  id: string;
  name: string;
  fund: string;
  avatar: string;
  bio: string;
  style: string;
}

interface Holding {
  ticker: string;
  name: string;
  value_thousands: number;
  shares: number;
  weight_pct?: number;
  transaction?: string;
  amount?: string;
  date?: string;
}

interface InvestorDetail extends Investor {
  holdings: Holding[];
  filing_date: string;
  analysis: string;
  data_note: string;
}

function formatValue(thousands: number): string {
  if (!thousands) return "—";
  if (thousands >= 1_000_000) return `$${(thousands / 1_000_000).toFixed(1)}B`;
  if (thousands >= 1_000) return `$${(thousands / 1_000).toFixed(1)}M`;
  return `$${thousands}K`;
}

export default function InvestorsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [investors, setInvestors] = useState<Investor[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [selected, setSelected] = useState<InvestorDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    investorsApi.list()
      .then((r) => setInvestors(r.data.investors ?? []))
      .catch(() => {})
      .finally(() => setLoadingList(false));
  }, []);

  const openInvestor = useCallback(async (inv: Investor) => {
    setSelected(null);
    setLoadingDetail(true);
    try {
      const r = await investorsApi.getHoldings(inv.id);
      setSelected(r.data);
    } catch {
      setSelected({ ...inv, holdings: [], filing_date: "", analysis: "", data_note: "" });
    }
    setLoadingDetail(false);
  }, []);

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (loadingDetail) {
    return (
      <SafeAreaView style={[styles.container, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={colors.accentLight} />
        <Text style={[styles.loadingText, { color: colors.textMuted }]}>Consultando SEC EDGAR…</Text>
      </SafeAreaView>
    );
  }

  if (selected) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.detailScroll}>
          {/* Back button */}
          <TouchableOpacity style={styles.backBtn} onPress={() => setSelected(null)} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={16} color={colors.accentLight} />
            <Text style={[styles.backText, { color: colors.accentLight }]}>Todos los inversores</Text>
          </TouchableOpacity>

          {/* Investor header */}
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={styles.investorHeader}>
              <View style={[styles.avatarBox, { backgroundColor: colors.accentGlow, borderColor: colors.accentLight + "30" }]}>
                <Text style={styles.avatarEmoji}>{selected.avatar}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.investorName, { color: colors.text }]}>{selected.name}</Text>
                <Text style={[styles.fundName, { color: colors.accentLight }]}>{selected.fund}</Text>
              </View>
            </View>
            <Text style={[styles.bio, { color: colors.textMuted }]}>{selected.bio}</Text>

            {/* Style tags */}
            <View style={styles.tagRow}>
              {selected.style.split(" · ").map((tag) => (
                <View key={tag} style={[styles.tag, { backgroundColor: colors.accentGlow }]}>
                  <Text style={[styles.tagText, { color: colors.accentLight }]}>{tag}</Text>
                </View>
              ))}
            </View>

            {selected.filing_date && (
              <Text style={[styles.filingDate, { color: colors.textDim }]}>
                Última declaración: {new Date(selected.filing_date).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}
                {"\n"}{selected.data_note}
              </Text>
            )}
          </View>

          {/* AI Analysis */}
          {!!selected.analysis && (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <View style={styles.aiHeader}>
                <Text style={[styles.aiSparkle, { color: colors.accentLight }]}>✦</Text>
                <Text style={[styles.aiTitle, { color: colors.accentLight }]}>Análisis IA</Text>
              </View>
              <Text style={[styles.aiBody, { color: colors.textSub }]}>{selected.analysis}</Text>
            </View>
          )}

          {/* Warning */}
          <View style={[styles.warningBox, { borderColor: "rgba(245,158,11,0.3)", backgroundColor: "rgba(245,158,11,0.07)" }]}>
            <Ionicons name="information-circle-outline" size={14} color="#f59e0b" />
            <Text style={styles.warningText}>Datos con hasta 45 días de retraso (SEC Form 13F / STOCK Act)</Text>
          </View>

          {/* Holdings */}
          <View style={[styles.holdingsCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={[styles.holdingsHeader, { borderBottomColor: colors.border }]}>
              <Ionicons name="trending-up-outline" size={14} color={colors.accentLight} />
              <Text style={[styles.holdingsTitle, { color: colors.text }]}>Posiciones declaradas</Text>
              <Text style={[styles.holdingsCount, { color: colors.textDim }]}>Top {selected.holdings.length}</Text>
            </View>

            {selected.holdings.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                  No se pudo obtener datos en este momento. Intenta más tarde.
                </Text>
              </View>
            ) : (
              selected.holdings.map((h, i) => {
                const isBuy = !h.transaction || h.transaction.toLowerCase().includes("purchase") || h.transaction.toLowerCase().includes("buy");
                return (
                  <View key={i} style={[styles.holdingRow, { borderTopColor: colors.border }]}>
                    <Text style={[styles.rank, { color: colors.textDim }]}>{i + 1}</Text>
                    {h.ticker
                      ? <StockAvatar ticker={h.ticker} size={34} />
                      : <View style={[styles.noAvatar, { backgroundColor: colors.raised }]} />
                    }
                    <View style={{ flex: 1 }}>
                      {h.ticker && <Text style={[styles.holdingTicker, { color: colors.text }]}>{h.ticker}</Text>}
                      <Text style={[styles.holdingName, { color: colors.textMuted }]} numberOfLines={1}>{h.name}</Text>
                      {h.transaction && (
                        <View style={[styles.txBadge, { backgroundColor: isBuy ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)" }]}>
                          <Text style={[styles.txText, { color: isBuy ? "#22c55e" : "#ef4444" }]}>{h.transaction}</Text>
                        </View>
                      )}
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      {h.weight_pct ? (
                        <>
                          <Text style={[styles.holdingValue, { color: colors.text }]}>{h.weight_pct.toFixed(1)}%</Text>
                          <Text style={[styles.holdingShares, { color: colors.textDim }]}>del fondo</Text>
                        </>
                      ) : h.value_thousands ? (
                        <>
                          <Text style={[styles.holdingValue, { color: colors.text }]}>{formatValue(h.value_thousands)}</Text>
                          {h.shares > 0 && (
                            <Text style={[styles.holdingShares, { color: colors.textDim }]}>{h.shares.toLocaleString()} acc.</Text>
                          )}
                        </>
                      ) : h.amount ? (
                        <Text style={[styles.holdingValue, { color: colors.textSub }]}>{h.amount}</Text>
                      ) : null}
                      {h.date && (
                        <Text style={[styles.holdingShares, { color: colors.textDim }]}>
                          {new Date(h.date).toLocaleDateString("es", { day: "numeric", month: "short" })}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* Info banner */}
      <View style={[styles.infoBanner, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={[styles.warningBox, { borderColor: "rgba(245,158,11,0.3)", backgroundColor: "rgba(245,158,11,0.07)", margin: 0 }]}>
          <Ionicons name="information-circle-outline" size={13} color="#f59e0b" />
          <Text style={styles.warningText}>Posiciones públicas con hasta 45 días de retraso (13F, STOCK Act, ARK)</Text>
        </View>
      </View>

      {loadingList ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={colors.accentLight} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>Cargando inversores…</Text>
        </View>
      ) : (
        <FlatList
          data={investors}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.investorCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => openInvestor(item)}
              activeOpacity={0.75}
            >
              <View style={[styles.listAvatarBox, { backgroundColor: colors.accentGlow, borderColor: colors.accentLight + "25" }]}>
                <Text style={styles.listAvatarEmoji}>{item.avatar}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.listName, { color: colors.text }]}>{item.name}</Text>
                <Text style={[styles.listFund, { color: colors.accentLight }]}>{item.fund}</Text>
                <Text style={[styles.listStyle, { color: colors.textMuted }]} numberOfLines={1}>{item.style}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    list: { padding: 14, gap: 10 },
    loadingState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    loadingText: { fontSize: 13, marginTop: 8 },

    infoBanner: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },

    // List items
    investorCard: {
      flexDirection: "row", alignItems: "center", gap: 12,
      borderRadius: 16, borderWidth: 1, padding: 14,
    },
    listAvatarBox: {
      width: 44, height: 44, borderRadius: 12, borderWidth: 1,
      alignItems: "center", justifyContent: "center",
    },
    listAvatarEmoji: { fontSize: 22 },
    listName: { fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
    listFund: { fontSize: 11, fontWeight: "600", marginTop: 1 },
    listStyle: { fontSize: 11, marginTop: 3, lineHeight: 15 },

    // Detail
    detailScroll: { padding: 14, gap: 12, paddingBottom: 40 },
    backBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
    backText: { fontSize: 13, fontWeight: "600" },

    card: { borderRadius: 16, borderWidth: 1, padding: 14 },
    investorHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 10 },
    avatarBox: {
      width: 48, height: 48, borderRadius: 14, borderWidth: 1,
      alignItems: "center", justifyContent: "center",
    },
    avatarEmoji: { fontSize: 24 },
    investorName: { fontSize: 16, fontWeight: "800", letterSpacing: -0.3 },
    fundName: { fontSize: 12, fontWeight: "600", marginTop: 2 },
    bio: { fontSize: 13, lineHeight: 19, marginBottom: 10 },
    tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    tag: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
    tagText: { fontSize: 10, fontWeight: "700" },
    filingDate: { fontSize: 10, marginTop: 12, lineHeight: 16 },

    // AI
    aiHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
    aiSparkle: { fontSize: 12, fontWeight: "800" },
    aiTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
    aiBody: { fontSize: 13, lineHeight: 20 },

    // Warning
    warningBox: {
      flexDirection: "row", alignItems: "flex-start", gap: 6,
      borderRadius: 10, borderWidth: 1, padding: 10,
    },
    warningText: { flex: 1, fontSize: 11, color: "#f59e0b", lineHeight: 16 },

    // Holdings
    holdingsCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
    holdingsHeader: {
      flexDirection: "row", alignItems: "center", gap: 6,
      paddingHorizontal: 14, paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    holdingsTitle: { fontSize: 13, fontWeight: "700", flex: 1 },
    holdingsCount: { fontSize: 11 },

    holdingRow: {
      flexDirection: "row", alignItems: "center", gap: 10,
      paddingHorizontal: 14, paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    rank: { fontSize: 11, fontWeight: "700", width: 16, textAlign: "center" },
    noAvatar: { width: 34, height: 34, borderRadius: 8 },
    holdingTicker: { fontSize: 13, fontWeight: "800" },
    holdingName: { fontSize: 11, marginTop: 1 },
    txBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, marginTop: 3, alignSelf: "flex-start" },
    txText: { fontSize: 9, fontWeight: "700" },
    holdingValue: { fontSize: 13, fontWeight: "700" },
    holdingShares: { fontSize: 10, marginTop: 1 },

    emptyState: { padding: 24, alignItems: "center" },
    emptyText: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  });
}
