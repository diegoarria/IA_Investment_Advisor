import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useTheme } from "../lib/ThemeContext";
import { earningsApi } from "../lib/api";

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
  eps_estimate?: number | null;
  eps_range?: string | null;
  revenue_estimate?: string | null;
  dividend_amount?: number | null;
  dividend_yield?: number | null;
  timing?: "BMO" | "AMC" | "DMT" | null; // pre-market / after-market / during-market session
}

// Display-only, no notifications — mirrors web's WatchlistEarningsCalendar.
interface MacroCalendarEvent {
  kind: "macro";
  event_id: string;
  event_type: MacroEventType;
  event_name: string;
  date_et: string;
  time_et: string;
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
  isPremium?: boolean;
  onUpgrade?: () => void;
}

const getDays = (t: TFunction): string[] => [
  t("mobileEarningsCalendar.days.sun"),
  t("mobileEarningsCalendar.days.mon"),
  t("mobileEarningsCalendar.days.tue"),
  t("mobileEarningsCalendar.days.wed"),
  t("mobileEarningsCalendar.days.thu"),
  t("mobileEarningsCalendar.days.fri"),
  t("mobileEarningsCalendar.days.sat"),
];
const getMonths = (t: TFunction): string[] => [
  t("mobileEarningsCalendar.months.jan"), t("mobileEarningsCalendar.months.feb"), t("mobileEarningsCalendar.months.mar"),
  t("mobileEarningsCalendar.months.apr"), t("mobileEarningsCalendar.months.may"), t("mobileEarningsCalendar.months.jun"),
  t("mobileEarningsCalendar.months.jul"), t("mobileEarningsCalendar.months.aug"), t("mobileEarningsCalendar.months.sep"),
  t("mobileEarningsCalendar.months.oct"), t("mobileEarningsCalendar.months.nov"), t("mobileEarningsCalendar.months.dec"),
];

const getEventMeta = (t: TFunction): Record<TickerEventType, { icon: string; label: string; bg: string; color: string; bgPortfolio: string; colorPortfolio: string }> => ({
  earnings:    { icon: "bar-chart-outline",  label: t("mobileEarningsCalendar.eventTypes.earnings"),   bg: "rgba(59,130,246,0.22)",  color: "#60a5fa", bgPortfolio: "rgba(0,168,94,0.22)",  colorPortfolio: "#00d47e" },
  ex_dividend: { icon: "cut-outline",        label: t("mobileEarningsCalendar.eventTypes.exDividend"), bg: "rgba(245,158,11,0.22)",  color: "#f59e0b", bgPortfolio: "rgba(245,158,11,0.28)", colorPortfolio: "#f59e0b" },
  dividend:    { icon: "cash-outline",       label: t("mobileEarningsCalendar.eventTypes.dividend"),   bg: "rgba(168,85,247,0.22)",  color: "#a855f7", bgPortfolio: "rgba(168,85,247,0.28)", colorPortfolio: "#a855f7" },
});

// Impact-coded (not ticker-coded) — macro events have no ticker.
const IMPACT_COLOR: Record<ImpactLevel, { bg: string; color: string }> = {
  VERY_HIGH: { bg: "rgba(239,68,68,0.22)",  color: "#f87171" },
  HIGH:      { bg: "rgba(249,115,22,0.22)", color: "#fb923c" },
  MEDIUM:    { bg: "rgba(234,179,8,0.20)",  color: "#facc15" },
};

