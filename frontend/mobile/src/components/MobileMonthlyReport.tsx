import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, ScrollView,
  ActivityIndicator, StyleSheet, Share,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";
import { reportApi } from "../lib/api";

interface Position {
  ticker: string; name?: string; shares?: number;
  avg_cost?: number; current_price?: number; value?: number;
}
interface Props {
  positions: Position[];
  isPremium: boolean;
  onUpgrade: () => void;
}

export default function MobileMonthlyReport({ positions, isPremium, onUpgrade }: Props) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [report, setReport]   = useState<any>(null);
  const [open, setOpen]       = useState(false);
  const s = styles(colors);

  const handleGenerate = async () => {
    if (!isPremium) { onUpgrade(); return; }
    setLoading(true);
    try {
      const portfolio = positions.map((p) => ({
        ticker: p.ticker, name: p.name || p.ticker,
        shares: p.shares || 0, avg_cost: p.avg_cost || 0,
        current_price: p.current_price || 0, value: p.value || 0,
      }));
      const res: any = await reportApi.monthly(portfolio);
      setReport(res.data);
      setOpen(true);
    } catch {
      alert("No se pudo generar el reporte.");
    } finally { setLoading(false); }
  };

  const handleShare = async () => {
    if (!report) return;
    const text = `📊 Reporte Nuvos AI — ${report.month}\n\n${report.executive_summary}\n\nRendimiento: ${report.performance?.total_return_pct?.toFixed(2)}%\nValor total: $${report.performance?.total_value?.toLocaleString()}\n\n🎓 ${report.mentor_note}`;
    await Share.share({ message: text, title: `Reporte ${report.month}` });
  };

  const retPct   = report?.performance?.total_return_pct ?? 0;
  const isPos    = retPct >= 0;

  return (
    <>
      <TouchableOpacity
        style={[s.trigger, { borderColor: colors.border, backgroundColor: colors.raised }]}
        onPress={handleGenerate}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator size="small" color={colors.accent} />
          : <Ionicons name="document-text-outline" size={16} color={colors.accent} />
        }
        <Text style={[s.triggerText, { color: colors.subtext }]}>
          {loading ? "Generando..." : "Reporte mensual"}
        </Text>
        {!isPremium && (
          <View style={[s.premiumBadge, { backgroundColor: colors.accent + "20" }]}>
            <Text style={[s.premiumBadgeText, { color: colors.accent }]}>PREMIUM</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={14} color={colors.muted} style={{ marginLeft: "auto" }} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[s.modal, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[s.modalHeader, { borderBottomColor: colors.border }]}>
            <View>
              <Text style={[s.modalTitle, { color: colors.text }]}>📊 {report?.month}</Text>
              <Text style={[s.modalSub, { color: colors.muted }]}>Reporte de portafolio</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <TouchableOpacity onPress={handleShare}>
                <Ionicons name="share-outline" size={20} color={colors.accent} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Ionicons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}>
            {/* Executive summary */}
            {report?.executive_summary && (
              <View style={[s.summaryBox, { backgroundColor: colors.raised }]}>
                <Text style={[s.summaryText, { color: colors.text }]}>{report.executive_summary}</Text>
              </View>
            )}

            {/* Key metrics */}
            <View style={s.metricsGrid}>
              {[
                { label: "Rendimiento", value: `${isPos ? "+" : ""}${retPct.toFixed(2)}%`, color: isPos ? "#22c55e" : "#ef4444" },
                { label: "Valor total", value: `$${(report?.performance?.total_value ?? 0).toLocaleString()}`, color: colors.text },
                { label: "Ganancia", value: `${(report?.performance?.unrealized_gain ?? 0) >= 0 ? "+" : ""}$${Math.abs(report?.performance?.unrealized_gain ?? 0).toLocaleString()}`, color: (report?.performance?.unrealized_gain ?? 0) >= 0 ? "#22c55e" : "#ef4444" },
                { label: "vs S&P 500", value: report?.performance?.vs_sp500 ?? "—", color: colors.subtext },
              ].map((m) => (
                <View key={m.label} style={[s.metricCard, { backgroundColor: colors.raised, borderColor: colors.border }]}>
                  <Text style={[s.metricLabel, { color: colors.muted }]}>{m.label}</Text>
                  <Text style={[s.metricValue, { color: m.color }]}>{m.value}</Text>
                </View>
              ))}
            </View>

            {/* Best/Worst */}
            <View style={s.bwRow}>
              <View style={[s.bwCard, { borderColor: "#22c55e40", backgroundColor: "#22c55e0A" }]}>
                <Text style={[s.bwLabel, { color: "#22c55e" }]}>🏆 Mejor</Text>
                <Text style={[s.bwTicker, { color: colors.text }]}>{report?.performance?.best_performer?.ticker ?? "—"}</Text>
                <Text style={[s.bwPct, { color: "#22c55e" }]}>+{report?.performance?.best_performer?.gain_pct?.toFixed(2) ?? 0}%</Text>
              </View>
              <View style={[s.bwCard, { borderColor: "#ef444440", backgroundColor: "#ef44440A" }]}>
                <Text style={[s.bwLabel, { color: "#ef4444" }]}>📉 Peor</Text>
                <Text style={[s.bwTicker, { color: colors.text }]}>{report?.performance?.worst_performer?.ticker ?? "—"}</Text>
                <Text style={[s.bwPct, { color: "#ef4444" }]}>{report?.performance?.worst_performer?.loss_pct?.toFixed(2) ?? 0}%</Text>
              </View>
            </View>

            {/* Advanced metrics */}
            {report?.metrics && (
              <View style={s.advRow}>
                {[
                  { label: "Sharpe", value: report.metrics.sharpe_ratio?.toFixed(2) ?? "—" },
                  { label: "Volatilidad", value: report.metrics.volatility_pct ? `${report.metrics.volatility_pct.toFixed(1)}%` : "—" },
                  { label: "Drawdown", value: report.metrics.max_drawdown_pct ? `${report.metrics.max_drawdown_pct.toFixed(1)}%` : "—" },
                ].map((m) => (
                  <View key={m.label} style={[s.advCard, { backgroundColor: colors.raised, borderColor: colors.border }]}>
                    <Text style={[s.advLabel, { color: colors.muted }]}>{m.label}</Text>
                    <Text style={[s.advValue, { color: colors.text }]}>{m.value}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Mentor note */}
            {report?.mentor_note && (
              <View style={[s.mentorBox, { backgroundColor: colors.accent + "0D", borderColor: colors.accent + "40" }]}>
                <Text style={[s.mentorLabel, { color: colors.accent }]}>🎓 NOTA DE TU MENTOR</Text>
                <Text style={[s.mentorText, { color: colors.subtext }]}>{report.mentor_note}</Text>
              </View>
            )}

            {/* Action items */}
            {report?.action_items?.length > 0 && (
              <View>
                <Text style={[s.sectionLabel, { color: colors.muted }]}>✅ ACCIONES PARA EL PRÓXIMO MES</Text>
                {report.action_items.map((item: string, i: number) => (
                  <View key={i} style={[s.actionRow, { backgroundColor: colors.raised }]}>
                    <Text style={[s.actionNum, { color: colors.accent }]}>{i + 1}.</Text>
                    <Text style={[s.actionText, { color: colors.subtext }]}>{item}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Learning insight */}
            {report?.learning_insight && (
              <View style={[s.insightBox, { backgroundColor: "#8b5cf60D", borderColor: "#8b5cf640" }]}>
                <Text style={[s.insightLabel, { color: "#a78bfa" }]}>💡 INSIGHT CONDUCTUAL</Text>
                <Text style={[s.insightText, { color: colors.subtext }]}>{report.learning_insight}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = (c: any) => StyleSheet.create({
  trigger:     { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 },
  triggerText: { fontSize: 13, fontWeight: "600" },
  premiumBadge:     { borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 },
  premiumBadgeText: { fontSize: 9, fontWeight: "800" },
  modal:       { flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle:  { fontSize: 17, fontWeight: "800" },
  modalSub:    { fontSize: 11, marginTop: 2 },
  content:     { padding: 18, paddingBottom: 48, gap: 14 },
  summaryBox:  { borderRadius: 14, padding: 14 },
  summaryText: { fontSize: 13, lineHeight: 20 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metricCard:  { flex: 1, minWidth: "45%", borderRadius: 12, borderWidth: 1, padding: 12, alignItems: "center" },
  metricLabel: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", marginBottom: 4 },
  metricValue: { fontSize: 16, fontWeight: "900" },
  bwRow:  { flexDirection: "row", gap: 10 },
  bwCard: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 12 },
  bwLabel:  { fontSize: 11, fontWeight: "700", marginBottom: 4 },
  bwTicker: { fontSize: 16, fontWeight: "800" },
  bwPct:    { fontSize: 12, fontWeight: "700" },
  advRow:  { flexDirection: "row", gap: 8 },
  advCard: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 10, alignItems: "center" },
  advLabel: { fontSize: 10, fontWeight: "600" },
  advValue: { fontSize: 14, fontWeight: "800", marginTop: 3 },
  mentorBox:  { borderRadius: 14, borderWidth: 1, padding: 14 },
  mentorLabel: { fontSize: 10, fontWeight: "800", marginBottom: 6 },
  mentorText:  { fontSize: 13, lineHeight: 19 },
  sectionLabel: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  actionRow: { flexDirection: "row", gap: 8, borderRadius: 10, padding: 10, marginBottom: 6 },
  actionNum: { fontSize: 12, fontWeight: "800" },
  actionText: { fontSize: 12, lineHeight: 18, flex: 1 },
  insightBox:  { borderRadius: 14, borderWidth: 1, padding: 14 },
  insightLabel: { fontSize: 10, fontWeight: "800", marginBottom: 6 },
  insightText:  { fontSize: 13, lineHeight: 19 },
});
