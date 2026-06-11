"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft, ChevronRight, Calendar, Loader2,
  Zap, Briefcase, Eye, Lock,
  BarChart2, Scissors, DollarSign,
} from "lucide-react";
import { earningsApi } from "@/lib/api";

type EventType = "earnings" | "ex_dividend" | "dividend";

interface CalendarEvent {
  ticker: string;
  event_date: string | null;
  event_type: EventType;
  status: "upcoming" | "today" | "past" | "unknown";
  // earnings fields
  eps_estimate?: number | null;
  eps_range?: string | null;
  revenue_estimate?: string | null;
  // dividend fields
  dividend_amount?: number | null;
  dividend_yield?: number | null;
}

interface Props {
  watchlistTickers: string[];
  portfolioTickers?: string[];
  isPremium: boolean;
  onUpgrade: () => void;
}

const DAYS   = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const EVENT_META: Record<EventType, { icon: LucideIcon; label: string; bg: string; color: string; bgPortfolio: string; colorPortfolio: string }> = {
  earnings:    { icon: BarChart2,   label: "Resultados",   bg: "rgba(59,130,246,0.22)",   color: "#60a5fa", bgPortfolio: "rgba(0,168,94,0.22)",  colorPortfolio: "var(--accent-l)" },
  ex_dividend: { icon: Scissors,    label: "Ex-Dividendo", bg: "rgba(245,158,11,0.22)",   color: "#f59e0b", bgPortfolio: "rgba(245,158,11,0.28)", colorPortfolio: "#f59e0b" },
  dividend:    { icon: DollarSign,  label: "Dividendo",    bg: "rgba(168,85,247,0.22)",   color: "#a855f7", bgPortfolio: "rgba(168,85,247,0.28)", colorPortfolio: "#a855f7" },
};