function macroEventLabel(t: TFunction, eventType: string): string {
  const label = t(`mobileEarningsCalendar.macro.eventTypes.${eventType}`);
  return label.startsWith("mobileEarningsCalendar.macro.eventTypes.") ? eventType : label;
}

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function MobileEarningsCalendar({
  watchlistTickers,
  portfolioTickers = [],
  isPremium = false,
  onUpgrade,
}: Props) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const DAYS = getDays(t);
  const MONTHS = getMonths(t);
  const EVENT_META = getEventMeta(t);
  const [tickerEvents, setTickerEvents] = useState<TickerCalendarEvent[]>([]);
  const [macroEvents, setMacroEvents]   = useState<MacroCalendarEvent[]>([]);
  const [loading, setLoading]       = useState(false);
  const [viewDate, setViewDate]     = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [analysis, setAnalysis]     = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing]   = useState<string | null>(null);
  const [macroImpact, setMacroImpact]       = useState<Record<string, string>>({});
  const [analyzingMacro, setAnalyzingMacro] = useState<string | null>(null);

  const allTickers   = [...new Set([...watchlistTickers, ...portfolioTickers])].filter(Boolean);
  const portfolioSet = new Set(portfolioTickers);

  useEffect(() => {
    setLoading(true);
    const tickerPromise = allTickers.length > 0
      ? earningsApi.getCalendar(allTickers).then((res) =>
          (res.data.earnings || []).map((e: Omit<TickerCalendarEvent, "kind">) => ({ ...e, kind: "ticker" as const }))
        )
      : Promise.resolve<TickerCalendarEvent[]>([]);
    // Macro events are US market-wide, not tied to the user's tickers.
    const macroPromise = earningsApi.getMacroCalendar(45, i18n.language).then((res) =>
      (res.data.events || []).map((e: Omit<MacroCalendarEvent, "kind">) => ({ ...e, kind: "macro" as const }))
    ).catch(() => [] as MacroCalendarEvent[]);

    Promise.all([tickerPromise, macroPromise])
      .then(([tEvents, mEvents]) => {
        setTickerEvents(tEvents);
        setMacroEvents(mEvents);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTickers.join(","), i18n.language]);

  // date → events map (ticker events keyed by event_date, macro by date_et — both "YYYY-MM-DD")
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

  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  const handleAnalyze = async (ticker: string) => {
    if (analysis[ticker] || analyzing) return;
    setAnalyzing(ticker);
    try {
      const res = await earningsApi.getAnalysis(ticker, 0, 0);
      setAnalysis((prev) => ({ ...prev, [ticker]: res.data.analysis }));
    } catch {
      setAnalysis((prev) => ({ ...prev, [ticker]: t("mobileEarningsCalendar.analysisError") }));
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
      setMacroImpact((prev) => ({ ...prev, [eventId]: t("mobileEarningsCalendar.analysisError") }));
    } finally {
      setAnalyzingMacro(null);
    }
  };

  const selectedEntries = selectedDay ? (eventMap[selectedDay] ?? []) : [];
  const s = makeStyles(colors);

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

      {/* ── Month nav ── */}
      <View style={[s.monthRow, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => setViewDate(new Date(year, month - 1, 1))}
          style={s.navBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={s.monthCenter}>
          <Ionicons name="calendar-outline" size={14} color={colors.accentLight} />
          <Text style={[s.monthTitle, { color: colors.text }]}>
            {MONTHS[month]} {year}
          </Text>
          {loading && <ActivityIndicator size="small" color={colors.accentLight} style={{ marginLeft: 6 }} />}
        </View>

        <TouchableOpacity
          onPress={() => setViewDate(new Date(year, month + 1, 1))}
          style={s.navBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* ── Day-of-week headers ── */}
      <View style={[s.dowRow, { borderBottomColor: colors.border }]}>
        {DAYS.map((d) => (
          <Text key={d} style={[s.dowLabel, { color: colors.textMuted }]}>{d}</Text>
        ))}
      </View>

      {/* ── Calendar grid ── */}
      <View style={s.grid}>
        {rows.map((row, ri) => (
          <View key={ri} style={[s.gridRow, { borderBottomColor: colors.border }]}>
            {row.map((day, ci) => {
              if (!day) {
                return (
                  <View key={`pad-${ri}-${ci}`}
                        style={[s.cell, { borderRightColor: colors.border, backgroundColor: colors.bgRaised }]} />
                );
              }
              const dateStr  = toDateStr(year, month, day);
              const isToday  = dateStr === todayStr;
              const dayEvents = eventMap[dateStr] ?? [];
              const isSel    = selectedDay === dateStr;
              const hasEvent = dayEvents.length > 0;

              return (
                <TouchableOpacity
                  key={dateStr}
                  disabled={!hasEvent}
                  onPress={() => setSelectedDay(isSel ? null : dateStr)}
                  style={[
                    s.cell,
                    { borderRightColor: colors.border },
                    isSel && { backgroundColor: "rgba(0,168,94,0.07)" },
                  ]}
                  activeOpacity={0.7}
                >
                  {/* Day number */}
                  <View style={[
                    s.dayCircle,
                    isToday && { backgroundColor: colors.accentLight },
                  ]}>
                    <Text style={[
                      s.dayNum,
                      { color: isToday ? "#fff" : colors.textSub },
                    ]}>
                      {day}
                    </Text>
                  </View>

                  {/* Event badges — show up to 2, each with its own color */}
                  {dayEvents.slice(0, 2).map((e, idx) => {
                    if (e.kind === "macro") {
                      const colorSet = IMPACT_COLOR[e.impact_level] ?? IMPACT_COLOR.MEDIUM;
                      return (
                        <View key={`macro-${e.event_type}-${idx}`} style={[s.macroDot, { backgroundColor: colorSet.bg }]}>
                          <Ionicons name="business-outline" size={8} color={colorSet.color} />
                        </View>
                      );
                    }
                    const meta = EVENT_META[e.event_type];
                    const isPortfolio = portfolioSet.has(e.ticker);
                    const bg = isPortfolio ? meta.bgPortfolio : meta.bg;
                    const col = isPortfolio ? meta.colorPortfolio : meta.color;
                    return (
                      <View key={`${e.ticker}-${idx}`} style={[s.tickerBadge, { backgroundColor: bg }]}>
                        <Text style={[s.tickerBadgeText, { color: col }]} numberOfLines={1}>
                          {e.ticker}
                        </Text>
                      </View>
                    );
                  })}
                  {dayEvents.length > 2 && (
                    <View style={[s.tickerBadge, { backgroundColor: colors.bgRaised }]}>
                      <Text style={[s.tickerBadgeText, { color: colors.textMuted }]}>
                        +{dayEvents.length - 2}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* ── Selected day detail ── */}
      {selectedDay && selectedEntries.length > 0 && (
        <View style={[s.detailWrap, { borderTopColor: colors.border }]}>
          <Text style={[s.detailTitle, { color: colors.text }]}>
            {new Date(selectedDay + "T12:00:00").toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", {
              weekday: "long", month: "long", day: "numeric",
            })}
          </Text>
          {selectedEntries.map((entry, idx) => {
            if (entry.kind === "macro") {
              const colorSet = IMPACT_COLOR[entry.impact_level] ?? IMPACT_COLOR.MEDIUM;
              return (
                <View
                  key={`macro-${entry.event_type}-${idx}`}
                  style={[
                    s.detailRow,
                    idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.06)" },
                  ]}
                >
                  <View style={[s.eventStripe, { backgroundColor: colorSet.color }]} />
                  <View style={{ flex: 1 }}>
                    <View style={s.detailHeader}>
                      <Ionicons name="business-outline" size={13} color={colorSet.color} />
                      <Text style={[s.detailTicker, { color: colors.text }]}>{macroEventLabel(t, entry.event_type)}</Text>
                      <View style={[s.eventTypeBadge, { backgroundColor: colorSet.bg }]}>
                        <Text style={[s.eventTypeText, { color: colorSet.color }]}>
                          {t(`mobileEarningsCalendar.macro.impact.${entry.impact_level}`)}
                        </Text>
                      </View>
                      <Text style={[s.statusText, { color: entry.status === "upcoming" || entry.status === "today" ? colorSet.color : colors.textMuted }]}>
                        {entry.time_et} ET
                      </Text>
                    </View>
                    <Text style={{ fontSize: 10, color: colors.textDim, marginBottom: 6 }}>{entry.event_name}</Text>
                    {(entry.actual_value != null || entry.estimate_value != null || entry.previous_value != null) && (
                      <View style={s.metaRow}>
                        {entry.actual_value != null && (
                          <View style={[s.metaChip, { backgroundColor: colors.bgRaised }]}>
                            <Text style={[s.metaChipLabel, { color: colors.textDim }]}>{t("mobileEarningsCalendar.statusReported")}</Text>
                            <Text style={[s.metaChipVal, { color: colors.text }]}>{entry.actual_value}</Text>
                          </View>
                        )}
                        {entry.estimate_value != null && (
                          <View style={[s.metaChip, { backgroundColor: colors.bgRaised }]}>
                            <Text style={[s.metaChipLabel, { color: colors.textDim }]}>Est.</Text>
                            <Text style={[s.metaChipVal, { color: colors.text }]}>{entry.estimate_value}</Text>
                          </View>
                        )}
                        {entry.previous_value != null && (
                          <View style={[s.metaChip, { backgroundColor: colors.bgRaised }]}>
                            <Text style={[s.metaChipLabel, { color: colors.textDim }]}>Prev.</Text>
                            <Text style={[s.metaChipVal, { color: colors.text }]}>{entry.previous_value}</Text>
                          </View>
                        )}
                      </View>
                    )}
                    {entry.speaker_name && (
                      <Text style={{ fontSize: 10, color: colors.textSub, marginBottom: 6 }}>{entry.speaker_name}</Text>
                    )}
                    {entry.why_it_matters && (
                      <View style={[s.analysisBox, { backgroundColor: colors.bgRaised }]}>
                        <Text style={[s.analysisText, { color: colors.textSub }]}>
                          <Text style={{ fontWeight: "700", color: colors.text }}>{t("mobileEarningsCalendar.macro.whyItMatters")}: </Text>
                          {entry.why_it_matters}
                        </Text>
                      </View>
                    )}

                    {/* Personalized portfolio impact — Premium, VERY_HIGH/HIGH events only */}
                    {(entry.impact_level === "VERY_HIGH" || entry.impact_level === "HIGH") && (
                      macroImpact[entry.event_id] ? (
                        <View style={[s.analysisBox, { backgroundColor: "rgba(0,168,94,0.10)", marginTop: 6 }]}>
                          <Text style={[s.analysisText, { color: colors.text }]}>
                            <Text style={{ fontWeight: "700", color: colors.accentLight }}>{t("mobileEarningsCalendar.macro.yourPortfolio")}: </Text>
                            {macroImpact[entry.event_id]}
                          </Text>
                        </View>
                      ) : analyzingMacro === entry.event_id ? (
                        <View style={s.analyzingRow}>
                          <ActivityIndicator size="small" color={colors.accentLight} />
                          <Text style={[s.analyzingText, { color: colors.textMuted }]}>{t("mobileEarningsCalendar.analyzingWithAI")}</Text>
                        </View>
                      ) : isPremium ? (
                        <TouchableOpacity
                          onPress={() => handleAnalyzeMacro(entry.event_id)}
                          style={[s.aiBtn, { marginTop: 6 }]}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="flash-outline" size={12} color={colors.accentLight} />
                          <Text style={[s.aiBtnText, { color: colors.accentLight }]}>{t("mobileEarningsCalendar.macro.impactLabel")}</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          onPress={onUpgrade}
                          style={[s.aiBtn, { backgroundColor: "rgba(107,114,128,0.10)", marginTop: 6 }]}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="flash-outline" size={12} color={colors.textMuted} />
                          <Text style={[s.aiBtnText, { color: colors.textMuted }]}>{t("mobileEarningsCalendar.macro.impactPremiumLabel")}</Text>
                        </TouchableOpacity>
                      )
                    )}
                  </View>
                </View>
              );
            }

            const meta = EVENT_META[entry.event_type];
            const isPortfolio = portfolioSet.has(entry.ticker);
            const accentColor = isPortfolio ? meta.colorPortfolio : meta.color;
            return (
              <View
                key={`${entry.ticker}-${entry.event_type}`}
                style={[
                  s.detailRow,
                  idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.06)" },
                ]}
              >
                {/* Event type stripe */}
                <View style={[s.eventStripe, { backgroundColor: accentColor }]} />

                <View style={{ flex: 1 }}>
                  {/* Header */}
                  <View style={s.detailHeader}>
                    <Text style={[s.detailTicker, { color: colors.text }]}>{entry.ticker}</Text>

                    {/* Event type badge */}
                    <View style={[s.eventTypeBadge, { backgroundColor: isPortfolio ? meta.bgPortfolio : meta.bg }]}>
                      <Ionicons name={meta.icon as any} size={9} color={accentColor} />
                      <Text style={[s.eventTypeText, { color: accentColor }]}>{meta.label}</Text>
                    </View>

                    {/* Pre-market / after-market — only Finnhub-sourced earnings carry this */}
                    {entry.event_type === "earnings" && entry.timing && (
                      <View style={[s.badge, { backgroundColor: "rgba(148,163,184,0.14)" }]}>
                        <Text style={[s.badgeText, { color: colors.textMuted }]}>
                          {entry.timing === "BMO" ? t("mobileEarningsCalendar.timing.bmo")
                            : entry.timing === "AMC" ? t("mobileEarningsCalendar.timing.amc")
                            : t("mobileEarningsCalendar.timing.dmt")}
                        </Text>
                      </View>
                    )}

                    {/* Portfolio / Watchlist badge */}
                    {isPortfolio ? (
                      <View style={[s.badge, { backgroundColor: "rgba(0,168,94,0.12)" }]}>
                        <Ionicons name="briefcase-outline" size={8} color={colors.accentLight} />
                        <Text style={[s.badgeText, { color: colors.accentLight }]}>{t("mobileEarningsCalendar.portfolio")}</Text>
                      </View>
                    ) : (
                      <View style={[s.badge, { backgroundColor: "rgba(59,130,246,0.12)" }]}>
                        <Ionicons name="eye-outline" size={8} color="#60a5fa" />
                        <Text style={[s.badgeText, { color: "#60a5fa" }]}>{t("mobileEarningsCalendar.watchlist")}</Text>
                      </View>
                    )}

                    <Text style={[s.statusText, { color: entry.status === "upcoming" || entry.status === "today" ? accentColor : colors.textMuted }]}>
                      {entry.status === "upcoming" ? t("mobileEarningsCalendar.statusUpcoming") : entry.status === "today" ? t("mobileEarningsCalendar.statusToday") : t("mobileEarningsCalendar.statusReported")}
                    </Text>
                  </View>

                  {/* Event-specific data */}
                  {entry.event_type === "earnings" && (entry.eps_estimate || entry.eps_range || entry.revenue_estimate) && (
                    <View style={s.metaRow}>
                      {entry.eps_estimate != null && (
                        <View style={[s.metaChip, { backgroundColor: colors.bgRaised }]}>
                          <Text style={[s.metaChipLabel, { color: colors.textDim }]}>{t("mobileEarningsCalendar.epsEst")}</Text>
                          <Text style={[s.metaChipVal, { color: colors.text }]}>${entry.eps_estimate}</Text>
                        </View>
                      )}
                      {entry.eps_range && (
                        <View style={[s.metaChip, { backgroundColor: colors.bgRaised }]}>
                          <Text style={[s.metaChipLabel, { color: colors.textDim }]}>{t("mobileEarningsCalendar.range")}</Text>
                          <Text style={[s.metaChipVal, { color: colors.text }]}>{entry.eps_range}</Text>
                        </View>
                      )}
                      {entry.revenue_estimate && (
                        <View style={[s.metaChip, { backgroundColor: colors.bgRaised }]}>
                          <Text style={[s.metaChipLabel, { color: colors.textDim }]}>{t("mobileEarningsCalendar.revEst")}</Text>
                          <Text style={[s.metaChipVal, { color: colors.text }]}>{entry.revenue_estimate}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {(entry.event_type === "ex_dividend" || entry.event_type === "dividend") && (entry.dividend_amount != null || entry.dividend_yield != null) && (
                    <View style={s.metaRow}>
                      {entry.dividend_amount != null && (
                        <View style={[s.metaChip, { backgroundColor: colors.bgRaised }]}>
                          <Text style={[s.metaChipLabel, { color: colors.textDim }]}>{t("mobileEarningsCalendar.dividend")}</Text>
                          <Text style={[s.metaChipVal, { color: colors.text }]}>${entry.dividend_amount?.toFixed(4)}</Text>
                        </View>
                      )}
                      {entry.dividend_yield != null && (
                        <View style={[s.metaChip, { backgroundColor: colors.bgRaised }]}>
                          <Text style={[s.metaChipLabel, { color: colors.textDim }]}>{t("mobileEarningsCalendar.yield")}</Text>
                          <Text style={[s.metaChipVal, { color: "#a855f7" }]}>{entry.dividend_yield?.toFixed(2)}%</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* AI analysis — only for earnings */}
                  {entry.event_type === "earnings" && (
                    analysis[entry.ticker] ? (
                      <View style={[s.analysisBox, { backgroundColor: colors.bgRaised }]}>
                        <Text style={[s.analysisText, { color: colors.textSub }]}>
                          {analysis[entry.ticker]}
                        </Text>
                      </View>
                    ) : analyzing === entry.ticker ? (
                      <View style={s.analyzingRow}>
                        <ActivityIndicator size="small" color={colors.accentLight} />
                        <Text style={[s.analyzingText, { color: colors.textMuted }]}>{t("mobileEarningsCalendar.analyzingWithAI")}</Text>
                      </View>
                    ) : isPremium ? (
                      <TouchableOpacity
                        onPress={() => handleAnalyze(entry.ticker)}
                        style={s.aiBtn}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="flash-outline" size={12} color={colors.accentLight} />
                        <Text style={[s.aiBtnText, { color: colors.accentLight }]}>{t("mobileEarningsCalendar.aiAnalysis")}</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        onPress={onUpgrade}
                        style={[s.aiBtn, { backgroundColor: "rgba(107,114,128,0.10)" }]}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="flash-outline" size={12} color={colors.textMuted} />
                        <Text style={[s.aiBtnText, { color: colors.textMuted }]}>{t("mobileEarningsCalendar.aiAnalysisPremium")}</Text>
                      </TouchableOpacity>
                    )
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* ── Legend ── */}
      <View style={[s.legend, { borderTopColor: colors.border }]}>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: "#60a5fa" }]} />
          <Text style={[s.legendText, { color: colors.textMuted }]}>{t("mobileEarningsCalendar.eventTypes.earnings")}</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: "#f59e0b" }]} />
          <Text style={[s.legendText, { color: colors.textMuted }]}>{t("mobileEarningsCalendar.eventTypes.exDividend")}</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: "#a855f7" }]} />
          <Text style={[s.legendText, { color: colors.textMuted }]}>{t("mobileEarningsCalendar.eventTypes.dividend")}</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: "#f87171" }]} />
          <Text style={[s.legendText, { color: colors.textMuted }]}>{t("mobileEarningsCalendar.macro.label")}</Text>
        </View>
        {allTickers.length > 0 && (
          <Text style={[s.legendCount, { color: colors.textDim }]}>
            {t("mobileEarningsCalendar.assetsCount", { count: allTickers.length })}
          </Text>
        )}
      </View>
    </View>
  );
}

function makeStyles(_colors: unknown) {
  return StyleSheet.create({
    card: {
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: "hidden",
    },
    monthRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 12, paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    navBtn: { padding: 4 },
    monthCenter: { flexDirection: "row", alignItems: "center", gap: 6 },
    monthTitle: { fontSize: 14, fontWeight: "800" },

    dowRow: {
      flexDirection: "row",
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    dowLabel: {
      flex: 1, textAlign: "center",
      fontSize: 10, fontWeight: "700",
      paddingVertical: 6,
      textTransform: "uppercase" as const,
    },

    grid: {},
    gridRow: {
      flexDirection: "row",
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    cell: {
      flex: 1, minHeight: 62,
      padding: 3,
      borderRightWidth: StyleSheet.hairlineWidth,
      alignItems: "center",
    },
    dayCircle: {
      width: 22, height: 22,
      borderRadius: 11,
      alignItems: "center", justifyContent: "center",
      marginBottom: 2,
    },
    dayNum: { fontSize: 11, fontWeight: "700" },
    tickerBadge: {
      borderRadius: 4,
      paddingHorizontal: 3, paddingVertical: 1,
      marginTop: 1,
      maxWidth: "100%",
    },
    tickerBadgeText: { fontSize: 8, fontWeight: "800" },
    eventDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 2 },
    macroDot: {
      width: 14, height: 14, borderRadius: 7,
      alignItems: "center", justifyContent: "center",
      marginTop: 1,
    },

    detailWrap: {
      borderTopWidth: StyleSheet.hairlineWidth,
      padding: 12,
      gap: 0,
    },
    detailTitle: {
      fontSize: 12, fontWeight: "800",
      marginBottom: 10,
      textTransform: "capitalize",
    },
    detailRow: {
      flexDirection: "row",
      gap: 10,
      paddingVertical: 10,
    },
    eventStripe: {
      width: 3, borderRadius: 2, alignSelf: "stretch", flexShrink: 0,
    },
    detailHeader: {
      flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5, marginBottom: 6,
    },
    detailTicker: { fontSize: 14, fontWeight: "900", letterSpacing: -0.3 },
    eventTypeBadge: {
      flexDirection: "row", alignItems: "center", gap: 3,
      borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2,
    },
    eventTypeText: { fontSize: 9, fontWeight: "800" },
    badge: {
      flexDirection: "row", alignItems: "center", gap: 3,
      borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2,
    },
    badgeText: { fontSize: 9, fontWeight: "700" },
    statusText: { fontSize: 10, fontWeight: "700", marginLeft: "auto" },

    metaRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 8 },
    metaChip: {
      borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
      alignItems: "center",
    },
    metaChipLabel: { fontSize: 8, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
    metaChipVal: { fontSize: 12, fontWeight: "800" },

    analysisBox: {
      borderRadius: 10, padding: 10, marginTop: 4,
    },
    analysisText: { fontSize: 12, lineHeight: 18 },
    analyzingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
    analyzingText: { fontSize: 12 },
    aiBtn: {
      flexDirection: "row", alignItems: "center", gap: 5,
      borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
      alignSelf: "flex-start", marginTop: 6,
      backgroundColor: "rgba(0,168,94,0.10)",
    },
    aiBtnText: { fontSize: 11, fontWeight: "700" },

    legend: {
      flexDirection: "row", alignItems: "center", gap: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12, paddingVertical: 9,
      flexWrap: "wrap",
    },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    legendDot: { width: 7, height: 7, borderRadius: 3.5 },
    legendText: { fontSize: 10, fontWeight: "600" },
    legendCount: { fontSize: 10, marginLeft: "auto" },
  });
}
