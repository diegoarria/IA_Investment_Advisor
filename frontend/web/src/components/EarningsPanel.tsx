"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Calendar, ChevronDown, ChevronUp, Zap, Loader2 } from "lucide-react";
import { earningsApi } from "@/lib/api";
import PremiumToolLocked from "@/components/PremiumToolLocked";

interface EarningsEntry {
  ticker: string;
  earnings_date: string | null;
  status: "upcoming" | "past" | "unknown";
}

interface Position {
  ticker: string;
  shares?: number;
  avg_cost?: number;
}

interface EarningsPanelProps {
  positions: Position[];
  isPremium: boolean;
  onUpgrade: () => void;
}

export default function EarningsPanel({ positions, isPremium, onUpgrade }: EarningsPanelProps) {
  const [calendar, setCalendar]   = useState<EarningsEntry[]>([]);
  const [loading, setLoading]     = useState(false);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [analysis, setAnalysis]   = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  const symbols = positions.map((p) => p.ticker).filter(Boolean);

  useEffect(() => {
    if (!isPremium || symbols.length === 0) return;
    setLoading(true);
    earningsApi
      .getCalendar(symbols)
      .then((res) => setCalendar(res.data.earnings || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isPremium, symbols.join(",")]);

  const handleExpand = async (ticker: string) => {
    if (expanded === ticker) { setExpanded(null); return; }
    setExpanded(ticker);
    if (analysis[ticker]) return;

    const pos = positions.find((p) => p.ticker === ticker);
    setAnalyzing(ticker);
    try {
      const res = await earningsApi.getAnalysis(
        ticker,
        pos?.shares ?? 0,
        pos?.avg_cost ?? 0
      );
      setAnalysis((prev) => ({ ...prev, [ticker]: res.data.analysis }));
    } catch {
      setAnalysis((prev) => ({ ...prev, [ticker]: "No se pudo obtener el análisis." }));
    } finally {
      setAnalyzing(null);
    }
  };

  const relevant = calendar.filter((e) => e.earnings_date);

  if (!isPremium) {
    return (
      <PremiumToolLocked
        title="Análisis de Earnings"
        tagline="IA analiza resultados automáticamente"
        description="Cuando una empresa de tu portafolio reporta resultados trimestrales, la IA los analiza al instante: EPS vs estimado, revenue, guidance e impacto exacto en tu posición."
        icon={Calendar}
        color="#22c55e"
        benefits={[
          { icon: "📅", text: "Calendario de earnings de tus posiciones" },
          { icon: "📊", text: "EPS real vs estimado con contexto profundo" },
          { icon: "💰", text: "Impacto calculado en tu inversión específica" },
          { icon: "⚡", text: "Análisis automático sin buscar nada tú" },
        ]}
        onUnlock={onUpgrade}
      />
    );
  }

  return (
    <div className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center gap-2 p-4 border-b" style={{ borderColor: "var(--border)" }}>
        <Calendar className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
        <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>Earnings de tu Portafolio</span>
        {loading && <Loader2 className="w-3.5 h-3.5 ml-auto animate-spin" style={{ color: "var(--muted)" }} />}
      </div>

      {!loading && relevant.length === 0 && (
        <p className="text-xs p-4" style={{ color: "var(--muted)" }}>
          No hay earnings en los próximos 30 días para tus posiciones.
        </p>
      )}

      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        {relevant.map((entry) => {
          const isExpanded = expanded === entry.ticker;
          const isUpcoming = entry.status === "upcoming";
          return (
            <div key={entry.ticker}>
              <button
                onClick={() => handleExpand(entry.ticker)}
                className="w-full flex items-center gap-3 p-3 hover:bg-white/3 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold"
                     style={{ background: isUpcoming ? "rgba(0,168,94,0.1)" : "rgba(100,100,100,0.1)",
                              color: isUpcoming ? "var(--accent-l)" : "var(--muted)" }}>
                  {entry.ticker.slice(0, 4)}
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium" style={{ color: "var(--text)" }}>{entry.ticker}</p>
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                    {isUpcoming ? "📅 Próximo: " : "📊 Reportó: "}
                    {entry.earnings_date}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isUpcoming
                    ? <TrendingUp className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
                    : <TrendingDown className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />}
                  {isExpanded
                    ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />
                    : <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />}
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 pt-1">
                  {analyzing === entry.ticker ? (
                    <div className="flex items-center gap-2 py-3">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--accent-l)" }} />
                      <span className="text-xs" style={{ color: "var(--muted)" }}>Analizando earnings con IA...</span>
                    </div>
                  ) : analysis[entry.ticker] ? (
                    <div className="text-xs leading-relaxed whitespace-pre-line p-3 rounded-lg"
                         style={{ background: "var(--raised)", color: "var(--sub)" }}>
                      {analysis[entry.ticker]}
                    </div>
                  ) : (
                    <button
                      onClick={() => handleExpand(entry.ticker)}
                      className="flex items-center gap-1.5 text-xs"
                      style={{ color: "var(--accent-l)" }}>
                      <Zap className="w-3 h-3" />
                      Ver análisis IA
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
