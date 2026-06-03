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
  { id: "buy",            label: "Compré" },
  { id: "sell",           label: "Vendí" },
  { id: "hold",           label: "Mantuve (no actué)" },
  { id: "ignored_alert",  label: "Ignoré una alerta" },
  { id: "acted_on_alert", label: "Actué en una alerta" },
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

const TOOL_COLOR = "#a78bfa";

export default function MobileDecisionDiary({ isPremium, onUpgrade }: Props) {
  const { colors } = useTheme();
  const s = styles(colors);

  const [tab, setTab]               = useState<"diary" | "biases">("diary");
  const [decisions, setDecisions]   = useState<any[]>([]);
  const [biases, setBiases]         = useState<any>(null);
  const [loadingD, setLoadingD]     = useState(false);
  const [loadingB, setLoadingB]     = useState(false);
  const [logOpen, setLogOpen]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [form, setForm]             = useState({ action: "buy", ticker: "", trigger: "manual", notes: "" });

  useEffect(() => {
    if (!isPremium) return;
    fetchDecisions();
    fetchBiases();
  }, [isPremium]);

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
    buy:            { name: "trending-up-outline",      color: "#22c55e" },
    sell:           { name: "trending-down-outline",    color: "#ef4444" },
    hold:           { name: "pause-circle-outline",     color: colors.textMuted },
    ignored_alert:  { name: "notifications-off-outline",color: colors.textMuted },
    acted_on_alert: { name: "flash-outline",            color: TOOL_COLOR },
  }[action] || { name: "ellipse-outline", color: colors.textMuted });

  // ── Non-premium: hero card (like other premium tools) ──────────────────────
  if (!isPremium) {
    return (
      <TouchableOpacity onPress={onUpgrade} activeOpacity={0.93}
        style={[s.card, { backgroundColor: colors.card }]}>
        <View style={[s.hero, { backgroundColor: TOOL_COLOR + "18" }]}>
          <View style={[s.circle1, { backgroundColor: TOOL_COLOR + "15" }]} />
          <View style={[s.circle2, { backgroundColor: TOOL_COLOR + "0A" }]} />
          <View style={[s.iconOuter, { backgroundColor: TOOL_COLOR + "25", borderColor: TOOL_COLOR + "40" }]}>
            <View style={[s.iconInner, { backgroundColor: TOOL_COLOR }]}>
              <Ionicons name="book" size={28} color="white" />
            </View>
          </View>
        </View>
        <View style={s.heroContent}>
          <Text style={[s.heroTitle, { color: colors.text }]}>Diario de Sesgos</Text>
          <Text style={[s.heroTagline, { color: TOOL_COLOR }]}>Descubre qué sesgos te cuestan dinero</Text>
          <View style={[s.featureList, { borderColor: colors.border }]}>
            {[
              { icon: "📔", text: "Diario de cada decisión de compra/venta" },
              { icon: "🧠", text: "Detección de FOMO, pánico y otros sesgos" },
              { icon: "📊", text: "Score de calidad como inversor sobre 100" },
              { icon: "🎯", text: "Reto semanal personalizado de tu mentor" },
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
          <TouchableOpacity onPress={onUpgrade} activeOpacity={0.85}
            style={[s.cta, { backgroundColor: TOOL_COLOR }]}>
            <View style={s.ctaGlow} />
            <Ionicons name="lock-open-outline" size={16} color="white" />
            <Text style={s.ctaText}>Desbloquear con Premium</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }

  // ── Premium: inline card matching web ─────────────────────────────────────
  return (
    <>
      <View style={[s.card, { backgroundColor: colors.card, borderColor: TOOL_COLOR + "50" }]}>
        {/* Purple gradient top bar */}
        <View style={s.accentBar} />

        <View style={s.inlineContent}>
          {/* Header */}
          <View style={s.inlineHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={[s.headerIconBox, { backgroundColor: TOOL_COLOR + "18" }]}>
                <Ionicons name="book-outline" size={18} color={TOOL_COLOR} />
              </View>
              <View>
                <Text style={[s.inlineTitle, { color: colors.text }]}>Diario de Sesgos</Text>
                <Text style={[s.inlineSub, { color: colors.textMuted }]}>Registra tus movimientos y descubre tus sesgos</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => setLogOpen(true)}
              style={[s.registerBtn, { backgroundColor: TOOL_COLOR }]}>
              <View style={s.ctaGlow} />
              <Ionicons name="add" size={14} color="white" />
              <Text style={s.registerBtnText}>Registrar</Text>
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={[s.tabRow, { backgroundColor: colors.bgRaised }]}>
            {(["diary", "biases"] as const).map((t) => (
              <TouchableOpacity key={t}
                style={[s.tabBtn, tab === t && { backgroundColor: colors.card }]}
                onPress={() => setTab(t)}>
                <Text style={[s.tabText, { color: tab === t ? colors.text : colors.textMuted }]}>
                  {t === "diary" ? "📔 Diario" : "🧠 Análisis de sesgos"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* DIARY TAB */}
          {tab === "diary" && (
            <View style={s.tabContent}>
              {loadingD ? (
                <View style={s.centered}>
                  <ActivityIndicator color={TOOL_COLOR} />
                </View>
              ) : decisions.length === 0 ? (
                <View style={s.emptyWrap}>
                  <Ionicons name="book-outline" size={36} color={colors.textMuted} style={{ opacity: 0.4 }} />
                  <Text style={[s.emptyTitle, { color: colors.textMuted }]}>Sin decisiones registradas aún.</Text>
                  <Text style={[s.emptySub, { color: colors.textDim }]}>Empieza registrando tu primera decisión.</Text>
                </View>
              ) : (
                decisions.map((d, i) => {
                  const ic = actionIcon(d.action);
                  return (
                    <View key={d.id ?? i} style={[s.decisionRow, { borderColor: colors.border, backgroundColor: colors.bgRaised }]}>
                      <View style={[s.decIcon, { backgroundColor: ic.color + "18" }]}>
                        <Ionicons name={ic.name as any} size={15} color={ic.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 2 }}>
                          <Text style={[s.decTicker, { color: colors.text }]}>{d.ticker}</Text>
                          <View style={[s.decBadge, { backgroundColor: colors.card }]}>
                            <Text style={[s.decBadgeText, { color: colors.textMuted }]}>
                              {ACTION_OPTIONS.find((a) => a.id === d.action)?.label ?? d.action}
                            </Text>
                          </View>
                        </View>
                        {d.trigger && (
                          <Text style={[s.decTrigger, { color: colors.textMuted }]}>
                            Trigger: {TRIGGER_OPTIONS.find((t) => t.id === d.trigger)?.label ?? d.trigger}
                          </Text>
                        )}
                        {d.notes && <Text style={[s.decNotes, { color: colors.textSub }]}>{d.notes}</Text>}
                      </View>
                      <Text style={[s.decDate, { color: colors.textDim }]}>
                        {d.created_at ? new Date(d.created_at).toLocaleDateString("es-MX") : ""}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          )}

          {/* BIASES TAB */}
          {tab === "biases" && (
            <View style={s.tabContent}>
              <TouchableOpacity style={[s.refreshBtn, { borderColor: colors.border }]} onPress={fetchBiases} disabled={loadingB}>
                <Ionicons name="refresh" size={13} color={colors.textMuted}
                  style={loadingB ? { transform: [{ rotate: "45deg" }] } : undefined} />
                <Text style={[s.refreshText, { color: colors.textSub }]}>Analizar</Text>
              </TouchableOpacity>

              {loadingB ? (
                <View style={[s.centered, { gap: 10 }]}>
                  <ActivityIndicator color={TOOL_COLOR} />
                  <Text style={[s.emptyTitle, { color: colors.textMuted }]}>Analizando tus patrones con IA...</Text>
                </View>
              ) : !biases ? null : biases.message ? (
                <View style={s.emptyWrap}>
                  <Ionicons name="alert-circle-outline" size={32} color={colors.textMuted} style={{ opacity: 0.5 }} />
                  <Text style={[s.emptyTitle, { color: colors.textMuted }]}>{biases.message}</Text>
                </View>
              ) : (
                <View style={{ gap: 12 }}>
                  {/* Score */}
                  <View style={[s.scoreCard, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
                    <Text style={[s.scoreLabel, { color: colors.textMuted }]}>PERFIL REAL COMO INVERSOR</Text>
                    <Text style={[s.scoreNum, { color: TOOL_COLOR }]}>
                      {biases.overall_score ?? 0}<Text style={{ fontSize: 18 }}>/100</Text>
                    </Text>
                    <Text style={[s.scoreTitle, { color: colors.text }]}>{biases.overall_label}</Text>
                    <Text style={[s.scoreSub, { color: colors.textMuted }]}>
                      Basado en {biases.total_decisions} decisiones · {biases.analysis_period}
                    </Text>
                  </View>

                  {/* Biases */}
                  {biases.biases_detected?.length > 0 && (
                    <View style={{ gap: 10 }}>
                      <Text style={[s.sectionLabel, { color: colors.textMuted }]}>SESGOS DETECTADOS</Text>
                      {biases.biases_detected.map((bias: any) => (
                        <View key={bias.name} style={[s.biasCard, {
                          borderColor: `${SEVERITY_COLOR[bias.severity]}30`,
                          backgroundColor: `${SEVERITY_COLOR[bias.severity]}08`,
                        }]}>
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                            <Text style={[s.biasName, { color: colors.text }]}>{bias.name}</Text>
                            <View style={[s.severityBadge, { backgroundColor: `${SEVERITY_COLOR[bias.severity]}20` }]}>
                              <Text style={[s.severityText, { color: SEVERITY_COLOR[bias.severity] }]}>
                                {bias.severity.toUpperCase()}
                              </Text>
                            </View>
                          </View>
                          <Text style={[s.biasDesc, { color: colors.textSub }]}>{bias.description}</Text>

                          {/* 2-column grid: ocurrencias + costo */}
                          <View style={s.biasGrid}>
                            <View style={[s.biasGridCell, { backgroundColor: colors.bgRaised }]}>
                              <Text style={[s.biasGridLabel, { color: colors.textMuted }]}>Ocurrencias</Text>
                              <Text style={[s.biasGridVal, { color: colors.text }]}>{bias.occurrences}x</Text>
                            </View>
                            <View style={[s.biasGridCell, { backgroundColor: colors.bgRaised }]}>
                              <Text style={[s.biasGridLabel, { color: colors.textMuted }]}>Costo estimado</Text>
                              <Text style={[s.biasGridVal, { color: "#ef4444" }]}>{bias.cost_estimate}</Text>
                            </View>
                          </View>

                          {/* Ejemplo real */}
                          {bias.example && (
                            <View style={[s.exampleBox, { backgroundColor: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.18)" }]}>
                              <Text style={[s.exampleLabel, { color: "#ef4444" }]}>Ejemplo real</Text>
                              <Text style={[s.exampleText, { color: colors.textSub }]}>{bias.example}</Text>
                            </View>
                          )}

                          {/* Cómo mejorar */}
                          {bias.fix && (
                            <View style={[s.fixBox, { backgroundColor: "rgba(34,197,94,0.06)", borderColor: "rgba(34,197,94,0.18)" }]}>
                              <Text style={[s.fixLabel, { color: "#22c55e" }]}>Cómo mejorar</Text>
                              <Text style={[s.fixText, { color: colors.textSub }]}>{bias.fix}</Text>
                            </View>
                          )}
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Strengths */}
                  {biases.strengths?.length > 0 && (
                    <View style={{ gap: 8 }}>
                      <Text style={[s.sectionLabel, { color: colors.textMuted }]}>TUS FORTALEZAS</Text>
                      {biases.strengths.map((st: any) => (
                        <View key={st.name} style={[s.strengthRow, { borderColor: "rgba(34,197,94,0.2)", backgroundColor: "rgba(34,197,94,0.05)" }]}>
                          <Ionicons name="checkmark-circle" size={16} color="#22c55e" style={{ marginTop: 1 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={[s.strengthName, { color: colors.text }]}>{st.name}</Text>
                            <Text style={[s.strengthDesc, { color: colors.textSub }]}>{st.description}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Mentor assessment */}
                  {biases.mentor_assessment && (
                    <View style={[s.mentorBox, { backgroundColor: TOOL_COLOR + "0D", borderColor: TOOL_COLOR + "40" }]}>
                      <Text style={[s.mentorLabel, { color: TOOL_COLOR }]}>🎓 EVALUACIÓN DE TU MENTOR</Text>
                      <Text style={[s.mentorText, { color: colors.textSub }]}>{biases.mentor_assessment}</Text>
                    </View>
                  )}

                  {/* Next challenge */}
                  {biases.next_challenge && (
                    <View style={[s.mentorBox, { backgroundColor: TOOL_COLOR + "0D", borderColor: TOOL_COLOR + "40" }]}>
                      <Text style={[s.mentorLabel, { color: TOOL_COLOR }]}>🎯 RETO DE LA SEMANA</Text>
                      <Text style={[s.mentorText, { color: colors.textSub }]}>{biases.next_challenge}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}
        </View>
      </View>

      {/* Log decision modal */}
      <Modal visible={logOpen} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setLogOpen(false)}>
        <View style={[s.logModal, { backgroundColor: colors.bg }]}>
          <View style={[s.logHeader, { borderBottomColor: colors.border }]}>
            <Text style={[s.logHeaderTitle, { color: colors.text }]}>Registrar decisión</Text>
            <TouchableOpacity onPress={() => setLogOpen(false)}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.logContent}>
            <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Acción</Text>
            <View style={s.optionsRow}>
              {ACTION_OPTIONS.map((a) => (
                <TouchableOpacity key={a.id}
                  style={[s.optionBtn, {
                    borderColor: form.action === a.id ? TOOL_COLOR : colors.border,
                    backgroundColor: form.action === a.id ? TOOL_COLOR + "15" : colors.bgRaised,
                  }]}
                  onPress={() => setForm((f) => ({ ...f, action: a.id }))}>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: form.action === a.id ? TOOL_COLOR : colors.textMuted }}>
                    {a.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Ticker</Text>
            <TextInput
              style={[s.input, { borderColor: colors.border, backgroundColor: colors.bgRaised, color: colors.text }]}
              placeholder="Ej: AAPL" placeholderTextColor={colors.placeholder}
              autoCapitalize="characters" value={form.ticker}
              onChangeText={(t) => setForm((f) => ({ ...f, ticker: t.toUpperCase() }))} />

            <Text style={[s.fieldLabel, { color: colors.textMuted }]}>¿Por qué lo hice?</Text>
            <View style={s.optionsRow}>
              {TRIGGER_OPTIONS.map((t) => (
                <TouchableOpacity key={t.id}
                  style={[s.optionBtn, {
                    borderColor: form.trigger === t.id ? TOOL_COLOR : colors.border,
                    backgroundColor: form.trigger === t.id ? TOOL_COLOR + "15" : colors.bgRaised,
                  }]}
                  onPress={() => setForm((f) => ({ ...f, trigger: t.id }))}>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: form.trigger === t.id ? TOOL_COLOR : colors.textMuted }}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Notas (opcional)</Text>
            <TextInput
              style={[s.textArea, { borderColor: colors.border, backgroundColor: colors.bgRaised, color: colors.text }]}
              placeholder="¿Qué pensabas en ese momento?" placeholderTextColor={colors.placeholder}
              multiline numberOfLines={3} value={form.notes}
              onChangeText={(t) => setForm((f) => ({ ...f, notes: t }))} />

            <TouchableOpacity
              style={[s.saveBtn, { backgroundColor: TOOL_COLOR, opacity: saving || !form.ticker.trim() ? 0.6 : 1 }]}
              onPress={handleLog} disabled={saving || !form.ticker.trim()}>
              {saving
                ? <ActivityIndicator color="white" />
                : <Text style={s.saveBtnText}>Guardar decisión</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = (_c: any) => StyleSheet.create({
  // ── Card shell ───────────────────────────────────────────────────────────
  card:         { borderRadius: 20, overflow: "hidden", borderWidth: 1, shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 4 },
  accentBar:    { height: 4, backgroundColor: "#a78bfa" },
  inlineContent:{ padding: 16, gap: 14 },

  // Header
  inlineHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerIconBox:{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  inlineTitle:  { fontSize: 14, fontWeight: "800" },
  inlineSub:    { fontSize: 11, marginTop: 1 },
  registerBtn:  { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, overflow: "hidden" },
  registerBtnText: { fontSize: 12, fontWeight: "800", color: "white" },

  // Tabs
  tabRow:    { flexDirection: "row", borderRadius: 12, padding: 3, gap: 2 },
  tabBtn:    { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  tabText:   { fontSize: 12, fontWeight: "600" },

  // Tab content
  tabContent:  { gap: 10 },
  centered:    { alignItems: "center", paddingVertical: 24 },
  emptyWrap:   { alignItems: "center", paddingVertical: 24, gap: 8 },
  emptyTitle:  { fontSize: 13, fontWeight: "600", textAlign: "center" },
  emptySub:    { fontSize: 11, textAlign: "center" },

  // Refresh
  refreshBtn:  { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  refreshText: { fontSize: 12 },

  // Decision rows
  decisionRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 10 },
  decIcon:     { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 },
  decTicker:   { fontSize: 13, fontWeight: "800" },
  decBadge:    { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  decBadgeText:{ fontSize: 9, fontWeight: "600" },
  decTrigger:  { fontSize: 10, marginTop: 2 },
  decNotes:    { fontSize: 11, marginTop: 3 },
  decDate:     { fontSize: 10, flexShrink: 0 },

  // Score
  scoreCard:   { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, alignItems: "center" },
  scoreLabel:  { fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  scoreNum:    { fontSize: 44, fontWeight: "900", letterSpacing: -2 },
  scoreTitle:  { fontSize: 14, fontWeight: "700", marginTop: 4 },
  scoreSub:    { fontSize: 10, marginTop: 4 },

  // Section labels
  sectionLabel:{ fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },

  // Biases
  biasCard:      { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  biasName:      { fontSize: 14, fontWeight: "700", flex: 1 },
  biasDesc:      { fontSize: 12, lineHeight: 18 },
  severityBadge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  severityText:  { fontSize: 9, fontWeight: "800" },
  biasGrid:      { flexDirection: "row", gap: 8 },
  biasGridCell:  { flex: 1, borderRadius: 10, padding: 10 },
  biasGridLabel: { fontSize: 9, fontWeight: "700", textTransform: "uppercase", marginBottom: 4, letterSpacing: 0.3 },
  biasGridVal:   { fontSize: 14, fontWeight: "800" },
  exampleBox:    { borderRadius: 10, borderWidth: 1, padding: 10 },
  exampleLabel:  { fontSize: 9, fontWeight: "800", marginBottom: 4 },
  exampleText:   { fontSize: 11, lineHeight: 16 },
  fixBox:        { borderRadius: 10, borderWidth: 1, padding: 10 },
  fixLabel:      { fontSize: 9, fontWeight: "800", marginBottom: 4 },
  fixText:       { fontSize: 11, lineHeight: 16 },

  // Strengths
  strengthRow:  { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 12, borderWidth: 1, padding: 12 },
  strengthName: { fontSize: 12, fontWeight: "700", marginBottom: 2 },
  strengthDesc: { fontSize: 11, lineHeight: 16 },

  // Mentor / challenge
  mentorBox:   { borderRadius: 14, borderWidth: 1, padding: 14 },
  mentorLabel: { fontSize: 9, fontWeight: "800", marginBottom: 6, letterSpacing: 0.5 },
  mentorText:  { fontSize: 12, lineHeight: 18 },

  // ── Non-premium hero card ──────────────────────────────────────────────
  hero:        { paddingTop: 28, paddingBottom: 20, alignItems: "center", position: "relative", overflow: "hidden" },
  circle1:     { position: "absolute", width: 160, height: 160, borderRadius: 80, top: -50, right: -30 },
  circle2:     { position: "absolute", width: 100, height: 100, borderRadius: 50, bottom: -25, left: -15 },
  iconOuter:   { width: 80, height: 80, borderRadius: 24, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  iconInner:   { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  heroContent: { padding: 20, paddingTop: 16 },
  heroTitle:   { fontSize: 20, fontWeight: "900", letterSpacing: -0.5, marginBottom: 4, textAlign: "center" },
  heroTagline: { fontSize: 12, fontWeight: "700", textAlign: "center", marginBottom: 16, letterSpacing: 0.2 },
  featureList: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", marginBottom: 18 },
  featureRow:  { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 14 },
  featureIconBox: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  featureText: { fontSize: 13, flex: 1, lineHeight: 18, fontWeight: "500" },
  cta:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, paddingVertical: 15, overflow: "hidden" },
  ctaGlow:     { position: "absolute", top: 0, left: 0, right: 0, height: "50%", backgroundColor: "rgba(255,255,255,0.12)" },
  ctaText:     { color: "white", fontWeight: "800", fontSize: 15, letterSpacing: 0.2 },

  // ── Log modal ─────────────────────────────────────────────────────────
  logModal:      { flex: 1 },
  logHeader:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18, borderBottomWidth: StyleSheet.hairlineWidth },
  logHeaderTitle:{ fontSize: 17, fontWeight: "800" },
  logContent:    { padding: 16, paddingBottom: 48, gap: 4 },
  fieldLabel:    { fontSize: 11, fontWeight: "600", marginBottom: 6 },
  optionsRow:    { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  optionBtn:     { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  input:         { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 14 },
  textArea:      { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 80, textAlignVertical: "top", marginBottom: 14 },
  saveBtn:       { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  saveBtnText:   { color: "white", fontWeight: "800", fontSize: 15 },
});
