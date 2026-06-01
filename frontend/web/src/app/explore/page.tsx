"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { market as marketApi } from "@/lib/api";
import { useAuthStore, useNotificationStore, useThemeStore, useWatchlistStore } from "@/lib/store";
import PaywallModal from "@/components/PaywallModal";
import {
  TrendingUp, BookOpen, PieChart, BarChart2, Bell, User, Menu, X,
  GraduationCap, Trophy, Sun, Moon, Search, Compass, Bookmark, BookmarkCheck,
  Loader2, Sparkles,
} from "lucide-react";

const NAV = [
  { href: "/chat",          icon: BookOpen,      label: "Chat" },
  { href: "/portfolio",     icon: PieChart,      label: "Portafolio" },
  { href: "/paper",         icon: BarChart2,     label: "Paper Trading" },
  { href: "/learn",         icon: GraduationCap, label: "Aprendizaje" },
  { href: "/arena",         icon: Trophy,        label: "Arena" },
  { href: "/explore",       icon: Compass,     label: "Explorar" },
  { href: "/notifications", icon: Bell,          label: "Notificaciones" },
  { href: "/profile",       icon: User,          label: "Perfil" },
];

const SECTORS = ["Todos", "Tech", "Finance", "Salud", "Consumo", "Energía", "ETF"];

interface Stock {
  ticker: string; name: string; sector: string;
  price: number | null; change_pct: number | null;
  pe: number | null; fwd_pe: number | null;
  rev_growth: number | null; margin: number | null;
  div_yield: number | null; recom: string; score: number;
}

const RECOM_LABELS: Record<string, { label: string; color: string }> = {
  strong_buy:  { label: "Compra fuerte", color: "#16a34a" },
  buy:         { label: "Compra",        color: "#22c55e" },
  hold:        { label: "Mantener",      color: "#f59e0b" },
  sell:        { label: "Vender",        color: "#ef4444" },
  strong_sell: { label: "Venta fuerte",  color: "#dc2626" },
};

function scoreColor(score: number) {
  if (score >= 70) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function ScoreBar({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-xs font-bold shrink-0" style={{ color }}>{score}/100</span>
    </div>
  );
}

function StockCard({ item }: { item: Stock }) {
  const { add, remove, has } = useWatchlistStore();
  const watching = has(item.ticker);
  const chgColor = (item.change_pct ?? 0) >= 0 ? "#22c55e" : "#ef4444";
  const recom = RECOM_LABELS[item.recom];

  return (
    <div className="rounded-2xl border p-4 space-y-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="font-black text-base" style={{ color: "var(--text)" }}>{item.ticker}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{item.name}</div>
        </div>
        <div className="text-right">
          {item.price && (
            <div className="font-bold text-sm" style={{ color: "var(--text)" }}>
              ${item.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          )}
          {item.change_pct !== null && (
            <div className="text-xs font-bold" style={{ color: chgColor }}>
              {item.change_pct >= 0 ? "▲" : "▼"} {Math.abs(item.change_pct).toFixed(2)}%
            </div>
          )}
        </div>
      </div>

      {/* Score bar */}
      <ScoreBar score={item.score} />

      {/* Metrics */}
      <div className="flex flex-wrap gap-2">
        {item.pe && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--raised)", color: "var(--muted)" }}>
            P/E {item.pe}x
          </span>
        )}
        {item.rev_growth && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: item.rev_growth > 15 ? "rgba(34,197,94,0.1)" : "var(--raised)", color: item.rev_growth > 15 ? "#22c55e" : "var(--muted)" }}>
            Rev +{item.rev_growth}%
          </span>
        )}
        {item.margin && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--raised)", color: "var(--muted)" }}>
            Mg {item.margin}%
          </span>
        )}
        {item.div_yield && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>
            Div {item.div_yield}%
          </span>
        )}
        {recom && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: recom.color + "18", color: recom.color }}>
            {recom.label}
          </span>
        )}
      </div>

      {/* Watchlist button */}
      <button
        onClick={() => watching ? remove(item.ticker) : add(item.ticker, item.name)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors hover:opacity-80"
        style={{
          borderColor: watching ? "#22c55e" : "var(--border)",
          color: watching ? "#22c55e" : "var(--muted)",
          background: watching ? "rgba(34,197,94,0.08)" : "transparent",
        }}
      >
        {watching
          ? <BookmarkCheck className="w-3.5 h-3.5" />
          : <Bookmark className="w-3.5 h-3.5" />}
        {watching ? "En watchlist" : "Agregar watchlist"}
      </button>
    </div>
  );
}

