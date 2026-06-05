"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Eye, X, RefreshCw, Search, Menu, LogOut,
  TrendingUp, TrendingDown, Lock, Plus,
} from "lucide-react";
import { watchlist as watchlistApi, market as marketApi } from "@/lib/api";
import { useAuthStore, useSubscriptionStore } from "@/lib/store";
import AppSidebar from "@/components/AppSidebar";
import PaywallModal from "@/components/PaywallModal";

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
  const [err, setErr] = useState(false);
  const initials = ticker.slice(0, 2).toUpperCase();

  if (logoUrl && !err) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={ticker}
        className="w-10 h-10 rounded-full object-contain p-1.5 shrink-0"
        style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shrink-0"
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
}

function StockCard({ item, confirmDelete, onRequestDelete, onConfirmDelete, onCancelDelete }: StockCardProps) {
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
      className="rounded-2xl p-4 flex items-start gap-3 relative overflow-hidden"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${borderColor}`,
      }}
    >
      {/* Avatar */}
      <StockAvatar ticker={item.ticker} logoUrl={item.logo_url} />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          {/* Left: ticker + name + badge */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-sm" style={{ color: "var(--text)" }}>
                {item.ticker}
              </span>
              <MarketStateBadge state={item.market_state} />
            </div>
            <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--muted)" }}>
              {item.name}
            </p>
          </div>

          {/* Right: prices */}
          <div className="text-right shrink-0">
            {/* Main display price */}
            {showPreMkt ? (
              <>
                <p className="text-base font-black leading-tight" style={{ color: "#f59e0b" }}>
                  {fmtPrice(item.pre_market_price, item.currency)}
                </p>
                <p className="text-[11px] font-bold" style={{ color: "#f59e0b" }}>
                  {fmtPct(item.pre_market_change_pct)}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
                  Regular {fmtPrice(item.price, item.currency)}
                </p>
              </>
            ) : showPostMkt ? (
              <>
                <p className="text-base font-black leading-tight" style={{ color: "#818cf8" }}>
                  {fmtPrice(item.post_market_price, item.currency)}
                </p>
                <p className="text-[11px] font-bold" style={{ color: "#818cf8" }}>
                  {fmtPct(item.post_market_change_pct)}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
                  Cierre {fmtPrice(item.price, item.currency)}
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-black leading-tight" style={{ color: "var(--text)" }}>
                  {fmtPrice(item.price, item.currency)}
                </p>
                <div className="flex items-center justify-end gap-1 mt-0.5">
                  {isUp
                    ? <TrendingUp className="w-3 h-3" style={{ color: priceColor }} />
                    : <TrendingDown className="w-3 h-3" style={{ color: priceColor }} />
                  }
                  <span className="text-[11px] font-bold" style={{ color: priceColor }}>
                    {fmtPct(item.change_pct)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Regular change row (shown when pre/post active) */}
        {(showPreMkt || showPostMkt) && (
          <div className="flex items-center gap-1 mt-1">
            {isUp
              ? <TrendingUp className="w-3 h-3" style={{ color: priceColor }} />
              : <TrendingDown className="w-3 h-3" style={{ color: priceColor }} />
            }
            <span className="text-[10px] font-semibold" style={{ color: priceColor }}>
              {fmtPct(item.change_pct)} vs cierre anterior
            </span>
          </div>
        )}
      </div>

      {/* Delete button */}
      <div className="shrink-0 ml-1">
        {isConfirming ? (
          <div className="flex flex-col items-end gap-1">
            <span className="text-[10px] font-semibold" style={{ color: "var(--muted)" }}>
              ¿Seguro?
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => onConfirmDelete(item.ticker)}
                className="px-2 py-0.5 rounded-lg text-[10px] font-bold"
                style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}
              >
                Sí
              </button>
              <button
                onClick={onCancelDelete}
                className="px-2 py-0.5 rounded-lg text-[10px] font-bold"
                style={{ background: "var(--raised)", color: "var(--muted)" }}
              >
                No
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => onRequestDelete(item.ticker)}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: "var(--dim)" }}
            title={`Eliminar ${item.ticker}`}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-2xl p-4 flex items-start gap-3 animate-pulse"
         style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="w-10 h-10 rounded-full shrink-0" style={{ background: "var(--raised)" }} />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 rounded-lg w-24" style={{ background: "var(--raised)" }} />
        <div className="h-2.5 rounded-lg w-40" style={{ background: "var(--raised)" }} />
      </div>
      <div className="space-y-2 text-right">
        <div className="h-4 rounded-lg w-20" style={{ background: "var(--raised)" }} />
        <div className="h-2.5 rounded-lg w-14 ml-auto" style={{ background: "var(--raised)" }} />
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function WatchlistPage() {
  const router = useRouter();
  const { isAuthenticated, clearAuth } = useAuthStore();
  const { tier } = useSubscriptionStore();
  const isPremium = tier === "premium";

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [secondsSince, setSecondsSince] = useState(0);

  const [toast, setToast] = useState<string | null>(null);

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
      setItems(res.data as WatchlistItem[]);
      setLastRefreshed(new Date());
      setSecondsSince(0);
    } catch {
      // silent
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
      setItems((prev) => prev.filter((i) => i.ticker !== ticker));
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
      <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>

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
                  className="absolute -inset-0.5 rounded-xl blur-sm opacity-40"
                  style={{ background: "var(--grad-green)" }}
                />
              </div>
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
            </button>
          </div>

          <span className="font-semibold text-sm" style={{ color: "var(--sub)" }}>Watchlist</span>

          <div className="flex items-center gap-2">
            {lastUpdatedText && (
              <span className="hidden sm:inline text-[10px]" style={{ color: "var(--dim)" }}>
                {lastUpdatedText}
              </span>
            )}
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

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden relative">
          <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

          <main className="flex-1 overflow-y-auto scrollbar-thin p-4 max-w-2xl mx-auto w-full">

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
                      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--raised)]"
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0"
                        style={{ background: "rgba(0,168,94,0.14)", color: "var(--accent-l)" }}
                      >
                        {r.ticker.slice(0, 2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{r.ticker}</p>
                        <p className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{r.name}</p>
                      </div>
                      <Plus className="w-4 h-4 shrink-0" style={{ color: "var(--accent-l)" }} />
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
              <div className="space-y-3">
                {items.map((item) => (
                  <StockCard
                    key={item.ticker}
                    item={item}
                    confirmDelete={confirmDelete}
                    onRequestDelete={handleRequestDelete}
                    onConfirmDelete={handleConfirmDelete}
                    onCancelDelete={handleCancelDelete}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

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
