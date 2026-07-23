"use client";

import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PremiumBadge from "@/components/PremiumBadge";
import StockAvatar from "@/components/StockAvatar";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { market as marketApi, paperApi } from "@/lib/api";
import { useAuthStore, useSubscriptionStore } from "@/lib/store";
import { usePaperStore, PAPER_INITIAL_CASH } from "@/lib/paperStore";
import PaywallModal from "@/components/PaywallModal";
import { Search, Menu, X, RefreshCw, Loader2, TrendingUp, TrendingDown, Plus, RotateCcw, Clock, Wallet, Sparkles, Lock, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";

interface PaperAnalysis {
  verdict: "practice_more" | "promising" | "ready";
  headline: string;
  feedback: string;
  positives: string[];
  improvements: string[];
  disclaimer: string;
}

interface TickerInfo { ticker: string; name: string; price: number; change_pct: number; }
interface PriceMap { [ticker: string]: { price: number | null; change_pct: number } }
interface SearchResult { ticker: string; name: string; }

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const neg = n < 0 ? "-" : "";
  if (abs >= 1e6) return `${neg}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${neg}$${(abs / 1e3).toFixed(2)}K`;
  return `${neg}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PaperPage() {
  const { t, i18n } = useTranslation();
  const router   = useRouter();
  const { isAuthenticated }  = useAuthStore();
  const subStore = useSubscriptionStore();
  const isPremium = subStore.tier === "premium" || subStore.isTrialPremium;
  const { cash, positions, trades, buy, sell, topUp, reset } = usePaperStore();

  const [paywallOpen, setPaywallOpen]       = useState(false);
  const [analysis, setAnalysis]             = useState<PaperAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery]             = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [tickerInfo, setTickerInfo]   = useState<TickerInfo | null>(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [buyQty, setBuyQty]           = useState("");
  const [sellModal, setSellModal]     = useState<{ ticker: string; shares: number; price: number } | null>(null);
  const [sellQty, setSellQty]         = useState("");
  const [posPrices, setPosPrices]     = useState<PriceMap>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    if (isAuthenticated) usePaperStore.getState().restoreFromServer().catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const syncPaper = useCallback(() => {
    const { cash: c, positions: p, trades: t } = usePaperStore.getState();
    paperApi.syncState(c, p, t).catch(() => {});
  }, []);

  const loadPrices = useCallback(async () => {
    if (!positions.length) return;
    setLoadingPrices(true);
    try {
      const res = await marketApi.getPrices(positions.map((p) => p.ticker));
      setPosPrices(res.data);
    } catch {}
    setLoadingPrices(false);
  }, [positions]);

  useEffect(() => { loadPrices(); }, [positions.length]);

  const handleQueryChange = (v: string) => {
    setQuery(v);
    setTickerInfo(null);
    setSearchError(null);
    setBuyQty("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) { setSuggestions([]); setShowSuggestions(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const res = await marketApi.searchTickers(v.trim());
        setSuggestions(res.data.results ?? []);
        setShowSuggestions(true);
      } catch {}
      setLoadingSuggestions(false);
    }, 150);
  };

  const selectSuggestion = useCallback(async (result: SearchResult) => {
    setShowSuggestions(false);
    setQuery(result.ticker);
    setSuggestions([]);
    setLoadingPrice(true);
    setSearchError(null);
    setTickerInfo(null);
    try {
      const res = await marketApi.getPrices([result.ticker]);
      const d = res.data[result.ticker];
      if (d?.price) {
        setTickerInfo({ ticker: result.ticker, name: result.name || result.ticker, price: d.price, change_pct: d.change_pct ?? 0 });
      } else {
        setSearchError(t("paper.priceError"));
      }
    } catch { setSearchError(t("paper.priceError")); }
    setLoadingPrice(false);
  }, []);

  const handleBuy = () => {
    if (!tickerInfo) return;
    const shares = parseFloat(buyQty);
    if (!shares || shares <= 0) return;
    const err = buy(tickerInfo.ticker, tickerInfo.name, shares, tickerInfo.price);
    if (err) alert(err);
    else { setQuery(""); setBuyQty(""); setTickerInfo(null); syncPaper(); }
  };

  const handleSell = () => {
    if (!sellModal) return;
    const shares = parseFloat(sellQty);
    if (!shares || shares <= 0 || shares > sellModal.shares) return;
    sell(sellModal.ticker, shares, sellModal.price);
    setSellModal(null); setSellQty(""); syncPaper();
  };

  const totalValue    = positions.reduce((acc, p) => acc + p.shares * (posPrices[p.ticker]?.price ?? p.avgPrice), 0);
  const invested      = positions.reduce((acc, p) => acc + p.shares * p.avgPrice, 0);
  const totalPnl      = totalValue - invested;
  const portfolioValue = cash + totalValue;
  const totalReturn   = ((portfolioValue - PAPER_INITIAL_CASH) / PAPER_INITIAL_CASH) * 100;
  const isUp          = totalReturn >= 0;
  const returnColor   = isUp ? "#22c55e" : "#ef4444";

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        {/* Sticky Header */}
        <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between border-b shrink-0"
             style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
          {/* pl-9 clears AppSidebar's floating mobile menu button (fixed
              top-1.5 left-1.5, ~34px wide) on mobile widths. */}
          <div className="pl-9 lg:pl-0">
            <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
              Paper Trading
            </p>
            <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>{t("paper.title")}</h1>
          </div>
          <div className="flex items-center gap-2">
            <PremiumBadge />
            <button onClick={loadPrices}
                    className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
                    style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}>
              <RefreshCw className={`w-4 h-4 ${loadingPrices ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

      <div className="flex flex-1 overflow-hidden relative">

        <main className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4 max-w-2xl mx-auto w-full">

          {/* ── Hero balance card ── */}
          <div className="rounded-2xl p-5 relative overflow-hidden"
               style={{
                 background: "var(--card)",
                 border: `1px solid ${returnColor}30`,
                 boxShadow: `0 0 40px ${returnColor}10`,
               }}>
            {/* Colored top accent */}
            <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: returnColor }} />

            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--muted)" }}>
                  {t("paper.portfolioLabel")}
                </p>
                <p className="text-4xl font-black leading-none tracking-tight" style={{ color: "var(--text)" }}>
                  {fmtMoney(portfolioValue)}
                </p>
                {totalReturn !== 0 && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
                         style={{ background: `${returnColor}18`, color: returnColor }}>
                      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {isUp ? "+" : ""}{totalReturn.toFixed(2)}% {t("paper.totalSuffix")}
                    </div>
                    <span className="text-xs font-semibold" style={{ color: returnColor }}>
                      {isUp ? "+" : ""}{fmtMoney(portfolioValue - PAPER_INITIAL_CASH)}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {[1000, 5000, 10000].map((amt) => (
                  <button key={amt} onClick={() => topUp(amt)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors hover:border-[var(--accent)]"
                          style={{ borderColor: "var(--border)", color: "var(--sub)", background: "var(--raised)" }}>
                    <Plus className="w-3 h-3" />
                    {fmtMoney(amt)}
                  </button>
                ))}
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
              {[
                { icon: Wallet,       label: t("paper.cash"),   value: fmtMoney(cash),       color: "#8b5cf6" },
                { icon: TrendingUp,   label: t("paper.positionsStat"), value: fmtMoney(totalValue),  color: "var(--text)" },
                { icon: totalPnl >= 0 ? TrendingUp : TrendingDown,
                  label: t("paper.colPnl"),       value: fmtMoney(totalPnl),  color: totalPnl >= 0 ? "#22c55e" : "#ef4444" },
              ].map(({ icon: Icon, label, value, color }) => (
                <div key={label} className="rounded-xl p-2.5 text-center" style={{ background: "var(--raised)" }}>
                  <Icon className="w-3.5 h-3.5 mx-auto mb-1" style={{ color }} />
                  <p className="text-[10px] uppercase tracking-wide font-semibold mb-0.5" style={{ color: "var(--muted)" }}>{label}</p>
                  <p className="text-sm font-black" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Comprar acciones ── */}
          <div className="rounded-2xl border p-4 space-y-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,212,126,0.12)" }}>
                <Plus className="w-3.5 h-3.5" style={{ color: "#00d47e" }} />
              </div>
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>{t("paper.buySection")}</span>
            </div>

            <div ref={searchWrapperRef} className="relative">
              <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5"
                   style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                {loadingSuggestions || loadingPrice
                  ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" style={{ color: "var(--muted)" }} />
                  : <Search className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />}
                <input value={query} onChange={(e) => handleQueryChange(e.target.value)}
                       onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                       placeholder={t("paper.searchPlaceholder")}
                       className="flex-1 bg-transparent outline-none text-sm"
                       style={{ color: "var(--text)" }} />
                {query && (
                  <button onClick={() => { setQuery(""); setSuggestions([]); setShowSuggestions(false); setTickerInfo(null); setSearchError(null); }}
                          style={{ color: "var(--muted)" }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-xl overflow-hidden shadow-2xl"
                     style={{ background: "#0f172a", border: "1px solid rgba(0,212,126,0.25)" }}>
                  {suggestions.map((s, i) => (
                    <button key={s.ticker} onMouseDown={() => selectSuggestion(s)}
                            className="w-full flex items-center justify-between px-4 py-2.5 transition-colors text-left hover:bg-white/5"
                            style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                      <span className="font-bold text-sm" style={{ color: "#00d47e" }}>{s.ticker}</span>
                      <span className="text-xs ml-3 truncate max-w-[200px]" style={{ color: "var(--sub)" }}>{s.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {searchError && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
                <X className="w-3 h-3" />{searchError}
              </div>
            )}

            {tickerInfo && !loadingPrice && (
              <div className="rounded-xl border p-3 space-y-3"
                   style={{ borderColor: "rgba(0,212,126,0.2)", background: "rgba(0,212,126,0.04)" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-black text-lg leading-none" style={{ color: "var(--text)" }}>{tickerInfo.ticker}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{tickerInfo.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-black text-lg leading-none" style={{ color: "var(--text)" }}>
                      ${tickerInfo.price.toFixed(2)}
                    </div>
                    <div className="flex items-center gap-1 justify-end mt-1 text-xs font-bold px-2 py-0.5 rounded-full"
                         style={{
                           background: `${tickerInfo.change_pct >= 0 ? "#22c55e" : "#ef4444"}18`,
                           color: tickerInfo.change_pct >= 0 ? "#22c55e" : "#ef4444",
                         }}>
                      {tickerInfo.change_pct >= 0 ? "▲" : "▼"} {Math.abs(tickerInfo.change_pct).toFixed(2)}%
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input value={buyQty} onChange={(e) => setBuyQty(e.target.value)}
                         placeholder={t("paper.quantityPlaceholder")} type="number" min="0.01" step="0.01"
                         className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none"
                         style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} />
                  <button onClick={handleBuy} disabled={!buyQty || parseFloat(buyQty) <= 0}
                          className="px-5 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                          style={{ background: "linear-gradient(135deg,#00a85e,#00d47e)", boxShadow: "0 4px 12px rgba(0,168,94,0.3)" }}>
                    {t("paper.buy")}
                  </button>
                </div>
                {buyQty && parseFloat(buyQty) > 0 && (
                  <div className="flex items-center justify-between text-xs px-3 py-2 rounded-lg" style={{ background: "var(--raised)" }}>
                    <span style={{ color: "var(--muted)" }}>
                      {t("paper.total")} <span className="font-bold" style={{ color: "var(--text)" }}>{fmtMoney(parseFloat(buyQty) * tickerInfo.price)}</span>
                    </span>
                    <span style={{ color: cash >= parseFloat(buyQty) * tickerInfo.price ? "#22c55e" : "#ef4444" }}>
                      {t("paper.balance")} {fmtMoney(cash)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Posiciones ── */}
          {positions.length > 0 && (() => {
            const totalPositionValue = positions.reduce((acc, p) => acc + p.shares * (posPrices[p.ticker]?.price ?? p.avgPrice), 0);
            const totalPositionPnl   = positions.reduce((acc, p) => {
              const cur = posPrices[p.ticker]?.price ?? p.avgPrice;
              return acc + (cur - p.avgPrice) * p.shares;
            }, 0);
            const totalInvested = positions.reduce((acc, p) => acc + p.shares * p.avgPrice, 0);
            const totalPnlPct   = totalInvested > 0 ? (totalPositionPnl / totalInvested) * 100 : 0;
            return (
              <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
                    <span className="text-sm font-bold" style={{ color: "var(--text)" }}>{t("paper.openPositions")}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: "var(--raised)", color: "var(--muted)" }}>
                      {positions.length}
                    </span>
                  </div>
                  {loadingPrices
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--muted)" }} />
                    : <button onClick={loadPrices} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" style={{ color: "var(--muted)" }}>
                        <RefreshCw className="w-3 h-3" />
                      </button>
                  }
                </div>

                {/* Column headers */}
                <div className="grid px-4 py-2 text-[10px] font-bold uppercase tracking-widest border-b"
                     style={{
                       gridTemplateColumns: "1fr 80px 80px 88px 96px 44px",
                       color: "var(--muted)",
                       borderColor: "var(--border)",
                       background: "var(--raised)",
                     }}>
                  <span>{t("paper.colTicker")}</span>
                  <span className="text-right">{t("paper.colShares")}</span>
                  <span className="text-right">{t("paper.colBuy")}</span>
                  <span className="text-right">{t("paper.colCurrent")}</span>
                  <span className="text-right">{t("paper.colPnl")}</span>
                  <span />
                </div>

                {/* Rows */}
                {positions.map((pos) => {
                  const cur    = posPrices[pos.ticker]?.price ?? pos.avgPrice;
                  const pnl    = (cur - pos.avgPrice) * pos.shares;
                  const pnlPct = ((cur - pos.avgPrice) / pos.avgPrice) * 100;
                  const up     = pnl >= 0;
                  const col    = up ? "#22c55e" : "#ef4444";
                  const posVal = cur * pos.shares;
                  const barW   = Math.min(Math.abs(pnlPct) * 4, 100);
                  return (
                    <div key={pos.ticker} className="border-b last:border-b-0 group hover:bg-white/[0.02] transition-colors"
                         style={{ borderColor: "var(--border)" }}>
                      {/* Left accent bar */}
                      <div className="grid items-center px-4 py-3 gap-1"
                           style={{ gridTemplateColumns: "1fr 80px 80px 88px 96px 44px" }}>

                        {/* Ticker + name */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="shrink-0">
                            <StockAvatar ticker={pos.ticker} size="sm" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-black text-sm" style={{ color: "var(--text)" }}>{pos.ticker}</span>
                              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: col, boxShadow: `0 0 4px ${col}80` }} />
                            </div>
                            {pos.name && pos.name !== pos.ticker && (
                              <span className="text-[10px] block truncate" style={{ color: "var(--muted)" }}>{pos.name}</span>
                            )}
                          </div>
                        </div>

                        {/* Shares */}
                        <div className="text-right">
                          <span className="text-sm font-bold" style={{ color: "var(--text)" }}>{pos.shares}</span>
                          <div className="text-[10px]" style={{ color: "var(--muted)" }}>{t("paper.sharesAbbrev")}</div>
                        </div>

                        {/* Avg cost */}
                        <div className="text-right">
                          <span className="text-sm font-semibold" style={{ color: "var(--sub)" }}>
                            ${pos.avgPrice.toFixed(2)}
                          </span>
                          <div className="text-[10px]" style={{ color: "var(--muted)" }}>{t("paper.avgAbbrev")}</div>
                        </div>

                        {/* Current price */}
                        <div className="text-right">
                          <span className="text-sm font-black" style={{ color: "var(--text)" }}>
                            ${cur.toFixed(2)}
                          </span>
                          <div className="text-[10px] font-semibold" style={{ color: col }}>
                            {fmtMoney(posVal)}
                          </div>
                        </div>

                        {/* P&L */}
                        <div className="text-right">
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-black"
                               style={{ background: `${col}18`, color: col }}>
                            {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                            {up ? "+" : ""}{pnlPct.toFixed(2)}%
                          </div>
                          <div className="text-[11px] font-bold mt-0.5" style={{ color: col }}>
                            {up ? "+" : ""}{fmtMoney(pnl)}
                          </div>
                          {/* Mini P&L bar */}
                          <div className="mt-1 h-0.5 rounded-full overflow-hidden" style={{ background: "var(--raised)" }}>
                            <div className="h-full rounded-full transition-all"
                                 style={{ width: `${barW}%`, background: col, opacity: 0.7 }} />
                          </div>
                        </div>

                        {/* Sell button */}
                        <div className="flex justify-end">
                          <button
                            onClick={() => { setSellModal({ ticker: pos.ticker, shares: pos.shares, price: cur }); setSellQty(""); }}
                            className="w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black transition-all hover:opacity-80 active:scale-95"
                            title={t("paper.sellTitle", { ticker: pos.ticker })}
                            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
                            V
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Totals footer */}
                <div className="grid items-center px-4 py-3 border-t"
                     style={{
                       gridTemplateColumns: "1fr 80px 80px 88px 96px 44px",
                       borderColor: "var(--border)",
                       background: "var(--raised)",
                     }}>
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--muted)" }}>{t("paper.totalPositions")}</span>
                  <span />
                  <span />
                  <div className="text-right">
                    <span className="text-sm font-black" style={{ color: "var(--text)" }}>{fmtMoney(totalPositionValue)}</span>
                  </div>
                  <div className="text-right">
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-black"
                         style={{
                           background: `${totalPositionPnl >= 0 ? "#22c55e" : "#ef4444"}18`,
                           color: totalPositionPnl >= 0 ? "#22c55e" : "#ef4444",
                         }}>
                      {totalPositionPnl >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {totalPnlPct >= 0 ? "+" : ""}{totalPnlPct.toFixed(2)}%
                    </div>
                    <div className="text-[11px] font-bold mt-0.5"
                         style={{ color: totalPositionPnl >= 0 ? "#22c55e" : "#ef4444" }}>
                      {totalPositionPnl >= 0 ? "+" : ""}{fmtMoney(totalPositionPnl)}
                    </div>
                  </div>
                  <span />
                </div>
              </div>
            );
          })()}

          {positions.length === 0 && trades.length === 0 && (
            <div className="rounded-2xl border p-10 flex flex-col items-center gap-3"
                 style={{ background: "var(--card)", borderColor: "var(--border)", borderStyle: "dashed" }}>
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(0,212,126,0.1)" }}>
                <TrendingUp className="w-6 h-6" style={{ color: "#00d47e" }} />
              </div>
              <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{t("paper.emptyTitle")}</p>
              <p className="text-xs text-center" style={{ color: "var(--muted)" }}
                 dangerouslySetInnerHTML={{ __html: t("paper.emptyBody", { amount: fmtMoney(PAPER_INITIAL_CASH) }) }} />
            </div>
          )}

          {/* ── Historial de operaciones ── */}
          {trades.length > 0 && (
            <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              {/* Header — clickable toggle */}
              <button
                className="w-full flex items-center gap-2 px-4 py-3 transition-colors hover:bg-white/[0.03]"
                style={{ borderBottom: historyOpen ? "1px solid var(--border)" : "none" }}
                onClick={() => setHistoryOpen(o => !o)}
              >
                <Clock className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />
                <span className="text-sm font-bold" style={{ color: "var(--text)" }}>{t("paper.tradeHistory")}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: "var(--raised)", color: "var(--muted)" }}>
                  {trades.length}
                </span>
                <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold" style={{ color: "var(--accent-l)" }}>
                  {historyOpen ? t("paper.seeLess") : t("paper.seeMore")}
                  {historyOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </span>
              </button>

              {historyOpen && (
                <div>
                  {/* Column headers */}
                  <div className="grid px-4 py-2 text-[10px] font-bold uppercase tracking-widest border-b"
                       style={{ gridTemplateColumns: "64px 1fr 1fr 80px", color: "var(--muted)", borderColor: "var(--border)", background: "var(--raised)" }}>
                    <span>{t("paper.colType")}</span>
                    <span>{t("paper.colAsset")}</span>
                    <span>{t("paper.colDetail")}</span>
                    <span className="text-right">{t("paper.colAmount")}</span>
                  </div>
                  {trades.slice(0, 30).map((trade, idx) => {
                    const isBuy     = trade.type === "buy";
                    const isDeposit = trade.type !== "buy" && trade.type !== "sell";
                    const col       = isBuy ? "#22c55e" : isDeposit ? "#3b82f6" : "#ef4444";
                    const label     = isBuy ? t("paper.tradeBuy") : isDeposit ? t("paper.tradeDeposit") : t("paper.tradeSell");
                    const Icon      = isBuy ? ArrowUpRight : isDeposit ? Plus : ArrowDownRight;
                    const dt        = new Date(trade.timestamp);
                    const dateStr   = dt.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
                    const timeStr   = dt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
                    const detail    = trade.shares > 0 ? `${trade.shares} ${t("paper.sharesAbbrev")} @ $${trade.price.toFixed(2)}` : "—";
                    return (
                      <div key={trade.id}
                           className="grid items-center px-4 py-3 border-b last:border-b-0 hover:bg-white/[0.02] transition-colors"
                           style={{ gridTemplateColumns: "64px 1fr 1fr 80px", borderColor: "var(--border)", background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                        <div>
                          <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                               style={{ background: `${col}15`, color: col }}>
                            <Icon className="w-2.5 h-2.5" />
                            {label}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-xs" style={{ color: "var(--text)" }}>
                            {trade.ticker !== "CASH" ? trade.ticker : t("paper.cashLabel")}
                          </div>
                          <div className="text-[10px]" style={{ color: "var(--muted)" }}>{dateStr} · {timeStr}</div>
                        </div>
                        <div className="text-[11px]" style={{ color: "var(--sub)" }}>{detail}</div>
                        <div className="text-right">
                          <span className="text-sm font-black" style={{ color: isBuy ? "#ef4444" : "#22c55e" }}>
                            {isBuy ? "−" : "+"}{fmtMoney(trade.total)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Análisis IA del portafolio (premium) ── */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                   style={{ background: "rgba(168,85,247,0.12)" }}>
                <Sparkles className="w-3.5 h-3.5" style={{ color: "#a855f7" }} />
              </div>
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>{t("paper.aiAnalysisTitle")}</span>
              {!isPremium && (
                <span className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(168,85,247,0.12)", color: "#a855f7" }}>{t("paper.premium")}</span>
              )}
            </div>

            {!isPremium ? (
              /* Locked state */
              <div className="flex flex-col items-center gap-3 py-8 px-6 text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                     style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)" }}>
                  <Lock className="w-5 h-5" style={{ color: "#a855f7" }} />
                </div>
                <div>
                  <p className="font-bold text-sm mb-1" style={{ color: "var(--text)" }}>
                    {t("paper.lockedTitle")}
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                    {t("paper.lockedBody")}
                  </p>
                </div>
                <button onClick={() => setPaywallOpen(true)}
                        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white"
                        style={{ background: "linear-gradient(135deg, #a855f7, #7c3aed)" }}>
                  {t("paper.activatePremium")}
                </button>
              </div>
            ) : analysis ? (
              /* Results */
              <div className="p-4 space-y-4">
                {/* Verdict badge */}
                <div className="flex items-center gap-3">
                  <div className="text-3xl">
                    {analysis.verdict === "ready" ? "🏆" : analysis.verdict === "promising" ? "📈" : "📚"}
                  </div>
                  <div>
                    <div className="font-black text-base leading-tight" style={{
                      color: analysis.verdict === "ready" ? "#22c55e"
                           : analysis.verdict === "promising" ? "#f59e0b" : "var(--text)"
                    }}>
                      {analysis.headline}
                    </div>
                    <div className="text-[10px] font-bold mt-0.5 px-2 py-0.5 rounded-full inline-block" style={{
                      background: analysis.verdict === "ready" ? "rgba(34,197,94,0.12)"
                                : analysis.verdict === "promising" ? "rgba(245,158,11,0.12)" : "rgba(99,102,241,0.12)",
                      color: analysis.verdict === "ready" ? "#22c55e"
                           : analysis.verdict === "promising" ? "#f59e0b" : "#818cf8",
                    }}>
                      {analysis.verdict === "ready" ? t("paper.verdictReady")
                     : analysis.verdict === "promising" ? t("paper.verdictPromising")
                     : t("paper.verdictPracticeMore")}
                    </div>
                  </div>
                </div>

                {/* Main feedback */}
                <p className="text-sm leading-relaxed" style={{ color: "var(--sub)" }}>{analysis.feedback}</p>

                {/* Positives */}
                {analysis.positives.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#22c55e" }}>Lo que haces bien</p>
                    {analysis.positives.map((p, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs" style={{ color: "var(--sub)" }}>
                        <span className="text-green-500 mt-0.5 shrink-0">✓</span>{p}
                      </div>
                    ))}
                  </div>
                )}

                {/* Improvements */}
                {analysis.improvements.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#f59e0b" }}>Áreas a mejorar</p>
                    {analysis.improvements.map((imp, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs" style={{ color: "var(--sub)" }}>
                        <span style={{ color: "#f59e0b", marginTop: 2 }} className="shrink-0">→</span>{imp}
                      </div>
                    ))}
                  </div>
                )}

                {/* Disclaimer */}
                <p className="text-[10px] leading-relaxed p-3 rounded-xl border"
                   style={{ color: "var(--dim)", borderColor: "var(--border)", background: "var(--raised)" }}>
                  ⚠️ {analysis.disclaimer}
                </p>

                {/* Re-analyze */}
                <button onClick={() => setAnalysis(null)}
                        className="w-full py-2 rounded-xl text-xs font-semibold border hover:opacity-80 transition-opacity"
                        style={{ borderColor: "rgba(168,85,247,0.3)", color: "#a855f7", background: "rgba(168,85,247,0.06)" }}>
                  Volver a analizar
                </button>
              </div>
            ) : (
              /* CTA */
              <div className="p-4 space-y-3">
                <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                  La IA analiza tu estrategia, diversificación y comportamiento para decirte si estás listo para invertir dinero real en acciones individuales — siempre con responsabilidad e investigación previa.
                </p>
                <button
                  onClick={async () => {
                    setAnalysisLoading(true);
                    try {
                      const res = await paperApi.analyze(
                        positions,
                        trades,
                        totalReturn,
                        cash,
                        portfolioValue,
                        i18n.language,
                      );
                      setAnalysis(res.data as PaperAnalysis);
                    } catch {
                      setAnalysis({
                        verdict: "promising",
                        headline: t("paper.analysis.errorHeadline"),
                        feedback: t("paper.analysis.errorFeedback"),
                        positives: [],
                        improvements: [],
                        disclaimer: "",
                      });
                    }
                    setAnalysisLoading(false);
                  }}
                  disabled={analysisLoading || trades.length === 0}
                  className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #a855f7, #7c3aed)", color: "#fff" }}
                >
                  {analysisLoading
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("paper.analysis.analyzing")}</>
                    : <><Sparkles className="w-4 h-4" /> {t("paper.analysis.analyzeButton")}</>}
                </button>
                {trades.length === 0 && (
                  <p className="text-[10px] text-center" style={{ color: "var(--dim)" }}>
                    {t("paper.analysis.needOneTrade")}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Reset ── */}
          <div className="flex justify-end pb-2">
            <button onClick={() => { if (confirm(t("paper.resetConfirm"))) { reset(); setAnalysis(null); } }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors hover:opacity-80"
                    style={{ borderColor: "rgba(239,68,68,0.2)", color: "#ef4444", background: "rgba(239,68,68,0.04)" }}>
              <RotateCcw className="w-3 h-3" />
              {t("paper.resetButton")}
            </button>
          </div>

        </main>
      </div>
      </div>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)}
                    reason={t("paper.paywallReason")} />

      {/* Sell modal */}
      {sellModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl border overflow-hidden"
               style={{ background: "var(--card)", borderColor: "rgba(239,68,68,0.3)" }}>
            <div className="h-0.5" style={{ background: "#ef4444" }} />
            <div className="p-5 space-y-4">
              <div>
                <div className="font-black text-xl" style={{ color: "var(--text)" }}>Vender {sellModal.ticker}</div>
                <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  Precio actual: <span className="font-bold" style={{ color: "var(--text)" }}>${sellModal.price.toFixed(2)}</span>
                  {" · "}{sellModal.shares} acciones disponibles
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5"
                   style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                <input value={sellQty} onChange={(e) => setSellQty(e.target.value)} type="number"
                       placeholder={`1 – ${sellModal.shares}`} autoFocus
                       className="flex-1 bg-transparent outline-none text-lg font-black" style={{ color: "var(--text)" }} />
                <button onClick={() => setSellQty(String(sellModal.shares))}
                        className="text-xs font-bold px-2 py-0.5 rounded-lg"
                        style={{ color: "#22c55e", background: "rgba(34,197,94,0.1)" }}>
                  MAX
                </button>
              </div>
              {sellQty && parseFloat(sellQty) > 0 && (
                <div className="flex items-center justify-between text-sm px-3 py-2 rounded-xl"
                     style={{ background: "var(--raised)" }}>
                  <span style={{ color: "var(--muted)" }}>Recibirás</span>
                  <span className="font-black" style={{ color: "#22c55e" }}>
                    {fmtMoney(parseFloat(sellQty) * sellModal.price)}
                  </span>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setSellModal(null)}
                        className="flex-1 py-3 rounded-xl border text-sm font-semibold"
                        style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  Cancelar
                </button>
                <button onClick={handleSell}
                        disabled={!sellQty || parseFloat(sellQty) <= 0 || parseFloat(sellQty) > sellModal.shares}
                        className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-all"
                        style={{ background: "#ef4444", boxShadow: "0 4px 12px rgba(239,68,68,0.3)" }}>
                  Vender {sellQty || "—"} acc
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
