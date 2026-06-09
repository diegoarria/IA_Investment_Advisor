import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/ThemeContext";
import { marketApi } from "../../lib/api";

interface NewsItem {
  title:     string;
  publisher: string;
  timestamp: number;
  url:       string;
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function StockNews({ ticker }: { ticker: string }) {
  const { colors } = useTheme();
  const [items, setItems]     = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    marketApi.getNews([ticker])
      .then((r) => setItems((r.data ?? []).slice(0, 6)))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <View style={s.loader}>
        <ActivityIndicator color={colors.accentLight} size="small" />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={s.loader}>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>Sin noticias recientes</Text>
      </View>
    );
  }

  return (
    <View>
      {items.map((item, i) => (
        <TouchableOpacity
          key={i}
          onPress={() => Linking.openURL(item.url)}
          style={[
            s.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderBottomWidth: i < items.length - 1 ? StyleSheet.hairlineWidth : 0,
            },
          ]}
          activeOpacity={0.7}
        >
          <View style={s.meta}>
            <Text style={[s.source, { color: colors.accentLight }]}>{item.publisher}</Text>
            <Text style={[s.time, { color: colors.textMuted }]}>· {timeAgo(item.timestamp)}</Text>
          </View>
          <Text style={[s.headline, { color: colors.text }]} numberOfLines={3}>
            {item.title}
          </Text>
          <Ionicons
            name="chevron-forward"
            size={14}
            color={colors.textMuted}
            style={s.chevron}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  loader: {
    paddingVertical: 24,
    alignItems: "center",
  },
  card: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: "relative",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 5,
  },
  source: { fontSize: 11, fontWeight: "700" },
  time:   { fontSize: 11 },
  headline: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    paddingRight: 20,
  },
  chevron: {
    position: "absolute",
    right: 14,
    top: "50%",
  },
});
