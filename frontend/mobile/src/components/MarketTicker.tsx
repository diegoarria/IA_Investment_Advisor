import React, { useEffect, useCallback, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, ActivityIndicator, Pressable, Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { marketApi } from "../lib/api";
import { useTheme } from "../lib/ThemeContext";

interface IndexData {
  name: string;
  symbol: string;
  price: number | null;
  change: number;
  change_pct: number;
}

interface NewsItem {
  uuid: string;
  title: string;
  publisher: string;
  url: string;
  timestamp: number;
  symbol: string;
  thumbnail: string | null;
}

const SHORT: Record<string, string> = {
  "^GSPC": "S&P 500",
  "^IXIC": "Nasdaq",
  "^DJI":  "Dow Jones",
  "^RUT":  "Russell 2000",
  "^VIX":  "VIX",
};

const REFRESH = 60_000;

function fmt(price: number, symbol: string): string {
  if (symbol === "^VIX") return price.toFixed(2);
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function relTime(ts: number): string {
  const diff = Math.floor((Date.now() / 1000 - ts) / 60);
  if (diff < 1) return "ahora";
  if (diff < 60) return `hace ${diff}m`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

function IndexChip({
  d,
  colors,
  isLast,
  onPress,
}: {
  d: IndexData;
  colors: ReturnType<typeof useTheme>["colors"];
  isLast: boolean;
  onPress: () => void;
}) {
  const up    = d.change >= 0;
  const color = up ? "#22c55e" : "#ef4444";
  const bg    = up ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)";

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.chip, { borderColor: colors.border, marginRight: isLast ? 0 : 8, backgroundColor: bg }]}
    >
      <Text style={[styles.chipName, { color: colors.textMuted }]}>{SHORT[d.symbol] ?? d.name}</Text>
      {d.price !== null ? (
        <View style={styles.chipRight}>
          <Text style={[styles.chipPrice, { color: colors.text }]}>{fmt(d.price, d.symbol)}</Text>
          <Text style={[styles.chipChange, { color }]}>
            {up ? "▲" : "▼"}{Math.abs(d.change_pct).toFixed(2)}%
          </Text>
        </View>
      ) : (
        <Text style={[styles.chipPrice, { color: colors.textDim }]}>—</Text>
      )}
    </TouchableOpacity>
  );
}

export default function MarketTicker() {
  const { colors, isDark } = useTheme();
  const [data, setData]       = useState<IndexData[]>([]);
  const [loading, setLoading] = useState(true);

  // News modal state
  const [modalIndex, setModalIndex]   = useState<IndexData | null>(null);
  const [newsItems, setNewsItems]     = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const newsCache = React.useRef<Record<string, NewsItem[]>>({});

  const load = useCallback(async () => {
    try {
      const res = await marketApi.getIndices();
      setData(res.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH);
    return () => clearInterval(id);
  }, []);

  const openNews = async (d: IndexData) => {
    setModalIndex(d);
    if (newsCache.current[d.symbol]) {
      setNewsItems(newsCache.current[d.symbol]);
      return;
    }
    setNewsLoading(true);
    setNewsItems([]);
    try {
      const res = await marketApi.getIndexNews(d.symbol);
      const items: NewsItem[] = res.data ?? [];
      newsCache.current[d.symbol] = items;
      setNewsItems(items);
    } catch {}
    setNewsLoading(false);
  };

  const closeModal = () => { setModalIndex(null); setNewsItems([]); setNewsLoading(false); };

  const bg = isDark ? "#0a0e17" : "#f1f5f9";
  const modalBg = isDark ? "#0b1120" : "#ffffff";

  return (
    <>
      <View style={[styles.container, { backgroundColor: bg, borderBottomColor: colors.border }]}>
        {loading || data.length === 0 ? (
          <Text style={[styles.placeholder, { color: colors.textDim }]}>Cargando mercados…</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
            bounces={false}
          >
            {data.map((d, i) => (
              <IndexChip
                key={d.symbol}
                d={d}
                colors={colors}
                isLast={i === data.length - 1}
                onPress={() => openNews(d)}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {/* News Modal */}
      <Modal
        visible={!!modalIndex}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <Pressable style={styles.overlay} onPress={closeModal}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: modalBg, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {modalIndex ? (SHORT[modalIndex.symbol] ?? modalIndex.name) : ""}
                </Text>
                <Text style={[styles.modalSub, { color: colors.textMuted }]}>
                  3 noticias más relevantes
                </Text>
              </View>
              <TouchableOpacity onPress={closeModal} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Body */}
            {newsLoading ? (
              <View style={styles.newsLoading}>
                <ActivityIndicator color={colors.accentLight} />
                <Text style={[styles.newsLoadingText, { color: colors.textMuted }]}>
                  Cargando noticias…
                </Text>
              </View>
            ) : newsItems.length === 0 ? (
              <View style={styles.newsLoading}>
                <Text style={[styles.newsLoadingText, { color: colors.textMuted }]}>
                  No hay noticias disponibles
                </Text>
              </View>
            ) : (
              newsItems.map((item) => (
                <TouchableOpacity
                  key={item.uuid}
                  style={[styles.newsItem, { borderTopColor: colors.border }]}
                  onPress={() => Linking.openURL(item.url)}
                  activeOpacity={0.75}
                >
                  <View style={styles.newsMeta}>
                    <Text style={[styles.newsPublisher, { color: colors.accentLight }]}>
                      {item.publisher}
                    </Text>
                    <Text style={[styles.newsTime, { color: colors.textDim }]}>
                      {relTime(item.timestamp)}
                    </Text>
                  </View>
                  <Text style={[styles.newsTitle, { color: colors.text }]} numberOfLines={3}>
                    {item.title}
                  </Text>
                  <Text style={[styles.newsReadMore, { color: colors.accentLight }]}>
                    Leer artículo →
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
  },
  scroll: {
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipName: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  chipRight: {
    alignItems: "flex-end",
    gap: 1,
  },
  chipPrice: {
    fontSize: 12,
    fontWeight: "700",
  },
  chipChange: {
    fontSize: 10,
    fontWeight: "600",
  },
  placeholder: {
    fontSize: 11,
    paddingHorizontal: 16,
  },
  // Modal
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 440,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  modalSub: {
    fontSize: 11,
    marginTop: 2,
  },
  newsLoading: {
    paddingVertical: 32,
    alignItems: "center",
    gap: 8,
  },
  newsLoadingText: {
    fontSize: 13,
  },
  newsItem: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  newsMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  newsPublisher: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  newsTime: {
    fontSize: 10,
  },
  newsTitle: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    letterSpacing: -0.1,
  },
  newsReadMore: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
});