export default function WatchlistEarningsCalendar({
  watchlistTickers,
  portfolioTickers = [],
  isPremium,
  onUpgrade,
}: Props) {
  const [events, setEvents]       = useState<CalendarEvent[]>([]);
  const [loading, setLoading]     = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [viewDate, setViewDate]   = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [analysis, setAnalysis]   = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  const allTickers   = [...new Set([...watchlistTickers, ...portfolioTickers])].filter(Boolean);
  const portfolioSet = new Set(portfolioTickers);

  const loadEvents = () => {
    if (!isPremium || allTickers.length === 0) return;
    setLoading(true);
    setLoadError(false);
    earningsApi
      .getCalendar(allTickers)
      .then((res) => setEvents(res.data.earnings || []))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEvents();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPremium, allTickers.join(",")]);

  // date → events map
  const eventMap: Record<string, CalendarEvent[]> = {};
  for (const e of events) {
    if (e.event_date) {
      (eventMap[e.event_date] ??= []).push(e);
    }
  }

  const year        = viewDate.getFullYear();
  const month       = viewDate.getMonth();
  const today       = new Date();
  const todayStr    = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());
  const firstDayDOW = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(firstDayDOW).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const handleAnalyze = async (ticker: string) => {
    if (analysis[ticker] || analyzing) return;
    setAnalyzing(ticker);
    try {
      const res = await earningsApi.getAnalysis(ticker, 0, 0);
      setAnalysis((prev) => ({ ...prev, [ticker]: res.data.analysis }));
    } catch {
      setAnalysis((prev) => ({ ...prev, [ticker]: "No se pudo obtener el análisis." }));
    } finally {
      setAnalyzing(null);
    }
  };

  const selectedEntries = selectedDay ? (eventMap[selectedDay] ?? []) : [];

  // ── Locked state ──────────────────────────────────────────────────────────
  if (!isPremium) {
    return (
      <div
        className="rounded-2xl border p-6 flex flex-col items-center gap-3 text-center"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
             style={{ background: "rgba(0,168,94,0.10)" }}>
          <Lock className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
        </div>
        <div>
          <p className="text-sm font-bold mb-1" style={{ color: "var(--text)" }}>
            Calendario de Eventos
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Ve las fechas de earnings y dividendos de tu watchlist. Incluye análisis IA de cada reporte.
          </p>
        </div>
        <button onClick={onUpgrade} className="btn-primary text-xs px-4 py-2">
          Activar Premium
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border overflow-hidden"
         style={{ background: "var(--card)", borderColor: "var(--border)" }}>

      {/* ── Month navigation ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b"
           style={{ borderColor: "var(--border)" }}>
        <button
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" style={{ color: "var(--muted)" }} />
        </button>

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
          <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
            {MONTHS[month]} {year}
          </span>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--muted)" }} />}
          {!loading && loadError && (
            <button onClick={loadEvents} className="text-[10px] font-semibold px-2 py-0.5 rounded-full transition-opacity hover:opacity-70"
                    style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
              Reintentar
            </button>
          )}
        </div>

        <button
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
        >
          <ChevronRight className="w-4 h-4" style={{ color: "var(--muted)" }} />
        </button>
      </div>

      {/* ── Day-of-week headers ── */}
      <div className="grid grid-cols-7">
        {DAYS.map((d) => (
          <div key={d}
               className="py-2 text-center text-[10px] font-bold uppercase tracking-wider border-b"
               style={{ color: "var(--muted)", borderColor: "var(--border)" }}>
            {d}
          </div>
        ))}
      </div>

      {/* ── Calendar grid ── */}
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          if (!day) {
            return (
              <div key={`pad-${idx}`}
                   className="h-[4.5rem] border-b border-r"
                   style={{ borderColor: "var(--border)", background: "var(--raised)" }} />
            );
          }

          const dateStr  = toDateStr(year, month, day);
          const isToday  = dateStr === todayStr;
          const dayEvents = eventMap[dateStr] ?? [];
          const isSel    = selectedDay === dateStr;
          const hasEvent = dayEvents.length > 0;

          return (
            <div
              key={dateStr}
              onClick={() => hasEvent && setSelectedDay(isSel ? null : dateStr)}
              className={`h-[4.5rem] border-b border-r p-1 flex flex-col transition-colors ${hasEvent ? "cursor-pointer hover:bg-white/[0.04]" : ""}`}
              style={{
                borderColor: "var(--border)",
                background: isSel ? "rgba(0,168,94,0.07)" : undefined,
              }}
            >
              {/* Day number */}
              <div className="flex justify-center mb-1">
                <span
                  className="w-6 h-6 flex items-center justify-center rounded-full text-[11px] font-bold"
                  style={{
                    background: isToday ? "var(--grad-green)" : "transparent",
                    color: isToday ? "#fff" : "var(--sub)",
                  }}
                >
                  {day}
                </span>
              </div>

              {/* Event badges */}
              <div className="flex flex-col gap-0.5 items-center">
                {dayEvents.slice(0, 2).map((e, ei) => {
                  const meta = EVENT_META[e.event_type] ?? EVENT_META.earnings;
                  const isPortfolio = portfolioSet.has(e.ticker);
                  return (
                    <span
                      key={`${e.ticker}-${e.event_type}-${ei}`}
                      className="text-[7px] font-black px-1 py-px rounded leading-tight flex items-center gap-px"
                      style={{
                        background: isPortfolio ? meta.bgPortfolio : meta.bg,
                        color: isPortfolio ? meta.colorPortfolio : meta.color,
                        maxWidth: "calc(100% - 2px)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <meta.icon className="w-2.5 h-2.5 inline-block mr-0.5" /> {e.ticker}
                    </span>
                  );
                })}
                {dayEvents.length > 2 && (
                  <span className="text-[7px] font-bold px-1 py-px rounded"
                        style={{ background: "var(--raised)", color: "var(--muted)" }}>
                    +{dayEvents.length - 2}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Selected day details ── */}
      {selectedDay && selectedEntries.length > 0 && (
        <div className="border-t" style={{ borderColor: "var(--border)" }}>
          <div className="px-4 pt-3 pb-2">
            <p className="text-xs font-bold" style={{ color: "var(--text)" }}>
              Eventos · {new Date(selectedDay + "T12:00:00").toLocaleDateString("es", {
                weekday: "long", month: "long", day: "numeric",
              })}
            </p>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {selectedEntries.map((entry, ei) => {
              const meta = EVENT_META[entry.event_type] ?? EVENT_META.earnings;
              const isPortfolio = portfolioSet.has(entry.ticker);
              return (
                <div key={`${entry.ticker}-${entry.event_type}-${ei}`} className="px-4 py-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <meta.icon className="w-4 h-4" style={{ color: isPortfolio ? meta.colorPortfolio : meta.color }} />
                    <span className="text-xs font-black" style={{ color: "var(--text)" }}>
                      {entry.ticker}
                    </span>
                    {/* Origin badge */}
                    {isPortfolio ? (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)" }}>
                        <Briefcase className="w-2 h-2" /> Portafolio
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa" }}>
                        <Eye className="w-2 h-2" /> Watchlist
                      </span>
                    )}
                    {/* Event type badge */}
                    <span className="inline-flex text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ background: isPortfolio ? meta.bgPortfolio : meta.bg, color: isPortfolio ? meta.colorPortfolio : meta.color }}>
                      {meta.label}
                    </span>
                    {/* Status */}
                    <span className="ml-auto text-[9px]"
                          style={{ color: entry.status === "upcoming" || entry.status === "today" ? "var(--accent-l)" : "var(--muted)" }}>
                      {entry.status === "today" ? "Hoy" : entry.status === "upcoming" ? "Próximo" : "Completado"}
                    </span>
                  </div>

                  {/* Extra info for dividend events */}
                  {(entry.event_type === "ex_dividend" || entry.event_type === "dividend") && (
                    <div className="text-[10px] mb-1.5 flex gap-3 flex-wrap"
                         style={{ color: "var(--sub)" }}>
                      {entry.event_type === "ex_dividend" && (
                        <span>Para recibir el dividendo debes poseer acciones <strong>antes</strong> de esta fecha</span>
                      )}
                      {entry.event_type === "dividend" && (
                        <span>Fecha de pago del dividendo</span>
                      )}
                      {entry.dividend_amount != null && (
                        <span className="font-semibold" style={{ color: "#f59e0b" }}>
                          ${entry.dividend_amount.toFixed(4)} / acción
                        </span>
                      )}
                      {entry.dividend_yield != null && entry.dividend_yield > 0 && (
                        <span style={{ color: "var(--muted)" }}>
                          Yield: {entry.dividend_yield.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  )}

                  {/* EPS + Revenue estimates for earnings */}
                  {entry.event_type === "earnings" && (entry.eps_estimate != null || entry.revenue_estimate) && (
                    <div className="text-[10px] mb-1.5 flex gap-3 flex-wrap"
                         style={{ color: "var(--sub)" }}>
                      {entry.eps_estimate != null && (
                        <span>
                          EPS est. <strong style={{ color: "#60a5fa" }}>${entry.eps_estimate.toFixed(2)}</strong>
                          {entry.eps_range && <span style={{ color: "var(--dim)" }}> ({entry.eps_range})</span>}
                        </span>
                      )}
                      {entry.revenue_estimate && (
                        <span>
                          Ingresos est. <strong style={{ color: "#60a5fa" }}>{entry.revenue_estimate}</strong>
                        </span>
                      )}
                    </div>
                  )}

                  {/* AI analysis — only for earnings */}
                  {entry.event_type === "earnings" && (
                    analysis[entry.ticker] ? (
                      <div className="text-[11px] leading-relaxed p-2.5 rounded-xl whitespace-pre-line"
                           style={{ background: "var(--raised)", color: "var(--sub)" }}>
                        {analysis[entry.ticker]}
                      </div>
                    ) : analyzing === entry.ticker ? (
                      <div className="flex items-center gap-1.5 py-1">
                        <Loader2 className="w-3 h-3 animate-spin" style={{ color: "var(--accent-l)" }} />
                        <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                          Analizando con IA...
                        </span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleAnalyze(entry.ticker)}
                        className="flex items-center gap-1 text-[10px] font-semibold transition-opacity hover:opacity-70"
                        style={{ color: "var(--accent-l)" }}
                      >
                        <Zap className="w-2.5 h-2.5" /> Análisis IA
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Legend ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-t flex-wrap"
           style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-1">
          <BarChart2 className="w-2.5 h-2.5" style={{ color: "#60a5fa" }} />
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>Resultados</span>
        </div>
        <div className="flex items-center gap-1">
          <Scissors className="w-2.5 h-2.5" style={{ color: "#f59e0b" }} />
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>Ex-Dividendo</span>
        </div>
        <div className="flex items-center gap-1">
          <DollarSign className="w-2.5 h-2.5" style={{ color: "#a855f7" }} />
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>Pago Dividendo</span>
        </div>
        {allTickers.length > 0 && (
          <span className="text-[10px] ml-auto" style={{ color: "var(--dim)" }}>
            {allTickers.length} activos
          </span>
        )}
      </div>
    </div>
  );
}
