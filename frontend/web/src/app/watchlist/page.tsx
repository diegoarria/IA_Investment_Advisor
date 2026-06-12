"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Eye, X, RefreshCw, Search, Menu, LogOut,
  TrendingUp, TrendingDown, Lock, Plus,
} from "lucide-react";
import { watchlist as watchlistApi, market as marketApi } from "@/lib/api";
import { useAuthStore, useSubscriptionStore, useProfileStore } from "@/lib/store";
import { getUserLevel } from "@/lib/userLevel";
import { usePortfolioStore } from "@/lib/portfolioStore";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
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

const FREE_LIMIT = 30;
const CACHE_KEY = "nuvos_watchlist_cache";

function readCache(): WatchlistItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as WatchlistItem[]) : [];
  } catch { return []; }
}

function writeCache(items: WatchlistItem[]) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(items)); } catch {}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtPrice(price: number | null, currency = "USD"): string {
  if (price === null || price === undefined) return "—";
  const symbol = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
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
  confirmDelete: string | null;
  onRequestDelete: (ticker: string) => void;
  onConfirmDelete: (ticker: string) => void;
  onCancelDelete: () => void;
  onSelect: (ticker: string) => void;
}

function StockCard({ item, confirmDelete, onRequestDelete, onConfirmDelete, onCancelDelete, onSelect }: StockCardProps) {
  const isUp = item.change_pct >= 0;
  const borderColor = isUp ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)";
  const priceColor = isUp ? "#22c55e" : "#ef4444";

  const state = (item.market_state || "").toUpperCase();
  const showPreMkt = item.pre_market_price !== null && (state === "PRE" || state === "PREPRE");
  const showPostMkt = item.post_market_price !== null &&
    (state === "POST" || state === "POSTPOST" || state === "CLOSED");

  const isConfirming = confirmDelete === item.ticker;

  return (
    <div
      className="rounded-xl p-3 flex items-center gap-2.5 relative overflow-hidden cursor-pointer"
      onClick={() => onSelect(item.ticker)}
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderLeft: `2px solid ${borderColor}`,
      }}
    >
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
                  {fmtPrice(item.pre_market_price, item.currency)}
                </p>
                <p className="text-[10px] font-bold" style={{ color: "#f59e0b" }}>
                  {fmtPct(item.pre_market_change_pct)}
                </p>
                <p className="text-[9px]" style={{ color: "var(--muted)" }}>
                  Reg. {fmtPrice(item.price, item.currency)}
                </p>
              </>
            ) : showPostMkt ? (
              <>
                <p className="text-[13px] font-black leading-tight" style={{ color: "#818cf8" }}>
                  {fmtPrice(item.post_market_price, item.currency)}
                </p>
                <p className="text-[10px] font-bold" style={{ color: "#818cf8" }}>
                  {fmtPct(item.post_market_change_pct)}
                </p>
                <p className="text-[9px]" style={{ color: "var(--muted)" }}>
                  Cierre {fmtPrice(item.price, item.currency)}
                </p>
              </>
            ) : (
              <>
                <p className="text-[13px] font-black leading-tight" style={{ color: "var(--text)" }}>
                  {fmtPrice(item.price, item.currency)}
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

      {/* Delete button */}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        {isConfirming ? (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[9px] font-semibold" style={{ color: "var(--muted)" }}>¿Seguro?</span>
            <div className="flex gap-1">
              <button
                onClick={() => onConfirmDelete(item.ticker)}
                className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}
              >Sí</button>
              <button
                onClick={onCancelDelete}
                className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                style={{ background: "var(--raised)", color: "var(--muted)" }}
              >No</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => onRequestDelete(item.ticker)}
            className="w-6 h-6 rounded flex items-center justify-center opacity-30 hover:opacity-80 transition-opacity"
            style={{ color: "var(--muted)" }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
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
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { profile } = useProfileStore();
  const userLevel = getUserLevel(profile);
  const { tier } = useSubscriptionStore();
  const isPremium = tier === "premium";
  const { positions } = usePortfolioStore();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [items, setItems] = useState<WatchlistItem[]>(() => readCache());
  const [loading, setLoading] = useState(() => readCache().length === 0);
  const [refreshing, setRefreshing] = useState(false);

  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [selectedStock, setSelectedStock] = useState<string | null>(null);

  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [secondsSince, setSecondsSince] = useState(0);

  const [toast, setToast] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"basic" | "advanced">(() => {
    if (typeof window === "undefined") return "basic";
    return (localStorage.getItem("nuvos_watchlist_view") as "basic" | "advanced") ?? "basic";
  });

  const searchRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auth guard ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) router.push("/");
  }, [isAuthenticated, router]);

  // ── Fetch watchlist ─────────────────────────────────────────────────────
  const fetchWatchlist = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await watchlistApi.get();
      const data = res.data as WatchlistItem[];
      setItems(data);
      writeCache(data);
      setLastRefreshed(new Date());
      setSecondsSince(0);
    } catch {
      // On failure keep whatever items are already shown — never reset to empty
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
      } else if (status === 403) {
        setPaywallOpen(true);
      } else {
        showToast("Error al agregar el ticker");
      }
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────
  const handleRequestDelete = (ticker: string) => setConfirmDelete(ticker);
  const handleCancelDelete = () => setConfirmDelete(null);

  const handleConfirmDelete = async (ticker: string) => {
    setConfirmDelete(null);
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

  if (!isAuthenticated) return null;

  const lastUpdatedText = lastRefreshed
    ? secondsSince < 5
      ? "Actualizado ahora"
      : `Actualizado hace ${secondsSince}s`
    : "";

  return (
    <>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>

        {/* ── Topbar ── */}
        <div
          className="font-ui border-b flex items-center justify-between px-4 py-2 shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--card)" }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-1"
              style={{ color: "var(--muted)" }}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <button onClick={() => router.push("/chat")} className="flex items-center gap-2.5">
              <div className="relative">
                <Image src="/logo.png" alt="Nuvos AI" width={30} height={30} className="rounded-xl object-cover" />
                <div
                  style={{ background: "var(--grad-green)" }}
                />
              </div>
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
            </button>
          </div>

          <span className="font-semibold text-sm" style={{ color: "var(--sub)", fontFamily: "var(--font-body)" }}>Watchlist</span>

          <div className="flex items-center gap-2">
            {lastUpdatedText && (
              <span className="hidden sm:inline text-[10px]" style={{ color: "var(--dim)" }}>
                {lastUpdatedText}
              </span>
            )}
            {/* View toggle */}
            <div className="flex items-center rounded-lg border overflow-hidden"
                 style={{ borderColor: "var(--border)" }}>
              <button
                onClick={() => { setViewMode("basic"); localStorage.setItem("nuvos_watchlist_view", "basic"); }}
                className="px-2.5 py-1.5 text-[10px] font-bold transition-colors"
                style={{
                  background: viewMode === "basic" ? "var(--accent)" : "transparent",
                  color: viewMode === "basic" ? "#fff" : "var(--muted)",
                }}
              >
                Básico
              </button>
              <button
                onClick={() => { setViewMode("advanced"); localStorage.setItem("nuvos_watchlist_view", "advanced"); }}
                className="px-2.5 py-1.5 text-[10px] font-bold transition-colors"
                style={{
                  background: viewMode === "advanced" ? "var(--accent)" : "transparent",
                  color: viewMode === "advanced" ? "#fff" : "var(--muted)",
                }}
              >
                Avanzado
              </button>
            </div>
            <button
              onClick={handleRefresh}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: "var(--muted)" }}
              title="Actualizar"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => { clearAuth(); router.push("/"); }}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: "var(--muted)" }}
              title="Cerrar sesión"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
        <MarketTickerBar />

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden relative">
          <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

          <main className="flex-1 overflow-y-auto scrollbar-thin p-4 w-full">
            <GuidedSteps currentPage="watchlist" />

            {/* ── Search bar ── */}
            <div ref={searchRef} className="relative mb-4">
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
            ) : viewMode === "advanced" && items.length > 0 ? (
              <AdvancedStockTable
                mode="watchlist"
                userLevel={userLevel}
                rows={items.map((i): AdvancedRow => ({
                  ticker: i.ticker,
                  name: i.name,
                  logoUrl: i.logo_url,
                  price: i.price,
                  changePct: i.change_pct,
                  currency: i.currency,
                  marketState: i.market_state,
                  extPrice: i.pre_market_price ?? i.post_market_price,
                  extPct: i.pre_market_change_pct ?? i.post_market_change_pct,
                  extLabel: i.pre_market_price ? "Pre" : i.post_market_price ? "Post" : null,
                }))}
                onRemove={handleRequestDelete}
                onRowClick={setSelectedStock}
              />
            ) : items.length === 0 ? (
              /* Empty state */
              <div
                className="rounded-2xl border flex flex-col items-center gap-3 py-16 px-6"
                style={{ borderColor: "var(--border)", background: "var(--card)" }}
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ background: "rgba(0,168,94,0.10)" }}
                >
                  <Eye className="w-7 h-7" style={{ color: "var(--accent-l)" }} />
                </div>
                <p className="font-bold text-sm" style={{ color: "var(--text)" }}>
                  Tu watchlist está vacía
                </p>
                <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
                  Busca acciones arriba para seguirlas
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {items.map((item) => (
                  <StockCard
                    key={item.ticker}
                    item={item}
                    confirmDelete={confirmDelete}
                    onRequestDelete={handleRequestDelete}
                    onConfirmDelete={handleConfirmDelete}
                    onCancelDelete={handleCancelDelete}
                    onSelect={setSelectedStock}
                  />
                ))}
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
        </div>
      </div>

      {/* ── Stock Detail Modal ── */}
      {selectedStock && (
        <StockDetailModal ticker={selectedStock} onClose={() => setSelectedStock(null)} />
      )}

      {/* ── Paywall Modal ── */}
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />

      {/* ── Toast ── */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-sm font-semibold z-50 shadow-lg"
          style={{ background: "var(--card)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          {toast}
        </div>
      )}
    </>
  );
}
