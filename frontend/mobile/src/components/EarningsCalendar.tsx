import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { earningsApi } from "../lib/api";
import { useTheme } from "../lib/ThemeContext";
import Markdown from "react-native-markdown-display";

interface Position { ticker: string; shares?: number; avg_cost?: number; }
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
}

interface Props {
  positions: Position[];
  isPremium: boolean;
  onUpgrade: () => void;
}

function daysLabel(t: TFunction, dateStr: string | null, status: string): string {
  if (!dateStr) return t("earningsCalendar.dateTbd");
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (status === "today" || diff === 0) return t("earningsCalendar.today");
  if (diff === 1) return t("earningsCalendar.tomorrow");
  if (diff < 0) return t("earningsCalendar.daysAgo", { days: Math.abs(diff) });
  return t("earningsCalendar.inDays", { days: diff });
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export default function EarningsCalendar({ positions, isPremium, onUpgrade }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [calendar, setCalendar] = useState<EarningsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});

  const symbols = positions.map(p => p.ticker).filter(Boolean);

  const triggerAnalysis = useCallback(async (ticker: string) => {
    if (analysis[ticker] || analyzing[ticker]) return;
    setAnalyzing(prev => ({ ...prev, [ticker]: true }));
    const pos = positions.find(p => p.ticker === ticker);
    try {
      const res: any = await earningsApi.getAnalysis(ticker, pos?.shares ?? 0, pos?.avg_cost ?? 0);
      setAnalysis(prev => ({ ...prev, [ticker]: res.data.analysis }));
    } catch {
      setAnalysis(prev => ({ ...prev, [ticker]: t("earningsCalendar.analysisError") }));
    } finally {
      setAnalyzing(prev => ({ ...prev, [ticker]: false }));
    }
  }, [analysis, analyzing, positions]);

  useEffect(() => {
    if (!isPremium || symbols.length === 0) return;
    setLoading(true);
    earningsApi.getCalendar(symbols)
      .then((res: any) => {
        const all: EarningsEntry[] = res.data.earnings || [];
        const order: Record<string, number> = { today: 0, upcoming: 1, past: 2, unknown: 3 };
        const earnings = all
          .filter((e) => e.event_type === "earnings")
          .sort((a, b) => {
            const od = (order[a.status] ?? 3) - (order[b.status] ?? 3);
            if (od !== 0) return od;
            return (a.event_date || "z") < (b.event_date || "z") ? -1 : 1;
          });
        setCalendar(earnings);
        // Auto-trigger analysis for first 2 upcoming
        const autoAnalyze = earnings.filter(e => e.status === "upcoming" || e.status === "today").slice(0, 2);
        for (const e of autoAnalyze) {
          earningsApi.getAnalysis(e.ticker, positions.find(p => p.ticker === e.ticker)?.shares ?? 0, positions.find(p => p.ticker === e.ticker)?.avg_cost ?? 0)
            .then((res: any) => setAnalysis(prev => ({ ...prev, [e.ticker]: res.data.analysis })))
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isPremium, symbols.join(",")]);

  const handleExpand = (entry: EarningsEntry) => {
    if (expanded === entry.ticker) { setExpanded(null); return; }
    setExpanded(entry.ticker);
    triggerAnalysis(entry.ticker);
  };

  const s = StyleSheet.create({
    card:    { borderRadius: 18, borderWidth: 1, overflow: "hidden", marginBottom: 12 },
    header:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14 },
    title:   { fontSize: 14, fontWeight: "800", marginBottom: 2 },
    sub:     { fontSize: 11 },
    row:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
    badge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignSelf: "flex-start" },
    detail:  { padding: 14, paddingTop: 8 },
    chip:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginRight: 6, marginBottom: 8 },
  });

  if (!isPremium) {
    return (
      <TouchableOpacity
        onPress={onUpgrade}
        style={[s.card, { borderColor: "rgba(245,158,11,0.35)", backgroundColor: "rgba(245,158,11,0.06)" }]}
        activeOpacity={0.8}
      >
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Text style={{ fontSize: 16 }}>📅</Text>
              <Text style={[s.title, { color: colors.text }]}>{t("earningsCalendar.title")}</Text>
              <View style={{ backgroundColor: "#f59e0b22", borderWidth: 1, borderColor: "#f59e0b44", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, fontWeight: "800", color: "#f59e0b" }}>PREMIUM</Text>
              </View>
            </View>
            <Text style={[s.sub, { color: colors.textMuted }]}>
              {t("earningsCalendar.premiumSub")}
            </Text>
          </View>
          <Ionicons name="lock-closed-outline" size={18} color="#f59e0b" style={{ marginLeft: 8 }} />
        </View>
      </TouchableOpacity>
    );
  }

  if (loading) {
    return (
      <View style={[s.card, { borderColor: colors.border, backgroundColor: colors.card, padding: 24, alignItems: "center", gap: 8 }]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={{ fontSize: 12, color: colors.textMuted }}>{t("earningsCalendar.loadingEarnings")}</Text>
      </View>
    );
  }

  const upcoming = calendar.filter(e => e.status === "upcoming" || e.status === "today");
  const past     = calendar.filter(e => e.status === "past");
  const unknown  = calendar.filter(e => e.status === "unknown");

  return (
    <View style={[s.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
        <Text style={{ fontSize: 16 }}>📅</Text>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[s.title, { color: colors.text }]}>{t("earningsCalendar.title")}</Text>
          <Text style={[s.sub, { color: colors.textMuted }]}>
            {upcoming.length > 0
              ? t("earningsCalendar.upcomingCount", { count: upcoming.length, total: calendar.length })
              : t("earningsCalendar.eventsCount", { count: calendar.length })}
          </Text>
        </View>
      </View>

      {/* ── Upcoming ── */}
      {upcoming.map((entry) => (
        <EntryRow key={entry.ticker} entry={entry} expanded={expanded} onExpand={handleExpand}
          analysis={analysis[entry.ticker]} analyzing={!!analyzing[entry.ticker]} colors={colors} s={s} />
      ))}

      {/* ── Section divider ── */}
      {past.length > 0 && (
        <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.raised ?? "#0d0f14", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
          <Text style={{ fontSize: 10, fontWeight: "800", color: colors.textDim, textTransform: "uppercase", letterSpacing: 1 }}>{t("earningsCalendar.recentReports")}</Text>
        </View>
      )}
      {past.map((entry) => (
        <EntryRow key={entry.ticker} entry={entry} expanded={expanded} onExpand={handleExpand}
          analysis={analysis[entry.ticker]} analyzing={!!analyzing[entry.ticker]} colors={colors} s={s} />
      ))}

      {/* ── Unknown / no date ── */}
      {unknown.length > 0 && (
        <View>
          {(upcoming.length > 0 || past.length > 0) && (
            <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.raised ?? "#0d0f14", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
              <Text style={{ fontSize: 10, fontWeight: "800", color: colors.textDim, textTransform: "uppercase", letterSpacing: 1 }}>{t("earningsCalendar.dateTbd")}</Text>
            </View>
          )}
          {unknown.map((entry) => (
            <View key={entry.ticker} style={[s.row, { borderTopColor: colors.border }]}>
              <View style={[s.badge, { backgroundColor: colors.border }]}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textMuted }}>{entry.ticker}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>{entry.ticker}</Text>
                <Text style={{ fontSize: 11, color: colors.textDim }}>{t("earningsCalendar.dateTbd")}</Text>
              </View>
              <Ionicons name="help-circle-outline" size={16} color={colors.textDim} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function EntryRow({ entry, expanded, onExpand, analysis, analyzing, colors, s }: {
  entry: EarningsEntry; expanded: string | null; onExpand: (e: EarningsEntry) => void;
  analysis?: string; analyzing: boolean; colors: any; s: any;
}) {
  const { t } = useTranslation();
  const isExpanded = expanded === entry.ticker;
  const isUpcoming = entry.status === "upcoming" || entry.status === "today";
  const beat = entry.eps_actual != null && entry.eps_estimate != null && entry.eps_actual >= entry.eps_estimate;
  const miss = entry.eps_actual != null && entry.eps_estimate != null && entry.eps_actual < entry.eps_estimate;
  const accent = colors.accent ?? "#22c55e";

  return (
    <View>
      <TouchableOpacity style={[s.row, { borderTopColor: colors.border }]} onPress={() => onExpand(entry)} activeOpacity={0.7}>
        <View style={[s.badge, { backgroundColor: isUpcoming ? accent + "18" : colors.border }]}>
          <Text style={{ fontSize: 11, fontWeight: "800", color: isUpcoming ? accent : colors.textMuted }}>{entry.ticker}</Text>
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>
              {daysLabel(t, entry.event_date, entry.status)}
            </Text>
            {entry.event_date && (
              <Text style={{ fontSize: 11, color: colors.textDim }}>{formatDate(entry.event_date)}</Text>
            )}
            {beat && <View style={{ backgroundColor: accent + "20", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontWeight: "800", color: accent }}>✓ Beat</Text></View>}
            {miss && <View style={{ backgroundColor: "#ef444420", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontWeight: "800", color: "#f87171" }}>✗ Miss</Text></View>}
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
            {entry.eps_estimate != null && (
              <Text style={{ fontSize: 10, color: colors.textDim }}>
                EPS est. ${entry.eps_estimate}
                {entry.eps_actual != null && (
                  <Text style={{ color: beat ? accent : "#f87171" }}> → ${entry.eps_actual}</Text>
                )}
              </Text>
            )}
            {entry.timing && <Text style={{ fontSize: 10, color: colors.textDim }}>{entry.timing}</Text>}
          </View>
        </View>

        <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textDim} />
      </TouchableOpacity>

      {isExpanded && (
        <View style={[s.detail, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bg }]}>
          {/* EPS / Revenue chips */}
          {(entry.eps_range || entry.revenue_estimate) && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 8 }}>
              {entry.eps_range && (
                <View style={[s.chip, { backgroundColor: "rgba(0,212,126,0.08)", borderWidth: 1, borderColor: "rgba(0,212,126,0.2)" }]}>
                  <Text style={{ fontSize: 10, color: "#00d47e", fontWeight: "700" }}>EPS {entry.eps_range}</Text>
                </View>
              )}
              {entry.revenue_estimate && (
                <View style={[s.chip, { backgroundColor: "rgba(99,102,241,0.08)", borderWidth: 1, borderColor: "rgba(99,102,241,0.2)" }]}>
                  <Text style={{ fontSize: 10, color: "#818cf8", fontWeight: "700" }}>Rev. est. {entry.revenue_estimate}</Text>
                </View>
              )}
              {entry.revenue_actual && (
                <View style={[s.chip, { backgroundColor: "rgba(99,102,241,0.08)", borderWidth: 1, borderColor: "rgba(99,102,241,0.2)" }]}>
                  <Text style={{ fontSize: 10, color: "#818cf8", fontWeight: "700" }}>{t("earningsCalendar.revActual", { value: entry.revenue_actual })}</Text>
                </View>
              )}
            </View>
          )}

          {analyzing ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{t("earningsCalendar.analyzingWithAi")}</Text>
            </View>
          ) : analysis ? (
            <Markdown style={{
              body: { color: colors.textSub, fontSize: 13, lineHeight: 20 },
              strong: { color: colors.text, fontWeight: "800" },
              bullet_list_icon: { color: colors.accent },
            }}>
              {analysis}
            </Markdown>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{t("earningsCalendar.loadingAnalysis")}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
