"use client";

import AppSidebar from "@/components/AppSidebar";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { market as marketApi, paperApi } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { usePaperStore, PAPER_INITIAL_CASH } from "@/lib/paperStore";
import { Search, Menu, X, RefreshCw, Loader2 } from "lucide-react";

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

  // Close dropdown on outside click
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
        <span className="font-semibold text-sm" style={{ color: "var(--sub)" }}>Paper Trading</span>
        <button onClick={loadPrices} className="p-2 rounded-lg hover:bg-[#0e1628] transition-colors" style={{ color: "var(--muted)" }}>
          <RefreshCw className={`w-4 h-4 ${loadingPrices ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <main className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4 max-w-4xl mx-auto w-full">

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Valor total", value: fmtMoney(portfolioValue), color: "var(--text)" },
              { label: "Efectivo",    value: fmtMoney(cash),           color: "var(--text)" },
              { label: "Posiciones",  value: fmtMoney(totalValue),     color: "var(--text)" },
              { label: "P&L total",   value: fmtMoney(totalPnl),       color: totalPnl >= 0 ? "var(--up)" : "var(--down)" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl p-3 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>{s.label}</div>
                <div className="font-bold text-sm" style={{ color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {totalReturn !== 0 && (
            <div className="text-xs" style={{ color: totalReturn >= 0 ? "var(--up)" : "var(--down)" }}>
              Retorno total: {totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(2)}%
            </div>
          )}

          {/* Search & buy */}
          <div className="rounded-xl border p-4 space-y-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>Comprar acciones</div>
            <div ref={searchWrapperRef} className="relative">
              <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                {loadingSuggestions || loadingPrice
                  ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" style={{ color: "var(--muted)" }} />
                  : <Search className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />}
                <input value={query} onChange={(e) => handleQueryChange(e.target.value)}
                       onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                       placeholder="Tesla, NVDA, Apple, TSLA…"
                       className="flex-1 bg-transparent outline-none text-sm"
                       style={{ color: "var(--text)" }} />
                {query && (
                  <button onClick={() => { setQuery(""); setSuggestions([]); setShowSuggestions(false); setTickerInfo(null); setSearchError(null); }}
                          style={{ color: "var(--muted)" }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Suggestions dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-xl overflow-hidden shadow-xl"
                     style={{ background: "#dbeafe", border: "1px solid #93c5fd" }}>
                  {suggestions.map((s, i) => (
                    <button key={s.ticker} onMouseDown={() => selectSuggestion(s)}
                            className="w-full flex items-center justify-between px-4 py-2.5 transition-colors text-left"
                            style={{ borderTop: i > 0 ? "1px solid #bfdbfe" : "none" }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#bfdbfe")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      <span className="font-bold text-sm" style={{ color: "#1d4ed8" }}>{s.ticker}</span>
                      <span className="text-xs ml-3 truncate max-w-[200px]" style={{ color: "#2563eb" }}>{s.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {searchError && <div className="text-xs" style={{ color: "var(--down)" }}>{searchError}</div>}

            {tickerInfo && !loadingPrice && (
              <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold" style={{ color: "var(--text)" }}>{tickerInfo.ticker}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>{tickerInfo.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold" style={{ color: "var(--text)" }}>${tickerInfo.price.toFixed(2)}</div>
                    <div className="text-xs" style={{ color: tickerInfo.change_pct >= 0 ? "var(--up)" : "var(--down)" }}>
                      {tickerInfo.change_pct >= 0 ? "▲" : "▼"}{Math.abs(tickerInfo.change_pct).toFixed(2)}%
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input value={buyQty} onChange={(e) => setBuyQty(e.target.value)}
                         placeholder="Cantidad" type="number" min="0.01" step="0.01"
                         className="flex-1 rounded-xl border px-3 py-2 text-sm outline-none"
                         style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }} />
                  <button onClick={handleBuy} disabled={!buyQty || parseFloat(buyQty) <= 0}
                          className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-40"
                          style={{ background: "var(--accent)" }}>
                    Comprar
                  </button>
                </div>
                {buyQty && parseFloat(buyQty) > 0 && (
                  <div className="text-xs" style={{ color: "var(--sub)" }}>
                    Total: <span className="font-bold" style={{ color: "var(--text)" }}>{fmtMoney(parseFloat(buyQty) * tickerInfo.price)}</span>
                    {" · "}Saldo: <span style={{ color: cash >= parseFloat(buyQty) * tickerInfo.price ? "var(--up)" : "var(--down)" }}>{fmtMoney(cash)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Positions */}
          {positions.length > 0 && (
            <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="px-4 py-3 border-b text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
                Posiciones ({positions.length})
              </div>
              {positions.map((pos) => {
                const cur    = posPrices[pos.ticker]?.price ?? pos.avgPrice;
                const pnl    = (cur - pos.avgPrice) * pos.shares;
                const pnlPct = ((cur - pos.avgPrice) / pos.avgPrice) * 100;
                return (
                  <div key={pos.ticker} className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: "var(--border)" }}>
                    <div>
                      <div className="font-bold text-sm" style={{ color: "var(--text)" }}>{pos.ticker}</div>
                      {pos.name && pos.name !== pos.ticker && (
                        <div className="text-[10px] font-medium truncate max-w-[140px]" style={{ color: "var(--accent-l)" }}>{pos.name}</div>
                      )}
                      <div className="text-xs" style={{ color: "var(--muted)" }}>{pos.shares} acc · avg ${pos.avgPrice.toFixed(2)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>${cur.toFixed(2)}</div>
                        <div className="text-xs" style={{ color: pnl >= 0 ? "var(--up)" : "var(--down)" }}>
                          {pnl >= 0 ? "+" : ""}{fmtMoney(pnl)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
                        </div>
                      </div>
                      <button onClick={() => { setSellModal({ ticker: pos.ticker, shares: pos.shares, price: cur }); setSellQty(""); }}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                              style={{ background: "rgba(255,71,87,0.12)", color: "var(--down)" }}>
                        Vender
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Trade history */}
          {trades.length > 0 && (
            <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="px-4 py-3 border-b text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
                Historial de operaciones
              </div>
              {trades.slice(0, 20).map((t) => (
                <div key={t.id} className="flex items-center justify-between px-4 py-2.5 border-t text-xs" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded font-bold" style={{
                      background: t.type === "buy" ? "rgba(0,212,126,0.12)" : t.type === "sell" ? "rgba(255,71,87,0.12)" : "rgba(77,159,255,0.12)",
                      color: t.type === "buy" ? "var(--up)" : t.type === "sell" ? "var(--down)" : "#4d9fff",
                    }}>
                      {t.type === "buy" ? "COMPRA" : t.type === "sell" ? "VENTA" : "DEPÓSITO"}
                    </span>
                    <span style={{ color: "var(--text)" }}>{t.ticker !== "CASH" ? t.ticker : ""}</span>
                    {t.shares > 0 && <span style={{ color: "var(--muted)" }}>{t.shares} acc @ ${t.price.toFixed(2)}</span>}
                  </div>
                  <div className="text-right">
                    <div style={{ color: "var(--text)" }}>{fmtMoney(t.total)}</div>
                    <div style={{ color: "var(--dim)" }}>{new Date(t.timestamp).toLocaleDateString("es")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Top up & reset */}
          <div className="flex gap-3 flex-wrap">
            {[1000, 5000, 10000].map((amt) => (
              <button key={amt} onClick={() => topUp(amt)}
                      className="px-4 py-2 rounded-xl text-sm font-semibold border transition-colors hover:bg-[#0e1628]"
                      style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
                +{fmtMoney(amt)}
              </button>
            ))}
            <button onClick={() => { if (confirm("¿Reiniciar portfolio paper trading?")) reset(); }}
                    className="px-4 py-2 rounded-xl text-sm font-semibold border transition-colors hover:bg-[#1a0a0a]"
                    style={{ borderColor: "rgba(255,71,87,0.3)", color: "var(--down)" }}>
              Reiniciar
            </button>
          </div>

        </main>
      </div>

      {/* Sell modal */}
      {sellModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="w-full max-w-sm rounded-2xl border p-5 space-y-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="text-base font-bold" style={{ color: "var(--text)" }}>Vender {sellModal.ticker}</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              Precio actual: <span className="font-bold" style={{ color: "var(--text)" }}>${sellModal.price.toFixed(2)}</span>
              {" · "}Tienes {sellModal.shares} acciones
            </div>
            <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
              <input value={sellQty} onChange={(e) => setSellQty(e.target.value)} type="number"
                     placeholder={`1 – ${sellModal.shares}`} autoFocus
                     className="flex-1 bg-transparent outline-none text-sm" style={{ color: "var(--text)" }} />
              <button onClick={() => setSellQty(String(sellModal.shares))}
                      className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{ color: "var(--accent-l)", background: "rgba(0,212,126,0.1)" }}>
                MAX
              </button>
            </div>
            {sellQty && parseFloat(sellQty) > 0 && (
              <div className="text-xs" style={{ color: "var(--sub)" }}>
                Recibirás: <span className="font-bold" style={{ color: "var(--up)" }}>{fmtMoney(parseFloat(sellQty) * sellModal.price)}</span>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setSellModal(null)}
                      className="flex-1 py-2.5 rounded-xl border text-sm font-semibold"
                      style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                Cancelar
              </button>
              <button onClick={handleSell}
                      disabled={!sellQty || parseFloat(sellQty) <= 0 || parseFloat(sellQty) > sellModal.shares}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                      style={{ background: "var(--down)" }}>
                Vender
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
