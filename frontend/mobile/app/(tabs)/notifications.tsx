import React, { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, SafeAreaView
} from "react-native";
import { notificationsApi } from "../../src/lib/api";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

const TYPE_ICONS: Record<string, string> = {
  market_move: "📉",
  earnings_event: "📊",
  learning_progress: "🚀",
  personalized_insight: "🧠",
  market_summary: "📈",
};

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const res = await notificationsApi.getAll();
      setNotifications(res.data.notifications);
      setUnread(res.data.unread_count);
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const handleMarkRead = async (id: string) => {
    await notificationsApi.markRead(id);
    setNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, read: true } : n)
    );
    setUnread((c) => Math.max(0, c - 1));
  };

  const handleMarkAllRead = async () => {
    await notificationsApi.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
  };

  const renderItem = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      style={[styles.card, !item.read && styles.cardUnread]}
      onPress={() => !item.read && handleMarkRead(item.id)}
    >
      <View style={styles.cardRow}>
        <Text style={styles.cardIcon}>{TYPE_ICONS[item.type] || "🔔"}</Text>
        <View style={styles.cardBody}>
          <Text style={[styles.cardTitle, !item.read && { color: "white" }]}>{item.title}</Text>
          <Text style={styles.cardMessage} numberOfLines={3}>{item.message}</Text>
          <Text style={styles.cardDate}>
            {new Date(item.created_at).toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
        {!item.read && <View style={styles.unreadDot} />}
      </View>
    </TouchableOpacity>
  );

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
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#22c55e" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyText}>Sin notificaciones todavía</Text>
            <Text style={styles.emptySubtext}>Las alertas aparecen cuando hay eventos relevantes del mercado para tu perfil</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f1117" },
  list: { padding: 16, paddingBottom: 32 },
  markAllBtn: {
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: "rgba(34,197,94,0.1)",
    borderWidth: 1, borderColor: "rgba(34,197,94,0.3)",
    borderRadius: 10, paddingVertical: 10, alignItems: "center"
  },
  markAllText: { color: "#22c55e", fontSize: 13, fontWeight: "500" },
  card: {
    backgroundColor: "#1a1d27", borderWidth: 1, borderColor: "#2a2d3a",
    borderRadius: 14, padding: 14, marginBottom: 10
  },
  cardUnread: { borderColor: "rgba(34,197,94,0.4)", backgroundColor: "rgba(34,197,94,0.04)" },
  cardRow: { flexDirection: "row", alignItems: "flex-start" },
  cardIcon: { fontSize: 22, marginRight: 12 },
  cardBody: { flex: 1 },
  cardTitle: { color: "#d1d5db", fontWeight: "600", fontSize: 14, marginBottom: 4 },
  cardMessage: { color: "#9ca3af", fontSize: 13, lineHeight: 18 },
  cardDate: { color: "#4b5563", fontSize: 11, marginTop: 6 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22c55e", marginTop: 4 },
  empty: { alignItems: "center", paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: "#9ca3af", fontSize: 16, fontWeight: "500" },
  emptySubtext: { color: "#4b5563", fontSize: 13, textAlign: "center", marginTop: 8, paddingHorizontal: 24 },
});
