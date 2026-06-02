import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet,
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
  const s = styles(colors);

  if (!isPremium) {
    return (
      <View style={[s.card, { borderColor: colors.border }]}>
        <View style={s.row}>
          <Ionicons name="calendar-outline" size={16} color={colors.accent} />
          <Text style={[s.title, { color: colors.text }]}>Análisis de Earnings</Text>
          <View style={s.premiumBadge}><Text style={s.premiumBadgeText}>PREMIUM</Text></View>
        </View>
        <Text style={[s.desc, { color: colors.muted }]}>
          Análisis automático cuando tus empresas reportan resultados trimestrales.
        </Text>
        <TouchableOpacity style={[s.btn, { backgroundColor: colors.accent }]} onPress={onUpgrade}>
          <Text style={s.btnText}>Activar Premium</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.card, { borderColor: colors.border }]}>
      <View style={[s.row, { marginBottom: 12 }]}>
        <Ionicons name="calendar-outline" size={16} color={colors.accent} />
        <Text style={[s.title, { color: colors.text }]}>Earnings de tu Portafolio</Text>
        {loading && <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: "auto" }} />}
      </View>

      {!loading && relevant.length === 0 && (
        <Text style={[s.empty, { color: colors.muted }]}>
          No hay earnings en los próximos 30 días.
        </Text>
      )}

      {relevant.map((entry) => {
        const isExpanded = expanded === entry.ticker;
        const isUpcoming = entry.status === "upcoming";
        return (
          <View key={entry.ticker}>
            <TouchableOpacity
              style={[s.earningsRow, { borderTopColor: colors.border }]}
              onPress={() => handleExpand(entry.ticker)}
            >
              <View style={[s.tickerBox, { backgroundColor: isUpcoming ? colors.accent + "18" : colors.raised }]}>
                <Text style={[s.tickerText, { color: isUpcoming ? colors.accent : colors.muted }]}>
                  {entry.ticker.slice(0, 4)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.tickerFull, { color: colors.text }]}>{entry.ticker}</Text>
                <Text style={[s.earningsDate, { color: colors.muted }]}>
                  {isUpcoming ? "📅 " : "📊 "}{entry.earnings_date}
                </Text>
              </View>
              <Ionicons
                name={isExpanded ? "chevron-up" : "chevron-down"}
                size={14} color={colors.muted}
              />
            </TouchableOpacity>

            {isExpanded && (
              <View style={[s.analysisBox, { backgroundColor: colors.raised }]}>
                {analyzing === entry.ticker ? (
                  <View style={s.analyzeRow}>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={[s.analyzeText, { color: colors.muted }]}>Analizando con IA...</Text>
                  </View>
                ) : (
                  <Text style={[s.analysisText, { color: colors.subtext }]}>
                    {analysis[entry.ticker] || "Toca para ver el análisis."}
                  </Text>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card:       { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  row:        { flexDirection: "row", alignItems: "center", gap: 8 },
  title:      { fontSize: 14, fontWeight: "700" },
  desc:       { fontSize: 12, lineHeight: 18, marginVertical: 8 },
  btn:        { borderRadius: 12, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  btnText:    { color: "white", fontWeight: "700", fontSize: 13 },
  premiumBadge:     { marginLeft: "auto", backgroundColor: c.accent + "20", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  premiumBadgeText: { color: c.accent, fontSize: 9, fontWeight: "800" },
  empty:      { fontSize: 12, textAlign: "center", paddingVertical: 8 },
  earningsRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  tickerBox:  { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tickerText: { fontSize: 10, fontWeight: "800" },
  tickerFull: { fontSize: 13, fontWeight: "700" },
  earningsDate: { fontSize: 11, marginTop: 2 },
  analysisBox: { borderRadius: 12, padding: 12, marginBottom: 8 },
  analyzeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  analyzeText: { fontSize: 12 },
  analysisText: { fontSize: 12, lineHeight: 18 },
});
