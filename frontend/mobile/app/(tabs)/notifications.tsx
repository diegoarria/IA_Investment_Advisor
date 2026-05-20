import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity, Modal,
  StyleSheet, RefreshControl, SafeAreaView, ActivityIndicator, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { notificationsApi, marketApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useWatchlistStore } from "../../src/lib/watchlistStore";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

interface PriceData {
  price: number | null;
  change_pct: number | null;
}

const TYPE_ICONS: Record<string, IoniconName> = {
  market_move:        "trending-down-outline",
  earnings_event:     "bar-chart-outline",
  learning_progress:  "rocket-outline",
  personalized_insight: "bulb-outline",
  market_summary:     "trending-up-outline",
};

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread]         = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Watchlist prices
  const { items: watchlist } = useWatchlistStore();
  const [prices, setPrices]  = useState<Record<string, PriceData>>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  // Alert context modal
  const [alertModal, setAlertModal]     = useState<{ ticker: string; change_pct: number } | null>(null);
  const [alertInsight, setAlertInsight] = useState<string | null>(null);
  const [alertLoading, setAlertLoading] = useState(false);

  const markdownStyles = useMemo(() => ({
    body: { color: colors.textSub, fontSize: 13, lineHeight: 20 },
    paragraph: { marginVertical: 2 },
    strong: { color: colors.text, fontWeight: "700" as const },
    bullet_list: { marginVertical: 3 },
    list_item: { color: colors.textSub, fontSize: 13, lineHeight: 20 },
  }), [colors]);

  const loadNotifications = async () => {
    try {
      const res = await notificationsApi.getAll();
      setNotifications(res.data.notifications ?? []);
      setUnread(res.data.unread_count ?? 0);
    } catch {}
  };

  const loadWatchlistWithChange = useCallback(async () => {
    if (watchlist.length === 0) return;
    setPricesLoading(true);
    try {
      const symbols = watchlist.map((w) => w.ticker);
      // Use indices-style approach: getChart for 1d gives us change
      const results: Record<string, PriceData> = {};
      await Promise.all(symbols.map(async (sym) => {
        try {
          const res = await marketApi.getChart(sym, "1d");
          const d = res.data;
          results[sym] = {
            price: d.current_price ?? null,
            change_pct: d.change_pct ?? null,
          };
        } catch {
          results[sym] = { price: null, change_pct: null };
        }
      }));
      setPrices(results);
    } catch {}
    setPricesLoading(false);
  }, [watchlist]);

  useEffect(() => { loadNotifications(); }, []);
  useEffect(() => { loadWatchlistWithChange(); }, [watchlist.length]);

  const handleMarkRead = async (id: string) => {
    await notificationsApi.markRead(id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    setUnread((c) => Math.max(0, c - 1));
  };

  const handleMarkAllRead = async () => {
    await notificationsApi.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
  };

  const openAlertContext = async (ticker: string, change_pct: number) => {
    setAlertModal({ ticker, change_pct });
    setAlertInsight(null);
    setAlertLoading(true);
    try {
      const res = await marketApi.alertContext(ticker, change_pct);
      setAlertInsight(res.data.insight);
    } catch {}
    setAlertLoading(false);
  };

  const renderNotification = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      style={[styles.card, !item.read && styles.cardUnread]}
      onPress={() => !item.read && handleMarkRead(item.id)}
    >
      <View style={styles.cardRow}>
        <Ionicons name={TYPE_ICONS[item.type] ?? "notifications-outline"} size={22} color={colors.textSub} style={{ marginRight: 12 }} />
        <View style={styles.cardBody}>
          <Text style={[styles.cardTitle, !item.read && { color: colors.text }]}>{item.title}</Text>
          <Text style={styles.cardMessage} numberOfLines={3}>{item.message}</Text>
          <Text style={styles.cardDate}>
            {new Date(item.created_at).toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
        {!item.read && <View style={styles.unreadDot} />}
      </View>
    </TouchableOpacity>
  );

  const WatchlistSection = () => {
    const { remove } = useWatchlistStore();
    if (watchlist.length === 0) return null;
    return (
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <Ionicons name="bookmark" size={14} color={colors.accentLight} />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Watchlist</Text>
          {pricesLoading && <ActivityIndicator size="small" color={colors.accentLight} style={{ marginLeft: 8 }} />}
        </View>
        {watchlist.map((item) => {
          const p = prices[item.ticker];
          const chgColor = !p?.change_pct ? colors.textDim : p.change_pct >= 0 ? "#22c55e" : "#ef4444";
          const bigDrop = p?.change_pct !== null && p?.change_pct !== undefined && Math.abs(p.change_pct) >= 3;
          return (
            <View key={item.ticker} style={[styles.watchRow, { borderTopColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.watchTicker, { color: colors.text }]}>{item.ticker}</Text>
                <Text style={[styles.watchName, { color: colors.textMuted }]}>{item.name}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                {p?.price ? (
                  <Text style={[styles.watchPrice, { color: colors.text }]}>
                    ${p.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </Text>
                ) : <Text style={{ color: colors.textDim, fontSize: 12 }}>—</Text>}
                {p?.change_pct !== null && p?.change_pct !== undefined && (
                  <TouchableOpacity
                    onPress={() => bigDrop ? openAlertContext(item.ticker, p.change_pct!) : null}
                    activeOpacity={bigDrop ? 0.7 : 1}
                  >
                    <Text style={[styles.watchChange, { color: chgColor }]}>
                      {p.change_pct >= 0 ? "▲" : "▼"} {Math.abs(p.change_pct).toFixed(2)}%
                      {bigDrop ? " ⚠️" : ""}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity onPress={() => remove(item.ticker)} style={{ marginLeft: 12, padding: 4 }}>
                <Ionicons name="close-outline" size={16} color={colors.textDim} />
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {unread > 0 && (
        <TouchableOpacity style={styles.markAllBtn} onPress={handleMarkAllRead}>
          <Text style={styles.markAllText}>Marcar todas como leídas ({unread})</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={renderNotification}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([loadNotifications(), loadWatchlistWithChange()]);
              setRefreshing(false);
            }}
            tintColor="#22c55e"
          />
        }
        ListHeaderComponent={<WatchlistSection />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="notifications-outline" size={48} color={colors.textMuted} style={{ marginBottom: 16 }} />
            <Text style={styles.emptyText}>Sin notificaciones todavía</Text>
            <Text style={styles.emptySubtext}>
              Las alertas aparecen cuando hay eventos relevantes del mercado para tu perfil
            </Text>
          </View>
        }
      />

      {/* Alert context modal */}
      <Modal visible={!!alertModal} transparent animationType="slide" onRequestClose={() => setAlertModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                ⚠️ {alertModal?.ticker} {(alertModal?.change_pct ?? 0) >= 0 ? "subió" : "cayó"} {Math.abs(alertModal?.change_pct ?? 0).toFixed(1)}%
              </Text>
              <TouchableOpacity onPress={() => setAlertModal(null)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 320 }}>
              {alertLoading ? (
                <View style={{ alignItems: "center", padding: 32 }}>
                  <ActivityIndicator color={colors.accentLight} />
                  <Text style={{ color: colors.textMuted, marginTop: 12 }}>Analizando con AI…</Text>
                </View>
              ) : (
                <Markdown style={markdownStyles}>{alertInsight ?? ""}</Markdown>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    list: { padding: 16, paddingBottom: 32 },
    markAllBtn: {
      marginHorizontal: 16, marginTop: 12,
      backgroundColor: "rgba(34,197,94,0.1)",
      borderWidth: 1, borderColor: "rgba(34,197,94,0.3)",
      borderRadius: 10, paddingVertical: 10, alignItems: "center",
    },
    markAllText: { color: "#22c55e", fontSize: 13, fontWeight: "500" },
    // Watchlist section
    section: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 16 },
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
    sectionTitle: { fontSize: 14, fontWeight: "700" },
    watchRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
    watchTicker: { fontSize: 14, fontWeight: "700" },
    watchName:   { fontSize: 11, marginTop: 1 },
    watchPrice:  { fontSize: 15, fontWeight: "700" },
    watchChange: { fontSize: 12, fontWeight: "600" },
    // Notifications
    card: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 14, padding: 14, marginBottom: 10,
    },
    cardUnread: { borderColor: "rgba(34,197,94,0.4)", backgroundColor: "rgba(34,197,94,0.04)" },
    cardRow: { flexDirection: "row", alignItems: "flex-start" },
    cardBody: { flex: 1 },
    cardTitle: { color: c.textSub, fontWeight: "600", fontSize: 14, marginBottom: 4 },
    cardMessage: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
    cardDate: { color: c.textDim, fontSize: 11, marginTop: 6 },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22c55e", marginTop: 4 },
    empty: { alignItems: "center", paddingTop: 40 },
    emptyText: { color: c.textMuted, fontSize: 16, fontWeight: "500" },
    emptySubtext: { color: c.textDim, fontSize: 13, textAlign: "center", marginTop: 8, paddingHorizontal: 24 },
    // Modal
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
    modalCard: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20 },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
    modalTitle: { fontSize: 15, fontWeight: "700", flex: 1 },
  });
}
