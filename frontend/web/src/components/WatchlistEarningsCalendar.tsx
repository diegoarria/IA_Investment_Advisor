"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft, ChevronRight, Calendar, Loader2,
  Zap, Briefcase, Eye,
  BarChart2, Scissors, DollarSign, Landmark,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { earningsApi } from "@/lib/api";
import StockAvatar from "@/components/StockAvatar";

type TickerEventType = "earnings" | "ex_dividend" | "dividend";
type ImpactLevel = "VERY_HIGH" | "HIGH" | "MEDIUM";
type MacroEventType =
  | "fomc_rate_decision" | "cpi" | "core_cpi" | "pce" | "core_pce" | "nfp"
  | "unemployment_rate" | "gdp" | "ism_manufacturing_pmi" | "ism_services_pmi"
  | "retail_sales" | "initial_jobless_claims" | "ppi" | "jolts"
  | "fed_speaker" | "housing_starts";

interface TickerCalendarEvent {
  kind: "ticker";
  ticker: string;
  event_date: string | null;
  event_type: TickerEventType;
  status: "upcoming" | "today" | "past" | "unknown";
  // earnings fields
  eps_estimate?: number | null;
  eps_range?: string | null;
  revenue_estimate?: string | null;
  timing?: "BMO" | "AMC" | "DMT" | null; // pre-market / after-market / during-market session
  // dividend fields
  dividend_amount?: number | null;
  dividend_yield?: number | null;
}

// Raw shape returned by GET /api/earnings/calendar/macro — display-only,
// no notifications. Never invented: date/impact/speaker all come straight
// from the backend, which sources them from a real economic-calendar API.
interface MacroCalendarEvent {
  kind: "macro";
  event_id: string;
  event_type: MacroEventType;
  event_name: string;
  date_et: string;   // "YYYY-MM-DD"
  time_et: string;   // "HH:MM"
  country: string;
  impact_level: ImpactLevel;
  status: "upcoming" | "today" | "past";
  why_it_matters: string;
  actual_value?: string | null;
  estimate_value?: string | null;
  previous_value?: string | null;
  speaker_name?: string | null;
}

type AnyCalendarEvent = TickerCalendarEvent | MacroCalendarEvent;

interface Props {
  watchlistTickers: string[];
  portfolioTickers?: string[];
  tickerNames?: Record<string, string>;
  tickerLogos?: Record<string, string | null>;
  isPremium?: boolean;
  onUpgrade?: () => void;
}

function getDays(t: TFunction): string[] {
  return [
    t("watchlistEarningsCalendar.days.sun"),
    t("watchlistEarningsCalendar.days.mon"),
    t("watchlistEarningsCalendar.days.tue"),
    t("watchlistEarningsCalendar.days.wed"),
    t("watchlistEarningsCalendar.days.thu"),
    t("watchlistEarningsCalendar.days.fri"),
    t("watchlistEarningsCalendar.days.sat"),
  ];
}
function getMonths(t: TFunction): string[] {
  return [
    t("watchlistEarningsCalendar.months.january"),
    t("watchlistEarningsCalendar.months.february"),
    t("watchlistEarningsCalendar.months.march"),
    t("watchlistEarningsCalendar.months.april"),
    t("watchlistEarningsCalendar.months.may"),
    t("watchlistEarningsCalendar.months.june"),
    t("watchlistEarningsCalendar.months.july"),
    t("watchlistEarningsCalendar.months.august"),
    t("watchlistEarningsCalendar.months.september"),
    t("watchlistEarningsCalendar.months.october"),
    t("watchlistEarningsCalendar.months.november"),
    t("watchlistEarningsCalendar.months.december"),
  ];
}

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getEventMeta(t: TFunction): Record<TickerEventType, { icon: LucideIcon; label: string; bg: string; color: string; bgPortfolio: string; colorPortfolio: string }> {
  return {
    earnings:    { icon: BarChart2,   label: t("watchlistEarningsCalendar.eventTypes.earnings"),    bg: "rgba(59,130,246,0.22)",   color: "#60a5fa", bgPortfolio: "rgba(0,168,94,0.22)",  colorPortfolio: "var(--accent-l)" },
    ex_dividend: { icon: Scissors,    label: t("watchlistEarningsCalendar.eventTypes.exDividend"), bg: "rgba(245,158,11,0.22)",   color: "#f59e0b", bgPortfolio: "rgba(245,158,11,0.28)", colorPortfolio: "#f59e0b" },
    dividend:    { icon: DollarSign,  label: t("watchlistEarningsCalendar.eventTypes.dividend"),    bg: "rgba(168,85,247,0.22)",   color: "#a855f7", bgPortfolio: "rgba(168,85,247,0.28)", colorPortfolio: "#a855f7" },
  };
}

