import React, { useEffect, useCallback, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, ActivityIndicator, Pressable, Linking, Image, Animated,
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
  "^RUT":  "Russell",
  "^VIX":  "VIX",
};

function isMarketOpen(): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = get("weekday");
  if (day === "Sat" || day === "Sun") return false;
  const mins = parseInt(get("hour")) * 60 + parseInt(get("minute"));
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function fmtPrice(price: number, symbol: string): string {
  if (symbol === "^VIX") return price.toFixed(2);
  if (price >= 10000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function relTime(ts: number): string {
  const h = Math.floor((Date.now() / 1000 - ts) / 3600);
  if (h < 1) return "Ahora";
  if (h === 1) return "Hace 1h";
  if (h < 24) return `Hace ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Ayer" : `Hace ${d}d`;
}

function LiveDot({ open }: { open: boolean }) {
  const anim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!open) { anim.setValue(1); return; }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [open]);

  return (
    <View style={styles.liveWrap}>
      <Animated.View style={[styles.liveDot, { backgroundColor: open ? "#22c55e" : "#6b7280", opacity: anim }]} />
      <Text style={[styles.liveText, { color: open ? "#22c55e" : "#6b7280" }]}>
        {open ? "LIVE" : "CLOSED"}
      </Text>
    </View>
  );
}

export default function MarketTicker() {
  const { colors } = useTheme();
  const [data, setData]         = useState<IndexData[]>([]);
  const [loading, setLoading]   = useState(true);
  const [marketOpen, setMarketOpen] = useState(false);

  const [modalIdx, setModalIdx]       = useState<IndexData | null>(null);
  const [newsItems, setNewsItems]     = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const newsCache = React.useRef<Record<string, NewsItem[]>>({});

  const load = useCallback(async () => {
    try {
      const res = await marketApi.getIndices();
      setData(res.data ?? []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    setMarketOpen(isMarketOpen());
    load();

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const open = isMarketOpen();
      setMarketOpen(open);
      timer = setTimeout(async () => {
        await load();
        schedule();
      }, open ? 10_000 : 300_000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  const openNews = async (d: IndexData) => {
    setModalIdx(d);
    if (newsCache.current[d.symbol]) {
      setNewsItems(newsCache.current[d.symbol]);
      return;
    }
    setNewsLoading(true);
    setNewsItems([]);
    try {
      const res = await marketApi.getIndexNews(d.symbol);
      const items: NewsItem[] = (res.data ?? []).slice(0, 3);
      newsCache.current[d.symbol] = items;
      setNewsItems(items);
    } catch {}
    setNewsLoading(false);
  };

  const closeModal = () => { setModalIdx(null); setNewsItems([]); setNewsLoading(false); };

  return (
    <>
      <View style={[styles.bar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {/* LIVE / CLOSED */}
        <View style={[styles.liveSection, { borderRightColor: colors.border }]}>
          <LiveDot open={marketOpen} />
        </View>

        {loading || data.length === 0 ? (
          <Text style={[styles.placeholder, { color: colors.textDim }]}>Cargando mercados…</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
            bounces={false}
          >
            {data.map((d, i) => {
              const up  = d.change_pct >= 0;
              const col = up ? "#22c55e" : "#ef4444";
              const absStr = Math.abs(d.change) >= 0.01
                ? d.change.toFixed(2)
                : d.change.toFixed(4);
              return (
                <TouchableOpacity
                  key={d.symbol}
                  onPress={() => openNews(d)}
                  activeOpacity={0.7}
                  style={[
                    styles.item,
                    i < data.length - 1 && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
                  ]}
                >
                  <Text style={[styles.itemName, { color: colors.textSub }]}>
                    {SHORT[d.symbol] ?? d.name}
                  </Text>
                  {d.price !== null && (
                    <>
                      <Text style={[styles.itemPrice, { color: colors.text }]}>
                        {fmtPrice(d.price, d.symbol)}
                      </Text>
                      <Text style={[styles.itemPct, { color: col }]}>
                        {up ? "▲" : "▼"} {Math.abs(d.change_pct).toFixed(2)}%
                      </Text>
                      <Text style={[styles.itemAbs, { color: col }]}>
                        ({up ? "+" : ""}{absStr})
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* News modal */}
      <Modal visible={!!modalIdx} transparent animationType="fade" onRequestClose={closeModal}>
        <Pressable style={styles.overlay} onPress={closeModal}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  Noticias — {modalIdx ? (SHORT[modalIdx.symbol] ?? modalIdx.name) : ""}
                </Text>
                {modalIdx?.price != null && (
                  <View style={styles.modalPriceLine}>
                    <Text style={[styles.modalPrice, { color: colors.textMuted }]}>
                      {fmtPrice(modalIdx.price, modalIdx.symbol)}
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: modalIdx.change_pct >= 0 ? "#22c55e" : "#ef4444" }}>
                      {modalIdx.change_pct >= 0 ? "▲" : "▼"} {Math.abs(modalIdx.change_pct).toFixed(2)}%
                    </Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={closeModal} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Body */}
            {newsLoading ? (
              <View style={styles.emptyState}>
                <ActivityIndicator color={colors.accentLight} />
              </View>
            ) : newsItems.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: colors.textDim }]}>Sin noticias disponibles</Text>
              </View>
            ) : (
              newsItems.map((item, i) => (
                <TouchableOpacity
                  key={item.uuid || String(i)}
                  style={[styles.newsItem, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
                  onPress={() => Linking.openURL(item.url)}
                  activeOpacity={0.75}
                >
                  <View style={styles.newsRow}>
                    <View style={styles.newsLeft}>
                      <View style={styles.newsTitleRow}>
                        <Text style={[styles.newsNum, { color: colors.accentLight }]}>{i + 1}.</Text>
                        <Text style={[styles.newsTitle, { color: colors.text }]} numberOfLines={2}>
                          {item.title}
                        </Text>
                      </View>
                      <Text style={[styles.newsMeta, { color: colors.textDim }]}>
                        {item.publisher} · {relTime(item.timestamp)}
                      </Text>
                      <Text style={[styles.readMore, { color: colors.accentLight }]}>
                        Leer artículo →
                      </Text>
                    </View>
                    {item.thumbnail ? (
                      <Image
                        source={{ uri: item.thumbnail }}
                        style={styles.thumbnail}
                        resizeMode="cover"
                      />
                    ) : null}
                  </View>
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
  // ─── Ticker bar ────────────────────────────────────────────────────────────
  bar: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  liveSection: {
    paddingHorizontal: 10,
    height: 34,
    justifyContent: "center",
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  liveWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  liveDot: {
    width: 6, height: 6, borderRadius: 3,
  },
  liveText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  scroll: {
    alignItems: "center",
    height: 34,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    height: 34,
  },
  itemName: {
    fontSize: 10,
    fontWeight: "600",
  },
  itemPrice: {
    fontSize: 10.5,
    fontWeight: "700",
  },
  itemPct: {
    fontSize: 9.5,
    fontWeight: "700",
  },
  itemAbs: {
    fontSize: 9,
    fontWeight: "500",
    opacity: 0.65,
  },
  placeholder: {
    fontSize: 11,
    paddingHorizontal: 16,
  },

  // ─── Modal ─────────────────────────────────────────────────────────────────
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
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
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  modalPriceLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 3,
  },
  modalPrice: {
    fontSize: 12,
  },
  emptyState: {
    paddingVertical: 32,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 13,
  },
  newsItem: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  newsRow: {
    flexDirection: "row",
    gap: 12,
  },
  newsLeft: {
    flex: 1,
    gap: 4,
  },
  newsTitleRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "flex-start",
  },
  newsNum: {
    fontSize: 12,
    fontWeight: "800",
    marginTop: 1,
    flexShrink: 0,
  },
  newsTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    letterSpacing: -0.1,
  },
  newsMeta: {
    fontSize: 11,
  },
  readMore: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  thumbnail: {
    width: 80,
    height: 64,
    borderRadius: 10,
    flexShrink: 0,
  },
});