export default function ExplorePage() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useAuthStore();
  const { notifications } = useNotificationStore();
  const { theme, toggleTheme } = useThemeStore();
  const unreadCount = notifications.filter((n) => !n.read).length;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [sector, setSector] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Stock[]>([]);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => { if (!isAuthenticated) router.push("/"); }, [isAuthenticated]);

  const runScreener = useCallback(async (s: string | null, q: string) => {
    setLoading(true);
    setAiInsight(null);
    try {
      const res = await marketApi.screener(s, q);
      setResults(res.data.results ?? []);
      setAiInsight(res.data.ai_insight ?? null);
      setSearched(true);
    } catch {}
    setLoading(false);
  }, []);

  const search = useCallback(async () => {
    await runScreener(sector, query);
  }, [sector, query, runScreener]);

  const searchBySector = useCallback(async (s: string | null) => {
    setSector(s);
    setLoading(true);
    setAiInsight(null);
    try {
      const res = await marketApi.screener(s, query);
      setResults(res.data.results ?? []);
      setAiInsight(res.data.ai_insight ?? null);
      setSearched(true);
    } catch {}
    setLoading(false);
  }, [query]);

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="border-b flex items-center justify-between px-4 py-2 shrink-0"
           style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1 rounded-lg" style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
              <TrendingUp className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </div>
        </div>
        <span className="font-semibold text-sm" style={{ color: "var(--sub)" }}>Explorar</span>
        <div className="flex items-center gap-1">
          <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-white/5" style={{ color: "var(--muted)" }}>
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? "flex" : "hidden"} lg:flex w-60 border-r flex-col py-4 absolute lg:relative z-20 h-full`}
               style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 space-y-0.5">
            {NAV.map(({ href, icon: Icon, label }) => {
              const active = pathname === href;
              const badge = href === "/notifications" && unreadCount > 0;
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

        {/* Main */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Search + filters (fixed top) */}
          <div className="shrink-0 p-4 space-y-3 border-b" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5"
                 style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <Search className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
                placeholder="ej. tech con P/E bajo y dividendo…"
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: "var(--text)" }}
              />
              {query.trim() && (
                <button onClick={() => search()}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg text-white shrink-0"
                        style={{ background: "var(--accent)" }}>
                  Buscar
                </button>
              )}
            </div>

            {/* Sector chips */}
            <div className="flex gap-2 overflow-x-auto scrollbar-none pb-0.5">
              {SECTORS.map((s) => {
                const val = s === "Todos" ? null : s;
                const active = val === sector;
                return (
                  <button key={s} onClick={() => searchBySector(val)}
                          className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors"
                          style={{
                            borderColor: active ? "var(--accent)" : "var(--border)",
                            background: active ? "rgba(0,168,94,0.15)" : "transparent",
                            color: active ? "var(--accent-l)" : "var(--muted)",
                          }}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
            {/* AI Insight */}
            {aiInsight && (
              <div className="rounded-2xl border p-4" style={{ background: "var(--card)", borderColor: "rgba(0,168,94,0.3)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
                  <span className="text-xs font-bold" style={{ color: "var(--accent-l)" }}>Análisis IA</span>
                </div>
                <div className="text-sm leading-relaxed" style={{ color: "var(--sub)" }}>
                  <ReactMarkdown>{aiInsight}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex flex-col items-center py-16 gap-3">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} />
                <p className="text-sm" style={{ color: "var(--muted)" }}>Analizando mercado…</p>
              </div>
            )}

            {/* Empty state */}
            {!loading && !searched && (
              <div className="flex flex-col items-center py-16 gap-3">
                <Compass className="w-12 h-12" style={{ color: "var(--dim)", opacity: 0.5 }} />
                <p className="text-base font-bold" style={{ color: "var(--muted)" }}>Explora el mercado</p>
                <p className="text-sm text-center max-w-xs" style={{ color: "var(--dim)" }}>
                  Filtra por sector o escribe lo que buscas para encontrar acciones
                </p>
              </div>
            )}

            {/* No results */}
            {!loading && searched && results.length === 0 && (
              <div className="flex flex-col items-center py-12 gap-2">
                <p className="text-base font-bold" style={{ color: "var(--muted)" }}>Sin resultados</p>
                <p className="text-sm" style={{ color: "var(--dim)" }}>Prueba con otro término o sector</p>
              </div>
            )}

            {/* Results grid */}
            {!loading && results.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
                {results.map((item) => <StockCard key={item.ticker} item={item} />)}
              </div>
            )}
          </div>
        </main>
      </div>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </div>
  );
}