// Impact-coded, not ticker-coded — macro events have no ticker, so they're
// visually distinguished from company events by color + a landmark icon.
const IMPACT_COLOR: Record<ImpactLevel, { bg: string; color: string }> = {
  VERY_HIGH: { bg: "rgba(239,68,68,0.22)",  color: "#f87171" },
  HIGH:      { bg: "rgba(249,115,22,0.22)", color: "#fb923c" },
  MEDIUM:    { bg: "rgba(234,179,8,0.20)",  color: "#facc15" },
};

function macroEventLabel(t: TFunction, eventType: string): string {
  const label = t(`watchlistEarningsCalendar.macro.eventTypes.${eventType}`);
  return label.startsWith("watchlistEarningsCalendar.macro.eventTypes.") ? eventType : label;
}

export default function WatchlistEarningsCalendar({
  watchlistTickers,
  portfolioTickers = [],
  tickerNames = {},
  tickerLogos = {},
  isPremium = false,
  onUpgrade,
}: Props) {
  const { t, i18n } = useTranslation();
  const DAYS = getDays(t);
  const MONTHS = getMonths(t);
  const EVENT_META = getEventMeta(t);
  const [tickerEvents, setTickerEvents] = useState<TickerCalendarEvent[]>([]);
  const [macroEvents, setMacroEvents]   = useState<MacroCalendarEvent[]>([]);
  const [loading, setLoading]     = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [viewDate, setViewDate]   = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [analysis, setAnalysis]   = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [macroImpact, setMacroImpact]     = useState<Record<string, string>>({});
  const [analyzingMacro, setAnalyzingMacro] = useState<string | null>(null);

  const allTickers   = [...new Set([...watchlistTickers, ...portfolioTickers])].filter(Boolean);
  const portfolioSet = new Set(portfolioTickers);

  const loadEvents = () => {
    setLoading(true);
    setLoadError(false);
    const tickerPromise = allTickers.length > 0
      ? earningsApi.getCalendar(allTickers).then((res) =>
          (res.data.earnings || []).map((e: Omit<TickerCalendarEvent, "kind">) => ({ ...e, kind: "ticker" as const }))
        )
      : Promise.resolve<TickerCalendarEvent[]>([]);
    // Macro events are watchlist-independent (US market-wide) — fetched
    // regardless of whether the user has any tickers added, and never
    // blocks/gets blocked by the ticker-events request.
    const macroPromise = earningsApi.getMacroCalendar(45, i18n.language).then((res) =>
      (res.data.events || []).map((e: Omit<MacroCalendarEvent, "kind">) => ({ ...e, kind: "macro" as const }))
    ).catch(() => [] as MacroCalendarEvent[]);

    Promise.all([tickerPromise, macroPromise])
      .then(([tEvents, mEvents]) => {
        setTickerEvents(tEvents);
        setMacroEvents(mEvents);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEvents();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTickers.join(","), i18n.language]);

  // date → events map (ticker events keyed by event_date, macro events by date_et — both "YYYY-MM-DD")
  const eventMap: Record<string, AnyCalendarEvent[]> = {};
  for (const e of tickerEvents) {
    if (e.event_date) {
      (eventMap[e.event_date] ??= []).push(e);
    }
  }
  for (const e of macroEvents) {
    if (e.date_et) {
      (eventMap[e.date_et] ??= []).push(e);
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
      setAnalysis((prev) => ({ ...prev, [ticker]: t("watchlistEarningsCalendar.analysisFailed") }));
    } finally {
      setAnalyzing(null);
    }
  };

  const handleAnalyzeMacro = async (eventId: string) => {
    if (macroImpact[eventId] || analyzingMacro) return;
    setAnalyzingMacro(eventId);
    try {
      const res = await earningsApi.getMacroImpact(eventId, i18n.language);
      setMacroImpact((prev) => ({ ...prev, [eventId]: res.data.impact_note }));
    } catch {
      setMacroImpact((prev) => ({ ...prev, [eventId]: t("watchlistEarningsCalendar.analysisFailed") }));
    } finally {
      setAnalyzingMacro(null);
    }
  };

  const selectedEntries = selectedDay ? (eventMap[selectedDay] ?? []) : [];

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
              {t("watchlistEarningsCalendar.retry")}
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
                  if (e.kind === "macro") {
                    const colors = IMPACT_COLOR[e.impact_level] ?? IMPACT_COLOR.MEDIUM;
                    return (
                      <span
                        key={`macro-${e.event_type}-${ei}`}
                        title={macroEventLabel(t, e.event_type)}
                        className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: colors.bg }}
                      >
                        <Landmark className="w-2 h-2" style={{ color: colors.color }} />
                      </span>
                    );
                  }
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
              {t("watchlistEarningsCalendar.events")} · {new Date(selectedDay + "T12:00:00").toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", {
                weekday: "long", month: "long", day: "numeric",
              })}
            </p>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {selectedEntries.map((entry, ei) => {
              if (entry.kind === "macro") {
                const colors = IMPACT_COLOR[entry.impact_level] ?? IMPACT_COLOR.MEDIUM;
                return (
                  <div key={`macro-${entry.event_type}-${ei}`} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <Landmark className="w-4 h-4" style={{ color: colors.color }} />
                      <span className="text-xs font-black" style={{ color: "var(--text)" }}>
                        {macroEventLabel(t, entry.event_type)}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: "rgba(96,165,250,0.14)", color: "#60a5fa" }}>
                        🇺🇸 {entry.country}
                      </span>
                      <span className="inline-flex text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: colors.bg, color: colors.color }}>
                        {t(`watchlistEarningsCalendar.macro.impact.${entry.impact_level}`)}
                      </span>
                      <span className="ml-auto text-[9px]"
                            style={{ color: entry.status === "upcoming" || entry.status === "today" ? "var(--accent-l)" : "var(--muted)" }}>
                        {entry.time_et} ET · {entry.status === "today" ? t("watchlistEarningsCalendar.status.today") : entry.status === "upcoming" ? t("watchlistEarningsCalendar.status.upcoming") : t("watchlistEarningsCalendar.status.completed")}
                      </span>
                    </div>
                    <p className="text-[10px] mb-1" style={{ color: "var(--dim)" }}>{entry.event_name}</p>
                    {(entry.actual_value != null || entry.estimate_value != null || entry.previous_value != null) && (
                      <div className="text-[10px] mb-1.5 flex gap-3 flex-wrap" style={{ color: "var(--sub)" }}>
                        {entry.actual_value != null && <span>{t("watchlistEarningsCalendar.status.completed")}: <strong style={{ color: "#60a5fa" }}>{entry.actual_value}</strong></span>}
                        {entry.estimate_value != null && <span>Est.: <strong style={{ color: "#60a5fa" }}>{entry.estimate_value}</strong></span>}
                        {entry.previous_value != null && <span>Prev.: <strong style={{ color: "var(--muted)" }}>{entry.previous_value}</strong></span>}
                      </div>
                    )}
                    {entry.speaker_name && (
                      <p className="text-[10px] mb-1" style={{ color: "var(--sub)" }}>{entry.speaker_name}</p>
                    )}
                    {entry.why_it_matters && (
                      <div className="text-[11px] leading-relaxed p-2.5 rounded-xl mb-1.5"
                           style={{ background: "var(--raised)", color: "var(--sub)" }}>
                        <span className="font-semibold" style={{ color: "var(--text)" }}>
                          {t("watchlistEarningsCalendar.macro.whyItMatters")}:
                        </span>{" "}
                        {entry.why_it_matters}
                      </div>
                    )}

                    {/* Personalized portfolio impact — Premium, VERY_HIGH/HIGH events only */}
                    {(entry.impact_level === "VERY_HIGH" || entry.impact_level === "HIGH") && (
                      macroImpact[entry.event_id] ? (
                        <div className="text-[11px] leading-relaxed p-2.5 rounded-xl"
                             style={{ background: "rgba(0,168,94,0.08)", color: "var(--text)" }}>
                          <span className="font-semibold" style={{ color: "var(--accent-l)" }}>
                            {t("watchlistEarningsCalendar.macro.yourPortfolio")}:
                          </span>{" "}
                          {macroImpact[entry.event_id]}
                        </div>
                      ) : analyzingMacro === entry.event_id ? (
                        <div className="flex items-center gap-1.5 py-1">
                          <Loader2 className="w-3 h-3 animate-spin" style={{ color: "var(--accent-l)" }} />
                          <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                            {t("watchlistEarningsCalendar.analyzingWithAi")}
                          </span>
                        </div>
                      ) : isPremium ? (
                        <button
                          onClick={() => handleAnalyzeMacro(entry.event_id)}
                          className="flex items-center gap-1 text-[10px] font-semibold transition-opacity hover:opacity-70"
                          style={{ color: "var(--accent-l)" }}
                        >
                          <Zap className="w-2.5 h-2.5" /> {t("watchlistEarningsCalendar.macro.impactLabel")}
                        </button>
                      ) : (
                        <button
                          onClick={onUpgrade}
                          className="flex items-center gap-1 text-[10px] font-semibold transition-opacity hover:opacity-70"
                          style={{ color: "var(--muted)" }}
                        >
                          <Zap className="w-2.5 h-2.5" /> {t("watchlistEarningsCalendar.macro.impactPremiumLabel")}
                        </button>
                      )
                    )}
                  </div>
                );
              }

              const meta = EVENT_META[entry.event_type] ?? EVENT_META.earnings;
              const isPortfolio = portfolioSet.has(entry.ticker);
              const companyName = tickerNames[entry.ticker];
              return (
                <div key={`${entry.ticker}-${entry.event_type}-${ei}`} className="px-4 py-3">
                  <div className="flex gap-3">
                    <StockAvatar ticker={entry.ticker} logoUrl={tickerLogos[entry.ticker]} size="md" />

                    <div className="flex-1 min-w-0">
                      {/* Ticker + company name + status */}
                      <div className="flex items-start gap-2 mb-1.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-black" style={{ color: "var(--text)" }}>
                              {entry.ticker}
                            </span>
                            <meta.icon className="w-3 h-3 shrink-0" style={{ color: isPortfolio ? meta.colorPortfolio : meta.color }} />
                          </div>
                          {companyName && (
                            <p className="text-[11px] truncate" style={{ color: "var(--muted)" }}>
                              {companyName}
                            </p>
                          )}
                        </div>
                        <span className="ml-auto shrink-0 text-[9px] font-semibold whitespace-nowrap"
                              style={{ color: entry.status === "upcoming" || entry.status === "today" ? "var(--accent-l)" : "var(--muted)" }}>
                          {entry.status === "today" ? t("watchlistEarningsCalendar.status.today") : entry.status === "upcoming" ? t("watchlistEarningsCalendar.status.upcoming") : t("watchlistEarningsCalendar.status.completed")}
                        </span>
                      </div>

                      {/* Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap mb-2">
                        {isPortfolio ? (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)" }}>
                            <Briefcase className="w-2 h-2" /> {t("watchlistEarningsCalendar.portfolio")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa" }}>
                            <Eye className="w-2 h-2" /> {t("watchlistEarningsCalendar.watchlist")}
                          </span>
                        )}
                        <span className="inline-flex text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                              style={{ background: isPortfolio ? meta.bgPortfolio : meta.bg, color: isPortfolio ? meta.colorPortfolio : meta.color }}>
                          {meta.label}
                        </span>
                        {/* Pre-market / after-market — only Finnhub-sourced earnings carry this */}
                        {entry.event_type === "earnings" && entry.timing && (
                          <span className="inline-flex text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ background: "rgba(148,163,184,0.14)", color: "var(--sub)" }}>
                            {entry.timing === "BMO" ? t("watchlistEarningsCalendar.timing.bmo")
                              : entry.timing === "AMC" ? t("watchlistEarningsCalendar.timing.amc")
                              : t("watchlistEarningsCalendar.timing.dmt")}
                          </span>
                        )}
                      </div>

                      {/* Extra info for dividend events */}
                      {(entry.event_type === "ex_dividend" || entry.event_type === "dividend") && (
                        <div className="text-[10px] mb-1.5 flex gap-3 flex-wrap"
                             style={{ color: "var(--sub)" }}>
                          {entry.event_type === "ex_dividend" && (
                            <span>
                              {t("watchlistEarningsCalendar.exDividendExplainerPre")}{" "}
                              <strong>{t("watchlistEarningsCalendar.exDividendExplainerBold")}</strong>{" "}
                              {t("watchlistEarningsCalendar.exDividendExplainerPost")}
                            </span>
                          )}
                          {entry.event_type === "dividend" && (
                            <span>{t("watchlistEarningsCalendar.dividendPaymentDate")}</span>
                          )}
                          {entry.dividend_amount != null && (
                            <span className="font-semibold" style={{ color: "#f59e0b" }}>
                              ${entry.dividend_amount.toFixed(4)} {t("watchlistEarningsCalendar.perShare")}
                            </span>
                          )}
                          {entry.dividend_yield != null && entry.dividend_yield > 0 && (
                            <span style={{ color: "var(--muted)" }}>
                              {t("watchlistEarningsCalendar.yieldLabel")}: {entry.dividend_yield.toFixed(2)}%
                            </span>
                          )}
                        </div>
                      )}

                      {/* EPS + Revenue estimates for earnings — stat pills */}
                      {entry.event_type === "earnings" && (entry.eps_estimate != null || entry.revenue_estimate) && (
                        <div className="flex gap-2 flex-wrap mb-2">
                          {entry.eps_estimate != null && (
                            <div className="rounded-lg px-2.5 py-1.5" style={{ background: "var(--raised)" }}>
                              <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                                EPS est.
                              </p>
                              <p className="text-xs font-black" style={{ color: "#60a5fa" }}>
                                ${entry.eps_estimate.toFixed(2)}
                                {entry.eps_range && <span className="ml-1 text-[10px] font-medium" style={{ color: "var(--dim)" }}>({entry.eps_range})</span>}
                              </p>
                            </div>
                          )}
                          {entry.revenue_estimate && (
                            <div className="rounded-lg px-2.5 py-1.5" style={{ background: "var(--raised)" }}>
                              <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                                {t("watchlistEarningsCalendar.revenueEstLabel")}
                              </p>
                              <p className="text-xs font-black" style={{ color: "#60a5fa" }}>
                                {entry.revenue_estimate}
                              </p>
                            </div>
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
                              {t("watchlistEarningsCalendar.analyzingWithAi")}
                            </span>
                          </div>
                        ) : isPremium ? (
                          <button
                            onClick={() => handleAnalyze(entry.ticker)}
                            className="flex items-center gap-1 text-[10px] font-semibold transition-opacity hover:opacity-70"
                            style={{ color: "var(--accent-l)" }}
                          >
                            <Zap className="w-2.5 h-2.5" /> {t("watchlistEarningsCalendar.aiAnalysisLabel")}
                          </button>
                        ) : (
                          <button
                            onClick={onUpgrade}
                            className="flex items-center gap-1 text-[10px] font-semibold transition-opacity hover:opacity-70"
                            style={{ color: "var(--muted)" }}
                          >
                            <Zap className="w-2.5 h-2.5" /> {t("watchlistEarningsCalendar.aiAnalysisPremiumLabel")}
                          </button>
                        )
                      )}
                    </div>
                  </div>
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
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>{t("watchlistEarningsCalendar.eventTypes.earnings")}</span>
        </div>
        <div className="flex items-center gap-1">
          <Scissors className="w-2.5 h-2.5" style={{ color: "#f59e0b" }} />
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>{t("watchlistEarningsCalendar.eventTypes.exDividend")}</span>
        </div>
        <div className="flex items-center gap-1">
          <DollarSign className="w-2.5 h-2.5" style={{ color: "#a855f7" }} />
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>{t("watchlistEarningsCalendar.eventTypes.dividend")}</span>
        </div>
        <div className="flex items-center gap-1">
          <Landmark className="w-2.5 h-2.5" style={{ color: "#f87171" }} />
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>{t("watchlistEarningsCalendar.macro.label")}</span>
        </div>
        {allTickers.length > 0 && (
          <span className="text-[10px] ml-auto" style={{ color: "var(--dim)" }}>
            {allTickers.length} {t("watchlistEarningsCalendar.assets")}
          </span>
        )}
      </div>
    </div>
  );
}
