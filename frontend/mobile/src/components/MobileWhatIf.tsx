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
    d === "aumenta" ? "#22c55e" : d === "disminuye" ? "#ef4444" : colors.muted;
  const dirIcon = (d: string) =>
    d === "aumenta" ? "trending-up" : d === "disminuye" ? "trending-down" : "remove";

  return (
    <>
      <TouchableOpacity style={[s.trigger, { borderColor: colors.border, backgroundColor: colors.raised }]} onPress={handleOpen}>
        <Ionicons name="flash-outline" size={16} color={colors.accent} />
        <Text style={[s.triggerText, { color: colors.subtext }]}>Simulador ¿Qué pasa si?</Text>
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
            <Text style={[s.modalTitle, { color: colors.text }]}>⚡ ¿Qué pasa si?</Text>
            <TouchableOpacity onPress={() => setOpen(false)}>
              <Ionicons name="close" size={22} color={colors.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.modalContent}>
            {/* Scenario type */}
            <Text style={[s.sectionLabel, { color: colors.muted }]}>TIPO DE ESCENARIO</Text>
            <View style={s.scenarioGrid}>
              {SCENARIOS.map((sc) => (
                <TouchableOpacity
                  key={sc.id}
                  style={[s.scenarioBtn, {
                    borderColor: scenarioType === sc.id ? colors.accent : colors.border,
                    backgroundColor: scenarioType === sc.id ? colors.accent + "12" : colors.raised,
                  }]}
                  onPress={() => { setScenarioType(sc.id); setParams({}); setResult(null); }}
                >
                  <Ionicons name={sc.icon as any} size={18} color={scenarioType === sc.id ? colors.accent : colors.muted} />
                  <Text style={[s.scenarioBtnText, { color: scenarioType === sc.id ? colors.text : colors.muted }]}>
                    {sc.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Params */}
            {scenarioType === "swap" && (
              <View style={s.paramsSection}>
                <Text style={[s.label, { color: colors.muted }]}>Vender (ticker actual)</Text>
                <TextInput
                  style={[s.input, { borderColor: colors.border, backgroundColor: colors.raised, color: colors.text }]}
                  placeholder="Ej: TSLA" placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  value={(params.sell_ticker as string) || ""}
                  onChangeText={(t) => setParams((p) => ({ ...p, sell_ticker: t.toUpperCase() }))}
                />
                <Text style={[s.label, { color: colors.muted }]}>Comprar</Text>
                <TextInput
                  style={[s.input, { borderColor: colors.border, backgroundColor: colors.raised, color: colors.text }]}
                  placeholder="Ej: VOO" placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  value={(params.buy_ticker as string) || ""}
                  onChangeText={(t) => setParams((p) => ({ ...p, buy_ticker: t.toUpperCase() }))}
                />
              </View>
            )}

            {scenarioType === "add_monthly" && (
              <View style={s.paramsSection}>
                <Text style={[s.label, { color: colors.muted }]}>Monto mensual ($)</Text>
                <TextInput
                  style={[s.input, { borderColor: colors.border, backgroundColor: colors.raised, color: colors.text }]}
                  placeholder="Ej: 300" placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  value={params.amount ? String(params.amount) : ""}
                  onChangeText={(t) => setParams((p) => ({ ...p, amount: Number(t) }))}
                />
                <Text style={[s.label, { color: colors.muted }]}>Durante (años)</Text>
                <TextInput
                  style={[s.input, { borderColor: colors.border, backgroundColor: colors.raised, color: colors.text }]}
                  placeholder="Ej: 5" placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  value={params.years ? String(params.years) : ""}
                  onChangeText={(t) => setParams((p) => ({ ...p, years: Number(t) }))}
                />
              </View>
            )}

            {scenarioType === "macro" && (
              <View style={s.paramsSection}>
                <Text style={[s.label, { color: colors.muted }]}>Evento macroeconómico</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  {MACRO_EVENTS.map((evt) => (
                    <TouchableOpacity
                      key={evt}
                      style={[s.macroChip, {
                        borderColor: params.event === evt ? colors.accent : colors.border,
                        backgroundColor: params.event === evt ? colors.accent + "12" : colors.raised,
                      }]}
                      onPress={() => setParams({ event: evt })}
                    >
                      <Text style={{ fontSize: 11, color: params.event === evt ? colors.accent : colors.subtext }}>
                        {evt}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={[s.input, { borderColor: colors.border, backgroundColor: colors.raised, color: colors.text }]}
                  placeholder="O escribe tu propio evento..." placeholderTextColor={colors.muted}
                  value={(params.event as string) || ""}
                  onChangeText={(t) => setParams({ event: t })}
                />
              </View>
            )}

            {scenarioType === "custom" && (
              <View style={s.paramsSection}>
                <Text style={[s.label, { color: colors.muted }]}>Describe el escenario</Text>
                <TextInput
                  style={[s.textArea, { borderColor: colors.border, backgroundColor: colors.raised, color: colors.text }]}
                  placeholder="Ej: ¿Qué pasa si vendo todo y compro SPY?" placeholderTextColor={colors.muted}
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
                  <Text style={[s.resultSummary, { color: colors.subtext }]}>{result.summary}</Text>
                )}
                {result.impacts?.map((imp: any) => (
                  <View key={imp.aspect} style={[s.impactRow, { backgroundColor: colors.raised, borderColor: colors.border }]}>
                    <Ionicons name={dirIcon(imp.direction) as any} size={14} color={dirColor(imp.direction)} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.impactAspect, { color: colors.text }]}>{imp.aspect}</Text>
                      <Text style={[s.impactDetail, { color: colors.muted }]}>{imp.detail}</Text>
                    </View>
                  </View>
                ))}
                {result.mentor_verdict && (
                  <View style={[s.verdictBox, { backgroundColor: colors.accent + "0D", borderColor: colors.accent + "40" }]}>
                    <Text style={[s.verdictLabel, { color: colors.accent }]}>🧠 Veredicto del mentor</Text>
                    <Text style={[s.verdictText, { color: colors.subtext }]}>{result.mentor_verdict}</Text>
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

const styles = (c: any) => StyleSheet.create({
  trigger:     { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 },
  triggerText: { fontSize: 13, fontWeight: "600" },
  premiumBadge:     { borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 },
  premiumBadgeText: { fontSize: 9, fontWeight: "800" },
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
