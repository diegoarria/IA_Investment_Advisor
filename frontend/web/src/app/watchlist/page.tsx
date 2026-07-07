"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import TourSpotlight from "@/components/TourSpotlight";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Eye, X, RefreshCw, Search, Menu, LogOut,
  TrendingUp, TrendingDown, Lock, Plus, GripVertical, Bell, BellOff,
} from "lucide-react";
import { watchlist as watchlistApi, market as marketApi, sync as syncApi, priceAlerts as priceAlertsApi } from "@/lib/api";
import { useAuthStore, useSubscriptionStore, useProfileStore } from "@/lib/store";
import { getUserLevel } from "@/lib/userLevel";
import { usePortfolioStore } from "@/lib/portfolioStore";
import { useFxRate } from "@/lib/useFxRate";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PremiumBadge from "@/components/PremiumBadge";
import PaywallModal from "@/components/PaywallModal";
import WatchlistEarningsCalendar from "@/components/WatchlistEarningsCalendar";
import AdvancedStockTable from "@/components/AdvancedStockTable";
import type { AdvancedRow } from "@/components/AdvancedStockTable";
import StockDetailModal from "@/components/StockDetailModal";
import GuidedSteps from "@/components/GuidedSteps";

// ─── Types ──────────────────────────────────────────────────────────────────

interface WatchlistItem {
  ticker: string;
  name: string;
  logo_url: string | null;
  price: number | null;
  prev_close: number | null;
  change: number;
  change_pct: number;
  market_state: string;
  currency: string;
  pre_market_price: number | null;
  pre_market_change_pct: number | null;
  post_market_price: number | null;
  post_market_change_pct: number | null;
  added_at: string;
}

interface SearchResult {
  ticker: string;
  name: string;
}

const FREE_LIMIT = 25;

// Cache keys are scoped per user so switching accounts never shows stale data.
const cacheKey = () => `nuvos_watchlist_cache__${useAuthStore.getState().userId ?? "guest"}`;
const orderKey = () => `nuvos_watchlist_order__${useAuthStore.getState().userId ?? "guest"}`;

function readCache(): WatchlistItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(cacheKey());
    return raw ? (JSON.parse(raw) as WatchlistItem[]) : [];
  } catch { return []; }
}

function writeCache(items: WatchlistItem[]) {
  try { localStorage.setItem(cacheKey(), JSON.stringify(items)); } catch {}
}

function readOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(orderKey()) || "[]"); } catch { return []; }
}

function writeOrder(tickers: string[]) {
  try { localStorage.setItem(orderKey(), JSON.stringify(tickers)); } catch {}
}

function applyOrder(data: WatchlistItem[], order: string[]): WatchlistItem[] {
  if (!order.length) return data;
  const map = new Map(data.map((i) => [i.ticker, i]));
  const sorted: WatchlistItem[] = [];
  for (const t of order) { if (map.has(t)) { sorted.push(map.get(t)!); map.delete(t); } }
  for (const i of map.values()) sorted.push(i); // new items appended at end
  return sorted;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const CURRENCY_SYM: Record<string, string> = {
  USD: "$", MXN: "$", ARS: "$", CLP: "$", COP: "$", CAD: "$",
  EUR: "€", GBP: "£", BRL: "R$", JPY: "¥", CHF: "Fr",
};

function fmtPrice(price: number | null, currency = "USD"): string {
  if (price === null || price === undefined) return "—";
  const symbol = CURRENCY_SYM[currency] ?? "$";
  return `${symbol}${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(pct: number | null): string {
  if (pct === null || pct === undefined) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function MarketStateBadge({ state }: { state: string }) {
  const s = (state || "").toUpperCase();
  if (s === "REGULAR") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
        <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
        En vivo
      </span>
    );
  }
  if (s === "PRE" || s === "PREPRE") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
        Pre-Mkt
      </span>
    );
  }
  if (s === "POST" || s === "POSTPOST") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>
        Post-Mkt
      </span>
    );
  }
  // CLOSED or anything else
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ background: "rgba(148,163,184,0.12)", color: "var(--muted)" }}>
      Cerrado
    </span>
  );
}

// ─── Stock Avatar ───────────────────────────────────────────────────────────

function StockAvatar({ ticker, logoUrl }: { ticker: string; logoUrl: string | null }) {
  const initials = ticker.slice(0, 2).toUpperCase();
  const clean = ticker.replace(".", "-");

  // Tries sources in order; falls back to initials when all fail
  const sources = [
    ...(logoUrl ? [logoUrl] : []),
    `https://assets.parqet.com/logos/symbol/${clean}?format=svg`,
    `https://financialmodelingprep.com/image-stock/${clean}.png`,
  ];
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const activeSrc = sources.find((s) => !failed.has(s));

  if (activeSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={activeSrc}
        alt={ticker}
        className="w-7 h-7 rounded-full object-contain p-1 shrink-0"
        style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
        onError={() => setFailed((prev) => new Set([...prev, activeSrc]))}
      />
    );
  }
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black shrink-0"
         style={{ background: "rgba(0,168,94,0.14)", color: "var(--accent-l)" }}>
      {initials}
    </div>
  );
}

