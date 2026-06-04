"use client";

import AppSidebar from "@/components/AppSidebar";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { market as marketApi, paperApi } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { usePaperStore, PAPER_INITIAL_CASH } from "@/lib/paperStore";
import { Search, Menu, X, RefreshCw, Loader2, TrendingUp, TrendingDown, Plus, RotateCcw, Clock, Wallet } from "lucide-react";

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
  const router   = useRouter();
  const { isAuthenticated }  = useAuthStore();
  const { cash, positions, trades, buy, sell, topUp, reset } = usePaperStore();

  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  useEffect(() => { if (!isAuthenticated) router.push("/"); }, [isAuthenticated]);

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
        setSearchError("No se pudo obtener precio");
      }
    } catch { setSearchError("No se pudo obtener precio"); }
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
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="border-b flex items-center justify-between px-4 py-2 shrink-0"
           style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1" style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button onClick={() => router.push("/chat")} className="flex items-center gap-2.5">
            <div className="relative">
              <Image src="/logo.png" alt="Nuvos AI" width={30} height={30} className="rounded-xl object-cover" />
              <div className="absolute -inset-0.5 rounded-xl blur-sm opacity-40" style={{ background: "var(--grad-green)" }} />
            </div>
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
          <span className="font-semibold text-sm" style={{ color: "var(--sub)" }}>Paper Trading</span>
        </div>
        <button onClick={loadPrices} className="p-2 rounded-lg hover:bg-white/5 transition-colors" style={{ color: "var(--muted)" }}>
          <RefreshCw className={`w-4 h-4 ${loadingPrices ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

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
                  Portafolio virtual
                </p>
                <p className="text-4xl font-black leading-none tracking-tight" style={{ color: "var(--text)" }}>
                  {fmtMoney(portfolioValue)}
                </p>
                {totalReturn !== 0 && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
                         style={{ background: `${returnColor}18`, color: returnColor }}>
                      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {isUp ? "+" : ""}{totalReturn.toFixed(2)}% total
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
                { icon: Wallet,       label: "Efectivo",   value: fmtMoney(cash),       color: "#8b5cf6" },
                { icon: TrendingUp,   label: "Posiciones", value: fmtMoney(totalValue),  color: "var(--text)" },
                { icon: totalPnl >= 0 ? TrendingUp : TrendingDown,
                  label: "P&L",       value: fmtMoney(totalPnl),  color: totalPnl >= 0 ? "#22c55e" : "#ef4444" },
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
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Comprar acciones</span>
            </div>

            <div ref={searchWrapperRef} className="relative">
              <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5"
                   style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                {loadingSuggestions || loadingPrice
                  ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" style={{ color: "var(--muted)" }} />
                  : <Search className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />}
                <input value={query} onChange={(e) => handleQueryChange(e.target.value)}
                       onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                       placeholder="Busca ticker: NVDA, AAPL, TSLA…"
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
                         placeholder="Cantidad" type="number" min="0.01" step="0.01"
                         className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none"
                         style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} />
                  <button onClick={handleBuy} disabled={!buyQty || parseFloat(buyQty) <= 0}
                          className="px-5 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                          style={{ background: "linear-gradient(135deg,#00a85e,#00d47e)", boxShadow: "0 4px 12px rgba(0,168,94,0.3)" }}>
                    Comprar
                  </button>
                </div>
                {buyQty && parseFloat(buyQty) > 0 && (
                  <div className="flex items-center justify-between text-xs px-3 py-2 rounded-lg" style={{ background: "var(--raised)" }}>
                    <span style={{ color: "var(--muted)" }}>
                      Total: <span className="font-bold" style={{ color: "var(--text)" }}>{fmtMoney(parseFloat(buyQty) * tickerInfo.price)}</span>
                    </span>
                    <span style={{ color: cash >= parseFloat(buyQty) * tickerInfo.price ? "#22c55e" : "#ef4444" }}>
                      Saldo: {fmtMoney(cash)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Posiciones ── */}
          {positions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
                  Posiciones · {positions.length}
                </span>
                {loadingPrices && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--muted)" }} />}
              </div>
              {positions.map((pos) => {
                const cur    = posPrices[pos.ticker]?.price ?? pos.avgPrice;
                const pnl    = (cur - pos.avgPrice) * pos.shares;
                const pnlPct = ((cur - pos.avgPrice) / pos.avgPrice) * 100;
                const up     = pnl >= 0;
                const col    = up ? "#22c55e" : "#ef4444";
                return (
                  <div key={pos.ticker} className="rounded-2xl border overflow-hidden"
                       style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <div className="h-0.5" style={{ background: col }} />
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-black text-base" style={{ color: "var(--text)" }}>{pos.ticker}</span>
                          {pos.name && pos.name !== pos.ticker && (
                            <span className="text-[10px] font-semibold truncate max-w-[120px]" style={{ color: "var(--accent-l)" }}>{pos.name}</span>
                          )}
                        </div>
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          {pos.shares} acc · avg ${pos.avgPrice.toFixed(2)} · actual ${cur.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="font-black text-base" style={{ color: col }}>
                            {up ? "+" : ""}{pnlPct.toFixed(2)}%
                          </div>
                          <div className="text-xs font-semibold" style={{ color: col }}>
                            {up ? "+" : ""}{fmtMoney(pnl)}
                          </div>
                        </div>
                        <button onClick={() => { setSellModal({ ticker: pos.ticker, shares: pos.shares, price: cur }); setSellQty(""); }}
                                className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:opacity-80"
                                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}>
                          Vender
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {positions.length === 0 && trades.length === 0 && (
            <div className="rounded-2xl border p-10 flex flex-col items-center gap-3"
                 style={{ background: "var(--card)", borderColor: "var(--border)", borderStyle: "dashed" }}>
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(0,212,126,0.1)" }}>
                <TrendingUp className="w-6 h-6" style={{ color: "#00d47e" }} />
              </div>
              <p className="font-bold text-sm" style={{ color: "var(--text)" }}>Empieza a operar</p>
              <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
                Busca cualquier ticker arriba y compra a precios reales<br />
                con tus {fmtMoney(PAPER_INITIAL_CASH)} virtuales sin arriesgar dinero real
              </p>
            </div>
          )}

          {/* ── Historial de operaciones ── */}
          {trades.length > 0 && (
            <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                <Clock className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />
                <span className="text-sm font-bold" style={{ color: "var(--text)" }}>Historial</span>
                <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: "var(--raised)", color: "var(--muted)" }}>
                  {trades.length}
                </span>
              </div>
              {trades.slice(0, 20).map((t) => {
                const isBuy = t.type === "buy";
                const isDeposit = t.type !== "buy" && t.type !== "sell";
                const badgeColor = isBuy ? "#22c55e" : isDeposit ? "#3b82f6" : "#ef4444";
                const badgeLabel = isBuy ? "COMPRA" : isDeposit ? "DEPÓSITO" : "VENTA";
                return (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-3 border-t"
                       style={{ borderColor: "var(--border)" }}>
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-[10px] font-black"
                         style={{ background: `${badgeColor}15`, color: badgeColor }}>
                      {isBuy ? "C" : isDeposit ? "$" : "V"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold" style={{ color: "var(--text)" }}>
                          {t.ticker !== "CASH" ? t.ticker : "Recarga"}
                        </span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ background: `${badgeColor}15`, color: badgeColor }}>
                          {badgeLabel}
                        </span>
                      </div>
                      {t.shares > 0 && (
                        <div className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
                          {t.shares} acc @ ${t.price.toFixed(2)}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold" style={{ color: isBuy ? "#ef4444" : "#22c55e" }}>
                        {isBuy ? "-" : "+"}{fmtMoney(t.total)}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--dim)" }}>
                        {new Date(t.timestamp).toLocaleDateString("es")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Reset ── */}
          <div className="flex justify-end pb-2">
            <button onClick={() => { if (confirm("¿Reiniciar portfolio paper trading?")) reset(); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors hover:opacity-80"
                    style={{ borderColor: "rgba(239,68,68,0.2)", color: "#ef4444", background: "rgba(239,68,68,0.04)" }}>
              <RotateCcw className="w-3 h-3" />
              Reiniciar
            </button>
          </div>

        </main>
      </div>

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
