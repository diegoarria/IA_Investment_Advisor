"use client";

import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PremiumBadge from "@/components/PremiumBadge";
import StockAvatar from "@/components/StockAvatar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import { notifications as notifApi, market as marketApi } from "@/lib/api";
import { useAuthStore, useNotificationStore, useThemeStore, useWatchlistStore, useSubscriptionStore } from "@/lib/store";
import { usePortfolioStore, type Position } from "@/lib/portfolioStore";
import PaywallModal from "@/components/PaywallModal";
import { Bell, Menu, X, Sun, Moon, Newspaper, Bookmark, RefreshCw, Loader2 } from "lucide-react";
import GuidedSteps from "@/components/GuidedSteps";

const TYPE_ICONS: Record<string, string> = {
  market_move:           "📉",
  earnings_event:        "📊",
  learning_progress:     "🚀",
  personalized_insight:  "🧠",
  market_summary:        "📈",
};

interface NewsItem {
  uuid: string; title: string; publisher: string;
  url: string; timestamp: number; symbol: string; thumbnail: string | null;
}

interface PriceData { price: number | null; change_pct: number | null; }

export default function NotificationsPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { notifications, unreadCount, setNotifications, markRead } = useNotificationStore();
  const { theme, toggleTheme } = useThemeStore();
  const { items: watchlist, remove: removeFromWatchlist } = useWatchlistStore();
  const { positions } = usePortfolioStore();
  const subStore = useSubscriptionStore();
  const isPremium = subStore.tier === "premium";

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Portfolio news
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(false);

  // Portfolio today prices
  const [portPrices, setPortPrices] = useState<Record<string, PriceData>>({});
  const [portPricesLoading, setPortPricesLoading] = useState(false);
  const [portSort, setPortSort] = useState<"default" | "gainers" | "losers">("gainers");

  // Watchlist prices
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  // News filter + pagination
  const [newsFilter, setNewsFilter] = useState<string | null>(null);
  const [newsShown, setNewsShown] = useState(10);

  // Alert context modal
  const [alertModal, setAlertModal] = useState<{ ticker: string; change_pct: number } | null>(null);
  const [alertInsight, setAlertInsight] = useState<string | null>(null);
  const [alertLoading, setAlertLoading] = useState(false);

  // AI news summary modal
  const [newsModal, setNewsModal] = useState<NewsItem | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);

  const loadNotifications = async () => {
    try {
      const res = await notifApi.getAll();
      setNotifications(res.data.notifications ?? [], res.data.unread_count ?? 0);
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
    setNewsLoading(true); setNewsError(false);
    try {
      const tickers = [...new Set(positions.map((p) => p.ticker))];
      const res = await marketApi.getNews(tickers);
      setNews(res.data ?? []);
    } catch { setNewsError(true); }
    setNewsLoading(false);
  }, [positions.length]);


  const loadWatchlistPrices = useCallback(async () => {
    if (watchlist.length === 0) return;
    setPricesLoading(true);
    try {
      const results: Record<string, PriceData> = {};
      await Promise.all(watchlist.map(async (item) => {
        try {
          const res = await marketApi.getChart(item.ticker, "1d");
          results[item.ticker] = { price: res.data.current_price ?? null, change_pct: res.data.change_pct ?? null };
        } catch { results[item.ticker] = { price: null, change_pct: null }; }
      }));
      setPrices(results);
    } catch {}
    setPricesLoading(false);
  }, [watchlist.length]);

  const openAlertContext = async (ticker: string, change_pct: number) => {
    setAlertModal({ ticker, change_pct });
    setAlertInsight(null); setAlertLoading(true);
    try {
      const res = await marketApi.alertContext(ticker, change_pct);
      setAlertInsight(res.data.insight);
    } catch {}
    setAlertLoading(false);
  };

  const handleMarkAllRead = async () => {
    await notifApi.markAllRead();
    setNotifications(notifications.map((n) => ({ ...n, read: true })), 0);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadNotifications(), loadPortfolioNews(), loadWatchlistPrices(), loadPortfolioPrices()]);
    setRefreshing(false);
  };

  useEffect(() => {
    loadNotifications();
    loadWatchlistPrices();
    loadPortfolioPrices();
  }, [isAuthenticated]);

  useEffect(() => {
    loadPortfolioNews();
    loadPortfolioPrices();
  }, [positions.length]);

  // Auto-refresh portfolio prices every 30s
  useEffect(() => {
    if (positions.length === 0) return;
    const id = setInterval(() => loadPortfolioPrices(), 30_000);
    return () => clearInterval(id);
  }, [positions.length, loadPortfolioPrices]);

  const filteredNews = useMemo(
    () => newsFilter ? news.filter((n) => n.symbol === newsFilter) : news,
    [news, newsFilter]
  );
  const visibleNews = filteredNews.slice(0, newsShown);

  const sortedPositions = useMemo((): Position[] => {
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

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="font-ui border-b flex items-center justify-between px-4 py-2 shrink-0"
           style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1 rounded-lg" style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button onClick={() => router.push("/chat")} className="flex items-center gap-2.5">
            <div className="relative">
              <Image src="/logo.png" alt="Nuvos AI" width={30} height={30} className="rounded-xl object-cover" />
            </div>
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </button>
        </div>
        <span className="font-semibold text-sm" style={{ color: "var(--sub)", fontFamily: "var(--font-body)" }}>Notificaciones</span>
        <div className="flex items-center gap-1">
          <PremiumBadge />
          <button onClick={handleRefresh} disabled={refreshing} className="p-2 rounded-lg hover:bg-white/5" style={{ color: "var(--muted)" }}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-white/5" style={{ color: "var(--muted)" }}>
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <MarketTickerBar />

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main */}
        <main className="flex-1 overflow-y-auto scrollbar-thin p-4">
          <GuidedSteps currentPage="notifications" />
          <div className="max-w-2xl mx-auto space-y-4 pb-8">

            {/* Mark all read */}
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead}
                      className="w-full py-2.5 rounded-xl border text-xs font-semibold text-center transition-colors hover:opacity-80"
                      style={{ background: "var(--accent-l)" + "12", borderColor: "var(--accent-l)" + "40", color: "var(--accent-l)" }}>
                Marcar todas como leídas ({unreadCount})
              </button>
            )}

            {/* Noticias — Mi portafolio */}
            <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>

              {/* Header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                <Newspaper className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
                <span className="text-sm font-bold" style={{ color: "var(--text)" }}>Noticias de tu portafolio</span>
                <span className="text-xs" style={{ color: "var(--dim)" }}>últimos 7 días</span>
              </div>

              {/* Ticker filter chips */}
              {positions.length > 0 && !newsLoading && news.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                  <button onClick={() => { setNewsFilter(null); setNewsShown(10); }}
                          className="text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all"
                          style={{
                            background: newsFilter === null ? "var(--accent)" : "var(--raised)",
                            borderColor: newsFilter === null ? "var(--accent)" : "var(--border)",
                            color: newsFilter === null ? "#fff" : "var(--muted)",
                          }}>
                    Todas
                  </button>
                  {[...new Set(positions.map((p) => p.ticker))].map((ticker) => {
                    const active = newsFilter === ticker;
                    const count = news.filter((n) => n.symbol === ticker).length;
                    if (count === 0) return null;
                    return (
                      <button key={ticker}
                              onClick={() => isPremium ? (setNewsFilter(ticker), setNewsShown(10)) : setPaywallOpen(true)}
                              className="text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all flex items-center gap-1"
                              style={{
                                background: active ? "var(--accent)" : "var(--raised)",
                                borderColor: active ? "var(--accent)" : "var(--border)",
                                color: active ? "#fff" : "var(--muted)",
                                opacity: isPremium ? 1 : 0.7,
                              }}>
                        {!isPremium && <span style={{ fontSize: 9 }}>🔒</span>}
                        {ticker} <span style={{ opacity: 0.7 }}>·{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {positions.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 px-4 text-center">
                  <span className="text-2xl">💼</span>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>Importa posiciones en Portafolio para ver sus noticias aquí</p>
                </div>
              ) : newsLoading ? (
                <div className="flex flex-col items-center gap-2 py-6">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--accent-l)" }} />
                  <p className="text-xs" style={{ color: "var(--dim)" }}>
                    Buscando noticias de {positions.map((p) => p.ticker).join(", ")}…
                  </p>
                </div>
              ) : newsError ? (
                <button onClick={loadPortfolioNews} className="w-full flex flex-col items-center gap-2 py-6 hover:opacity-70">
                  <RefreshCw className="w-5 h-5" style={{ color: "var(--dim)" }} />
                  <p className="text-xs" style={{ color: "var(--muted)" }}>Error al cargar. Toca para reintentar.</p>
                </button>
              ) : filteredNews.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center px-4">
                  <Newspaper className="w-6 h-6" style={{ color: "var(--dim)" }} />
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {newsFilter ? `Sin noticias de ${newsFilter} en los últimos 7 días` : "Sin noticias en los últimos 7 días"}
                  </p>
                </div>
              ) : (
                <>
                  {visibleNews.map((item) => (
                    <button
                      key={item.uuid}
                      onClick={() => {
                        if (isPremium) { setSummaryText(null); setNewsModal(item); }
                        else window.open(item.url, "_blank", "noopener,noreferrer");
                      }}
                      className="w-full flex items-start gap-3 px-4 py-3 border-t hover:bg-white/3 transition-colors text-left"
                      style={{ borderColor: "var(--border)" }}
                    >
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--border)" }}>
                          <Newspaper className="w-5 h-5" style={{ color: "var(--dim)" }} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-black px-1.5 py-0.5 rounded"
                                style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)" }}>
                            {item.symbol}
                          </span>
                          <span className="text-[10px]" style={{ color: "var(--dim)" }}>
                            {new Date(item.timestamp * 1000).toLocaleDateString("es", { day: "numeric", month: "short" })}
                          </span>
                          {isPremium && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full ml-auto"
                                  style={{ background: "rgba(168,85,247,0.12)", color: "#a855f7" }}>
                              ✦ IA
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold leading-snug line-clamp-2" style={{ color: "var(--text)" }}>{item.title}</p>
                        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{item.publisher}</p>
                      </div>
                    </button>
                  ))}
                  {visibleNews.length < filteredNews.length && (
                    <button onClick={() => setNewsShown((n) => n + 10)}
                            className="w-full py-3 border-t text-xs font-semibold transition-colors hover:bg-white/5"
                            style={{ borderColor: "var(--border)", color: "var(--accent-l)" }}>
                      Ver {Math.min(10, filteredNews.length - visibleNews.length)} noticias más
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Hoy en tu portafolio */}
            {positions.length > 0 && (
              <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: "var(--text)" }}>Hoy en tu portafolio</span>
                    {portPricesLoading && <Loader2 className="w-3 h-3 animate-spin" style={{ color: "var(--muted)" }} />}
                  </div>
                  {/* Sort filters */}
                  <div className="flex gap-1">
                    {([
                      { key: "gainers", label: "▲ Más subidas" },
                      { key: "losers",  label: "▼ Más caídas" },
                      { key: "default", label: "Normal" },
                    ] as const).map(({ key, label }) => (
                      <button key={key} onClick={() => setPortSort(key)}
                              className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all"
                              style={{
                                background: portSort === key ? "var(--accent)" : "var(--raised)",
                                color: portSort === key ? "#fff" : "var(--muted)",
                              }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* List */}
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {sortedPositions.map((pos) => {
                    const d   = portPrices[pos.ticker];
                    const pct = d?.change_pct ?? null;
                    const px  = d?.price ?? null;
                    const up  = pct !== null && pct >= 0;
                    return (
                      <div key={pos.ticker} className="flex items-center justify-between px-4 py-1.5">
                        <div className="flex items-center gap-2">
                          <StockAvatar ticker={pos.ticker} size="sm" />
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs" style={{ color: "var(--text)" }}>{pos.ticker}</span>
                            {pos.name && pos.name !== pos.ticker && (
                              <span className="text-[10px]" style={{ color: "var(--dim)" }}>{pos.name}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {px !== null && (
                            <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--sub)" }}>
                              ${px.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          )}
                          {pct !== null ? (
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[52px] text-center tabular-nums"
                                  style={{ background: up ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", color: up ? "var(--up)" : "var(--down)" }}>
                              {up ? "+" : ""}{pct.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-[11px] min-w-[52px] text-center" style={{ color: "var(--dim)" }}>—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Watchlist */}
            {watchlist.length > 0 && (
              <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                  <Bookmark className="w-3.5 h-3.5 fill-current" style={{ color: "var(--accent-l)" }} />
                  <span className="text-sm font-bold" style={{ color: "var(--text)" }}>Watchlist</span>
                  {pricesLoading && <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" style={{ color: "var(--accent-l)" }} />}
                </div>
                {watchlist.map((item) => {
                  const p = prices[item.ticker];
                  const chgColor = !p?.change_pct ? "var(--dim)" : p.change_pct >= 0 ? "#22c55e" : "#ef4444";
                  const bigMove = p?.change_pct !== null && p?.change_pct !== undefined && Math.abs(p.change_pct) >= 3;
                  return (
                    <div key={item.ticker} className="flex items-center gap-3 px-4 py-3 border-t"
                         style={{ borderColor: "var(--border)" }}>
                      <StockAvatar ticker={item.ticker} size="sm" />
                      <div className="flex-1">
                        <div className="font-bold text-sm" style={{ color: "var(--text)" }}>{item.ticker}</div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{item.name}</div>
                      </div>
                      <div className="text-right">
                        {p?.price ? (
                          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>
                            ${p.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                          </div>
                        ) : <div className="text-sm" style={{ color: "var(--dim)" }}>—</div>}
                        {p?.change_pct !== null && p?.change_pct !== undefined && (
                          <button onClick={() => bigMove ? openAlertContext(item.ticker, p.change_pct!) : undefined}
                                  className={`text-xs font-bold mt-0.5 ${bigMove ? "hover:opacity-70" : ""}`}
                                  style={{ color: chgColor }}>
                            {p.change_pct >= 0 ? "▲" : "▼"} {Math.abs(p.change_pct).toFixed(2)}%{bigMove ? " ⚠️" : ""}
                          </button>
                        )}
                      </div>
                      <button onClick={() => removeFromWatchlist(item.ticker)} className="ml-2 p-1 hover:opacity-70" style={{ color: "var(--dim)" }}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Notifications list */}
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-3">
                <Bell className="w-12 h-12" style={{ color: "var(--dim)", opacity: 0.4 }} />
                <p className="text-base font-bold" style={{ color: "var(--muted)" }}>Sin notificaciones todavía</p>
                <p className="text-sm text-center max-w-xs" style={{ color: "var(--dim)" }}>
                  Las alertas aparecen cuando hay eventos relevantes del mercado para tu perfil
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.map((n) => (
                  <div key={n.id} onClick={() => { if (!n.read) { markRead(n.id); notifApi.markRead(n.id); } }}
                       className="p-4 rounded-2xl border cursor-pointer transition-all"
                       style={{
                         background: n.read ? "var(--card)" : "var(--accent-l)" + "06",
                         borderColor: n.read ? "var(--border)" : "var(--accent-l)" + "50",
                       }}>
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                           style={{ background: n.read ? "var(--border)" + "60" : "var(--accent-l)" + "18" }}>
                        <span className="text-lg">{TYPE_ICONS[n.type] ?? "🔔"}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-sm" style={{ color: n.read ? "var(--sub)" : "var(--text)" }}>
                            {n.title}
                          </span>
                          {!n.read && (
                            <div className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ background: "var(--accent-l)" }} />
                          )}
                        </div>
                        <p className="text-xs mt-1 leading-relaxed line-clamp-3" style={{ color: "var(--muted)" }}>{n.message}</p>
                        <p className="text-[10px] mt-2" style={{ color: "var(--dim)" }}>{formatDate(n.created_at)}</p>
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); router.push("/chat"); }}
                            className="mt-2 text-xs hover:opacity-70"
                            style={{ color: "var(--accent-l)" }}>
                      Discutir con mi mentor →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Alert context modal */}
      {alertModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center"
             style={{ background: "rgba(0,0,0,0.65)" }}
             onClick={() => setAlertModal(null)}>
          <div className="rounded-t-3xl border-t border-x p-6 w-full max-w-lg max-h-[60vh] flex flex-col"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}
               onClick={(e) => e.stopPropagation()}>
            <div className="w-9 h-1 rounded-full mx-auto mb-4" style={{ background: "var(--border)" }} />
            <div className="flex items-center justify-between mb-4">
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>
                {(alertModal.change_pct ?? 0) >= 0 ? "📈" : "📉"} {alertModal.ticker}{" "}
                {alertModal.change_pct >= 0 ? "subió" : "cayó"} {Math.abs(alertModal.change_pct).toFixed(1)}%
              </span>
              <button onClick={() => setAlertModal(null)} style={{ color: "var(--muted)" }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {alertLoading ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
                  <p className="text-xs" style={{ color: "var(--muted)" }}>Analizando con IA…</p>
                </div>
              ) : (
                <div className="prose-sm" style={{ color: "var(--sub)" }}>
                  <ReactMarkdown>{alertInsight ?? ""}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)}
                    reason="Las noticias ilimitadas son exclusivas de Premium" />

      {/* ── Modal elección + resumen IA ── */}
      {newsModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
          onClick={() => { if (!summaryLoading) setNewsModal(null); }}
        >
          <div
            className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
            style={{ background: "var(--card)", border: "1px solid var(--border)", maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle (mobile) */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--border)" }} />
            </div>

            {/* Header — article info */}
            <div className="relative overflow-hidden shrink-0">
              {newsModal.thumbnail && (
                <img src={newsModal.thumbnail} alt="" className="w-full h-24 object-cover"
                     style={{ opacity: 0.45 }} />
              )}
              {newsModal.thumbnail && (
                <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 0%, var(--card) 100%)" }} />
              )}
              <div className={`${newsModal.thumbnail ? "absolute bottom-0 left-0 right-0" : ""} px-5 pt-4 pb-4`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)", border: "1px solid rgba(0,168,94,0.2)" }}>
                    {newsModal.symbol}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--dim)" }}>{newsModal.publisher}</span>
                  <button onClick={() => { if (!summaryLoading) setNewsModal(null); }}
                          className="ml-auto p-1 rounded-lg hover:opacity-70" style={{ color: "var(--muted)" }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm font-bold leading-snug line-clamp-2" style={{ color: "var(--text)" }}>
                  {newsModal.title}
                </p>
              </div>
              <div className="h-px mx-5" style={{ background: "var(--border)" }} />
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
              {summaryText ? (
                /* ── Resumen generado ── */
                <div className="rounded-2xl overflow-hidden" style={{
                  background: "linear-gradient(145deg, rgba(168,85,247,0.07) 0%, var(--raised) 50%, rgba(168,85,247,0.04) 100%)",
                  border: "1px solid rgba(168,85,247,0.22)",
                  boxShadow: "0 0 40px rgba(168,85,247,0.06), inset 0 1px 0 rgba(168,85,247,0.1)",
                }}>
                  {/* shimmer line */}
                  <div style={{ height: 2, background: "linear-gradient(90deg, transparent, rgba(168,85,247,0.75), transparent)" }} />

                  <div className="p-5">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                             style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(139,92,246,0.1))", border: "1px solid rgba(168,85,247,0.35)", boxShadow: "0 0 16px rgba(168,85,247,0.15)" }}>
                          <span style={{ fontSize: 18 }}>✦</span>
                        </div>
                        <div>
                          <p className="text-sm font-black tracking-widest uppercase" style={{ color: "#c084fc", letterSpacing: "0.14em" }}>Resumen IA</p>
                          <p className="text-[10px] mt-0.5" style={{ color: "var(--dim)" }}>Generado por Claude</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0"
                            style={{ background: "rgba(168,85,247,0.12)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.25)" }}>
                        Premium
                      </span>
                    </div>

                    {/* Summary text — rich paragraph */}
                    {(() => {
                      const fullText = summaryText.split(/\n+/).filter(p => p.trim().length > 0).join(" ");
                      const parts = fullText.split(/(\$[\d,.]+[BMK]?|[+-]?\d+\.?\d*%|[A-Z]{2,5}(?=[\s,.]|$))/g);
                      const SKIP = new Set(["THE","AND","FOR","BUT","INC","LLC","ETF","CEO","USD","SEC","IA","DE","EN","LA","EL","LOS","LAS","UNA","CON","SUS","QUE"]);
                      const rendered = parts.map((part, j) => {
                        if (/^\$[\d,.]+/.test(part) || /[+-]?\d+\.?\d*%/.test(part)) {
                          const isNeg = /^[-−]/.test(part);
                          return <strong key={j} className="tabular-nums" style={{ fontWeight: 700, color: isNeg ? "#f87171" : "#4ade80" }}>{part}</strong>;
                        }
                        if (/^[A-Z]{2,5}$/.test(part) && !SKIP.has(part)) {
                          return <strong key={j} style={{ fontWeight: 700, color: "#c084fc" }}>{part}</strong>;
                        }
                        return <span key={j}>{part}</span>;
                      });
                      return (
                        <div className="flex gap-3">
                          <div className="w-0.5 rounded-full shrink-0 self-stretch" style={{ background: "linear-gradient(to bottom, rgba(168,85,247,0.8), rgba(168,85,247,0.1))" }} />
                          <p className="text-[14px] leading-[1.85]" style={{ color: "var(--sub)" }}>{rendered}</p>
                        </div>
                      );
                    })()}

                    {/* Footer */}
                    <div className="mt-5 pt-4" style={{ borderTop: "1px solid rgba(168,85,247,0.1)" }}>
                      <div className="flex gap-2.5">
                        <button
                          onClick={() => window.open(newsModal.url, "_blank", "noopener,noreferrer")}
                          className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all hover:opacity-80"
                          style={{ borderColor: "var(--border)", color: "var(--muted)", background: "var(--card)" }}
                        >
                          Ver artículo
                        </button>
                        <button
                          onClick={() => setNewsModal(null)}
                          className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-80"
                          style={{ background: "rgba(168,85,247,0.12)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.22)" }}
                        >
                          Cerrar
                        </button>
                      </div>
                      <p className="text-[10px] text-center mt-3" style={{ color: "var(--dim)" }}>
                        Resumen por IA · No constituye asesoramiento de inversión
                      </p>
                    </div>
                  </div>
                </div>

              ) : summaryLoading ? (
                /* ── Cargando resumen ── */
                <div className="flex flex-col items-center gap-5 py-6">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                         style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(139,92,246,0.08))", border: "1px solid rgba(168,85,247,0.3)", boxShadow: "0 0 28px rgba(168,85,247,0.14)" }}>
                      <Loader2 className="w-7 h-7 animate-spin" style={{ color: "#c084fc" }} />
                    </div>
                    <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center animate-pulse"
                         style={{ background: "rgba(168,85,247,0.25)", border: "1px solid rgba(168,85,247,0.4)" }}>
                      <span style={{ fontSize: 9, color: "#c084fc" }}>✦</span>
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold" style={{ color: "var(--text)" }}>Claude está leyendo el artículo</p>
                    <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>Extrayendo lo más importante para ti…</p>
                  </div>
                  {/* Skeleton lines */}
                  <div className="w-full space-y-2.5">
                    {[100, 88, 94, 72].map((w, i) => (
                      <div key={i} className="h-3 rounded-full animate-pulse"
                           style={{ width: `${w}%`, background: "rgba(168,85,247,0.09)", animationDelay: `${i * 120}ms` }} />
                    ))}
                  </div>
                </div>

              ) : (
                /* ── Elección inicial ── */
                <div className="space-y-3 py-1">
                  {/* AI Summary — hero CTA */}
                  <button
                    onClick={async () => {
                      setSummaryLoading(true);
                      try {
                        const res = await marketApi.summarizeNews(newsModal.title, newsModal.url);
                        setSummaryText(res.data.summary);
                      } catch {
                        setSummaryText("No se pudo generar el resumen. Intenta ver el artículo completo.");
                      } finally {
                        setSummaryLoading(false);
                      }
                    }}
                    className="w-full rounded-2xl overflow-hidden text-left transition-opacity hover:opacity-90 active:scale-[0.99]"
                    style={{
                      background: "linear-gradient(145deg, rgba(168,85,247,0.12) 0%, rgba(139,92,246,0.07) 100%)",
                      border: "1px solid rgba(168,85,247,0.28)",
                      boxShadow: "0 0 32px rgba(168,85,247,0.08), inset 0 1px 0 rgba(168,85,247,0.12)",
                    }}
                  >
                    <div style={{ height: 2, background: "linear-gradient(90deg, transparent, rgba(168,85,247,0.7), transparent)" }} />
                    <div className="p-5 flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
                           style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(139,92,246,0.08))", border: "1px solid rgba(168,85,247,0.35)", boxShadow: "0 0 20px rgba(168,85,247,0.18)" }}>
                        <span style={{ fontSize: 26 }}>✦</span>
                      </div>
                      <div className="flex-1">
                        <p className="font-black text-base" style={{ color: "#c084fc" }}>Resumen IA</p>
                        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--muted)" }}>
                          Claude lee y extrae lo esencial
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                style={{ background: "rgba(168,85,247,0.15)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.2)" }}>
                            Premium
                          </span>
                          <span className="text-[10px]" style={{ color: "var(--dim)" }}>4–8 líneas · en segundos</span>
                        </div>
                      </div>
                      <span className="text-xl" style={{ color: "#c084fc", opacity: 0.6 }}>›</span>
                    </div>
                  </button>

                  {/* Original article — secondary */}
                  <button
                    onClick={() => window.open(newsModal.url, "_blank", "noopener,noreferrer")}
                    className="w-full p-4 rounded-2xl border flex items-center gap-3 text-left transition-opacity hover:opacity-80"
                    style={{ background: "var(--raised)", borderColor: "var(--border)" }}
                  >
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                         style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                      <span className="text-xl">🌐</span>
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-sm" style={{ color: "var(--text)" }}>Ver artículo completo</p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--dim)" }}>Abre el original en {newsModal.publisher}</p>
                    </div>
                    <span className="text-lg" style={{ color: "var(--dim)" }}>›</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
