"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Calendar, ChevronDown, ChevronUp, Zap, Loader2, Eye, Briefcase, BarChart2, DollarSign, HelpCircle } from "lucide-react";
import { earningsApi } from "@/lib/api";
import PremiumToolLocked from "@/components/PremiumToolLocked";

interface EarningsEntry {
  ticker: string;
  event_date: string | null;
  event_type: "earnings" | "ex_dividend" | "dividend";
  status: "upcoming" | "today" | "past" | "unknown";
  eps_estimate?: number | null;
  eps_actual?: number | null;
  eps_range?: string | null;
  revenue_estimate?: string | null;
  revenue_actual?: string | null;
  timing?: string | null;
  dividend_amount?: number | null;
  dividend_yield?: number | null;
}

interface Position {
  ticker: string;
  shares?: number;
  avg_cost?: number;
}

interface EarningsPanelProps {
  positions: Position[];
  watchlistTickers?: string[];
  isPremium: boolean;
  onUpgrade: () => void;
}

function daysLabel(dateStr: string | null, status: string): string {
  if (!dateStr) return "Fecha por confirmar";
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (status === "today" || diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  if (diff < 0) return `Hace ${Math.abs(diff)} días`;
  return `En ${diff} días`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export default function EarningsPanel({ positions, watchlistTickers = [], isPremium, onUpgrade }: EarningsPanelProps) {
  const [calendar, setCalendar]   = useState<EarningsEntry[]>([]);
  const [loading, setLoading]     = useState(false);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [analysis, setAnalysis]   = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});

  const portfolioTickers = new Set(positions.map((p) => p.ticker));
  const symbols = [...new Set([
    ...positions.map((p) => p.ticker),
    ...watchlistTickers,
  ])].filter(Boolean);

  useEffect(() => {
    if (!isPremium || symbols.length === 0) return;
    setLoading(true);
    earningsApi
      .getCalendar(symbols)
      .then((res: any) => {
        const all: EarningsEntry[] = res.data.earnings || [];
        // Show earnings only (not dividends in this panel) — upcoming first, then past, then unknown
        const order: Record<string, number> = { today: 0, upcoming: 1, past: 2, unknown: 3 };
        const earnings = all
          .filter((e) => e.event_type === "earnings")
          .sort((a, b) => {
            const od = (order[a.status] ?? 3) - (order[b.status] ?? 3);
            if (od !== 0) return od;
            return (a.event_date || "z") < (b.event_date || "z") ? -1 : 1;
          });
        setCalendar(earnings);
        // Auto-trigger analysis for first 2 upcoming entries
        const autoAnalyze = earnings.filter(e => e.status === "upcoming" || e.status === "today").slice(0, 2);
        for (const e of autoAnalyze) triggerAnalysis(e.ticker, positions);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isPremium, symbols.join(",")]);

  const triggerAnalysis = async (ticker: string, pos: Position[]) => {
    if (analysis[ticker] || analyzing[ticker]) return;
    setAnalyzing(prev => ({ ...prev, [ticker]: true }));
    const p = pos.find((p) => p.ticker === ticker);
    try {
      const res: any = await earningsApi.getAnalysis(ticker, p?.shares ?? 0, p?.avg_cost ?? 0);
      setAnalysis(prev => ({ ...prev, [ticker]: res.data.analysis }));
    } catch {
      setAnalysis(prev => ({ ...prev, [ticker]: "No se pudo obtener el análisis." }));
    } finally {
      setAnalyzing(prev => ({ ...prev, [ticker]: false }));
    }
  };

  const handleExpand = (entry: EarningsEntry) => {
    if (expanded === entry.ticker) { setExpanded(null); return; }
    setExpanded(entry.ticker);
    triggerAnalysis(entry.ticker, positions);
  };

  if (!isPremium) {
    return (
      <PremiumToolLocked
        title="Calendario de Earnings"
        tagline="Portfolio + Watchlist con análisis IA"
        description="Earnings de todas tus posiciones y tu watchlist en un solo lugar. Cuando una empresa reporta, la IA lo analiza al instante: EPS vs estimado, revenue, guidance e impacto en tu inversión."
        icon={Calendar}
        color="#22c55e"
        benefits={[
          { icon: Calendar,   text: "Earnings de portafolio y watchlist combinados" },
          { icon: BarChart2,  text: "EPS real vs estimado con contexto profundo" },
          { icon: DollarSign, text: "Impacto calculado en tu inversión específica" },
          { icon: Zap,        text: "Análisis automático sin buscar nada tú" },
        ]}
        onUnlock={onUpgrade}
      />
    );
  }

  const upcoming = calendar.filter(e => e.status === "upcoming" || e.status === "today");
  const past     = calendar.filter(e => e.status === "past");
  const unknown  = calendar.filter(e => e.status === "unknown");

  return (
    <div className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b" style={{ borderColor: "var(--border)" }}>
        <Calendar className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
        <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>Calendario de Earnings</span>
        {symbols.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full ml-1"
                style={{ background: "var(--raised)", color: "var(--muted)" }}>
            {symbols.length} activos
          </span>
        )}
        {loading && <Loader2 className="w-3.5 h-3.5 ml-auto animate-spin" style={{ color: "var(--muted)" }} />}
      </div>

      {!loading && calendar.length === 0 && (
        <div className="p-6 text-center">
          <Calendar className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--dim)" }} />
          <p className="text-xs" style={{ color: "var(--muted)" }}>Cargando fechas de earnings...</p>
        </div>
      )}

      <div className="divide-y" style={{ borderColor: "var(--border)" }}>

        {/* ── Upcoming ── */}
        {upcoming.map((entry) => <EarningsRow key={entry.ticker} entry={entry} expanded={expanded} onExpand={handleExpand} inPortfolio={portfolioTickers.has(entry.ticker)} analysis={analysis[entry.ticker]} analyzing={!!analyzing[entry.ticker]} />)}

        {/* ── Divider between upcoming and past ── */}
        {upcoming.length > 0 && past.length > 0 && (
          <div className="px-4 py-2" style={{ background: "var(--raised)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--dim)" }}>Reportes recientes</p>
          </div>
        )}

        {/* ── Past ── */}
        {past.map((entry) => <EarningsRow key={entry.ticker} entry={entry} expanded={expanded} onExpand={handleExpand} inPortfolio={portfolioTickers.has(entry.ticker)} analysis={analysis[entry.ticker]} analyzing={!!analyzing[entry.ticker]} />)}

        {/* ── Unknown dates ── */}
        {unknown.length > 0 && (
          <div>
            {(upcoming.length > 0 || past.length > 0) && (
              <div className="px-4 py-2" style={{ background: "var(--raised)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--dim)" }}>Fecha sin confirmar</p>
              </div>
            )}
            {unknown.map((entry) => (
              <div key={entry.ticker} className="flex items-center gap-3 p-3" style={{ borderTop: "1px solid var(--border)" }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold"
                     style={{ background: "var(--raised)", color: "var(--muted)" }}>
                  {entry.ticker.slice(0, 4)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium" style={{ color: "var(--text)" }}>{entry.ticker}</p>
                    {portfolioTickers.has(entry.ticker)
                      ? <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)" }}><Briefcase className="w-2 h-2" />Portafolio</span>
                      : <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa" }}><Eye className="w-2 h-2" />Watchlist</span>
                    }
                  </div>
                  <p className="text-[10px]" style={{ color: "var(--dim)" }}>Fecha por confirmar</p>
                </div>
                <HelpCircle className="w-3.5 h-3.5" style={{ color: "var(--dim)" }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EarningsRow({ entry, expanded, onExpand, inPortfolio, analysis, analyzing }: {
  entry: EarningsEntry;
  expanded: string | null;
  onExpand: (e: EarningsEntry) => void;
  inPortfolio: boolean;
  analysis?: string;
  analyzing: boolean;
}) {
  const isExpanded = expanded === entry.ticker;
  const isUpcoming = entry.status === "upcoming" || entry.status === "today";
  const beat = entry.eps_actual != null && entry.eps_estimate != null && entry.eps_actual >= entry.eps_estimate;
  const miss = entry.eps_actual != null && entry.eps_estimate != null && entry.eps_actual < entry.eps_estimate;

  return (
    <div>
      <button
        onClick={() => onExpand(entry)}
        className="w-full flex items-center gap-3 p-3 hover:bg-white/3 transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0"
             style={{ background: isUpcoming ? "rgba(0,168,94,0.1)" : "rgba(100,100,100,0.08)",
                      color: isUpcoming ? "var(--accent-l)" : "var(--muted)" }}>
          {entry.ticker.slice(0, 4)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>{entry.ticker}</p>
            {inPortfolio
              ? <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)" }}><Briefcase className="w-2 h-2" />Portafolio</span>
              : <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa" }}><Eye className="w-2 h-2" />Watchlist</span>
            }
            {beat && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(0,168,94,0.15)", color: "var(--accent-l)" }}>✓ Beat</span>}
            {miss && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>✗ Miss</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-[10px] font-medium" style={{ color: isUpcoming ? "var(--accent-l)" : "var(--muted)" }}>
              {daysLabel(entry.event_date, entry.status)}
            </p>
            {entry.event_date && (
              <p className="text-[10px]" style={{ color: "var(--dim)" }}>{formatDate(entry.event_date)}</p>
            )}
            {entry.timing && (
              <p className="text-[9px]" style={{ color: "var(--dim)" }}>· {entry.timing}</p>
            )}
            {entry.eps_estimate != null && (
              <p className="text-[10px]" style={{ color: "var(--dim)" }}>
                EPS est. <span style={{ color: "var(--muted)" }}>${entry.eps_estimate}</span>
                {entry.eps_actual != null && (
                  <span style={{ color: beat ? "var(--accent-l)" : "#f87171" }}> → real ${entry.eps_actual}</span>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isUpcoming ? <TrendingUp className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} /> : <TrendingDown className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />}
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pt-1">
          {analyzing ? (
            <div className="flex items-center gap-2 py-3">
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--accent-l)" }} />
              <span className="text-xs" style={{ color: "var(--muted)" }}>Analizando con IA...</span>
            </div>
          ) : analysis ? (
            <div className="text-xs leading-relaxed whitespace-pre-line p-3 rounded-lg"
                 style={{ background: "var(--raised)", color: "var(--sub)" }}>
              {analysis}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--accent-l)" }} />
              <span className="text-xs" style={{ color: "var(--muted)" }}>Cargando análisis...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
