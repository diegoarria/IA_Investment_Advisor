"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp, TrendingDown, Sparkles, BookOpen,
  Bell, ChevronRight, GraduationCap, Newspaper, Target, Flame,
} from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import StockAvatar from "@/components/StockAvatar";
import { market as marketApi, notifications as notifApi } from "@/lib/api";
import { useAuthStore, useProfileStore, useLearnStore, useSubscriptionStore } from "@/lib/store";
import { usePortfolioStore } from "@/lib/portfolioStore";

// ── Helpers ───────────────────────────────────────────────────────────────────

const CURRENCY_SYM: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", JPY: "¥", MXN: "$", ARS: "$", BRL: "R$",
};

function fmt(n: number, currency = "USD") {
  const sym = CURRENCY_SYM[currency] ?? "$";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(2)}M`;
  return `${sign}${sym}${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function isNYSEOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const etH = now.getUTCHours() - 4;
  const etM = now.getUTCMinutes();
  const mins = etH * 60 + etM;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

function notifIcon(type: string): string {
  if (type === "price_alert") return "📈";
  if (type === "earnings")    return "📊";
  if (type === "news")        return "📰";
  if (type === "portfolio")   return "💼";
  if (type === "dividend")    return "💰";
  return "🔔";
}

function timeAgo(ts: string | number): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "ahora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const DAILY_LESSONS = [
  { emoji: "🥧", title: "Diversificación" },
  { emoji: "📅", title: "Dollar Cost Averaging" },
  { emoji: "💰", title: "Dividendos" },
  { emoji: "📈", title: "Análisis Fundamental" },
  { emoji: "🛡️", title: "Ventaja Competitiva" },
  { emoji: "⚠️", title: "Aversión a la Pérdida" },
  { emoji: "🔄", title: "Rebalanceo" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { profile } = useProfileStore();
  const { positions, portfolioCurrency } = usePortfolioStore();
  const streak = useLearnStore((s) => s.streak);
  useSubscriptionStore();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [prices, setPrices]       = useState<Record<string, any>>({});
  const [indices, setIndices]     = useState<any[]>([]);
  const [news, setNews]           = useState<any[]>([]);
  const [unread, setUnread]       = useState(0);
  const [topNotifs, setTopNotifs] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const marketOpen = useMemo(() => isNYSEOpen(), []);

  const sym = CURRENCY_SYM[portfolioCurrency] ?? "$";
  const dailyLesson = DAILY_LESSONS[new Date().getDay() % DAILY_LESSONS.length];

  useEffect(() => {
    if (!isAuthenticated) { router.push("/"); return; }
  }, [isAuthenticated]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const tickers = positions.map((p) => p.ticker);
      const [priceRes, idxRes, notifRes] = await Promise.allSettled([
        tickers.length ? marketApi.getPrices(tickers) : Promise.resolve({ data: {} }),
        marketApi.getIndices(),
        notifApi.getAll(),
      ]);
      if (priceRes.status === "fulfilled")  setPrices(priceRes.value.data ?? {});
      if (idxRes.status  === "fulfilled")   setIndices(idxRes.value.data ?? []);
      if (notifRes.status === "fulfilled") {
        const d = notifRes.value.data;
        setUnread(d?.unread_count ?? 0);
        const items: any[] = d?.notifications ?? d?.items ?? [];
        setTopNotifs(items.slice(0, 2));
      }

      if (tickers.length) {
        const newsRes = await marketApi.getNews(tickers.slice(0, 6)).catch(() => null);
        if (newsRes) setNews((newsRes.data?.articles ?? newsRes.data?.news ?? []).slice(0, 6));
      }
    } catch {}
    setLoading(false);
  }, [positions]);

  useEffect(() => { loadData(); }, [loadData]);

  // Refresh prices + indices every 30s (no news/notifs to avoid hammering API)
  useEffect(() => {
    const tick = () => {
      const tickers = positions.map((p) => p.ticker);
      if (tickers.length) {
        marketApi.getPrices(tickers)
          .then((res) => { if (res?.data) setPrices(res.data ?? {}); })
          .catch(() => {});
      }
      marketApi.getIndices()
        .then((res) => { if (res?.data) setIndices(res.data ?? []); })
        .catch(() => {});
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [positions]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Computed portfolio totals ───────────────────────────────────────────────
  const { total, dayGain, dayGainPct, totalGain, totalGainPct } = useMemo(() => {
    if (!positions.length) return { total: 0, dayGain: 0, dayGainPct: 0, totalGain: 0, totalGainPct: 0 };
    let total = 0, dayGain = 0, costBasis = 0;
    for (const p of positions) {
      const px   = prices[p.ticker];
      const curr = px?.price ?? p.avgPrice;
      const cp   = px?.change_pct ?? 0;
      const prev = cp !== -100 ? curr / (1 + cp / 100) : curr;
      total     += curr * p.shares;
      dayGain   += (curr - prev) * p.shares;
      costBasis += p.avgPrice * p.shares;
    }
    const dayGainPct   = total > 0 ? (dayGain / (total - dayGain)) * 100 : 0;
    const totalGain    = total - costBasis;
    const totalGainPct = costBasis > 0 ? (totalGain / costBasis) * 100 : 0;
    return { total, dayGain, dayGainPct, totalGain, totalGainPct };
  }, [positions, prices]);

  // ── Top gainers today (sorted by % change desc, top 4) ────────────────────
  const movers = useMemo(() => {
    return [...positions]
      .map((p) => {
        const px   = prices[p.ticker];
        const curr = px?.price ?? p.avgPrice;
        const cp   = px?.change_pct ?? 0;
        const prev = cp !== -100 ? curr / (1 + cp / 100) : curr;
        const chg  = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
        return { ...p, curr, chg };
      })
      .filter((m) => m.chg > 0)
      .sort((a, b) => b.chg - a.chg)
      .slice(0, 4);
  }, [positions, prices]);

  // ── Goal ───────────────────────────────────────────────────────────────────
  const goalName   = profile?.investment_goal ?? null;
  const goalAmount = parseFloat(profile?.investment_goal_amount ?? "0") || 0;
  const goalPct    = goalAmount > 0 ? Math.min(100, (total / goalAmount) * 100) : 0;

  const firstName = profile?.name?.split(" ")[0] ?? "Inversor";

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        <main className="flex-1 overflow-y-auto">
          {/* ── Sticky Header ──────────────────────────────────────────────── */}
          <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between border-b"
               style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Tu resumen de hoy
              </p>
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
                {greeting()}, {firstName} 👋
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border"
                   style={{
                     borderColor: marketOpen ? "rgba(34,197,94,0.3)" : "var(--border)",
                     color: marketOpen ? "#22c55e" : "var(--dim)",
                     background: marketOpen ? "rgba(34,197,94,0.06)" : "transparent",
                   }}>
                <span className="w-1.5 h-1.5 rounded-full"
                      style={{ background: marketOpen ? "#22c55e" : "var(--dim)" }} />
                {marketOpen ? "Mercado abierto" : "Mercado cerrado"}
              </div>
              <button onClick={() => router.push("/notifications")}
                      className="relative w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
                      style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                <Bell className="w-4 h-4" style={{ color: "var(--sub)" }} />
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-black text-white flex items-center justify-center"
                        style={{ background: "#ef4444" }}>
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="px-6 py-5 space-y-5 max-w-5xl mx-auto">

            {/* ── Stat Strip ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-4 gap-3">
              {/* Portfolio day */}
              <button onClick={() => router.push("/patrimonio")}
                      className="flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all hover:border-[var(--accent)]"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                {dayGain >= 0
                  ? <TrendingUp className="w-5 h-5 shrink-0" style={{ color: "#22c55e" }} />
                  : <TrendingDown className="w-5 h-5 shrink-0" style={{ color: "#ef4444" }} />
                }
                <div className="text-left min-w-0">
                  <p className="text-sm font-black leading-none"
                     style={{ color: dayGain >= 0 ? "#22c55e" : "#ef4444" }}>
                    {loading ? "—" : fmtPct(dayGainPct)}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>Portafolio hoy</p>
                </div>
              </button>

              {/* Racha */}
              <button onClick={() => router.push("/academy")}
                      className="flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all hover:border-[var(--accent)]"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <span className="text-xl shrink-0">{streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "✨"}</span>
                <div className="text-left min-w-0">
                  <p className="text-sm font-black leading-none"
                     style={{ color: streak > 0 ? "#f59e0b" : "var(--text)" }}>
                    {streak} días
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>Racha</p>
                </div>
              </button>

              {/* Meta */}
              <button onClick={() => router.push("/profile")}
                      className="flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all hover:border-[var(--accent)]"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <Target className="w-5 h-5 shrink-0" style={{ color: "var(--accent-l)" }} />
                <div className="text-left min-w-0">
                  <p className="text-sm font-black leading-none truncate"
                     style={{ color: "var(--text)" }}>
                    {goalName ?? "Sin meta"}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
                    {goalPct > 0 ? `${goalPct.toFixed(0)}% completado` : "Meta"}
                  </p>
                </div>
              </button>

              {/* Alertas */}
              <button onClick={() => router.push("/notifications")}
                      className="flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all hover:border-[var(--accent)]"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <Bell className="w-5 h-5 shrink-0"
                      style={{ color: unread > 0 ? "#ef4444" : "var(--sub)" }} />
                <div className="text-left min-w-0">
                  <p className="text-sm font-black leading-none"
                     style={{ color: unread > 0 ? "#ef4444" : "var(--text)" }}>
                    {unread > 0 ? `${unread} nuevas` : "Sin alertas"}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>Notificaciones</p>
                </div>
              </button>
            </div>

            {/* ── Main grid: Portfolio hero + Key stats ───────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Portfolio hero (2/3) */}
              <button onClick={() => router.push("/patrimonio")}
                      className="lg:col-span-2 text-left rounded-2xl p-5 border transition-all hover:border-[var(--accent)] group relative"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>
                  Mi Portafolio
                </p>
                {loading ? (
                  <div className="h-10 w-44 rounded-lg animate-pulse" style={{ background: "var(--raised)" }} />
                ) : (
                  <p className="text-4xl font-black tracking-tight" style={{ color: "var(--text)" }}>
                    {fmt(total, portfolioCurrency)}
                  </p>
                )}

                {!loading && (
                  <div className="flex gap-5 mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                    <div>
                      <p className="text-[11px]" style={{ color: "var(--muted)" }}>Hoy</p>
                      <p className="text-sm font-bold" style={{ color: dayGain >= 0 ? "#22c55e" : "#ef4444" }}>
                        {dayGain >= 0 ? "+" : ""}{fmt(dayGain, portfolioCurrency)} ({fmtPct(dayGainPct)})
                      </p>
                    </div>
                    {positions.length > 0 && (
                      <>
                        <div>
                          <p className="text-[11px]" style={{ color: "var(--muted)" }}>Total</p>
                          <p className="text-sm font-bold" style={{ color: totalGain >= 0 ? "#22c55e" : "#ef4444" }}>
                            {totalGain >= 0 ? "+" : ""}{fmt(totalGain, portfolioCurrency)} ({fmtPct(totalGainPct)})
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px]" style={{ color: "var(--muted)" }}>Posiciones</p>
                          <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{positions.length}</p>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {!loading && !positions.length && (
                  <div className="mt-3 pt-3 border-t border-dashed" style={{ borderColor: "var(--border)" }}>
                    <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>Empieza agregando acciones:</p>
                    <div className="flex flex-wrap gap-2">
                      {["AAPL", "NVDA", "MSFT", "TSLA", "GOOGL"].map((t) => (
                        <span key={t} className="text-xs font-bold px-2.5 py-1 rounded-lg border"
                              style={{ borderColor: "var(--border)", color: "var(--accent-l)", background: "var(--raised)" }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{ color: "var(--dim)" }} />
              </button>

              {/* Right column: 3 key stat cards */}
              <div className="flex flex-col gap-3">

                {/* 🎯 Meta */}
                <button onClick={() => router.push("/profile")}
                        className="flex-1 flex items-center gap-3 px-4 py-4 rounded-xl border transition-all hover:border-[var(--accent)] text-left"
                        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                       style={{ background: "rgba(0,212,126,0.12)" }}>
                    <Target className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: "var(--muted)" }}>Meta</p>
                    <p className="text-sm font-black truncate" style={{ color: "var(--text)" }}>
                      {goalName ?? "Configura tu meta"}
                    </p>
                    {goalPct > 0 && (
                      <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--raised)" }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${goalPct}%`, background: "var(--accent)" }} />
                      </div>
                    )}
                    {goalPct > 0 && (
                      <p className="text-[10px] mt-1" style={{ color: "var(--muted)" }}>{goalPct.toFixed(0)}% completado</p>
                    )}
                  </div>
                </button>

                {/* 🔥 Racha */}
                <button onClick={() => router.push("/academy")}
                        className="flex-1 flex items-center gap-3 px-4 py-4 rounded-xl border transition-all hover:border-[var(--accent)] text-left"
                        style={{ background: "var(--card)", borderColor: streak > 0 ? "rgba(245,158,11,0.3)" : "var(--border)" }}>
                  <div className="w-10 h-10 rounded-full border-2 flex items-center justify-center text-xl shrink-0"
                       style={{ borderColor: streak > 0 ? "#f59e0b" : "var(--border)" }}>
                    {streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "✨"}
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: "var(--muted)" }}>Racha</p>
                    <p className="text-xl font-black leading-none" style={{ color: streak > 0 ? "#f59e0b" : "var(--text)" }}>
                      {streak} días
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
                      {streak === 0 ? "¡Empieza hoy!" : "seguidos"}
                    </p>
                  </div>
                </button>

                {/* 📚 Lección del día */}
                <button onClick={() => router.push("/academy")}
                        className="flex-1 flex items-center gap-3 px-4 py-4 rounded-xl border transition-all hover:border-[var(--accent)] text-left"
                        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                       style={{ background: "rgba(124,58,237,0.1)" }}>
                    {dailyLesson.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: "var(--muted)" }}>Lección del día</p>
                    <p className="text-sm font-black truncate" style={{ color: "var(--text)" }}>{dailyLesson.title}</p>
                    <p className="text-[10px] mt-0.5 font-semibold" style={{ color: "var(--accent-l)" }}>Aprender →</p>
                  </div>
                </button>
              </div>
            </div>

            {/* ── Lo más importante hoy ────────────────────────────────────── */}
            {topNotifs.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold flex items-center gap-1.5" style={{ color: "var(--text)" }}>
                    <Bell className="w-4 h-4" style={{ color: "var(--muted)" }} />
                    Lo más importante hoy
                  </h2>
                  <button onClick={() => router.push("/notifications")}
                          className="text-xs font-semibold" style={{ color: "var(--accent-l)" }}>
                    Ver todo →
                  </button>
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  {topNotifs.map((n: any, i: number) => (
                    <button key={n.id ?? i}
                            onClick={() => router.push("/notifications")}
                            className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:opacity-80 transition-opacity ${i > 0 ? "border-t" : ""}`}
                            style={{ borderColor: "var(--border)" }}>
                      <span className="text-lg shrink-0 mt-0.5">{notifIcon(n.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold" style={{ color: "var(--text)" }}>{n.title}</p>
                        {n.body && (
                          <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: "var(--muted)" }}>{n.body}</p>
                        )}
                      </div>
                      {n.created_at && (
                        <p className="text-[10px] shrink-0 mt-0.5" style={{ color: "var(--dim)" }}>
                          {timeAgo(n.created_at)}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Market Indices ──────────────────────────────────────────── */}
            {indices.length > 0 && (
              <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin">
                {indices.map((idx) => {
                  const up = idx.change_pct >= 0;
                  return (
                    <div key={idx.symbol} className="flex-shrink-0 rounded-xl px-4 py-3 border min-w-[110px]"
                         style={{
                           background: "var(--card)",
                           borderColor: up ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)",
                         }}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                        {idx.name}
                      </p>
                      {idx.price != null && (
                        <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text)" }}>
                          {idx.price >= 1000 ? (idx.price / 1000).toFixed(1) + "K" : idx.price.toFixed(2)}
                        </p>
                      )}
                      <p className="text-xs font-semibold" style={{ color: up ? "#22c55e" : "#ef4444" }}>
                        {up ? "+" : ""}{idx.change_pct.toFixed(2)}%
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Quick Actions ────────────────────────────────────────────── */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { icon: BookOpen,       label: "Pregunta algo",  sub: "Mentor IA",    href: "/chat",                accent: true  },
                { icon: Sparkles,       label: "Mi dinero",      sub: "Patrimonio",   href: "/patrimonio",          accent: false },
                { icon: GraduationCap,  label: "Aprender",       sub: "Academy",      href: "/academy",             accent: false },
                { icon: Flame,          label: "Mi perfil",      sub: "Stats",        href: "/profile",             accent: false },
              ].map(({ icon: Icon, label, sub, href, accent }) => (
                <button key={href}
                        onClick={() => router.push(href)}
                        className="flex flex-col items-start p-3.5 rounded-xl border transition-all hover:scale-[1.02]"
                        style={{
                          background: accent ? "rgba(0,212,126,0.07)" : "var(--card)",
                          borderColor: accent ? "rgba(0,212,126,0.3)" : "var(--border)",
                        }}>
                  <Icon className="w-5 h-5 mb-2" style={{ color: accent ? "var(--accent-l)" : "var(--sub)" }} />
                  <p className="text-xs font-bold leading-tight" style={{ color: "var(--text)" }}>{label}</p>
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>{sub}</p>
                </button>
              ))}
            </div>

            {/* ── Top movers ──────────────────────────────────────────────── */}
            {positions.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold" style={{ color: "var(--text)" }}>📈 Subiendo hoy</h2>
                  <button onClick={() => router.push("/patrimonio")}
                          className="text-xs font-semibold" style={{ color: "var(--accent-l)" }}>
                    Ver todo →
                  </button>
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  {loading
                    ? [0,1,2].map((i) => (
                        <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 animate-pulse"
                             style={{ borderColor: "var(--border)" }}>
                          <div className="w-9 h-9 rounded-xl" style={{ background: "var(--raised)" }} />
                          <div className="flex-1 space-y-1.5">
                            <div className="h-3 w-16 rounded" style={{ background: "var(--raised)" }} />
                            <div className="h-2.5 w-24 rounded" style={{ background: "var(--raised)" }} />
                          </div>
                          <div className="h-5 w-12 rounded" style={{ background: "var(--raised)" }} />
                        </div>
                      ))
                    : movers.length === 0
                    ? (
                        <div className="px-4 py-5 text-center">
                          <p className="text-sm" style={{ color: "var(--muted)" }}>
                            Sin posiciones al alza hoy
                          </p>
                        </div>
                      )
                    : movers.map((m) => (
                        <div key={m.ticker}
                             className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 cursor-pointer hover:opacity-80 transition-opacity"
                             style={{ borderColor: "var(--border)" }}
                             onClick={() => router.push("/patrimonio")}>
                          <StockAvatar ticker={m.ticker} size="sm" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{m.ticker}</p>
                            <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{(m as any).name ?? m.ticker}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{sym}{m.curr.toFixed(2)}</p>
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                                  style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
                              +{m.chg.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      ))
                  }
                </div>
              </div>
            )}

            {/* ── Portfolio news ───────────────────────────────────────────── */}
            {news.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold flex items-center gap-1.5" style={{ color: "var(--text)" }}>
                    <Newspaper className="w-4 h-4" style={{ color: "var(--muted)" }} />
                    Noticias de tu portafolio
                  </h2>
                  <button onClick={() => router.push("/notifications")}
                          className="text-xs font-semibold" style={{ color: "var(--accent-l)" }}>
                    Ver más →
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {news.map((item: any, idx: number) => (
                    <div key={idx} className="rounded-xl border overflow-hidden"
                         style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      {(item.thumbnail_url || item.thumbnail) ? (
                        <img src={item.thumbnail_url ?? item.thumbnail} alt=""
                             className="w-full h-28 object-cover" />
                      ) : (
                        <div className="w-full h-28 flex items-center justify-center"
                             style={{ background: "var(--raised)" }}>
                          <Newspaper className="w-6 h-6" style={{ color: "var(--dim)" }} />
                        </div>
                      )}
                      <div className="p-3">
                        {item.ticker && (
                          <span className="text-[10px] font-bold" style={{ color: "var(--accent-l)" }}>
                            {item.ticker}
                          </span>
                        )}
                        <p className="text-xs font-semibold leading-snug mt-0.5 line-clamp-3"
                           style={{ color: "var(--text)" }}>
                          {item.title}
                        </p>
                        <p className="text-[10px] mt-1.5 truncate" style={{ color: "var(--muted)" }}>
                          {item.publisher ?? item.source}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── AI Mentor CTA ────────────────────────────────────────────── */}
            <button onClick={() => router.push("/chat")}
                    className="w-full flex items-center gap-4 p-5 rounded-2xl border transition-all hover:opacity-90"
                    style={{ background: "rgba(0,212,126,0.06)", borderColor: "rgba(0,212,126,0.25)" }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                   style={{ background: "rgba(0,212,126,0.15)" }}>
                <Sparkles className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold" style={{ color: "var(--text)" }}>Habla con tu Mentor IA</p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {positions.length
                    ? `Analiza tus ${positions.length} posiciones o pide consejo de inversión`
                    : "Chatea sobre inversiones, acciones o estrategias"}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 shrink-0" style={{ color: "var(--dim)" }} />
            </button>

            <div className="h-6" />
          </div>
        </main>
      </div>
    </div>
  );
}
