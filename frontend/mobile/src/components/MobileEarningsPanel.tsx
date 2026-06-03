import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";
import { earningsApi } from "../lib/api";

interface Position { ticker: string; shares?: number; avg_cost?: number; }
interface EarningsEntry { ticker: string; earnings_date: string | null; status: string; }

interface Props {
  positions: Position[];
  isPremium: boolean;
  onUpgrade: () => void;
}

const TOOL_COLOR = "#22c55e";

export default function MobileEarningsPanel({ positions, isPremium, onUpgrade }: Props) {
  const { colors } = useTheme();
  const [calendar, setCalendar]   = useState<EarningsEntry[]>([]);
  const [loading, setLoading]     = useState(false);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [analysis, setAnalysis]   = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  const symbols = positions.map((p) => p.ticker);

  useEffect(() => {
    if (!isPremium || symbols.length === 0) return;
    setLoading(true);
    earningsApi.getCalendar(symbols)
      .then((res: any) => setCalendar(res.data.earnings || []))
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
      const res: any = await earningsApi.getAnalysis(ticker, pos?.shares ?? 0, pos?.avg_cost ?? 0);
      setAnalysis((prev) => ({ ...prev, [ticker]: res.data.analysis }));
    } catch {
      setAnalysis((prev) => ({ ...prev, [ticker]: "No se pudo obtener el análisis." }));
    } finally { setAnalyzing(null); }
  };

  const relevant = calendar.filter((e) => e.earnings_date);
  const s = styles();

  return (
    <View style={[s.card, { backgroundColor: colors.card }]}>

      {/* ── Hero ── */}
      <View style={[s.hero, { backgroundColor: TOOL_COLOR + "18" }]}>
        <View style={[s.circle1, { backgroundColor: TOOL_COLOR + "15" }]} />
        <View style={[s.circle2, { backgroundColor: TOOL_COLOR + "0A" }]} />
        <View style={[s.iconOuter, { backgroundColor: TOOL_COLOR + "25", borderColor: TOOL_COLOR + "40" }]}>
          <View style={[s.iconInner, { backgroundColor: TOOL_COLOR }]}>
            {loading
              ? <ActivityIndicator color="white" size="small" />
              : <Ionicons name="calendar" size={28} color="white" />}
          </View>
        </View>
        <Text style={[s.heroTitle, { color: colors.text }]}>Earnings de tu Portafolio</Text>
        <Text style={[s.heroTagline, { color: TOOL_COLOR }]}>Análisis IA automático de resultados</Text>
      </View>

      {/* ── Content ── */}
      <View style={s.content}>
        {loading && (
          <View style={s.loadingRow}>
            <ActivityIndicator size="small" color={TOOL_COLOR} />
            <Text style={[s.loadingText, { color: colors.textMuted }]}>Cargando calendario...</Text>
          </View>
        )}

        {!loading && relevant.length === 0 && (
          <View style={s.emptyWrap}>
            <Text style={{ fontSize: 28 }}>📅</Text>
            <Text style={[s.emptyText, { color: colors.textMuted }]}>
              No hay earnings en los próximos 30 días.
            </Text>
          </View>
        )}

        {relevant.map((entry) => {
          const isExpanded = expanded === entry.ticker;
          const isUpcoming = entry.status === "upcoming";
          return (
            <View key={entry.ticker}>
              <TouchableOpacity
                style={[s.earningsRow, { borderTopColor: colors.border }]}
                onPress={() => handleExpand(entry.ticker)}
                activeOpacity={0.7}
              >
                <View style={[s.tickerBox, {
                  backgroundColor: isUpcoming ? TOOL_COLOR + "18" : colors.bgRaised,
                }]}>
                  <Text style={[s.tickerText, { color: isUpcoming ? TOOL_COLOR : colors.textMuted }]}>
                    {entry.ticker.slice(0, 4)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.tickerFull, { color: colors.text }]}>{entry.ticker}</Text>
                  <Text style={[s.earningsDate, { color: colors.textMuted }]}>
                    {isUpcoming ? "📅 " : "📊 "}{entry.earnings_date}
                  </Text>
                </View>
                <Ionicons
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={14} color={colors.textMuted}
                />
              </TouchableOpacity>

              {isExpanded && (
                <View style={[s.analysisBox, { backgroundColor: colors.bgRaised }]}>
                  {analyzing === entry.ticker ? (
                    <View style={s.analyzeRow}>
                      <ActivityIndicator size="small" color={TOOL_COLOR} />
                      <Text style={[s.analyzeText, { color: colors.textMuted }]}>Analizando con IA...</Text>
                    </View>
                  ) : (
                    <Text style={[s.analysisText, { color: colors.textSub }]}>
                      {analysis[entry.ticker] || "Toca para ver el análisis."}
                    </Text>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = () => StyleSheet.create({
  card:       { borderRadius: 24, overflow: "hidden", marginBottom: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 6 },

  // Hero
  hero:       { paddingTop: 28, paddingBottom: 20, alignItems: "center", position: "relative", overflow: "hidden" },
  circle1:    { position: "absolute", width: 160, height: 160, borderRadius: 80, top: -50, right: -30 },
  circle2:    { position: "absolute", width: 100, height: 100, borderRadius: 50, bottom: -25, left: -15 },
  iconOuter:  { width: 80, height: 80, borderRadius: 24, borderWidth: 2, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  iconInner:  { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  heroTitle:  { fontSize: 20, fontWeight: "900", letterSpacing: -0.5, marginBottom: 4, textAlign: "center" },
  heroTagline:{ fontSize: 12, fontWeight: "700", textAlign: "center", letterSpacing: 0.2 },

  // Content
  content:    { paddingHorizontal: 16, paddingBottom: 16 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 16, justifyContent: "center" },
  loadingText:{ fontSize: 13 },
  emptyWrap:  { alignItems: "center", paddingVertical: 20, gap: 8 },
  emptyText:  { fontSize: 13, textAlign: "center" },

  // Earnings rows
  earningsRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth },
  tickerBox:    { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tickerText:   { fontSize: 10, fontWeight: "800" },
  tickerFull:   { fontSize: 13, fontWeight: "700" },
  earningsDate: { fontSize: 11, marginTop: 2 },
  analysisBox:  { borderRadius: 12, padding: 12, marginBottom: 8 },
  analyzeRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  analyzeText:  { fontSize: 12 },
  analysisText: { fontSize: 12, lineHeight: 18 },
});
