"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import TourSpotlight from "@/components/TourSpotlight";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Eye, X, RefreshCw, Search, Menu, LogOut,
  TrendingUp, TrendingDown, Lock, Plus, GripVertical, Bell, BellOff,
} from "lucide-react";
import { watchlist as watchlistApi, market as marketApi, sync as syncApi, priceAlerts as priceAlertsApi } from "@/lib/api";
import { useAuthStore, useSubscriptionStore, useProfileStore, usePersonalizationStore } from "@/lib/store";
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
import dynamic from "next/dynamic";
// Fase 4, Incremento 13 (Cierre, Parte M) — see portfolio/page.tsx's comment.
const StockDetailModal = dynamic(() => import("@/components/StockDetailModal"), { ssr: false });

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

// "Avanzado" siempre activo, en cualquier dispositivo/ancho de ventana —
// "Básico" queda dormido (Diego, 2026-08-12). Wrapped in a function (not a
// bare literal) so TS doesn't narrow effectiveViewMode to the "advanced"
// literal type and flag the still-present básico branches as dead code.
function getEffectiveViewMode(): "basic" | "advanced" {
  return "advanced";
}

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

function MarketStateBadge({ state, t }: { state: string; t: TFunction }) {
  const s = (state || "").toUpperCase();
  if (s === "REGULAR") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
        <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
        {t("watchlist.marketState.live")}
      </span>
    );
  }
  if (s === "PRE" || s === "PREPRE") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
        {t("watchlist.marketState.preMkt")}
      </span>
    );
  }
  if (s === "POST" || s === "POSTPOST") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>
        {t("watchlist.marketState.postMkt")}
      </span>
    );
  }
  // CLOSED or anything else
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ background: "rgba(148,163,184,0.12)", color: "var(--muted)" }}>
      {t("watchlist.marketState.closed")}
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
  const { t } = useTranslation();
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
              <MarketStateBadge state={item.market_state} t={t} />
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
                  {t("watchlist.card.regPrice", { price: fmtPrice(conv(item.price), displayCurrency) })}
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
                  {t("watchlist.card.closePrice", { price: fmtPrice(conv(item.price), displayCurrency) })}
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
              {t("watchlist.card.vsPreviousClose", { pct: fmtPct(item.change_pct) })}
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
          title={hasAlert ? t("watchlist.card.editAlert") : t("watchlist.card.createAlert")}
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
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [isTour, setIsTour] = useState(false);
  useEffect(() => { setIsTour(new URLSearchParams(window.location.search).get("tour") === "5"); }, []);
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { profile } = useProfileStore();
  const userLevel = getUserLevel(profile);
  const { tier, isTrialPremium } = useSubscriptionStore();
  const { minMarginOfSafetyPct } = usePersonalizationStore();
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

  // Fase 4, Incremento 9 (Watchlist Inteligente, Parte I) — cache-only batch
  // scores, keyed by ticker. Independent load state, same "never block
  // anything else" philosophy as the rest of Fase 4's per-panel fetches.
  type WatchlistScores = Record<string, {
    quality_score: number | null; conviction_score: number | null; margin_of_safety_pct: number | null;
    opportunity_score: number | null; thesis_status: "no_thesis" | "draft_only" | "user_thesis";
    top_risks: string[]; deteriorating_count: number | null; improving_count: number | null; top_catalysts: string[];
  }>;
  const [scores, setScores] = useState<WatchlistScores>({});

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
      showToast(t("watchlist.toast.alertCreated", { ticker: alertModal.ticker }));
      setAlertModal(null);
    } catch { showToast(t("watchlist.toast.alertSaveError")); }
    finally { setSavingAlert(false); }
  };

  const deleteAlert = async (ticker: string) => {
    try {
      await priceAlertsApi.remove(ticker);
    } catch {
      // Used to discard the outcome and tell the user "deleted" regardless —
      // if the DELETE actually failed server-side, the alert is still live
      // there and fires days later with no context, since the UI already
      // told them it was gone.
      showToast(t("watchlist.toast.alertDeleteError"));
      return;
    }
    setAlerts((prev) => { const n = { ...prev }; delete n[ticker]; return n; });
    showToast(t("watchlist.toast.alertDeleted"));
    setAlertModal(null);
  };

  // Default is "advanced" for everyone — Diego wants the dense table as the
  // starting point for every user, never the simplified card view, with
  // FinancialTip (i) icons carrying the explanatory burden for básico users
  // instead of hiding the real data behind a dumbed-down default.
  const [viewMode, setViewMode] = useState<"basic" | "advanced">(() => {
    if (typeof window === "undefined") return "advanced";
    return (localStorage.getItem("nuvos_watchlist_view") as "basic" | "advanced") ?? "advanced";
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

  // "Avanzado" siempre activo, en cualquier dispositivo/ancho de ventana —
  // "Básico" queda dormido (Diego, 2026-08-12). Previously this force-
  // downgraded to "básico" under 1024px viewport width, which fired on
  // real desktop windows too whenever the browser wasn't maximized, not
  // just phones.
  const effectiveViewMode: "basic" | "advanced" = getEffectiveViewMode();

  // Fase 4, Incremento 9 — only fetched when the advanced table with real
  // tickers is actually visible, and only for Premium (matches the backend
  // gate) — never fires for the basic card view.
  const tickerKey = items.map((i) => i.ticker).join(",");
  useEffect(() => {
    if (!isPremium || effectiveViewMode !== "advanced" || items.length === 0) return;
    let cancelled = false;
    watchlistApi.getBatchScores(items.map((i) => i.ticker), i18n.language)
      .then((res) => { if (!cancelled) setScores(res.data ?? {}); })
      .catch(() => { if (!cancelled) setScores({}); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey, isPremium, effectiveViewMode, i18n.language]);

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

    // Retried with backoff before ever showing an error — a transient
    // network blip or a momentary DB hiccup on the tier-check query used to
    // surface as "Error al agregar" even though a second attempt would have
    // gone through fine. 409 (already in list) and 403 (free-tier limit) are
    // real outcomes, not transient failures, so they short-circuit the retry
    // loop immediately.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await watchlistApi.add(ticker, name);
        await fetchWatchlist();
        return;
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 409) {
          showToast(t("watchlist.toast.alreadyInWatchlist", { ticker }));
          return;
        }
        if (status === 403 && !isPremium) {
          setPaywallOpen(true);
          return;
        }
        if (attempt === 2) {
          showToast(t("watchlist.toast.addError"));
          return;
        }
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────
  // Deletes instantly and optimistically — the trash icon removes the row
  // right away, no confirmation step and no error toast ever shown. The
  // actual server call is retried with backoff in the background; the
  // backend delete is idempotent (a ticker already gone is still "deleted"
  // from the user's point of view), so this effectively never fails visibly.
  const handleConfirmDelete = (ticker: string) => {
    setItems((prev) => {
      const updated = prev.filter((i) => i.ticker !== ticker);
      writeCache(updated);
      return updated;
    });
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await watchlistApi.remove(ticker);
          return;
        } catch (e) {
          if (attempt === 2) console.error("Failed to remove from watchlist on server:", e);
          else await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    })();
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
      ? t("watchlist.header.updatedNow")
      : t("watchlist.header.updatedAgo", { seconds: secondsSince })
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
            {/* pl-9 clears AppSidebar's floating mobile menu button (fixed
                top-1.5 left-1.5, ~34px wide) on mobile widths. */}
            <div className="pl-9 lg:pl-0">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("watchlist.header.myList")}</p>
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>{t("watchlist.header.title")}</h1>
            </div>
            <div className="flex items-center gap-2">
              {lastUpdatedText && (
                <span className="hidden sm:inline text-[10px]" style={{ color: "var(--dim)" }}>
                  {lastUpdatedText}
                </span>
              )}
              {/* View toggle removed — "Avanzado" is always on (Diego, 2026-08-12) */}
              <PremiumBadge />
              <button
                onClick={handleRefresh}
                className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
                style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}
                title={t("watchlist.header.refresh")}
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={async () => { await clearAuth(); router.push("/"); }}
                className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
                style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}
                title={t("watchlist.header.logout")}
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          <main className="flex-1 overflow-y-auto scrollbar-thin p-4 w-full max-w-5xl mx-auto">

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
                  placeholder={t("watchlist.search.placeholder")}
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
                      {t("watchlist.limit.stocksCount", { count: items.length, limit: FREE_LIMIT })}
                    </span>
                  </div>
                  {items.length >= FREE_LIMIT ? (
                    <button
                      onClick={() => setPaywallOpen(true)}
                      className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                      style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}
                    >
                      {t("watchlist.limit.activatePremium")}
                    </button>
                  ) : (
                    <span className="text-[10px]" style={{ color: "var(--dim)" }}>
                      {t("watchlist.limit.remaining", { count: FREE_LIMIT - items.length })}
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
                minMarginOfSafetyPct={minMarginOfSafetyPct}
                rows={items.map((i): AdvancedRow => {
                  const s = scores[i.ticker];
                  return {
                    ticker: i.ticker,
                    name: i.name,
                    logoUrl: i.logo_url,
                    price: i.price !== null ? i.price * fxRate : null,
                    changePct: i.change_pct,
                    currency: portfolioCurrency,
                    marketState: i.market_state,
                    extPrice: (i.pre_market_price ?? i.post_market_price) !== null ? (i.pre_market_price ?? i.post_market_price)! * fxRate : null,
                    extPct: i.pre_market_change_pct ?? i.post_market_change_pct,
                    extLabel: i.pre_market_price ? t("watchlist.extLabel.pre") : i.post_market_price ? t("watchlist.extLabel.post") : null,
                    qualityScore: s?.quality_score ?? null,
                    convictionScore: s?.conviction_score ?? null,
                    marginOfSafetyPct: s?.margin_of_safety_pct ?? null,
                    opportunityScore: s?.opportunity_score ?? null,
                    thesisStatus: s?.thesis_status ?? null,
                    netChangeScore: s ? (s.improving_count ?? 0) - (s.deteriorating_count ?? 0) : null,
                    topRisk: s?.top_risks?.[0] ?? null,
                    topCatalyst: s?.top_catalysts?.[0] ?? null,
                  };
                })}
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
                  <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{t("watchlist.empty.advancedTitle")}</p>
                  <p className="text-xs text-center" style={{ color: "var(--muted)" }}>{t("watchlist.empty.advancedSubtitle")}</p>
                </div>
              ) : (
                <div className="rounded-2xl border overflow-hidden"
                     style={{ borderColor: "rgba(0,212,126,0.2)", background: "var(--card)" }}>
                  <div className="h-1" style={{ background: "linear-gradient(90deg,#00d47e,#00a8ff)" }} />
                  <div className="p-6 flex flex-col items-center gap-3 text-center">
                    <span className="text-3xl">👀</span>
                    <div>
                      <p className="font-black text-sm mb-1" style={{ color: "var(--text)" }}>
                        {t("watchlist.empty.title")}
                      </p>
                      <p className="text-xs leading-relaxed max-w-xs" style={{ color: "var(--muted)" }}>
                        {t("watchlist.empty.description")}
                      </p>
                    </div>
                    <div className="w-full grid grid-cols-2 gap-2 mt-1">
                      <button onClick={() => router.push("/screener")}
                              className="py-2.5 rounded-xl text-xs font-black transition-all hover:opacity-90"
                              style={{ background: "var(--accent)", color: "#000" }}>
                        {t("watchlist.empty.viewEtfs")}
                      </button>
                      <button onClick={() => router.push("/chat")}
                              className="py-2.5 rounded-xl text-xs font-bold border transition-all hover:opacity-80"
                              style={{ borderColor: "rgba(0,212,126,0.35)", color: "var(--accent-l)", background: "rgba(0,212,126,0.06)" }}>
                        {t("watchlist.empty.askMentor")}
                      </button>
                    </div>
                    <p className="text-[10px] mt-1" style={{ color: "var(--dim)" }}>
                      {t("watchlist.empty.searchHint")}
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
                <p className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: "var(--muted)" }}>{t("watchlist.alertModal.title")}</p>
                <p className="text-base font-black" style={{ color: "var(--text)" }}>{alertModal.ticker}</p>
              </div>
              <button onClick={() => setAlertModal(null)} className="p-1.5 rounded-lg" style={{ color: "var(--muted)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {alertModal.currentPrice != null && (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {t("watchlist.alertModal.currentPrice")} <span className="font-bold" style={{ color: "var(--text)" }}>${alertModal.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </p>
            )}

            <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
              {(["below", "above"] as const).map((c) => (
                <button key={c} onClick={() => setAlertCondition(c)}
                        className="flex-1 py-2 text-sm font-bold transition-colors"
                        style={{ background: alertCondition === c ? "var(--accent)" : "var(--raised)", color: alertCondition === c ? "#fff" : "var(--muted)" }}>
                  {c === "below" ? t("watchlist.alertModal.below") : t("watchlist.alertModal.above")}
                </button>
              ))}
            </div>

            <input
              type="number"
              placeholder={t("watchlist.alertModal.pricePlaceholder")}
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
                  {t("watchlist.alertModal.deleteAlert")}
                </button>
              )}
              <button onClick={saveAlert} disabled={savingAlert || !alertPrice}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors"
                      style={{ background: "var(--accent)", color: "#fff", opacity: (!alertPrice || savingAlert) ? 0.5 : 1 }}>
                {savingAlert ? t("watchlist.alertModal.saving") : t("watchlist.alertModal.saveAlert")}
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
          title={t("watchlist.tour.title")}
          description={t("watchlist.tour.description")}
          ctaLabel={t("watchlist.tour.cta")}
        />
      )}
    </>
  );
}
