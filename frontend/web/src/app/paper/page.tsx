"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { market as marketApi, paperApi } from "@/lib/api";
import { useAuthStore, useNotificationStore } from "@/lib/store";
import { usePaperStore, PAPER_INITIAL_CASH } from "@/lib/paperStore";
import {
  TrendingUp, Search, BookOpen, PieChart, BarChart2, Bell, User, Menu, X,
  RefreshCw, GraduationCap, Trophy, Lightbulb,
} from "lucide-react";

interface TickerInfo { ticker: string; name: string; price: number; change_pct: number; }
interface PriceMap { [ticker: string]: { price: number | null; change_pct: number } }
interface LeagueEntry {
  rank: number; alias: string; returnPct: number;
  topHolding: string; rankChange: number; isMe?: boolean;
}

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const neg = n < 0 ? "-" : "";
  if (abs >= 1e6) return `${neg}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${neg}$${(abs / 1e3).toFixed(2)}K`;
  return `${neg}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const NAV = [
  { href: "/chat",          icon: BookOpen,      label: "Chat" },
  { href: "/portfolio",     icon: PieChart,      label: "Portafolio" },
  { href: "/paper",         icon: BarChart2,     label: "Paper Trading" },
  { href: "/learn",         icon: GraduationCap, label: "Aprendizaje" },
  { href: "/arena",         icon: Trophy,        label: "Arena" },
  { href: "/notifications", icon: Bell,          label: "Notificaciones" },
  { href: "/profile",       icon: User,          label: "Perfil" },
];

// ─── Liga mock data (reemplazar con GET /paper/leaderboard cuando exista el backend) ──
const MOCK_OTHERS = [
  { alias: "InversorPro",    returnPct: 18.4, topHolding: "NVDA",  rankChange:  0 },
  { alias: "TauroMX",        returnPct: 14.2, topHolding: "AAPL",  rankChange:  2 },
  { alias: "BullMkt99",      returnPct: 11.8, topHolding: "MSFT",  rankChange: -1 },
  { alias: "WallStLearner",  returnPct:  9.3, topHolding: "TSLA",  rankChange:  1 },
  { alias: "PipoCapital",    returnPct:  7.1, topHolding: "AMZN",  rankChange:  3 },
  { alias: "Sigma_Returns",  returnPct:  5.8, topHolding: "GOOGL", rankChange:  0 },
  { alias: "CrackMercado",   returnPct:  4.6, topHolding: "META",  rankChange: -2 },
  { alias: "PatternBreaker", returnPct:  2.1, topHolding: "BRK-B", rankChange:  0 },
  { alias: "ETFQueen",       returnPct:  1.4, topHolding: "SPY",   rankChange:  4 },
  { alias: "LongTermLeo",    returnPct: -0.8, topHolding: "BABA",  rankChange: -3 },
];

const LEAGUE_LESSONS: Record<"week" | "month" | "all", string> = {
  week:  "Los líderes concentraron en semiconductores (NVDA, AMD +8.2% esta semana). Apostar a un sector en tendencia clara pagó.",
  month: "Los portfolios top mantuvieron Big Tech (MSFT, AAPL, META) sin rotar. Paciencia > timing de mercado.",
  all:   "Los mejores inversores balancearon crecimiento y dividendos desde el inicio. La consistencia supera al timing.",
};

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
const TOTAL_PARTICIPANTS = 847;

// ─── LeaderRow ────────────────────────────────────────────────────────────────
function LeaderRow({ entry }: { entry: LeagueEntry }) {
  const medal = MEDALS[entry.rank];
  const up = entry.returnPct >= 0;
  return (
    <div
      className="flex items-center px-4 py-3 border-t"
      style={{
        borderColor: "var(--border)",
        background: entry.isMe
          ? "rgba(0,168,94,0.07)"
          : entry.rank === 1 ? "rgba(251,191,36,0.03)" : "transparent",
      }}
    >
      {/* Rank */}
      <div className="w-8 shrink-0 text-center">
        {medal
          ? <span className="text-base leading-none">{medal}</span>
          : <span className="text-xs font-bold" style={{ color: "var(--dim)" }}>#{entry.rank}</span>}
      </div>

      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center mx-2.5 text-[11px] font-black shrink-0"
        style={{
          background: entry.isMe ? "var(--accent)" : entry.rank <= 3 ? "rgba(251,191,36,0.18)" : "var(--raised)",
          color: entry.isMe ? "white" : entry.rank <= 3 ? "#fbbf24" : "var(--muted)",
        }}
      >
        {entry.alias[0].toUpperCase()}
      </div>

      {/* Name + holding */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold truncate"
            style={{ color: entry.isMe ? "var(--accent-l)" : "var(--text)" }}>
            {entry.isMe ? "Tú" : entry.alias}
          </span>
          {entry.isMe && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0"
              style={{ background: "rgba(0,168,94,0.15)", color: "var(--accent-l)" }}>★</span>
          )}
        </div>
        <div className="text-[11px]" style={{ color: "var(--dim)" }}>Top: {entry.topHolding}</div>
      </div>

      {/* Return + rank change */}
      <div className="text-right shrink-0">
        <div className="text-sm font-bold" style={{ color: up ? "var(--up)" : "var(--down)" }}>
          {up ? "+" : ""}{entry.returnPct.toFixed(1)}%
        </div>
        <div className="text-[11px] font-semibold"
          style={{ color: entry.rankChange > 0 ? "var(--up)" : entry.rankChange < 0 ? "var(--down)" : "var(--dim)" }}>
          {entry.rankChange > 0 ? `↑${entry.rankChange}` : entry.rankChange < 0 ? `↓${Math.abs(entry.rankChange)}` : "—"}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function PaperPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useAuthStore();
  const { notifications } = useNotificationStore();
  const { cash, positions, trades, buy, sell, topUp, reset } = usePaperStore();

  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [query, setQuery]               = useState("");
  const [tickerInfo, setTickerInfo]     = useState<TickerInfo | null>(null);
  const [searching, setSearching]       = useState(false);
  const [searchError, setSearchError]   = useState<string | null>(null);
  const [buyQty, setBuyQty]             = useState("");
  const [sellModal, setSellModal]       = useState<{ ticker: string; shares: number; price: number } | null>(null);
  const [sellQty, setSellQty]           = useState("");
  const [posPrices, setPosPrices]       = useState<PriceMap>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [activeTab, setActiveTab]       = useState<"portfolio" | "liga">("portfolio");
  const [leaguePeriod, setLeaguePeriod] = useState<"week" | "month" | "all">("week");
  const [leagueData, setLeagueData]     = useState<LeagueEntry[]>([]);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => { if (!isAuthenticated) router.push("/"); }, [isAuthenticated]);

  // Sync paper state to backend silently after each trade
  const syncPaper = useCallback(() => {
    const { cash: c, positions: p, trades: t } = usePaperStore.getState();
    paperApi.syncState(c, p, t).catch(() => {});
  }, []);

  const loadLeaderboard = useCallback(async () => {
    setLeagueLoading(true);
    try {
      const res = await paperApi.getLeaderboard();
      setLeagueData(res.data as LeagueEntry[]);
    } catch {}
    setLeagueLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab === "liga" && leagueData.length === 0) loadLeaderboard();
  }, [activeTab]);

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

  const searchTicker = useCallback((raw: string) => {
    const t = raw.trim().toUpperCase();
    if (!t) { setTickerInfo(null); setSearchError(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true); setSearchError(null); setTickerInfo(null);
      try {
        const res = await marketApi.getPrices([t]);
        const d = res.data[t];
        if (d?.price) setTickerInfo({ ticker: t, name: t, price: d.price, change_pct: d.change_pct ?? 0 });
        else setSearchError("Ticker no encontrado");
      } catch { setSearchError("No se pudo obtener precio"); }
      setSearching(false);
    }, 500);
  }, []);

  const handleQueryChange = (v: string) => { setQuery(v.toUpperCase()); setBuyQty(""); searchTicker(v); };

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

  // Liga — usa datos reales del API; cae en mock si aún no cargó
  const allLeagueEntries = useMemo<LeagueEntry[]>(() => {
    if (leagueData.length > 0) return leagueData;
    // Fallback local mientras carga o sin conexión
    const me = {
      alias: "Tú", returnPct: parseFloat(totalReturn.toFixed(1)),
      topHolding: positions[0]?.ticker ?? "—", rankChange: 0, isMe: true, rank: 0,
    };
    return [...MOCK_OTHERS, me]
      .sort((a, b) => b.returnPct - a.returnPct)
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }, [leagueData, totalReturn, positions]);

  const myEntry      = allLeagueEntries.find((e) => e.isMe)!;
  const top5         = allLeagueEntries.slice(0, 5);
  const showEllipsis = myEntry?.rank > 5;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="border-b flex items-center justify-between px-4 py-2 shrink-0"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1" style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
              <TrendingUp className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvo</span>
          </div>
        </div>
        <span className="font-semibold text-sm" style={{ color: "var(--sub)" }}>Paper Trading</span>
        <button onClick={loadPrices} className="p-2 rounded-lg hover:bg-[#0e1628] transition-colors" style={{ color: "var(--muted)" }}>
          <RefreshCw className={`w-4 h-4 ${loadingPrices ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? "flex" : "hidden"} lg:flex w-60 border-r flex-col py-4 absolute lg:relative z-20 h-full`}
          style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <nav className="flex-1 px-2 space-y-0.5">
            {NAV.map(({ href, icon: Icon, label }) => {
              const active = pathname === href;
              const badge  = href === "/notifications" && unreadCount > 0;
              return (
                <button key={href} onClick={() => { router.push(href); setSidebarOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
                  style={{ background: active ? "rgba(0,168,94,0.12)" : "transparent", color: active ? "var(--accent-l)" : "var(--muted)" }}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                  {badge && <span className="ml-auto w-4 h-4 rounded-full text-white text-[10px] flex items-center justify-center font-bold" style={{ background: "var(--accent)" }}>{unreadCount}</span>}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4 max-w-4xl mx-auto w-full">

          {/* ── Tab switcher ── */}
          <div className="flex p-1 rounded-xl gap-1" style={{ background: "var(--raised)" }}>
            <button
              onClick={() => setActiveTab("portfolio")}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: activeTab === "portfolio" ? "var(--card)" : "transparent",
                color: activeTab === "portfolio" ? "var(--text)" : "var(--muted)",
              }}
            >
              Mi Portafolio
            </button>
            <button
              onClick={() => setActiveTab("liga")}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-1.5"
              style={{
                background: activeTab === "liga" ? "var(--card)" : "transparent",
                color: activeTab === "liga" ? "var(--accent-l)" : "var(--muted)",
              }}
            >
              <Trophy className="w-3.5 h-3.5" />
              Liga
            </button>
          </div>

          {/* ══════════════════ PORTAFOLIO TAB ══════════════════ */}
          {activeTab === "portfolio" && (
            <>
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
                <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                  <Search className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
                  <input value={query} onChange={(e) => handleQueryChange(e.target.value)}
                    placeholder="Busca ticker: NVDA, AAPL, TSLA…"
                    className="flex-1 bg-transparent outline-none text-sm"
                    style={{ color: "var(--text)" }} />
                </div>

                {searching && <div className="text-xs" style={{ color: "var(--muted)" }}>Buscando…</div>}
                {searchError && !searching && <div className="text-xs" style={{ color: "var(--down)" }}>{searchError}</div>}

                {tickerInfo && !searching && (
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
                          <div className="text-xs" style={{ color: "var(--muted)" }}>{pos.shares} acc · avg ${pos.avgPrice.toFixed(2)}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>${cur.toFixed(2)}</div>
                            <div className="text-xs" style={{ color: pnl >= 0 ? "var(--up)" : "var(--down)" }}>
                              {pnl >= 0 ? "+" : ""}{fmtMoney(pnl)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
                            </div>
                          </div>
                          <button
                            onClick={() => { setSellModal({ ticker: pos.ticker, shares: pos.shares, price: cur }); setSellQty(""); }}
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
            </>
          )}

          {/* ══════════════════ LIGA TAB ══════════════════ */}
          {activeTab === "liga" && (
            <div className="space-y-3">

              {/* League header with refresh */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                  {leagueData.length > 0 ? `${leagueData.length} inversores en tiempo real` : "Cargando ranking…"}
                </span>
                <button onClick={loadLeaderboard} disabled={leagueLoading}
                  className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                  style={{ color: "var(--muted)" }}>
                  <RefreshCw className={`w-3.5 h-3.5 ${leagueLoading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {/* Period selector */}
              <div className="flex gap-1.5">
                {([
                  { id: "week",  label: "Esta semana" },
                  { id: "month", label: "Este mes" },
                  { id: "all",   label: "Todo tiempo" },
                ] as const).map((p) => (
                  <button key={p.id} onClick={() => setLeaguePeriod(p.id)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border"
                    style={{
                      background:   leaguePeriod === p.id ? "rgba(0,168,94,0.12)" : "transparent",
                      borderColor:  leaguePeriod === p.id ? "rgba(0,168,94,0.4)"  : "var(--border)",
                      color:        leaguePeriod === p.id ? "var(--accent-l)"      : "var(--muted)",
                    }}>
                    {p.label}
                  </button>
                ))}
              </div>

              {/* My rank card */}
              <div className="rounded-xl border p-4"
                style={{
                  background:   (myEntry?.returnPct ?? 0) >= 0 ? "rgba(0,168,94,0.07)"  : "rgba(255,71,87,0.07)",
                  borderColor:  (myEntry?.returnPct ?? 0) >= 0 ? "rgba(0,168,94,0.25)"  : "rgba(255,71,87,0.25)",
                }}>
                <div className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--muted)" }}>
                  Tu posición
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black" style={{ color: "var(--text)" }}>
                      #{myEntry?.rank ?? "—"}
                    </span>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      de {TOTAL_PARTICIPANTS.toLocaleString()} inversores
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black"
                      style={{ color: (myEntry?.returnPct ?? 0) >= 0 ? "var(--up)" : "var(--down)" }}>
                      {(myEntry?.returnPct ?? 0) >= 0 ? "+" : ""}{(myEntry?.returnPct ?? 0).toFixed(1)}%
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "#f59e0b" }}>
                      ↑ Subiste 2 posiciones esta semana
                    </div>
                  </div>
                </div>
              </div>

              {/* Lesson card */}
              <div className="rounded-xl border p-3.5"
                style={{ background: "rgba(59,130,246,0.05)", borderColor: "rgba(59,130,246,0.2)" }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <Lightbulb className="w-3.5 h-3.5 shrink-0" style={{ color: "#60a5fa" }} />
                  <span className="text-xs font-bold" style={{ color: "#60a5fa" }}>Lección del mercado</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
                  {LEAGUE_LESSONS[leaguePeriod]}
                </p>
              </div>

              {/* Leaderboard table */}
              <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="px-4 py-3 border-b flex items-center justify-between"
                  style={{ borderColor: "var(--border)" }}>
                  <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>Tabla de líderes</span>
                  <span className="text-xs" style={{ color: "var(--dim)" }}>
                    {TOTAL_PARTICIPANTS.toLocaleString()} inversores · retorno % desde $10K
                  </span>
                </div>
                {top5.map((entry) => <LeaderRow key={entry.rank} entry={entry} />)}
                {showEllipsis && (
                  <>
                    <div className="px-4 py-2 text-center text-sm tracking-widest" style={{ color: "var(--dim)" }}>
                      · · ·
                    </div>
                    {myEntry && <LeaderRow entry={myEntry} />}
                  </>
                )}
              </div>

              <p className="text-[11px] text-center pb-2" style={{ color: "var(--dim)" }}>
                Ranking en tiempo real · Todos empiezan con $10,000 virtuales
              </p>
            </div>
          )}

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
