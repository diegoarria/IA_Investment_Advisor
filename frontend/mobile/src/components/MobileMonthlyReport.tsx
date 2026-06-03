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

  const TOOL_COLOR = "#3b82f6";

  return (
    <>
      <TouchableOpacity onPress={handleGenerate} disabled={loading} activeOpacity={0.93}
        style={[s.card, { backgroundColor: colors.card }]}>

        {/* Hero */}
        <View style={[s.hero, { backgroundColor: TOOL_COLOR + "18" }]}>
          <View style={[s.circle1, { backgroundColor: TOOL_COLOR + "15" }]} />
          <View style={[s.circle2, { backgroundColor: TOOL_COLOR + "0A" }]} />
          <View style={[s.iconOuter, { backgroundColor: TOOL_COLOR + "25", borderColor: TOOL_COLOR + "40" }]}>
            <View style={[s.iconInner, { backgroundColor: TOOL_COLOR }]}>
              {loading
                ? <ActivityIndicator color="white" size="small" />
                : <Ionicons name="document-text" size={28} color="white" />}
            </View>
          </View>
        </View>

        {/* Content */}
        <View style={s.cardContent}>
          <Text style={[s.cardTitle, { color: colors.text }]}>Reporte Mensual</Text>
          <Text style={[s.cardTagline, { color: TOOL_COLOR }]}>Tu portafolio analizado con IA cada mes</Text>

          <View style={[s.featureList, { borderColor: colors.border }]}>
            {[
              { icon: "📊", text: "Rendimiento real vs S&P 500 y benchmarks" },
              { icon: "📉", text: "Sharpe ratio, volatilidad y drawdown" },
              { icon: "✅", text: "3 acciones concretas para el mes siguiente" },
            ].map((f, i, arr) => (
              <View key={f.text} style={[s.featureRow,
                i < arr.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                <View style={[s.featureIconBox, { backgroundColor: TOOL_COLOR + "12" }]}>
                  <Text style={{ fontSize: 15 }}>{f.icon}</Text>
                </View>
                <Text style={[s.featureText, { color: colors.textSub }]}>{f.text}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity onPress={handleGenerate} disabled={loading} activeOpacity={0.85}
            style={[s.cta, { backgroundColor: TOOL_COLOR }]}>
            <View style={s.ctaGlow} />
            {loading
              ? <><ActivityIndicator color="white" size="small" /><Text style={s.ctaText}>Generando...</Text></>
              : <><Ionicons name="sparkles" size={16} color="white" /><Text style={s.ctaText}>Generar Reporte</Text></>}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[s.modal, { backgroundColor: colors.bg }]}>
          {/* Header */}
          <View style={[s.modalHeader, { borderBottomColor: colors.border }]}>
            <View>
              <Text style={[s.modalTitle, { color: colors.text }]}>📊 {report?.month}</Text>
              <Text style={[s.modalSub, { color: colors.textMuted }]}>Reporte de portafolio</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <TouchableOpacity onPress={handleShare}>
                <Ionicons name="share-outline" size={20} color={colors.accent} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}>
            {/* Executive summary */}
            {report?.executive_summary && (
              <View style={[s.summaryBox, { backgroundColor: colors.bgRaised }]}>
                <Text style={[s.summaryText, { color: colors.text }]}>{report.executive_summary}</Text>
              </View>
            )}

            {/* Key metrics */}
            <View style={s.metricsGrid}>
              {[
                { label: "Rendimiento", value: `${isPos ? "+" : ""}${retPct.toFixed(2)}%`, color: isPos ? "#22c55e" : "#ef4444" },
                { label: "Valor total", value: `$${(report?.performance?.total_value ?? 0).toLocaleString()}`, color: colors.text },
                { label: "Ganancia", value: `${(report?.performance?.unrealized_gain ?? 0) >= 0 ? "+" : ""}$${Math.abs(report?.performance?.unrealized_gain ?? 0).toLocaleString()}`, color: (report?.performance?.unrealized_gain ?? 0) >= 0 ? "#22c55e" : "#ef4444" },
                { label: "vs S&P 500", value: report?.performance?.vs_sp500 ?? "—", color: colors.textSub },
              ].map((m) => (
                <View key={m.label} style={[s.metricCard, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
                  <Text style={[s.metricLabel, { color: colors.textMuted }]}>{m.label}</Text>
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
                  <View key={m.label} style={[s.advCard, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
                    <Text style={[s.advLabel, { color: colors.textMuted }]}>{m.label}</Text>
                    <Text style={[s.advValue, { color: colors.text }]}>{m.value}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Mentor note */}
            {report?.mentor_note && (
              <View style={[s.mentorBox, { backgroundColor: colors.accent + "0D", borderColor: colors.accent + "40" }]}>
                <Text style={[s.mentorLabel, { color: colors.accent }]}>🎓 NOTA DE TU MENTOR</Text>
                <Text style={[s.mentorText, { color: colors.textSub }]}>{report.mentor_note}</Text>
              </View>
            )}

            {/* Action items */}
            {report?.action_items?.length > 0 && (
              <View>
                <Text style={[s.sectionLabel, { color: colors.textMuted }]}>✅ ACCIONES PARA EL PRÓXIMO MES</Text>
                {report.action_items.map((item: string, i: number) => (
                  <View key={i} style={[s.actionRow, { backgroundColor: colors.bgRaised }]}>
                    <Text style={[s.actionNum, { color: colors.accent }]}>{i + 1}.</Text>
                    <Text style={[s.actionText, { color: colors.textSub }]}>{item}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Learning insight */}
            {report?.learning_insight && (
              <View style={[s.insightBox, { backgroundColor: "#8b5cf60D", borderColor: "#8b5cf640" }]}>
                <Text style={[s.insightLabel, { color: "#a78bfa" }]}>💡 INSIGHT CONDUCTUAL</Text>
                <Text style={[s.insightText, { color: colors.textSub }]}>{report.learning_insight}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = (_c: any) => StyleSheet.create({
  // ── Trigger card ──────────────────────────────────────
  card:        { borderRadius: 24, overflow: "hidden", marginBottom: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 6 },
  hero:        { paddingTop: 30, paddingBottom: 24, alignItems: "center", position: "relative", overflow: "hidden" },
  circle1:     { position: "absolute", width: 160, height: 160, borderRadius: 80, top: -50, right: -30 },
  circle2:     { position: "absolute", width: 100, height: 100, borderRadius: 50, bottom: -25, left: -15 },
  iconOuter:   { width: 80, height: 80, borderRadius: 24, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  iconInner:   { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  cardContent: { padding: 20, paddingTop: 16 },
  cardTitle:   { fontSize: 20, fontWeight: "900", letterSpacing: -0.5, marginBottom: 4, textAlign: "center" },
  cardTagline: { fontSize: 12, fontWeight: "700", textAlign: "center", marginBottom: 16, letterSpacing: 0.2 },
  featureList: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", marginBottom: 18 },
  featureRow:  { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 14 },
  featureIconBox: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  featureText: { fontSize: 13, flex: 1, lineHeight: 18, fontWeight: "500" },
  cta:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, paddingVertical: 15, overflow: "hidden" },
  ctaGlow:     { position: "absolute", top: 0, left: 0, right: 0, height: "50%", backgroundColor: "rgba(255,255,255,0.12)" },
  ctaText:     { color: "white", fontWeight: "800", fontSize: 15, letterSpacing: 0.2 },
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
