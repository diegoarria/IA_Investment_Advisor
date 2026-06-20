import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, Alert
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import {
  useAppStore, RISK_CONFIG, calculateRisk,
} from "../../src/lib/profileStore";
import type { QuizAnswer, QuizAnswers } from "../../src/lib/profileStore";
import { profileApi } from "../../src/lib/api";

// ─── Static data ──────────────────────────────────────────────────────────────
const GOALS = [
  { value: "house",             label: "Comprar una casa",          emoji: "🏠" },
  { value: "car",               label: "Comprar un carro",          emoji: "🚗" },
  { value: "passive_income",    label: "Vivir de mis inversiones",  emoji: "💸" },
  { value: "retirement",        label: "Retiro / pensión",          emoji: "👴" },
  { value: "financial_freedom", label: "Libertad financiera",       emoji: "🦅" },
  { value: "long_term_wealth",  label: "Patrimonio de largo plazo", emoji: "🏛️" },
];

const KNOWLEDGE_LEVELS = [
  { value: "B" as QuizAnswer, label: "Básico",     emoji: "🌱", color: "#22c55e",
    desc: "Sin experiencia o apenas inicio." },
  { value: "C" as QuizAnswer, label: "Intermedio", emoji: "📈", color: "#3b82f6",
    desc: "ETFs, acciones y diversificación." },
  { value: "D" as QuizAnswer, label: "Avanzado",   emoji: "🎯", color: "#a855f7",
    desc: "Análisis fundamental, derivados y estrategias complejas." },
];

const QUIZ: {
  key: keyof QuizAnswers;
  num: string;
  category: string;
  question: string;
  options: Record<QuizAnswer, string>;
}[] = [
  {
    key: "q1", num: "01", category: "MENTALIDAD",
    question: "Tu portafolio cae 35% en 3 meses por una crisis del mercado. ¿Qué haces?",
    options: {
      A: "Vendo todo antes de perder más",
      B: "Espero a que se recupere, pero no compro más",
      C: "Reviso si los fundamentos siguen sólidos y mantengo",
      D: "Aprovecho para comprar más a precios bajos",
    },
  },
  {
    key: "q2", num: "02", category: "HORIZONTE",
    question: "¿Para qué necesitas este dinero invertido y en cuánto tiempo?",
    options: {
      A: "Podría necesitarlo en menos de 2 años",
      B: "En 3–5 años, para algo específico",
      C: "En 10+ años, para independencia financiera o retiro",
      D: "No tengo prisa — es para construir patrimonio a largo plazo",
    },
  },
  {
    key: "q3", num: "03", category: "CONOCIMIENTO",
    question: "¿Cuál de estos conceptos entiendes y podrías explicar a alguien más?",
    options: {
      A: "Ninguno con confianza — apenas empiezo",
      B: "Interés compuesto, CETES, fondos indexados",
      C: "P/E ratio, diversificación, rendimiento ajustado al riesgo",
      D: "Análisis fundamental, cobertura con derivados, ciclos de mercado",
    },
  },
  {
    key: "q4", num: "04", category: "RIESGO",
    question: "Tienes $100,000 para invertir. ¿Qué escenario prefieres?",
    options: {
      A: "Ganar $5K seguro, sin posibilidad de perder nada",
      B: "Ganar $15K probable, con riesgo de perder $5K",
      C: "Ganar $40K posible, con riesgo de perder $20K",
      D: "Ganar $120K posible, con riesgo de perder todo",
    },
  },
  {
    key: "q5", num: "05", category: "COMPORTAMIENTO",
    question: "¿Cuánto tiempo dedicarías a monitorear y gestionar tus inversiones?",
    options: {
      A: "Prefiero algo automático que no requiera atención",
      B: "Una revisión mensual o trimestral me parece suficiente",
      C: "Me gusta revisar semanalmente y hacer ajustes cuando vale",
      D: "Estoy dispuesto a dedicarle tiempo diario — es una actividad activa",
    },
  },
];

