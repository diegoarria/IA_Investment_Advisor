import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, Modal, ScrollView, TextInput,
  ActivityIndicator, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";
import { decisionsApi } from "../lib/api";

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
}

const ACTION_OPTIONS = [
  { id: "buy",           label: "Compré" },
  { id: "sell",          label: "Vendí" },
  { id: "hold",          label: "Mantuve (no actué)" },
  { id: "ignored_alert", label: "Ignoré una alerta" },
  { id: "acted_on_alert",label: "Actué en una alerta" },
];
const TRIGGER_OPTIONS = [
  { id: "manual",   label: "Decisión propia" },
  { id: "alert",    label: "Alerta del sistema" },
  { id: "mentor",   label: "Recomendación del mentor" },
  { id: "fomo",     label: "FOMO" },
  { id: "panic",    label: "Pánico / estrés" },
  { id: "research", label: "Investigación propia" },
];
const SEVERITY_COLOR: Record<string, string> = { alto: "#ef4444", medio: "#f59e0b", bajo: "#22c55e" };

export default function MobileDecisionDiary({ isPremium, onUpgrade }: Props) {
  const { colors } = useTheme();
  const [open, setOpen]         = useState(false);
  const [tab, setTab]           = useState<"diary" | "biases">("diary");
  const [decisions, setDecisions] = useState<any[]>([]);
  const [biases, setBiases]     = useState<any>(null);
  const [loadingD, setLoadingD] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [logOpen, setLogOpen]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState({ action: "buy", ticker: "", trigger: "manual", notes: "" });
  const s = styles(colors);

  const handleOpen = () => { if (!isPremium) { onUpgrade(); return; } setOpen(true); };

  useEffect(() => {
    if (!open || !isPremium) return;
    fetchDecisions();
    fetchBiases();
  }, [open]);

  const fetchDecisions = async () => {
    setLoadingD(true);
    try { const r: any = await decisionsApi.getAll(50); setDecisions(r.data.decisions || []); }
    catch {} finally { setLoadingD(false); }
  };

  const fetchBiases = async () => {
    setLoadingB(true);
    try { const r: any = await decisionsApi.getBiases(); setBiases(r.data); }
    catch {} finally { setLoadingB(false); }
  };

  const handleLog = async () => {
    if (!form.ticker.trim()) return;
    setSaving(true);
    try {
      await decisionsApi.log({ ...form, ticker: form.ticker.toUpperCase() });
      setForm({ action: "buy", ticker: "", trigger: "manual", notes: "" });
      setLogOpen(false);
      fetchDecisions();
      setBiases(null);
    } catch {} finally { setSaving(false); }
  };

  const actionIcon = (action: string) => ({
    buy:           { name: "trending-up", color: "#22c55e" },
    sell:          { name: "trending-down", color: "#ef4444" },
    hold:          { name: "pause-circle", color: colors.textMuted },
    ignored_alert: { name: "notifications-off", color: colors.textMuted },
    acted_on_alert:{ name: "flash", color: colors.accent },
  }[action] || { name: "ellipse", color: colors.textMuted });

  return (
    <>
      {/* Card trigger — purple accent like web */}
      <TouchableOpacity
        onPress={handleOpen}
        activeOpacity={0.85}
        style={{ borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: "#a78bfa40", backgroundColor: colors.card }}
      >
        <View style={{ height: 4, backgroundColor: "#a78bfa" }} />
        <View style={{ padding: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#a78bfa18" }}>
                <Ionicons name="book-outline" size={20} color="#a78bfa" />
              </View>
              <View>
                <Text style={[s.triggerTitle, { color: colors.text }]}>Diario de Sesgos</Text>
                <Text style={[s.triggerSub, { color: colors.textMuted }]}>Registra movimientos · Detecta tus sesgos</Text>
              </View>
            </View>
            {!isPremium
              ? <View style={{ borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: "#a78bfa20" }}>
                  <Text style={{ fontSize: 9, fontWeight: "800", color: "#a78bfa" }}>PREMIUM</Text>
                </View>
              : <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#a78bfa" }}>Abrir</Text>
                  <Ionicons name="chevron-forward" size={14} color="#a78bfa" />
                </View>
            }
          </View>
        </View>
      </TouchableOpacity>

      {/* Main modal */}
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[s.modal, { backgroundColor: colors.bg }]}>
          <View style={[s.header, { borderBottomColor: colors.border }]}>
            <Text style={[s.headerTitle, { color: colors.text }]}>📔 Diario de Inversión</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity onPress={() => setLogOpen(true)}>
                <Ionicons name="add-circle" size={26} color={colors.accent} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Tabs */}
          <View style={[s.tabRow, { backgroundColor: colors.bgRaised }]}>
            {(["diary", "biases"] as const).map((t) => (
              <TouchableOpacity key={t} style={[s.tabBtn, tab === t && [s.tabBtnActive, { backgroundColor: colors.card }]]} onPress={() => setTab(t)}>
                <Text style={[s.tabText, { color: tab === t ? colors.text : colors.textMuted }]}>
                  {t === "diary" ? "📔 Diario" : "🧠 Sesgos"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* DIARY TAB */}
          {tab === "diary" && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}>
              {loadingD ? (
                <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
              ) : decisions.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name="book-outline" size={40} color={colors.textMuted} style={{ opacity: 0.4 }} />
                  <Text style={[s.emptyText, { color: colors.textMuted }]}>Sin decisiones registradas.</Text>
                  <Text style={[s.emptySub, { color: colors.textDim }]}>Toca + para registrar tu primera decisión.</Text>
                </View>
              ) : (
                decisions.map((d, i) => {
                  const ic = actionIcon(d.action);
                  return (
                    <View key={d.id ?? i} style={[s.decisionRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
                      <View style={[s.decIcon, { backgroundColor: ic.color + "18" }]}>
                        <Ionicons name={ic.name as any} size={16} color={ic.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                          <Text style={[s.decTicker, { color: colors.text }]}>{d.ticker}</Text>
                          <View style={[s.decBadge, { backgroundColor: colors.bgRaised }]}>
                            <Text style={[s.decBadgeText, { color: colors.textMuted }]}>
                              {ACTION_OPTIONS.find((a) => a.id === d.action)?.label ?? d.action}
                            </Text>
                          </View>
                        </View>
                        {d.trigger && <Text style={[s.decTrigger, { color: colors.textMuted }]}>{TRIGGER_OPTIONS.find((t) => t.id === d.trigger)?.label ?? d.trigger}</Text>}
                        {d.notes && <Text style={[s.decNotes, { color: colors.textSub }]}>{d.notes}</Text>}
                      </View>
                      <Text style={[s.decDate, { color: colors.textDim }]}>{d.created_at ? new Date(d.created_at).toLocaleDateString("es-MX") : ""}</Text>
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}

          {/* BIASES TAB */}
          {tab === "biases" && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}>
              <TouchableOpacity style={[s.refreshBtn, { borderColor: colors.border }]} onPress={fetchBiases}>
                <Ionicons name="refresh" size={14} color={colors.textMuted} />
                <Text style={[s.refreshText, { color: colors.textMuted }]}>Analizar</Text>
              </TouchableOpacity>

              {loadingB ? (
                <View style={s.empty}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={[s.emptyText, { color: colors.textMuted }]}>Analizando tus patrones con IA...</Text>
                </View>
              ) : !biases ? null : biases.message ? (
                <View style={s.empty}>
                  <Ionicons name="alert-circle-outline" size={36} color={colors.textMuted} style={{ opacity: 0.5 }} />
                  <Text style={[s.emptyText, { color: colors.textMuted }]}>{biases.message}</Text>
                </View>
              ) : (
                <>
                  {/* Score */}
                  <View style={[s.scoreCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[s.scoreLabel, { color: colors.textMuted }]}>PERFIL REAL COMO INVERSOR</Text>
                    <Text style={[s.scoreNum, { color: colors.accent }]}>{biases.overall_score ?? 0}<Text style={{ fontSize: 18 }}>/100</Text></Text>
                    <Text style={[s.scoreTitle, { color: colors.text }]}>{biases.overall_label}</Text>
                    <Text style={[s.scoreSub, { color: colors.textMuted }]}>{biases.total_decisions} decisiones · {biases.analysis_period}</Text>
                  </View>

                  {/* Biases */}
                  {biases.biases_detected?.map((bias: any) => (
                    <View key={bias.name} style={[s.biasCard, { borderColor: `${SEVERITY_COLOR[bias.severity]}30`, backgroundColor: `${SEVERITY_COLOR[bias.severity]}08` }]}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                        <Text style={[s.biasName, { color: colors.text }]}>{bias.name}</Text>
                        <View style={[s.severityBadge, { backgroundColor: `${SEVERITY_COLOR[bias.severity]}20` }]}>
                          <Text style={[s.severityText, { color: SEVERITY_COLOR[bias.severity] }]}>{bias.severity.toUpperCase()}</Text>
                        </View>
                      </View>
                      <Text style={[s.biasDesc, { color: colors.textSub }]}>{bias.description}</Text>
                      <View style={[s.costRow, { backgroundColor: colors.bgRaised }]}>
                        <Text style={[s.costLabel, { color: colors.textMuted }]}>Costo estimado: </Text>
                        <Text style={[s.costVal, { color: "#ef4444" }]}>{bias.cost_estimate}</Text>
                      </View>
                      <View style={[s.fixBox, { backgroundColor: "#22c55e08", borderColor: "#22c55e20" }]}>
                        <Text style={{ fontSize: 9, fontWeight: "800", color: "#22c55e", marginBottom: 4 }}>CÓMO MEJORAR</Text>
                        <Text style={[s.fixText, { color: colors.textSub }]}>{bias.fix}</Text>
                      </View>
                    </View>
                  ))}

                  {/* Mentor assessment */}
                  {biases.mentor_assessment && (
                    <View style={[s.mentorBox, { backgroundColor: colors.accent + "0D", borderColor: colors.accent + "40" }]}>
                      <Text style={[s.mentorLabel, { color: colors.accent }]}>🎓 EVALUACIÓN DE TU MENTOR</Text>
                      <Text style={[s.mentorText, { color: colors.textSub }]}>{biases.mentor_assessment}</Text>
                    </View>
                  )}

                  {/* Challenge */}
                  {biases.next_challenge && (
                    <View style={[s.challengeBox, { backgroundColor: "#8b5cf60D", borderColor: "#8b5cf640" }]}>
                      <Text style={{ fontSize: 10, fontWeight: "800", color: "#a78bfa", marginBottom: 6 }}>🎯 RETO DE LA SEMANA</Text>
                      <Text style={[s.mentorText, { color: colors.textSub }]}>{biases.next_challenge}</Text>
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Log decision modal */}
      <Modal visible={logOpen} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setLogOpen(false)}>
        <View style={[s.logModal, { backgroundColor: colors.bg }]}>
          <View style={[s.header, { borderBottomColor: colors.border }]}>
            <Text style={[s.headerTitle, { color: colors.text }]}>Registrar decisión</Text>
            <TouchableOpacity onPress={() => setLogOpen(false)}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.content}>
            <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Acción</Text>
            <View style={s.optionsRow}>
              {ACTION_OPTIONS.map((a) => (
                <TouchableOpacity key={a.id} style={[s.optionBtn, { borderColor: form.action === a.id ? colors.accent : colors.border, backgroundColor: form.action === a.id ? colors.accent + "12" : colors.bgRaised }]} onPress={() => setForm((f) => ({ ...f, action: a.id }))}>
                  <Text style={{ fontSize: 11, color: form.action === a.id ? colors.accent : colors.textMuted, fontWeight: "600" }}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Ticker</Text>
            <TextInput style={[s.input, { borderColor: colors.border, backgroundColor: colors.bgRaised, color: colors.text }]} placeholder="Ej: AAPL" placeholderTextColor={colors.textMuted} autoCapitalize="characters" value={form.ticker} onChangeText={(t) => setForm((f) => ({ ...f, ticker: t.toUpperCase() }))} />

            <Text style={[s.fieldLabel, { color: colors.textMuted }]}>¿Por qué lo hice?</Text>
            <View style={s.optionsRow}>
              {TRIGGER_OPTIONS.map((t) => (
                <TouchableOpacity key={t.id} style={[s.optionBtn, { borderColor: form.trigger === t.id ? colors.accent : colors.border, backgroundColor: form.trigger === t.id ? colors.accent + "12" : colors.bgRaised }]} onPress={() => setForm((f) => ({ ...f, trigger: t.id }))}>
                  <Text style={{ fontSize: 11, color: form.trigger === t.id ? colors.accent : colors.textMuted, fontWeight: "600" }}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Notas (opcional)</Text>
            <TextInput style={[s.textArea, { borderColor: colors.border, backgroundColor: colors.bgRaised, color: colors.text }]} placeholder="¿Qué pensabas en ese momento?" placeholderTextColor={colors.textMuted} multiline numberOfLines={3} value={form.notes} onChangeText={(t) => setForm((f) => ({ ...f, notes: t }))} />

            <TouchableOpacity style={[s.saveBtn, { backgroundColor: colors.accent, opacity: saving || !form.ticker.trim() ? 0.6 : 1 }]} onPress={handleLog} disabled={saving || !form.ticker.trim()}>
              {saving ? <ActivityIndicator color="white" /> : <Text style={s.saveBtnText}>Guardar decisión</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = (c: any) => StyleSheet.create({
  trigger:     { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1, padding: 14, marginHorizontal: 16, marginBottom: 12 },
  iconBox:     { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  triggerTitle: { fontSize: 14, fontWeight: "700" },
  triggerSub:   { fontSize: 11, marginTop: 1 },
  badge:       { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:   { fontSize: 9, fontWeight: "800" },
  modal:       { flex: 1 },
  logModal:    { flex: 1 },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 17, fontWeight: "800" },
  tabRow:      { flexDirection: "row", margin: 16, borderRadius: 12, padding: 4 },
  tabBtn:      { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  tabBtnActive:{ },
  tabText:     { fontSize: 13, fontWeight: "600" },
  content:     { padding: 16, paddingBottom: 48, gap: 10 },
  empty:       { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyText:   { fontSize: 14, fontWeight: "600" },
  emptySub:    { fontSize: 12 },
  refreshBtn:  { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  refreshText: { fontSize: 12 },
  decisionRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 14, borderWidth: 1, padding: 12 },
  decIcon:     { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  decTicker:   { fontSize: 14, fontWeight: "800" },
  decBadge:    { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  decBadgeText:{ fontSize: 10, fontWeight: "600" },
  decTrigger:  { fontSize: 11, marginTop: 2 },
  decNotes:    { fontSize: 11, marginTop: 3 },
  decDate:     { fontSize: 10 },
  scoreCard:   { borderRadius: 16, borderWidth: 1, padding: 16, alignItems: "center" },
  scoreLabel:  { fontSize: 10, fontWeight: "700", textTransform: "uppercase", marginBottom: 8 },
  scoreNum:    { fontSize: 48, fontWeight: "900", letterSpacing: -2 },
  scoreTitle:  { fontSize: 15, fontWeight: "700", marginTop: 4 },
  scoreSub:    { fontSize: 11, marginTop: 4 },
  biasCard:    { borderRadius: 14, borderWidth: 1, padding: 14 },
  biasName:    { fontSize: 14, fontWeight: "700", flex: 1 },
  biasDesc:    { fontSize: 12, lineHeight: 18, marginBottom: 8 },
  severityBadge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  severityText:  { fontSize: 9, fontWeight: "800" },
  costRow:     { flexDirection: "row", borderRadius: 8, padding: 8, marginBottom: 8 },
  costLabel:   { fontSize: 11 },
  costVal:     { fontSize: 11, fontWeight: "700" },
  fixBox:      { borderRadius: 10, borderWidth: 1, padding: 10 },
  fixText:     { fontSize: 12, lineHeight: 17 },
  mentorBox:   { borderRadius: 14, borderWidth: 1, padding: 14 },
  mentorLabel: { fontSize: 10, fontWeight: "800", marginBottom: 6 },
  mentorText:  { fontSize: 13, lineHeight: 19 },
  challengeBox:{ borderRadius: 14, borderWidth: 1, padding: 14 },
  fieldLabel:  { fontSize: 11, fontWeight: "600", marginBottom: 6 },
  input:       { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 12 },
  textArea:    { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 80, textAlignVertical: "top", marginBottom: 12 },
  optionsRow:  { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  optionBtn:   { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  saveBtn:     { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  saveBtnText: { color: "white", fontWeight: "800", fontSize: 15 },
});
