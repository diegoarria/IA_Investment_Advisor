import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";
import { earningsApi } from "../lib/api";

interface EarningsEntry {
  ticker: string;
  earnings_date: string | null;
  status: "upcoming" | "past" | "unknown";
}

interface Props {
  watchlistTickers: string[];
  portfolioTickers?: string[];
  isPremium: boolean;
  onUpgrade: () => void;
}

const DAYS   = ["D", "L", "M", "X", "J", "V", "S"];
const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function MobileEarningsCalendar({
  watchlistTickers,
  portfolioTickers = [],
  isPremium,
  onUpgrade,
}: Props) {
  const { colors } = useTheme();
  const [calendar, setCalendar]     = useState<EarningsEntry[]>([]);
  const [loading, setLoading]       = useState(false);
  const [viewDate, setViewDate]     = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [analysis, setAnalysis]     = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing]   = useState<string | null>(null);

  const allTickers   = [...new Set([...watchlistTickers, ...portfolioTickers])].filter(Boolean);
  const portfolioSet = new Set(portfolioTickers);

  useEffect(() => {
    if (!isPremium || allTickers.length === 0) return;
    setLoading(true);
    earningsApi
      .getCalendar(allTickers)
      .then((res) => setCalendar(res.data.earnings || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPremium, allTickers.join(",")]);

  const earningsMap: Record<string, EarningsEntry[]> = {};
  for (const e of calendar) {
    if (e.earnings_date) {
      (earningsMap[e.earnings_date] ??= []).push(e);
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
      setAnalysis((prev) => ({ ...prev, [ticker]: "No se pudo obtener el análisis." }));
    } finally {
      setAnalyzing(null);
    }
  };

  const selectedEntries = selectedDay ? (earningsMap[selectedDay] ?? []) : [];

  const s = makeStyles(colors);

  // ── Locked ──────────────────────────────────────────────────────────────────
  if (!isPremium) {
    return (
      <View style={[s.lockedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[s.lockIcon, { backgroundColor: "rgba(0,168,94,0.10)" }]}>
          <Ionicons name="lock-closed-outline" size={22} color={colors.accentLight} />
        </View>
        <Text style={[s.lockTitle, { color: colors.text }]}>Calendario de Earnings</Text>
        <Text style={[s.lockSub, { color: colors.textMuted }]}>
          Fechas de earnings de tu watchlist en un calendario visual con análisis IA.
        </Text>
        <TouchableOpacity style={s.lockBtn} onPress={onUpgrade}>
          <Text style={s.lockBtnText}>⭐ Activar Premium</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
              const entries  = earningsMap[dateStr] ?? [];
              const isSel    = selectedDay === dateStr;
              const hasEvent = entries.length > 0;

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

                  {/* Ticker badges */}
                  {entries.slice(0, 2).map((e) => (
                    <View
                      key={e.ticker}
                      style={[s.tickerBadge, {
                        backgroundColor: portfolioSet.has(e.ticker)
                          ? "rgba(0,168,94,0.22)"
                          : "rgba(59,130,246,0.22)",
                      }]}
                    >
                      <Text style={[s.tickerBadgeText, {
                        color: portfolioSet.has(e.ticker) ? colors.accentLight : "#60a5fa",
                      }]} numberOfLines={1}>
                        {e.ticker}
                      </Text>
                    </View>
                  ))}
                  {entries.length > 2 && (
                    <View style={[s.tickerBadge, { backgroundColor: colors.bgRaised }]}>
                      <Text style={[s.tickerBadgeText, { color: colors.textMuted }]}>
                        +{entries.length - 2}
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
            Earnings · {new Date(selectedDay + "T12:00:00").toLocaleDateString("es", {
              weekday: "long", month: "long", day: "numeric",
            })}
          </Text>
          {selectedEntries.map((entry, idx) => (
            <View
              key={entry.ticker}
              style={[s.detailRow, idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
            >
              <View style={s.detailHeader}>
                <Text style={[s.detailTicker, { color: colors.text }]}>{entry.ticker}</Text>
                {portfolioSet.has(entry.ticker) ? (
                  <View style={[s.badge, { backgroundColor: "rgba(0,168,94,0.12)" }]}>
                    <Ionicons name="briefcase-outline" size={8} color={colors.accentLight} />
                    <Text style={[s.badgeText, { color: colors.accentLight }]}>Portafolio</Text>
                  </View>
                ) : (
                  <View style={[s.badge, { backgroundColor: "rgba(59,130,246,0.12)" }]}>
                    <Ionicons name="eye-outline" size={8} color="#60a5fa" />
                    <Text style={[s.badgeText, { color: "#60a5fa" }]}>Watchlist</Text>
                  </View>
                )}
                <Text style={[s.statusText, { color: entry.status === "upcoming" ? colors.accentLight : colors.textMuted }]}>
                  {entry.status === "upcoming" ? "📅 Próximo" : "📊 Reportó"}
                </Text>
              </View>

              {analysis[entry.ticker] ? (
                <View style={[s.analysisBox, { backgroundColor: colors.bgRaised }]}>
                  <Text style={[s.analysisText, { color: colors.textSub }]}>
                    {analysis[entry.ticker]}
                  </Text>
                </View>
              ) : analyzing === entry.ticker ? (
                <View style={s.analyzingRow}>
                  <ActivityIndicator size="small" color={colors.accentLight} />
                  <Text style={[s.analyzingText, { color: colors.textMuted }]}>
                    Analizando con IA...
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => handleAnalyze(entry.ticker)}
                  style={s.aiBtn}
                  activeOpacity={0.7}
                >
                  <Ionicons name="flash-outline" size={12} color={colors.accentLight} />
                  <Text style={[s.aiBtnText, { color: colors.accentLight }]}>Análisis IA</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {/* ── Legend ── */}
      <View style={[s.legend, { borderTopColor: colors.border }]}>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: colors.accentLight }]} />
          <Text style={[s.legendText, { color: colors.textMuted }]}>Portafolio</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: "#60a5fa" }]} />
          <Text style={[s.legendText, { color: colors.textMuted }]}>Watchlist</Text>
        </View>
        {allTickers.length > 0 && (
          <Text style={[s.legendCount, { color: colors.textDim }]}>
            {allTickers.length} activos
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
    lockedCard: {
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 24,
      alignItems: "center",
      gap: 10,
    },
    lockIcon: {
      width: 48, height: 48, borderRadius: 14,
      alignItems: "center", justifyContent: "center",
    },
    lockTitle: { fontSize: 14, fontWeight: "800", textAlign: "center" },
    lockSub: { fontSize: 12, textAlign: "center", lineHeight: 18 },
    lockBtn: {
      backgroundColor: "#00a85e",
      paddingHorizontal: 20, paddingVertical: 10,
      borderRadius: 12, marginTop: 4,
    },
    lockBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },

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
      flex: 1, minHeight: 60,
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
    tickerBadgeText: { fontSize: 6, fontWeight: "900" },

    detailWrap: {
      borderTopWidth: StyleSheet.hairlineWidth,
      padding: 14,
      gap: 8,
    },
    detailTitle: { fontSize: 12, fontWeight: "800", marginBottom: 4 },
    detailRow: { paddingTop: 8, gap: 6 },
    detailHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
    detailTicker: { fontSize: 13, fontWeight: "900" },
    badge: {
      flexDirection: "row", alignItems: "center", gap: 3,
      paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20,
    },
    badgeText: { fontSize: 9, fontWeight: "700" },
    statusText: { fontSize: 9, marginLeft: "auto" as never },
    analysisBox: {
      padding: 10, borderRadius: 10,
    },
    analysisText: { fontSize: 11, lineHeight: 17 },
    analyzingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
    analyzingText: { fontSize: 11 },
    aiBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2 },
    aiBtnText: { fontSize: 11, fontWeight: "700" },

    legend: {
      flexDirection: "row", alignItems: "center",
      gap: 14, paddingHorizontal: 14, paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    legendDot: { width: 7, height: 7, borderRadius: 4 },
    legendText: { fontSize: 10 },
    legendCount: { fontSize: 10, marginLeft: "auto" as never },
  });
}