// ─── Stock Card ─────────────────────────────────────────────────────────────

interface StockCardProps {
  item: WatchlistItem;
  fxRate: number;
  displayCurrency: string;
  onDelete: (ticker: string) => void;
  onSelect: (ticker: string) => void;
  onAlert: (ticker: string, price: number | null) => void;
  hasAlert?: boolean;
  draggable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}

function StockCard({ item, fxRate, displayCurrency, onDelete, onSelect, onAlert, hasAlert, draggable: isDraggable, isDragging, isDragOver: _isDragOver, onDragStart, onDragOver, onDrop, onDragEnd }: StockCardProps) {
  const isUp = item.change_pct >= 0;
  const conv = (price: number | null) => price === null ? null : price * fxRate;
  const borderColor = isUp ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)";
  const priceColor = isUp ? "#22c55e" : "#ef4444";

  const state = (item.market_state || "").toUpperCase();
  const showPreMkt = item.pre_market_price !== null && (state === "PRE" || state === "PREPRE");
  const showPostMkt = item.post_market_price !== null &&
    (state === "POST" || state === "POSTPOST" || state === "CLOSED");

  return (
    <div
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={(e) => { e.preventDefault(); onDrop?.(); }}
      onDragEnd={onDragEnd}
      className="rounded-xl p-3 flex items-center gap-2.5 relative overflow-hidden cursor-pointer group"
      onClick={() => onSelect(item.ticker)}
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderLeft: `2px solid ${borderColor}`,
        opacity: isDragging ? 0.35 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {/* Drag handle */}
      {isDraggable && (
        <GripVertical
          className="w-3.5 h-3.5 shrink-0 opacity-0 group-hover:opacity-30 transition-opacity"
          style={{ color: "var(--muted)", cursor: "grab" }}
        />
      )}

      {/* Avatar */}
      <StockAvatar ticker={item.ticker} logoUrl={item.logo_url} />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          {/* Left: ticker + name + badge */}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-black text-[12px]" style={{ color: "var(--text)" }}>
                {item.ticker}
              </span>
              <MarketStateBadge state={item.market_state} />
            </div>
            <p className="text-[10px] truncate mt-0.5" style={{ color: "var(--muted)" }}>
              {item.name}
            </p>
          </div>

          {/* Right: prices */}
          <div className="text-right shrink-0">
            {showPreMkt ? (
              <>
                <p className="text-[13px] font-black leading-tight" style={{ color: "#f59e0b" }}>
                  {fmtPrice(conv(item.pre_market_price), displayCurrency)}
                </p>
                <p className="text-[10px] font-bold" style={{ color: "#f59e0b" }}>
                  {fmtPct(item.pre_market_change_pct)}
                </p>
                <p className="text-[9px]" style={{ color: "var(--muted)" }}>
                  Reg. {fmtPrice(conv(item.price), displayCurrency)}
                </p>
              </>
            ) : showPostMkt ? (
              <>
                <p className="text-[13px] font-black leading-tight" style={{ color: "#818cf8" }}>
                  {fmtPrice(conv(item.post_market_price), displayCurrency)}
                </p>
                <p className="text-[10px] font-bold" style={{ color: "#818cf8" }}>
                  {fmtPct(item.post_market_change_pct)}
                </p>
                <p className="text-[9px]" style={{ color: "var(--muted)" }}>
                  Cierre {fmtPrice(conv(item.price), displayCurrency)}
                </p>
              </>
            ) : (
              <>
                <p className="text-[13px] font-black leading-tight" style={{ color: "var(--text)" }}>
                  {fmtPrice(conv(item.price), displayCurrency)}
                </p>
                <div className="flex items-center justify-end gap-0.5 mt-0.5">
                  {isUp
                    ? <TrendingUp className="w-2.5 h-2.5" style={{ color: priceColor }} />
                    : <TrendingDown className="w-2.5 h-2.5" style={{ color: priceColor }} />
                  }
                  <span className="text-[10px] font-bold" style={{ color: priceColor }}>
                    {fmtPct(item.change_pct)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Regular change row (shown when pre/post active) */}
        {(showPreMkt || showPostMkt) && (
          <div className="flex items-center gap-0.5 mt-0.5">
            {isUp
              ? <TrendingUp className="w-2.5 h-2.5" style={{ color: priceColor }} />
              : <TrendingDown className="w-2.5 h-2.5" style={{ color: priceColor }} />
            }
            <span className="text-[9px] font-semibold" style={{ color: priceColor }}>
              {fmtPct(item.change_pct)} vs cierre anterior
            </span>
          </div>
        )}
      </div>

      {/* Alert + Delete buttons */}
      <div className="shrink-0 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onAlert(item.ticker, item.price)}
          className="w-6 h-6 rounded flex items-center justify-center transition-opacity"
          style={{ color: hasAlert ? "var(--accent-l)" : "var(--muted)", opacity: hasAlert ? 1 : 0.35 }}
          title={hasAlert ? "Editar alerta de precio" : "Crear alerta de precio"}
        >
          {hasAlert ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => onDelete(item.ticker)}
          className="w-6 h-6 rounded flex items-center justify-center opacity-30 hover:opacity-80 transition-opacity"
          style={{ color: "var(--muted)" }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl p-3 flex items-center gap-2.5 animate-pulse"
         style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="w-7 h-7 rounded-full shrink-0" style={{ background: "var(--raised)" }} />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 rounded w-20" style={{ background: "var(--raised)" }} />
        <div className="h-2 rounded w-32" style={{ background: "var(--raised)" }} />
      </div>
      <div className="space-y-1.5 text-right">
        <div className="h-3.5 rounded w-16" style={{ background: "var(--raised)" }} />
        <div className="h-2 rounded w-12 ml-auto" style={{ background: "var(--raised)" }} />
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function WatchlistPage() {
  const router = useRouter();
  const [isTour, setIsTour] = useState(false);
  useEffect(() => { setIsTour(new URLSearchParams(window.location.search).get("tour") === "5"); }, []);
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { profile } = useProfileStore();
  const userLevel = getUserLevel(profile);
  const { tier, isTrialPremium } = useSubscriptionStore();
  const isPremium = tier === "premium" || isTrialPremium;
  const { positions, portfolioCurrency } = usePortfolioStore();
  const fxRate = useFxRate(portfolioCurrency);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [items, setItems] = useState<WatchlistItem[]>(() => readCache());
  const [loading, setLoading] = useState(() => readCache().length === 0);
  const [refreshing, setRefreshing] = useState(false);

  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [paywallOpen, setPaywallOpen] = useState(false);
  const [selectedStock, setSelectedStock] = useState<string | null>(null);

  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [secondsSince, setSecondsSince] = useState(0);

  const [dragIndex, setDragIndex]     = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  // ── Price Alerts ────────────────────────────────────────────────────────
  type PriceAlert = { ticker: string; target_price: number; condition: string };
  const [alerts, setAlerts] = useState<Record<string, PriceAlert>>({});
  const [alertModal, setAlertModal] = useState<{ ticker: string; currentPrice: number | null } | null>(null);
  const [alertPrice, setAlertPrice] = useState("");
  const [alertCondition, setAlertCondition] = useState<"above" | "below">("below");
  const [savingAlert, setSavingAlert] = useState(false);

  useEffect(() => {
    priceAlertsApi.list().then((r) => {
      const map: Record<string, PriceAlert> = {};
      for (const a of r.data ?? []) map[a.ticker] = a;
      setAlerts(map);
    }).catch(() => {});
  }, []);

  const openAlertModal = (ticker: string, currentPrice: number | null) => {
    const existing = alerts[ticker];
    setAlertPrice(existing ? String(existing.target_price) : "");
    setAlertCondition(existing?.condition === "above" ? "above" : "below");
    setAlertModal({ ticker, currentPrice });
  };

  const saveAlert = async () => {
    if (!alertModal || !alertPrice || isNaN(Number(alertPrice))) return;
    setSavingAlert(true);
    try {
      const res = await priceAlertsApi.create(alertModal.ticker, Number(alertPrice), alertCondition);
      setAlerts((prev) => ({ ...prev, [alertModal.ticker]: res.data }));
      showToast(`Alerta creada para ${alertModal.ticker}`);
      setAlertModal(null);
    } catch { showToast("Error al guardar alerta"); }
    finally { setSavingAlert(false); }
  };

  const deleteAlert = async (ticker: string) => {
    await priceAlertsApi.remove(ticker).catch(() => {});
    setAlerts((prev) => { const n = { ...prev }; delete n[ticker]; return n; });
    showToast(`Alerta eliminada`);
    setAlertModal(null);
  };

  const [viewMode, setViewMode] = useState<"basic" | "advanced">(() => {
    if (typeof window === "undefined") return "basic";
    return (localStorage.getItem("nuvos_watchlist_view") as "basic" | "advanced") ?? "basic";
  });
  // Restore from server so Safari localStorage clears don't reset the view mode
  useEffect(() => {
    if (!isAuthenticated) return;
    import("@/lib/api").then(({ sync }) =>
      sync.getAll().then((res) => {
        const serverMode = res.data?.watchlist_view_mode as "basic" | "advanced" | undefined;
        if (serverMode && serverMode !== viewMode) {
          setViewMode(serverMode);
          localStorage.setItem("nuvos_watchlist_view", serverMode);
        }
      }).catch(() => {})
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // "Avanzado" is a denser table meant for desktop width — force "Básico" on
  // a phone-sized viewport without touching the user's actual saved
  // preference, so it's back to normal the moment they open this on a
  // computer. Web-only concept (viewport width), not a device check.
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    setIsMobileViewport(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobileViewport(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const effectiveViewMode: "basic" | "advanced" = isMobileViewport ? "basic" : viewMode;

  const searchRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch watchlist ─────────────────────────────────────────────────────
  const fetchWatchlist = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await watchlistApi.get();
      const data = res.data as WatchlistItem[];
      if (data.length === 0 && readCache().length > 0) return;
      // Prefer server-persisted order; fall back to localStorage
      let serverOrder: string[] = [];
      try {
        const syncRes = await syncApi.getAll();
        serverOrder = syncRes.data?.watchlist_order ?? [];
      } catch { /* ignore */ }
      const order = serverOrder.length ? serverOrder : readOrder();
      const ordered = applyOrder(data, order);
      if (serverOrder.length) writeOrder(serverOrder);
      setItems(ordered);
      writeCache(ordered);
      setLastRefreshed(new Date());
      setSecondsSince(0);
    } catch {
      // On network/server error keep whatever items are already shown
    } finally {
      if (isRefresh) setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => fetchWatchlist(true), 60_000);
    return () => clearInterval(interval);
  }, [fetchWatchlist]);

  // Seconds-since counter
  useEffect(() => {
    if (!lastRefreshed) return;
    const tick = setInterval(() => {
      setSecondsSince(Math.floor((Date.now() - lastRefreshed.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastRefreshed]);

  const handleRefresh = () => fetchWatchlist(true);

  // ── Toast helper ──────────────────────────────────────────────────────
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ── Search ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!searchQ.trim()) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await marketApi.searchTickers(searchQ.trim());
        const results: SearchResult[] = res.data.results || [];
        setSearchResults(results);
        setSearchOpen(results.length > 0);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }, [searchQ]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleAddTicker = async (ticker: string, name: string) => {
    // Check free limit before even calling API
    if (!isPremium && items.length >= FREE_LIMIT) {
      setPaywallOpen(true);
      return;
    }

    setSearchQ("");
    setSearchOpen(false);
    setSearchResults([]);

    try {
      await watchlistApi.add(ticker, name);
      await fetchWatchlist();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        showToast(`${ticker} ya está en tu watchlist`);
      } else if (status === 403 && !isPremium) {
        setPaywallOpen(true);
      } else {
        showToast("Error al agregar el ticker");
      }
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────
  const handleConfirmDelete = async (ticker: string) => {
    try {
      await watchlistApi.remove(ticker);
      setItems((prev) => {
        const updated = prev.filter((i) => i.ticker !== ticker);
        writeCache(updated);
        return updated;
      });
    } catch {
      showToast("Error al eliminar");
    }
  };

  // ── Drag-and-drop reorder (basic view only) ──────────────────────────────
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = "move";
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    setDragOverIndex(insertBefore ? index : index + 1);
  };

  const handleDrop = () => {
    if (dragIndex === null || dragOverIndex === null) return;
    let target = dragOverIndex;
    if (dragIndex < target) target--;
    if (target === dragIndex) { setDragIndex(null); setDragOverIndex(null); return; }
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(target, 0, moved);
      const newOrder = next.map((i) => i.ticker);
      writeOrder(newOrder);
      writeCache(next);
      syncApi.pushWatchlistOrder(newOrder).catch(() => {});
      return next;
    });
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => { setDragIndex(null); setDragOverIndex(null); };

  const lastUpdatedText = lastRefreshed
    ? secondsSince < 5
      ? "Actualizado ahora"
      : `Actualizado hace ${secondsSince}s`
    : "";

  return (
    <>
      <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />

        <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

          {/* ── Sticky Header ── */}
          <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between border-b shrink-0"
               style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Mi lista</p>
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>Watchlist</h1>
            </div>
            <div className="flex items-center gap-2">
              {lastUpdatedText && (
                <span className="hidden sm:inline text-[10px]" style={{ color: "var(--dim)" }}>
                  {lastUpdatedText}
                </span>
              )}
              {/* View toggle — hidden on mobile since effectiveViewMode forces "basic" there regardless of what's tapped */}
              <div className="hidden lg:flex items-center rounded-lg border overflow-hidden"
                   style={{ borderColor: "var(--border)" }}>
                <button
                  onClick={() => { setViewMode("basic"); localStorage.setItem("nuvos_watchlist_view", "basic"); import("@/lib/api").then(({ sync }) => sync.pushWatchlistViewMode("basic").catch(() => {})); }}
                  className="px-2.5 py-1.5 text-[10px] font-bold transition-colors"
                  style={{
                    background: viewMode === "basic" ? "var(--accent)" : "transparent",
                    color: viewMode === "basic" ? "#fff" : "var(--muted)",
                  }}
                >
                  Básico
                </button>
                <button
                  onClick={() => { setViewMode("advanced"); localStorage.setItem("nuvos_watchlist_view", "advanced"); import("@/lib/api").then(({ sync }) => sync.pushWatchlistViewMode("advanced").catch(() => {})); }}
                  className="px-2.5 py-1.5 text-[10px] font-bold transition-colors"
                  style={{
                    background: viewMode === "advanced" ? "var(--accent)" : "transparent",
                    color: viewMode === "advanced" ? "#fff" : "var(--muted)",
                  }}
                >
                  Avanzado
                </button>
              </div>
              <PremiumBadge />
              <button
                onClick={handleRefresh}
                className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
                style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}
                title="Actualizar"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={() => { clearAuth(); router.push("/"); }}
                className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
                style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}
                title="Cerrar sesión"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          <main className="flex-1 overflow-y-auto scrollbar-thin p-4 w-full max-w-5xl mx-auto">
            <GuidedSteps currentPage="watchlist" />

            {/* ── Search bar ── */}
            <div id="tour-watchlist-search" ref={searchRef} className="relative mb-4">
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-2xl border"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
              >
                {searchLoading
                  ? <RefreshCw className="w-4 h-4 shrink-0 animate-spin" style={{ color: "var(--muted)" }} />
                  : <Search className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
                }
                <input
                  type="text"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Buscar por ticker o empresa — ej. AAPL, Tesla..."
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{ color: "var(--text)" }}
                />
                {searchQ && (
                  <button onClick={() => { setSearchQ(""); setSearchOpen(false); }} style={{ color: "var(--dim)" }}>
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Search dropdown */}
              {searchOpen && searchResults.length > 0 && (
                <div
                  className="absolute top-full left-0 right-0 mt-1 rounded-2xl border z-30 overflow-hidden"
                  style={{ background: "var(--card)", borderColor: "var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
                >
                  {searchResults.slice(0, 6).map((r) => (
                    <button
                      key={r.ticker}
                      onClick={() => handleAddTicker(r.ticker, r.name)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--raised)]"
                    >
                      <StockAvatar ticker={r.ticker} logoUrl={null} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-bold" style={{ color: "var(--text)" }}>{r.ticker}</p>
                        <p className="text-[10px] truncate" style={{ color: "var(--muted)" }}>{r.name}</p>
                      </div>
                      <Plus className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent-l)" }} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Free tier limit bar ── */}
            {!isPremium && (
              <div
                className="rounded-2xl p-3 mb-4 border"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    {items.length >= FREE_LIMIT && (
                      <Lock className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} />
                    )}
                    <span className="text-xs font-semibold" style={{ color: "var(--sub)" }}>
                      {items.length} / {FREE_LIMIT} acciones
                    </span>
                  </div>
                  {items.length >= FREE_LIMIT ? (
                    <button
                      onClick={() => setPaywallOpen(true)}
                      className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                      style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}
                    >
                      Activar Premium
                    </button>
                  ) : (
                    <span className="text-[10px]" style={{ color: "var(--dim)" }}>
                      {FREE_LIMIT - items.length} restantes
                    </span>
                  )}
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min((items.length / FREE_LIMIT) * 100, 100)}%`,
                      background: items.length >= FREE_LIMIT
                        ? "#f59e0b"
                        : items.length >= FREE_LIMIT * 0.8
                          ? "#f97316"
                          : "var(--grad-green)",
                    }}
                  />
                </div>
              </div>
            )}

            {/* ── Content ── */}
            {loading ? (
              <div className="space-y-3">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : effectiveViewMode === "advanced" && items.length > 0 ? (
              <AdvancedStockTable
                mode="watchlist"
                userLevel={userLevel}
                fxRate={fxRate}
                rows={items.map((i): AdvancedRow => ({
                  ticker: i.ticker,
                  name: i.name,
                  logoUrl: i.logo_url,
                  price: i.price !== null ? i.price * fxRate : null,
                  changePct: i.change_pct,
                  currency: portfolioCurrency,
                  marketState: i.market_state,
                  extPrice: (i.pre_market_price ?? i.post_market_price) !== null ? (i.pre_market_price ?? i.post_market_price)! * fxRate : null,
                  extPct: i.pre_market_change_pct ?? i.post_market_change_pct,
                  extLabel: i.pre_market_price ? "Pre" : i.post_market_price ? "Post" : null,
                }))}
                onRemove={handleConfirmDelete}
                onRowClick={setSelectedStock}
              />
            ) : items.length === 0 ? (
              /* Empty state */
              userLevel === "avanzado" ? (
                <div className="rounded-2xl border flex flex-col items-center gap-3 py-16 px-6"
                     style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                       style={{ background: "rgba(0,168,94,0.10)" }}>
                    <Eye className="w-7 h-7" style={{ color: "var(--accent-l)" }} />
                  </div>
                  <p className="font-bold text-sm" style={{ color: "var(--text)" }}>Tu watchlist está vacía</p>
                  <p className="text-xs text-center" style={{ color: "var(--muted)" }}>Busca acciones arriba para seguirlas</p>
                </div>
              ) : (
                <div className="rounded-2xl border overflow-hidden"
                     style={{ borderColor: "rgba(0,212,126,0.2)", background: "var(--card)" }}>
                  <div className="h-1" style={{ background: "linear-gradient(90deg,#00d47e,#00a8ff)" }} />
                  <div className="p-6 flex flex-col items-center gap-3 text-center">
                    <span className="text-3xl">👀</span>
                    <div>
                      <p className="font-black text-sm mb-1" style={{ color: "var(--text)" }}>
                        Tu lista de empresas favoritas
                      </p>
                      <p className="text-xs leading-relaxed max-w-xs" style={{ color: "var(--muted)" }}>
                        Una watchlist es como una lista de compras: agregas las empresas o ETFs que te interesan para seguir su precio antes de decidir si invertir.
                      </p>
                    </div>
                    <div className="w-full grid grid-cols-2 gap-2 mt-1">
                      <button onClick={() => router.push("/screener")}
                              className="py-2.5 rounded-xl text-xs font-black transition-all hover:opacity-90"
                              style={{ background: "var(--accent)", color: "#000" }}>
                        Ver ETFs recomendados
                      </button>
                      <button onClick={() => router.push("/chat")}
                              className="py-2.5 rounded-xl text-xs font-bold border transition-all hover:opacity-80"
                              style={{ borderColor: "rgba(0,212,126,0.35)", color: "var(--accent-l)", background: "rgba(0,212,126,0.06)" }}>
                        Preguntarle al mentor IA
                      </button>
                    </div>
                    <p className="text-[10px] mt-1" style={{ color: "var(--dim)" }}>
                      O busca cualquier empresa arriba por nombre o símbolo (ej: "Apple" o "AAPL")
                    </p>
                  </div>
                </div>
              )
            ) : (
              <div className="space-y-1.5">
                {items.map((item, index) => (
                  <div key={item.ticker}>
                    {/* Drop indicator line above this card */}
                    {dragOverIndex === index && dragIndex !== index && dragIndex !== index - 1 && (
                      <div className="mx-2 mb-1.5 rounded-full" style={{ height: 2, background: "var(--accent-l)" }} />
                    )}
                    <StockCard
                      item={item}
                      fxRate={fxRate}
                      displayCurrency={portfolioCurrency}
                      onDelete={handleConfirmDelete}
                      onSelect={setSelectedStock}
                      onAlert={openAlertModal}
                      hasAlert={!!alerts[item.ticker]}
                      draggable
                      isDragging={dragIndex === index}
                      isDragOver={dragOverIndex === index}
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDrop={handleDrop}
                      onDragEnd={handleDragEnd}
                    />
                  </div>
                ))}
                {/* Drop indicator at the very end */}
                {dragOverIndex === items.length && (
                  <div className="mx-2 mt-1.5 rounded-full" style={{ height: 2, background: "var(--accent-l)" }} />
                )}
              </div>
            )}

            {/* ── Earnings Calendar ── */}
            {!loading && (
              <div className="mt-4">
                <WatchlistEarningsCalendar
                  watchlistTickers={items.map((i) => i.ticker)}
                  portfolioTickers={positions.map((p) => p.ticker)}
                  isPremium={isPremium}
                  onUpgrade={() => setPaywallOpen(true)}
                />
              </div>
            )}
          </main>
        </div>{/* end flex-1 flex-col */}
      </div>{/* end flex h-screen */}

      {/* ── Stock Detail Modal ── */}
      {selectedStock && (
        <StockDetailModal ticker={selectedStock} onClose={() => setSelectedStock(null)} />
      )}

      {/* ── Paywall Modal ── */}
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />

      {/* ── Price Alert Modal ── */}
      {alertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}
             onClick={() => setAlertModal(null)}>
          <div className="w-full max-w-sm rounded-2xl p-5 flex flex-col gap-4"
               style={{ background: "var(--card)", border: "1px solid var(--border)" }}
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: "var(--muted)" }}>Alerta de precio</p>
                <p className="text-base font-black" style={{ color: "var(--text)" }}>{alertModal.ticker}</p>
              </div>
              <button onClick={() => setAlertModal(null)} className="p-1.5 rounded-lg" style={{ color: "var(--muted)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {alertModal.currentPrice != null && (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Precio actual: <span className="font-bold" style={{ color: "var(--text)" }}>${alertModal.currentPrice.toFixed(2)}</span>
              </p>
            )}

            <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
              {(["below", "above"] as const).map((c) => (
                <button key={c} onClick={() => setAlertCondition(c)}
                        className="flex-1 py-2 text-sm font-bold transition-colors"
                        style={{ background: alertCondition === c ? "var(--accent)" : "var(--raised)", color: alertCondition === c ? "#fff" : "var(--muted)" }}>
                  {c === "below" ? "Por debajo de" : "Por encima de"}
                </button>
              ))}
            </div>

            <input
              type="number"
              placeholder="Precio objetivo (ej. 180.00)"
              value={alertPrice}
              onChange={(e) => setAlertPrice(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm font-semibold outline-none"
              style={{ background: "var(--raised)", color: "var(--text)", border: "1px solid var(--border)" }}
              onKeyDown={(e) => e.key === "Enter" && saveAlert()}
            />

            <div className="flex gap-2">
              {alerts[alertModal.ticker] && (
                <button onClick={() => deleteAlert(alertModal.ticker)}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold border transition-colors"
                        style={{ borderColor: "#ef4444", color: "#ef4444", background: "transparent" }}>
                  Eliminar alerta
                </button>
              )}
              <button onClick={saveAlert} disabled={savingAlert || !alertPrice}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors"
                      style={{ background: "var(--accent)", color: "#fff", opacity: (!alertPrice || savingAlert) ? 0.5 : 1 }}>
                {savingAlert ? "Guardando…" : "Guardar alerta"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-sm font-semibold z-50 shadow-lg"
          style={{ background: "var(--card)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          {toast}
        </div>
      )}

      {isTour && (
        <TourSpotlight
          targetId="tour-watchlist-search"
          step={5}
          title="Busca una acción para seguir"
          description="Escribe el ticker o nombre de la empresa — ej. AAPL o Tesla. Nuvos te avisará cuando haya movimientos importantes."
          ctaLabel="Entendido, volver al inicio ✓"
        />
      )}
    </>
  );
}
