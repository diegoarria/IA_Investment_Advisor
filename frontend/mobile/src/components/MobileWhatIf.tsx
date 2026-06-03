import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput, Modal, ScrollView,
  ActivityIndicator, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";
import { simulateApi } from "../lib/api";

interface Position {
  ticker: string; name?: string; shares?: number;
  avg_cost?: number; current_price?: number; value?: number;
}
interface Props {
  positions: Position[];
  isPremium: boolean;
  onUpgrade: () => void;
}

const SCENARIOS = [
  { id: "swap",        label: "Cambiar posición",     icon: "swap-horizontal-outline" },
  { id: "add_monthly", label: "Aporte mensual",        icon: "trending-up-outline" },
  { id: "macro",       label: "Evento macro",          icon: "globe-outline" },
  { id: "custom",      label: "Escenario libre",       icon: "create-outline" },
] as const;

const MACRO_EVENTS = [
  "La Fed sube tasas al 7%",
  "Recesión en EE.UU.",
  "Crash tech -40%",
  "Boom de IA +50%",
  "Inflación 8%",
];

export default function MobileWhatIf({ positions, isPremium, onUpgrade }: Props) {
  const { colors } = useTheme();
  const [open, setOpen]               = useState(false);
  const [scenarioType, setScenarioType] = useState<string>("swap");
  const [params, setParams]           = useState<Record<string, unknown>>({});
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState<any>(null);
  const s = styles(colors);

  const handleOpen = () => {
    if (!isPremium) { onUpgrade(); return; }
    setOpen(true);
  };

  const handleRun = async () => {
    setLoading(true);
    setResult(null);
    try {
      const portfolio = positions.map((p) => ({
        ticker: p.ticker, name: p.name || p.ticker,
        shares: p.shares || 0, avg_cost: p.avg_cost || 0,
        current_price: p.current_price || 0, value: p.value || 0,
      }));
      const res: any = await simulateApi.whatIf(scenarioType, params, portfolio);
      setResult(res.data);
    } catch {
      setResult({ summary: "No se pudo completar la simulación." });
    } finally { setLoading(false); }
  };

  const dirColor = (d: string) =>
    d === "aumenta" ? "#22c55e" : d === "disminuye" ? "#ef4444" : colors.textMuted;
  const dirIcon = (d: string) =>
    d === "aumenta" ? "trending-up" : d === "disminuye" ? "trending-down" : "remove";

  const TOOL_COLOR = "#f59e0b";

  return (
    <>
      <TouchableOpacity onPress={handleOpen} activeOpacity={0.93}
        style={[s.card, { backgroundColor: colors.card }]}>

        {/* Hero */}
        <View style={[s.hero, { backgroundColor: TOOL_COLOR + "18" }]}>
          <View style={[s.circle1, { backgroundColor: TOOL_COLOR + "15" }]} />
          <View style={[s.circle2, { backgroundColor: TOOL_COLOR + "0A" }]} />
          <View style={[s.iconOuter, { backgroundColor: TOOL_COLOR + "25", borderColor: TOOL_COLOR + "40" }]}>
            <View style={[s.iconInner, { backgroundColor: TOOL_COLOR }]}>
              <Ionicons name="flash" size={28} color="white" />
            </View>
          </View>
        </View>

        {/* Content */}
        <View style={s.cardContent}>
          <Text style={[s.cardTitle, { color: colors.text }]}>Simulador ¿Qué pasa si?</Text>
          <Text style={[s.cardTagline, { color: TOOL_COLOR }]}>Prueba decisiones antes de tomarlas</Text>

          <View style={[s.featureList, { borderColor: colors.border }]}>
            {[
              { icon: "🔄", text: "¿Qué pasa si vendo X y compro Y?" },
              { icon: "💰", text: "Proyección de aportes mensuales a N años" },
              { icon: "💡", text: "Veredicto de tu mentor en cada escenario" },
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

          <TouchableOpacity onPress={handleOpen} activeOpacity={0.85}
            style={[s.cta, { backgroundColor: TOOL_COLOR }]}>
            <View style={s.ctaGlow} />
            <Ionicons name="flash" size={16} color="white" />
            <Text style={s.ctaText}>Simular Escenario</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[s.modal, { backgroundColor: colors.bg }]}>
          {/* Header */}
          <View style={[s.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[s.modalTitle, { color: colors.text }]}>⚡ ¿Qué pasa si?</Text>
            <TouchableOpacity onPress={() => setOpen(false)}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.modalContent}>
            {/* Scenario type */}
            <Text style={[s.sectionLabel, { color: colors.textMuted }]}>TIPO DE ESCENARIO</Text>
            <View style={s.scenarioGrid}>
              {SCENARIOS.map((sc) => (
                <TouchableOpacity
                  key={sc.id}
                  style={[s.scenarioBtn, {
                    borderColor: scenarioType === sc.id ? colors.accent : colors.border,
                    backgroundColor: scenarioType === sc.id ? colors.accent + "12" : colors.bgRaised,
                  }]}
                  onPress={() => { setScenarioType(sc.id); setParams({}); setResult(null); }}
                >
                  <Ionicons name={sc.icon as any} size={18} color={scenarioType === sc.id ? colors.accent : colors.textMuted} />
                  <Text style={[s.scenarioBtnText, { color: scenarioType === sc.id ? colors.text : colors.textMuted }]}>
                    {sc.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Params */}
            {scenarioType === "swap" && (
              <View style={s.paramsSection}>
                <Text style={[s.label, { color: colors.textMuted }]}>Vender (ticker actual)</Text>
                <TextInput
                  style={[s.input, { borderColor: colors.border, backgroundColor: colors.bgRaised, color: colors.text }]}
                  placeholder="Ej: TSLA" placeholderTextColor={colors.textMuted}
                  autoCapitalize="characters"
                  value={(params.sell_ticker as string) || ""}
                  onChangeText={(t) => setParams((p) => ({ ...p, sell_ticker: t.toUpperCase() }))}
                />
                <Text style={[s.label, { color: colors.textMuted }]}>Comprar</Text>
                <TextInput
                  style={[s.input, { borderColor: colors.border, backgroundColor: colors.bgRaised, color: colors.text }]}
                  placeholder="Ej: VOO" placeholderTextColor={colors.textMuted}
                  autoCapitalize="characters"
                  value={(params.buy_ticker as string) || ""}
                  onChangeText={(t) => setParams((p) => ({ ...p, buy_ticker: t.toUpperCase() }))}
                />
              </View>
            )}

            {scenarioType === "add_monthly" && (
              <View style={s.paramsSection}>
                <Text style={[s.label, { color: colors.textMuted }]}>Monto mensual ($)</Text>
                <TextInput
                  style={[s.input, { borderColor: colors.border, backgroundColor: colors.bgRaised, color: colors.text }]}
                  placeholder="Ej: 300" placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  value={params.amount ? String(params.amount) : ""}
                  onChangeText={(t) => setParams((p) => ({ ...p, amount: Number(t) }))}
                />
                <Text style={[s.label, { color: colors.textMuted }]}>Durante (años)</Text>
                <TextInput
                  style={[s.input, { borderColor: colors.border, backgroundColor: colors.bgRaised, color: colors.text }]}
                  placeholder="Ej: 5" placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  value={params.years ? String(params.years) : ""}
                  onChangeText={(t) => setParams((p) => ({ ...p, years: Number(t) }))}
                />
              </View>
            )}

            {scenarioType === "macro" && (
              <View style={s.paramsSection}>
                <Text style={[s.label, { color: colors.textMuted }]}>Evento macroeconómico</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  {MACRO_EVENTS.map((evt) => (
                    <TouchableOpacity
                      key={evt}
                      style={[s.macroChip, {
                        borderColor: params.event === evt ? colors.accent : colors.border,
                        backgroundColor: params.event === evt ? colors.accent + "12" : colors.bgRaised,
                      }]}
                      onPress={() => setParams({ event: evt })}
                    >
                      <Text style={{ fontSize: 11, color: params.event === evt ? colors.accent : colors.textSub }}>
                        {evt}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={[s.input, { borderColor: colors.border, backgroundColor: colors.bgRaised, color: colors.text }]}
                  placeholder="O escribe tu propio evento..." placeholderTextColor={colors.textMuted}
                  value={(params.event as string) || ""}
                  onChangeText={(t) => setParams({ event: t })}
                />
              </View>
            )}

            {scenarioType === "custom" && (
              <View style={s.paramsSection}>
                <Text style={[s.label, { color: colors.textMuted }]}>Describe el escenario</Text>
                <TextInput
                  style={[s.textArea, { borderColor: colors.border, backgroundColor: colors.bgRaised, color: colors.text }]}
                  placeholder="Ej: ¿Qué pasa si vendo todo y compro SPY?" placeholderTextColor={colors.textMuted}
                  multiline numberOfLines={3}
                  value={(params.description as string) || ""}
                  onChangeText={(t) => setParams({ description: t })}
                />
              </View>
            )}

            <TouchableOpacity
              style={[s.runBtn, { backgroundColor: colors.accent, opacity: loading ? 0.7 : 1 }]}
              onPress={handleRun}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="white" />
                : <Text style={s.runBtnText}>⚡ Simular escenario</Text>
              }
            </TouchableOpacity>

            {/* Results */}
            {result && (
              <View style={{ marginTop: 16, gap: 12 }}>
                {result.scenario_title && (
                  <Text style={[s.resultTitle, { color: colors.text }]}>{result.scenario_title}</Text>
                )}
                {result.summary && (
                  <Text style={[s.resultSummary, { color: colors.textSub }]}>{result.summary}</Text>
                )}
                {result.impacts?.map((imp: any) => (
                  <View key={imp.aspect} style={[s.impactRow, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
                    <Ionicons name={dirIcon(imp.direction) as any} size={14} color={dirColor(imp.direction)} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.impactAspect, { color: colors.text }]}>{imp.aspect}</Text>
                      <Text style={[s.impactDetail, { color: colors.textMuted }]}>{imp.detail}</Text>
                    </View>
                  </View>
                ))}
                {result.mentor_verdict && (
                  <View style={[s.verdictBox, { backgroundColor: colors.accent + "0D", borderColor: colors.accent + "40" }]}>
                    <Text style={[s.verdictLabel, { color: colors.accent }]}>🧠 Veredicto del mentor</Text>
                    <Text style={[s.verdictText, { color: colors.textSub }]}>{result.mentor_verdict}</Text>
                  </View>
                )}
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
  modalContent: { padding: 18, paddingBottom: 48 },
  sectionLabel: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  scenarioGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
  scenarioBtn:  { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  scenarioBtnText: { fontSize: 12, fontWeight: "600" },
  paramsSection: { marginBottom: 16, gap: 6 },
  label:    { fontSize: 11, fontWeight: "600", marginBottom: 2 },
  input:    { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 4 },
  textArea: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 80, textAlignVertical: "top" },
  macroChip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  runBtn:    { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  runBtnText: { color: "white", fontWeight: "800", fontSize: 15 },
  resultTitle:   { fontSize: 15, fontWeight: "800" },
  resultSummary: { fontSize: 13, lineHeight: 20 },
  impactRow:     { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 12, borderWidth: 1, padding: 10 },
  impactAspect:  { fontSize: 12, fontWeight: "700" },
  impactDetail:  { fontSize: 11, marginTop: 2 },
  verdictBox:    { borderRadius: 14, borderWidth: 1, padding: 14 },
  verdictLabel:  { fontSize: 11, fontWeight: "800", marginBottom: 6 },
  verdictText:   { fontSize: 13, lineHeight: 19 },
});
