import React, { useEffect, useState, useMemo, useCallback } from "react";
import StockAvatar from "../../src/components/StockAvatar";
import { useFocusEffect } from "expo-router";
import {
  View, Text, FlatList, TouchableOpacity, Modal,
  StyleSheet, RefreshControl, SafeAreaView, ActivityIndicator, ScrollView, Image, Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { notificationsApi, marketApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useWatchlistStore } from "../../src/lib/watchlistStore";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";

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

interface NewsItem {
  uuid: string;
  title: string;
  publisher: string;
  url: string;
  timestamp: number;
  symbol: string;
  thumbnail: string | null;
}

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread]         = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Portfolio news
  const { positions } = usePortfolioStore();
  const [news, setNews]             = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError]   = useState(false);

  // News filter + pagination
  const [newsFilter, setNewsFilter] = useState<string | null>(null);
  const [newsShown, setNewsShown]   = useState(10);

  // Portfolio today prices
  const [portPrices, setPortPrices] = useState<Record<string, PriceData>>({});
  const [portPricesLoading, setPortPricesLoading] = useState(false);
  const [portSort, setPortSort]     = useState<"gainers" | "losers" | "default">("gainers");

  // Watchlist prices
  const { items: watchlist } = useWatchlistStore();
  const [prices, setPrices]  = useState<Record<string, PriceData>>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  const subStore = useSubscriptionStore();
  const isPremiumAccess = hasPremiumAccess(subStore);
  const [paywallOpen, setPaywallOpen] = useState(false);

  // Alert context modal
  const [alertModal, setAlertModal]     = useState<{ ticker: string; change_pct: number } | null>(null);
  const [alertInsight, setAlertInsight] = useState<string | null>(null);

  // AI news summary modal
  const [newsModal, setNewsModal]         = useState<NewsItem | null>(null);
  const [newsSummary, setNewsSummary]     = useState<string | null>(null);
  const [newsSummaryLoading, setNewsSummaryLoading] = useState(false);

  const openNewsSummary = (item: NewsItem) => {
    setNewsModal(item);
    setNewsSummary(null);
    setNewsSummaryLoading(false);
  };

  const handleRequestSummary = async () => {
    if (!newsModal) return;
    setNewsSummaryLoading(true);
    try {
      const res = await marketApi.summarizeNews(newsModal.title, newsModal.url);
      setNewsSummary(res.data.summary ?? null);
    } catch {
      setNewsSummary("No se pudo generar el resumen. Toca el enlace para leer la nota completa.");
    }
    setNewsSummaryLoading(false);
  };
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

  const loadPortfolioPrices = useCallback(async () => {
    if (positions.length === 0) return;
    setPortPricesLoading(true);
    try {
      const res = await marketApi.getPrices(positions.map((p) => p.ticker));
      const result: Record<string, PriceData> = {};
      for (const [t, d] of Object.entries(res.data as Record<string, { price: number | null; change_pct: number | null }>)) {
        result[t] = { price: d.price, change_pct: d.change_pct };
      }
      setPortPrices(result);
    } catch {}
    setPortPricesLoading(false);
  }, [positions.length]);

  const loadPortfolioNews = useCallback(async () => {
    if (positions.length === 0) return;
    setNewsLoading(true);
    setNewsError(false);
    try {
      const tickers = [...new Set(positions.map((p) => p.ticker))];
      const res = await marketApi.getNews(tickers);
      setNews(res.data ?? []);
    } catch {
      setNewsError(true);
    }
    setNewsLoading(false);
  }, [positions.length]);

  const loadWatchlistWithChange = useCallback(async () => {
    if (watchlist.length === 0) return;
    setPricesLoading(true);
    try {
      const symbols = watchlist.map((w) => w.ticker);
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

  useFocusEffect(useCallback(() => {
    loadPortfolioNews();
    loadPortfolioPrices();
    const interval = setInterval(() => loadPortfolioPrices(), 30_000);
    return () => clearInterval(interval);
  }, [loadPortfolioNews, loadPortfolioPrices]));

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

  // Sorted positions for "Hoy en tu portafolio"
  const sortedPositions = useMemo(() => {
    if (portSort === "default") return positions;
    return [...positions].sort((a, b) => {
      const pa = portPrices[a.ticker]?.change_pct ?? null;
      const pb = portPrices[b.ticker]?.change_pct ?? null;
      if (pa === null && pb === null) return 0;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return portSort === "gainers" ? pb - pa : pa - pb;
    });
  }, [positions, portPrices, portSort]);

  // Filtered + paginated news
  const filteredNews = useMemo(
    () => newsFilter ? news.filter((n) => n.symbol === newsFilter) : news,
    [news, newsFilter]
  );
  const visibleNews = filteredNews.slice(0, newsShown);

  const renderNotification = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, !item.read && styles.cardUnread]}
      onPress={() => !item.read && handleMarkRead(item.id)}
      activeOpacity={0.75}
    >
      <View style={styles.cardRow}>
        <View style={[styles.cardIconBox, { backgroundColor: item.read ? colors.border + "60" : colors.accentLight + "18" }]}>
          <Ionicons
            name={TYPE_ICONS[item.type] ?? "notifications-outline"}
            size={19}
            color={item.read ? colors.textDim : colors.accentLight}
          />
        </View>
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

  const PortfolioTodaySection = () => {
    if (positions.length === 0) return null;
    return (
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Header */}
        <View style={[styles.sectionHeader, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Hoy en tu portafolio</Text>
          {portPricesLoading && <ActivityIndicator size="small" color={colors.accentLight} style={{ marginLeft: 4 }} />}
          {/* Sort buttons */}
          <View style={styles.sortButtons}>
            {([
              { key: "gainers" as const, label: "▲ Más subidas" },
              { key: "losers"  as const, label: "▼ Más caídas" },
              { key: "default" as const, label: "Normal" },
            ]).map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[styles.sortBtn, portSort === key && styles.sortBtnActive]}
                onPress={() => setPortSort(key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.sortBtnText, portSort === key && styles.sortBtnTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Position rows */}
        {sortedPositions.map((pos) => {
          const d   = portPrices[pos.ticker];
          const pct = d?.change_pct ?? null;
          const px  = d?.price ?? null;
          const up  = pct !== null && pct >= 0;
          return (
            <View key={pos.ticker} style={[styles.portTodayRow, { borderTopColor: colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                <StockAvatar ticker={pos.ticker} size={34} />
                <View>
                  <Text style={[styles.portTodayTicker, { color: colors.text }]}>{pos.ticker}</Text>
                  {pos.name && pos.name !== pos.ticker && (
                    <Text style={[styles.portTodayName, { color: colors.textDim }]}>{pos.name}</Text>
                  )}
                </View>
              </View>
              <View style={styles.portTodayRight}>
                {px !== null && (
                  <Text style={[styles.portTodayPrice, { color: colors.textSub }]}>
                    ${px.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                )}
                {pct !== null ? (
                  <View style={[styles.portTodayBadge, { backgroundColor: up ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)" }]}>
                    <Text style={[styles.portTodayBadgeText, { color: up ? "#22c55e" : "#ef4444" }]}>
                      {up ? "+" : ""}{pct.toFixed(2)}%
                    </Text>
                  </View>
                ) : (
                  <Text style={{ color: colors.textDim, fontSize: 12, minWidth: 58, textAlign: "center" }}>—</Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const PortfolioNewsSection = () => {
    const tickers = [...new Set(positions.map((p) => p.ticker))];

    const body = () => {
      if (positions.length === 0) {
        return (
          <View style={styles.newsEmptyState}>
            <Ionicons name="briefcase-outline" size={28} color={colors.textDim} />
            <Text style={[styles.newsEmptyText, { color: colors.textMuted }]}>
              Importa acciones en Portafolio para ver sus noticias aquí
            </Text>
          </View>
        );
      }
      if (newsLoading) {
        return (
          <View style={styles.newsEmptyState}>
            <ActivityIndicator color={colors.accentLight} />
            <Text style={[styles.newsEmptyText, { color: colors.textDim }]}>
              Buscando noticias de {tickers.join(", ")}…
            </Text>
          </View>
        );
      }
      if (newsError) {
        return (
          <TouchableOpacity style={styles.newsEmptyState} onPress={loadPortfolioNews} activeOpacity={0.7}>
            <Ionicons name="refresh-outline" size={24} color={colors.textDim} />
            <Text style={[styles.newsEmptyText, { color: colors.textMuted }]}>
              Error al cargar noticias. Toca para reintentar.
            </Text>
          </TouchableOpacity>
        );
      }
      if (filteredNews.length === 0) {
        return (
          <View style={styles.newsEmptyState}>
            <Ionicons name="newspaper-outline" size={28} color={colors.textDim} />
            <Text style={[styles.newsEmptyText, { color: colors.textMuted }]}>
              {newsFilter
                ? `Sin noticias de ${newsFilter} en los últimos 7 días`
                : `Sin noticias en los últimos 7 días para ${tickers.join(", ")}`}
            </Text>
          </View>
        );
      }
      return (
        <>
          {visibleNews.map((item) => (
            <TouchableOpacity
              key={item.uuid}
              style={[styles.newsRow, { borderTopColor: colors.border }]}
              onPress={() => openNewsSummary(item)}
              activeOpacity={0.75}
            >
              {item.thumbnail ? (
                <Image source={{ uri: item.thumbnail }} style={styles.newsThumbnail} />
              ) : (
                <View style={[styles.newsThumbnail, { backgroundColor: colors.border, alignItems: "center", justifyContent: "center" }]}>
                  <Ionicons name="newspaper-outline" size={18} color={colors.textDim} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={styles.newsTickerRow}>
                  <View style={[styles.newsTickerBadge, { backgroundColor: colors.accentGlow }]}>
                    <Text style={[styles.newsTickerText, { color: colors.accentLight }]}>{item.symbol}</Text>
                  </View>
                  <Text style={[styles.newsDate, { color: colors.textDim }]}>
                    {new Date(item.timestamp * 1000).toLocaleDateString("es", { day: "numeric", month: "short" })}
                  </Text>
                </View>
                <Text style={[styles.newsTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
                <Text style={[styles.newsPublisher, { color: colors.textMuted }]}>{item.publisher}</Text>
              </View>
            </TouchableOpacity>
          ))}
          {visibleNews.length < filteredNews.length && (
            <TouchableOpacity
              style={[styles.newsShowMore, { borderTopColor: colors.border }]}
              onPress={() => setNewsShown((n) => n + 10)}
              activeOpacity={0.7}
            >
              <Text style={[styles.newsShowMoreText, { color: colors.accentLight }]}>
                Ver {Math.min(10, filteredNews.length - visibleNews.length)} noticias más
              </Text>
            </TouchableOpacity>
          )}
        </>
      );
    };

    return (
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Header */}
        <View style={[styles.sectionHeader, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
          <Ionicons name="newspaper-outline" size={14} color={colors.accentLight} />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Noticias de tu portafolio</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textDim }]}>últimos 7 días</Text>
        </View>

        {/* Ticker filter chips */}
        {positions.length > 0 && !newsLoading && news.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipScrollContent}
          >
            <TouchableOpacity
              style={[styles.chip, newsFilter === null && styles.chipActive]}
              onPress={() => { setNewsFilter(null); setNewsShown(10); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, newsFilter === null && styles.chipTextActive]}>Todas</Text>
            </TouchableOpacity>
            {[...new Set(positions.map((p) => p.ticker))].map((ticker) => {
              const count = news.filter((n) => n.symbol === ticker).length;
              if (count === 0) return null;
              const active = newsFilter === ticker;
              return (
                <TouchableOpacity
                  key={ticker}
                  style={[styles.chip, active && styles.chipActive, !isPremiumAccess && { opacity: 0.7 }]}
                  onPress={() => isPremiumAccess ? (setNewsFilter(ticker), setNewsShown(10)) : setPaywallOpen(true)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {!isPremiumAccess ? "🔒 " : ""}{ticker} · {count}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {body()}
      </View>
    );
  };

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
              <StockAvatar ticker={item.ticker} size={34} />
              <View style={{ flex: 1, marginLeft: 10 }}>
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
              await Promise.all([loadNotifications(), loadWatchlistWithChange(), loadPortfolioNews(), loadPortfolioPrices()]);
              setRefreshing(false);
            }}
            tintColor="#22c55e"
          />
        }
        ListHeaderComponent={<><PortfolioTodaySection /><PortfolioNewsSection /><WatchlistSection /></>}
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

      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason="Las noticias ilimitadas son exclusivas de Premium"
      />

      {/* AI News summary modal */}
      <Modal visible={!!newsModal} transparent animationType="slide" onRequestClose={() => { setNewsModal(null); setNewsSummary(null); }}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={2}>
                {newsModal?.title}
              </Text>
              <TouchableOpacity onPress={() => { setNewsModal(null); setNewsSummary(null); }}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.textDim, fontSize: 11, marginBottom: 14 }}>
              {newsModal?.publisher} · {newsModal ? new Date(newsModal.timestamp * 1000).toLocaleDateString("es", { day: "numeric", month: "long" }) : ""}
            </Text>

            {/* State 1: Initial choice */}
            {!newsSummary && !newsSummaryLoading && (
              <View style={styles.newsChoiceRow}>
                <TouchableOpacity
                  style={[styles.newsChoiceCard, { borderColor: colors.border, backgroundColor: colors.bg }]}
                  activeOpacity={0.75}
                  onPress={() => { setNewsModal(null); Linking.openURL(newsModal?.url ?? "").catch(() => {}); }}
                >
                  <Text style={styles.newsChoiceEmoji}>🌐</Text>
                  <Text style={[styles.newsChoiceTitle, { color: colors.text }]}>Ver noticia completa</Text>
                  <Text style={[styles.newsChoiceSub, { color: colors.textMuted }]}>Abre el artículo original</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.newsChoiceCard, { borderColor: colors.accentLight + "55", backgroundColor: colors.accentGlow }]}
                  activeOpacity={0.75}
                  onPress={handleRequestSummary}
                >
                  <Text style={styles.newsChoiceEmoji}>✦</Text>
                  <Text style={[styles.newsChoiceTitle, { color: colors.accentLight }]}>Resumen de IA</Text>
                  <Text style={[styles.newsChoiceSub, { color: colors.textMuted }]}>4–8 líneas con lo esencial</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* State 2: Loading */}
            {newsSummaryLoading && (
              <View style={{ alignItems: "center", paddingVertical: 36 }}>
                <ActivityIndicator color={colors.accentLight} size="large" />
                <Text style={{ color: colors.textMuted, marginTop: 14, fontSize: 13 }}>Leyendo el artículo…</Text>
              </View>
            )}

            {/* State 3: Summary */}
            {!!newsSummary && !newsSummaryLoading && (
              <>
                <ScrollView style={{ maxHeight: 280 }}>
                  <Markdown style={markdownStyles}>{newsSummary}</Markdown>
                </ScrollView>
                <View style={[styles.newsSummaryActions, { borderTopColor: colors.border }]}>
                  <TouchableOpacity
                    style={[styles.newsSummaryBtn, { borderColor: colors.border }]}
                    onPress={() => { setNewsModal(null); setNewsSummary(null); Linking.openURL(newsModal?.url ?? "").catch(() => {}); }}
                  >
                    <Ionicons name="open-outline" size={14} color={colors.textSub} />
                    <Text style={[styles.newsSummaryBtnText, { color: colors.textSub }]}>Ver artículo completo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.newsSummaryBtn, { borderColor: colors.accentLight + "55", backgroundColor: colors.accentGlow }]}
                    onPress={() => { setNewsModal(null); setNewsSummary(null); }}
                  >
                    <Text style={[styles.newsSummaryBtnText, { color: colors.accentLight }]}>Cerrar</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Alert context modal */}
      <Modal visible={!!alertModal} transparent animationType="slide" onRequestClose={() => setAlertModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {(alertModal?.change_pct ?? 0) >= 0 ? "📈" : "📉"} {alertModal?.ticker} {(alertModal?.change_pct ?? 0) >= 0 ? "subió" : "cayó"} {Math.abs(alertModal?.change_pct ?? 0).toFixed(1)}%
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
    list: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 40 },

    // Mark all button
    markAllBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
      marginHorizontal: 14, marginTop: 12,
      backgroundColor: c.accentLight + "12",
      borderWidth: 1, borderColor: c.accentLight + "40",
      borderRadius: 12, paddingVertical: 11,
    },
    markAllText: { color: c.accentLight, fontSize: 13, fontWeight: "600", letterSpacing: 0.1 },

    // Sections
    section: {
      borderRadius: 16, borderWidth: 1, overflow: "hidden", marginBottom: 16,
    },
    sectionHeader: {
      flexDirection: "row", alignItems: "center", gap: 7,
      paddingHorizontal: 14, paddingVertical: 12,
    },
    sectionTitle: { fontSize: 13, fontWeight: "700", letterSpacing: 0.2 },
    sectionSubtitle: { fontSize: 11, letterSpacing: 0.2 },

    // Sort buttons (for Hoy en tu portafolio)
    sortButtons: { flexDirection: "row", gap: 4, marginLeft: "auto" },
    sortBtn: {
      paddingHorizontal: 7, paddingVertical: 4,
      borderRadius: 8, backgroundColor: "transparent",
    },
    sortBtnActive: { backgroundColor: c.accent },
    sortBtnText: { fontSize: 9, fontWeight: "600", color: c.textMuted },
    sortBtnTextActive: { color: "#fff" },

    // Portfolio today rows
    portTodayRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 14, paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    portTodayTicker: { fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
    portTodayName:   { fontSize: 10, marginTop: 2, letterSpacing: 0.1 },
    portTodayRight:  { flexDirection: "row", alignItems: "center", gap: 8 },
    portTodayPrice:  { fontSize: 13, fontWeight: "600" },
    portTodayBadge:  { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, minWidth: 62, alignItems: "center" },
    portTodayBadgeText: { fontSize: 11, fontWeight: "700" },

    // News filter chips
    chipScroll: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    chipScrollContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 6, flexDirection: "row" },
    chip: {
      paddingHorizontal: 10, paddingVertical: 5,
      borderRadius: 20, borderWidth: 1,
      borderColor: c.border, backgroundColor: "transparent",
    },
    chipActive: { backgroundColor: c.accent, borderColor: c.accent },
    chipText:       { fontSize: 10, fontWeight: "700", color: c.textMuted },
    chipTextActive: { color: "#fff" },

    // Portfolio news
    newsRow: {
      flexDirection: "row", alignItems: "flex-start", gap: 12,
      paddingHorizontal: 14, paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    newsThumbnail: { width: 60, height: 60, borderRadius: 10, flexShrink: 0 },
    newsTickerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
    newsTickerBadge: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
    newsTickerText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
    newsDate:      { fontSize: 10 },
    newsTitle:     { fontSize: 13, fontWeight: "600", lineHeight: 18, marginBottom: 4 },
    newsPublisher: { fontSize: 11 },
    newsEmptyState: {
      alignItems: "center" as const, gap: 10,
      paddingHorizontal: 16, paddingVertical: 20,
    },
    newsEmptyText: { fontSize: 13, textAlign: "center" as const, lineHeight: 19 },
    newsShowMore: {
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingVertical: 14,
      alignItems: "center",
    },
    newsShowMoreText: { fontSize: 12, fontWeight: "600" },

    newsChoiceRow: {
      flexDirection: "row", gap: 10, marginBottom: 8,
    },
    newsChoiceCard: {
      flex: 1, borderWidth: 1, borderRadius: 12,
      padding: 14, alignItems: "center", gap: 6,
    },
    newsChoiceEmoji: { fontSize: 22 },
    newsChoiceTitle: { fontSize: 13, fontWeight: "700", textAlign: "center" },
    newsChoiceSub: { fontSize: 11, textAlign: "center", lineHeight: 15 },

    newsSummaryActions: {
      flexDirection: "row", gap: 8, marginTop: 14,
      paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth,
    },
    newsSummaryBtn: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 5, borderWidth: 1, borderRadius: 10, paddingVertical: 10,
    },
    newsSummaryBtnText: { fontSize: 12, fontWeight: "600" },

    // News tabs
    newsTabs: {
      flexDirection: "row", borderRadius: 10, padding: 3, gap: 4, alignSelf: "stretch",
    },
    newsTabBtn: {
      flex: 1, borderRadius: 8, paddingVertical: 7, alignItems: "center",
      borderWidth: 1, borderColor: "transparent",
    },
    newsTabText: { fontSize: 12, fontWeight: "700" },

    // Watchlist
    watchRow: {
      flexDirection: "row", alignItems: "center",
      paddingHorizontal: 14, paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    watchTicker: { fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
    watchName:   { fontSize: 11, marginTop: 2, letterSpacing: 0.1 },
    watchPrice:  { fontSize: 15, fontWeight: "700" },
    watchChange: { fontSize: 12, fontWeight: "700" },

    // Notification cards
    card: {
      backgroundColor: c.card,
      borderWidth: 1, borderColor: c.border,
      borderRadius: 16, padding: 14, marginBottom: 8,
    },
    cardUnread: {
      borderColor: c.accentLight + "50",
      backgroundColor: c.accentLight + "06",
    },
    cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    cardIconBox: {
      width: 38, height: 38, borderRadius: 11,
      alignItems: "center", justifyContent: "center",
      flexShrink: 0, marginTop: 1,
    },
    cardBody: { flex: 1 },
    cardTitle: { color: c.textSub, fontWeight: "600", fontSize: 14, marginBottom: 4, lineHeight: 20 },
    cardMessage: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
    cardDate: { color: c.textDim, fontSize: 10, marginTop: 7, letterSpacing: 0.2 },
    unreadDot: {
      width: 9, height: 9, borderRadius: 5,
      backgroundColor: c.accentLight, marginTop: 5, flexShrink: 0,
      shadowColor: c.accentLight, shadowOpacity: 0.8, shadowRadius: 4, shadowOffset: { width: 0, height: 0 },
    },

    // Empty state
    empty: { alignItems: "center", paddingTop: 56, paddingHorizontal: 32 },
    emptyText: { color: c.textMuted, fontSize: 17, fontWeight: "700", letterSpacing: -0.3, marginTop: 16 },
    emptySubtext: { color: c.textDim, fontSize: 13, textAlign: "center", marginTop: 8, lineHeight: 20 },

    // Alert modal
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
    modalCard: {
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      borderWidth: 1, borderBottomWidth: 0,
      padding: 22, paddingTop: 14,
    },
    modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, alignSelf: "center", marginBottom: 18 },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
    modalTitle: { fontSize: 15, fontWeight: "700", flex: 1, letterSpacing: -0.2 },
  });
}