const RISK_DESC: Record<string, string> = {
  conservative: "Priorizas la seguridad y la preservación de tu capital.",
  moderate:     "Buscas equilibrio entre crecimiento y protección.",
  aggressive:   "Tu objetivo es el máximo crecimiento a largo plazo.",
};

export default function EditProfileScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { profile, setProfile } = useAppStore();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    monthly_income:         profile?.monthly_income ?? "",
    monthly_contribution:   profile?.monthly_contribution ?? "",
    investment_goal:        profile?.investment_goal ?? "",
    investment_goal_amount: profile?.investment_goal_amount ?? "",
    investment_horizon:     profile?.investment_horizon ?? "",
    knowledge_level:        (profile?.quiz_answers?.q3 ?? profile?.knowledge_level ?? "") as QuizAnswer | "",
    q1: (profile?.quiz_answers?.q1 ?? "") as QuizAnswer | "",
    q2: (profile?.quiz_answers?.q2 ?? "") as QuizAnswer | "",
    q3: (profile?.quiz_answers?.q3 ?? "") as QuizAnswer | "",
    q4: (profile?.quiz_answers?.q4 ?? "") as QuizAnswer | "",
    q5: (profile?.quiz_answers?.q5 ?? "") as QuizAnswer | "",
  });

  const quizAnswers = { q1: form.q1, q2: form.q2, q3: form.q3, q4: form.q4, q5: form.q5 };
  const calculated  = calculateRisk(quizAnswers);
  const riskCfg     = RISK_CONFIG[calculated];
  const pct         = Math.round(riskCfg.pct * 100);

  const canSave = !!form.monthly_income && !!form.monthly_contribution;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const updates = {
        monthly_income:         form.monthly_income,
        monthly_contribution:   form.monthly_contribution,
        investment_goal:        form.investment_goal || undefined,
        investment_goal_amount: form.investment_goal_amount || undefined,
        investment_horizon:     form.investment_horizon || undefined,
        knowledge_level:        form.knowledge_level || undefined,
        risk_tolerance:         calculated,
        quiz_answers:           quizAnswers,
      };
      setProfile({
        ...(profile ?? {}),
        ...updates,
        name:      profile?.name ?? "",
        avatarUri: profile?.avatarUri ?? null,
        mentor:    profile?.mentor ?? null,
      } as any);
      await profileApi.update(updates as Record<string, unknown>);
      Alert.alert("✅ Perfil actualizado", "Tus cambios se guardaron correctamente.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert("Error", "No se pudieron guardar los cambios. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* ── Situación financiera ── */}
        <Text style={s.section}>Situación financiera</Text>

        <Text style={s.label}>Ingresos mensuales (USD)</Text>
        <View style={s.prefixWrap}>
          <Text style={s.prefix}>$</Text>
          <TextInput
            style={s.prefixInput} value={form.monthly_income}
            onChangeText={(v) => setForm((f) => ({ ...f, monthly_income: v }))}
            placeholder="3000" placeholderTextColor={colors.placeholder} keyboardType="numeric"
          />
        </View>

        <Text style={[s.label, { marginTop: 16 }]}>Aportación mensual (USD)</Text>
        <View style={s.prefixWrap}>
          <Text style={s.prefix}>$</Text>
          <TextInput
            style={s.prefixInput} value={form.monthly_contribution}
            onChangeText={(v) => setForm((f) => ({ ...f, monthly_contribution: v }))}
            placeholder="500" placeholderTextColor={colors.placeholder} keyboardType="numeric"
          />
          <Text style={s.suffix}>/mes</Text>
        </View>

        {/* ── Tu plan ── */}
        <Text style={[s.section, { marginTop: 28 }]}>Tu plan de inversión</Text>

        <Text style={s.label}>Patrimonio objetivo (USD)</Text>
        <View style={s.prefixWrap}>
          <Text style={s.prefix}>$</Text>
          <TextInput
            style={s.prefixInput} value={form.investment_goal_amount}
            onChangeText={(v) => setForm((f) => ({ ...f, investment_goal_amount: v }))}
            placeholder="1,000,000" placeholderTextColor={colors.placeholder} keyboardType="numeric"
          />
        </View>

        <Text style={[s.label, { marginTop: 16 }]}>Horizonte de inversión</Text>
        <View style={s.prefixWrap}>
          <TextInput
            style={[s.prefixInput, { flex: 1 }]} value={form.investment_horizon}
            onChangeText={(v) => setForm((f) => ({ ...f, investment_horizon: v }))}
            placeholder="10" placeholderTextColor={colors.placeholder} keyboardType="numeric"
          />
          <Text style={s.suffix}>años</Text>
        </View>

        <Text style={[s.label, { marginTop: 16 }]}>Meta al invertir</Text>
        <View style={s.goalGrid}>
          {GOALS.map((g) => {
            const active = form.investment_goal === g.value;
            return (
              <TouchableOpacity
                key={g.value} activeOpacity={0.75}
                onPress={() => setForm((f) => ({ ...f, investment_goal: g.value }))}
                style={[s.goalCard, {
                  borderColor: active ? colors.accentLight : colors.border,
                  backgroundColor: active ? colors.accentLight + "15" : colors.card,
                }]}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <Text style={{ fontSize: 22 }}>{g.emoji}</Text>
                  {active && (
                    <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.accentLight,
                                   alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="checkmark" size={10} color="white" />
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 11, fontWeight: "700",
                               color: active ? colors.accentLight : colors.textSub, lineHeight: 15 }}>
                  {g.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Nivel de conocimiento ── */}
        <Text style={[s.section, { marginTop: 28 }]}>Nivel de conocimiento</Text>
        {KNOWLEDGE_LEVELS.map((lvl) => {
          const active = form.knowledge_level === lvl.value;
          return (
            <TouchableOpacity
              key={lvl.value} activeOpacity={0.75}
              onPress={() => setForm((f) => ({ ...f, knowledge_level: lvl.value }))}
              style={[s.levelCard, {
                borderColor: active ? lvl.color : colors.border,
                backgroundColor: active ? lvl.color + "12" : colors.card,
              }]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Text style={{ fontSize: 24 }}>{lvl.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "800", color: active ? lvl.color : colors.text }}>
                    {lvl.label}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2, lineHeight: 16 }}>
                    {lvl.desc}
                  </Text>
                </View>
                {active && (
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: lvl.color,
                                 alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Ionicons name="checkmark" size={12} color="white" />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}

        {/* ── Quiz ── */}
        <Text style={[s.section, { marginTop: 28 }]}>Diagnóstico de inversor</Text>
        {QUIZ.map((q) => (
          <View key={q.key} style={s.quizBlock}>
            <Text style={[s.quizNum, { color: colors.accentLight }]}>{q.num} · {q.category}</Text>
            <Text style={[s.questionText, { color: colors.text }]}>{q.question}</Text>
            {(["A", "B", "C", "D"] as QuizAnswer[]).map((letter) => {
              const selected = form[q.key] === letter;
              return (
                <TouchableOpacity
                  key={letter}
                  style={[s.option, selected && s.optionActive]}
                  onPress={() => setForm((f) => ({ ...f, [q.key]: letter }))}
                  activeOpacity={0.75}
                >
                  <View style={[s.letterBadge, selected && { backgroundColor: "#22c55e" }]}>
                    <Text style={[s.letterText, selected && { color: "white" }]}>{letter}</Text>
                  </View>
                  <Text style={[s.optionLabel, { color: selected ? colors.text : colors.textSub }]}>
                    {q.options[letter]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        {/* ── Perfil resultante ── */}
        <Text style={[s.section, { marginTop: 24 }]}>Tu perfil resultante</Text>
        <View style={[s.profileCard, { backgroundColor: colors.card, borderColor: riskCfg.color + "55" }]}>
          <View style={s.profileRow}>
            <Ionicons name={riskCfg.icon} size={32} color={riskCfg.color} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[s.profileType, { color: colors.text }]}>{riskCfg.label}</Text>
              <Text style={[s.profileDesc, { color: colors.textMuted }]}>{RISK_DESC[calculated]}</Text>
            </View>
          </View>
          <View style={[s.barTrack, { backgroundColor: colors.border, marginTop: 12 }]}>
            <View style={[s.barFill, { flex: pct, backgroundColor: riskCfg.color }]} />
            {pct < 100 && <View style={{ flex: 100 - pct }} />}
          </View>
          <View style={s.barLabels}>
            <Text style={[s.barLabel, { color: colors.textDim }]}>Bajo riesgo</Text>
            <Text style={[s.barLabel, { color: colors.textDim }]}>Alto riesgo</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[s.saveBtn, (!canSave || saving) && s.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!canSave || saving}
        >
          <Text style={s.saveBtnText}>{saving ? "Guardando..." : "Guardar cambios"}</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container:    { flex: 1, backgroundColor: c.bg },
    content:      { padding: 20 },
    section: {
      fontSize: 11, fontWeight: "700", color: c.accentLight,
      letterSpacing: 1, textTransform: "uppercase", marginBottom: 12,
    },
    label:        { color: c.textSub, fontSize: 14, fontWeight: "500", marginBottom: 6 },
    prefixWrap:   { flexDirection: "row", alignItems: "center", backgroundColor: c.card,
                    borderWidth: 1, borderColor: c.border, borderRadius: 12 },
    prefix:       { paddingLeft: 16, fontSize: 16, color: c.textMuted },
    prefixInput:  { flex: 1, paddingHorizontal: 8, paddingVertical: 14, color: c.text, fontSize: 16 },
    suffix:       { paddingRight: 16, fontSize: 13, color: c.textMuted },
    goalGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
    goalCard: {
      width: "30.5%", borderWidth: 1.5, borderRadius: 14, padding: 10,
    },
    levelCard: {
      borderWidth: 1.5, borderRadius: 14, padding: 14, marginBottom: 8,
    },
    quizBlock:    { marginBottom: 24 },
    quizNum:      { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 6 },
    questionText: { fontSize: 15, fontWeight: "600", lineHeight: 22, marginBottom: 10 },
    option: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border,
      borderRadius: 12, padding: 12, marginBottom: 6,
    },
    optionActive:  { borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.08)" },
    letterBadge:   { width: 30, height: 30, borderRadius: 15,
                     backgroundColor: c.border, alignItems: "center", justifyContent: "center" },
    letterText:    { fontSize: 13, fontWeight: "700", color: c.textMuted },
    optionLabel:   { flex: 1, fontSize: 13, lineHeight: 18 },
    profileCard:   { borderRadius: 16, borderWidth: 1.5, padding: 16, marginBottom: 24 },
    profileRow:    { flexDirection: "row", alignItems: "center" },
    profileType:   { fontSize: 16, fontWeight: "700", marginBottom: 4 },
    profileDesc:   { fontSize: 12, lineHeight: 17 },
    barTrack:      { height: 7, borderRadius: 4, overflow: "hidden", flexDirection: "row", marginBottom: 5 },
    barFill:       { height: "100%", borderRadius: 4 },
    barLabels:     { flexDirection: "row", justifyContent: "space-between" },
    barLabel:      { fontSize: 10 },
    saveBtn:       { backgroundColor: "#16a34a", borderRadius: 14, paddingVertical: 18,
                     alignItems: "center", marginTop: 8 },
    saveBtnDisabled: { opacity: 0.4 },
    saveBtnText:   { color: "white", fontWeight: "700", fontSize: 16 },
  });
}
