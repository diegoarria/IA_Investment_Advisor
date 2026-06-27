import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
  eps_range?: string | null;
  revenue_estimate?: string | null;
}

interface Props {
  positions: Position[];
  isPremium: boolean;
  onUpgrade: () => void;
}

function daysUntil(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  if (diff < 0) return `Hace ${Math.abs(diff)}d`;
  return `En ${diff} días`;
}

export default function EarningsCalendar({ positions, isPremium, onUpgrade }: Props) {
  const { colors } = useTheme();
  const [calendar, setCalendar] = useState<EarningsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  const symbols = positions.map(p => p.ticker).filter(Boolean);

  useEffect(() => {
    if (!isPremium || symbols.length === 0) return;
    setLoading(true);
    earningsApi.getCalendar(symbols)
      .then((res: any) => {
        const events: EarningsEntry[] = (res.data.earnings || [])
          .filter((e: EarningsEntry) => e.event_date && e.event_type === "earnings");
        setCalendar(events);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isPremium, symbols.join(",")]);

  const handleExpand = async (entry: EarningsEntry) => {
    const key = entry.ticker;
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (analysis[key]) return;
    const pos = positions.find(p => p.ticker === key);
    setAnalyzing(key);
    try {
      const res: any = await earningsApi.getAnalysis(key, pos?.shares ?? 0, pos?.avg_cost ?? 0);
      setAnalysis(prev => ({ ...prev, [key]: res.data.analysis }));
    } catch {
      setAnalysis(prev => ({ ...prev, [key]: "No se pudo obtener el análisis." }));
    } finally {
      setAnalyzing(null);
    }
  };

  const s = StyleSheet.create({
    card:     { borderRadius: 18, borderWidth: 1, overflow: "hidden", marginBottom: 12 },
    header:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14 },
    title:    { fontSize: 14, fontWeight: "800", marginBottom: 2 },
    subtitle: { fontSize: 11 },
    row:      { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
    badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignSelf: "flex-start" },
    detail:   { padding: 14, paddingTop: 4 },
    chip:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginBottom: 8 },
  });

  if (!isPremium) {
    return (
      <TouchableOpacity
        onPress={onUpgrade}
        style={[s.card, { borderColor: "rgba(245,158,11,0.35)", backgroundColor: "rgba(245,158,11,0.06)" }]}
        activeOpacity={0.8}
      >
        <View style={[s.header]}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Text style={{ fontSize: 16 }}>📅</Text>
              <Text style={[s.title, { color: colors.text }]}>Calendario de Earnings</Text>
              <View style={{ backgroundColor: "#f59e0b22", borderWidth: 1, borderColor: "#f59e0b44", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, fontWeight: "800", color: "#f59e0b" }}>PREMIUM</Text>
              </View>
            </View>
            <Text style={[s.subtitle, { color: colors.textMuted }]}>
              Earnings de tus posiciones con análisis IA · fecha, EPS estimado e impacto en tu inversión
            </Text>
          </View>
          <Ionicons name="lock-closed-outline" size={18} color="#f59e0b" style={{ marginLeft: 8 }} />
        </View>
      </TouchableOpacity>
    );
  }

  if (loading) {
    return (
      <View style={[s.card, { borderColor: colors.border, backgroundColor: colors.card, padding: 20, alignItems: "center", gap: 8 }]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={{ fontSize: 12, color: colors.textMuted }}>Cargando earnings...</Text>
      </View>
    );
  }

  if (calendar.length === 0) {
    return (
      <View style={[s.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <View style={s.header}>
          <Text style={{ fontSize: 16 }}>📅</Text>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={[s.title, { color: colors.text }]}>Calendario de Earnings</Text>
            <Text style={[s.subtitle, { color: colors.textMuted }]}>Sin earnings próximos en tu portafolio</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
        <Text style={{ fontSize: 16 }}>📅</Text>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[s.title, { color: colors.text }]}>Calendario de Earnings</Text>
          <Text style={[s.subtitle, { color: colors.textMuted }]}>{calendar.length} evento{calendar.length !== 1 ? "s" : ""} en los próximos 6 meses</Text>
        </View>
      </View>

      {/* Earnings list */}
      {calendar.map((entry) => {
        const isExpanded = expanded === entry.ticker;
        const isUpcoming = entry.status === "upcoming" || entry.status === "today";
        const accentColor = isUpcoming ? colors.accent : colors.textMuted;

        return (
          <View key={entry.ticker}>
            <TouchableOpacity
              style={[s.row, { borderTopColor: colors.border }]}
              onPress={() => handleExpand(entry)}
              activeOpacity={0.7}
            >
              {/* Ticker badge */}
              <View style={[s.badge, { backgroundColor: isUpcoming ? colors.accent + "18" : colors.border }]}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: accentColor }}>
                  {entry.ticker}
                </Text>
              </View>

              {/* Info */}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>
                  {entry.event_date}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <Text style={{ fontSize: 11, color: isUpcoming ? colors.accent : colors.textMuted, fontWeight: "700" }}>
                    {daysUntil(entry.event_date)}
                  </Text>
                  {entry.eps_estimate != null && (
                    <Text style={{ fontSize: 10, color: colors.textDim }}>
                      · EPS est. ${entry.eps_estimate}
                    </Text>
                  )}
                </View>
              </View>

              {/* Chevron */}
              <Ionicons
                name={isExpanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.textDim}
              />
            </TouchableOpacity>

            {/* Expanded analysis */}
            {isExpanded && (
              <View style={[s.detail, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bg }]}>
                {/* Estimates row */}
                {(entry.eps_range || entry.revenue_estimate) && (
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
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
                  </View>
                )}

                {/* AI Analysis */}
                {analyzing === entry.ticker ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={{ fontSize: 12, color: colors.textMuted }}>Analizando con IA...</Text>
                  </View>
                ) : analysis[entry.ticker] ? (
                  <Markdown
                    style={{
                      body: { color: colors.textSub, fontSize: 13, lineHeight: 20 },
                      strong: { color: colors.text, fontWeight: "800" },
                      bullet_list_icon: { color: colors.accent },
                    }}
                  >
                    {analysis[entry.ticker]}
                  </Markdown>
                ) : (
                  <TouchableOpacity
                    onPress={() => handleExpand(entry)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
                    <Text style={{ fontSize: 13, color: colors.accent, fontWeight: "700" }}>Ver análisis IA</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
