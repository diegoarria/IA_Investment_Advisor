import React, { useEffect, useState, useMemo } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, SafeAreaView
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { notificationsApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

const TYPE_ICONS: Record<string, IoniconName> = {
  market_move: "trending-down-outline",
  earnings_event: "bar-chart-outline",
  learning_progress: "rocket-outline",
  personalized_insight: "bulb-outline",
  market_summary: "trending-up-outline",
};

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor="#22c55e"
          />
        }
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
    empty: { alignItems: "center", paddingTop: 80 },
    emptyText: { color: c.textMuted, fontSize: 16, fontWeight: "500" },
    emptySubtext: { color: c.textDim, fontSize: 13, textAlign: "center", marginTop: 8, paddingHorizontal: 24 },
  });
}
