import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, Alert
} from "react-native";
import { router } from "expo-router";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import {
  useAppStore, RISK_CONFIG, calculateRisk, getAge, formatBirthDate,
} from "../../src/lib/profileStore";
import type { QuizAnswer, QuizAnswers } from "../../src/lib/profileStore";

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

function isValidDate(d: string) {
  const age = getAge(d);
  return d.length === 10 && age >= 10 && age <= 100;
}

export default function EditProfileScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { profile, setProfile } = useAppStore();

  const [form, setForm] = useState({
    name:                 profile?.name ?? "",
    birth_date:           profile?.birth_date ?? "",
    monthly_income:       profile?.monthly_income ?? "",
    monthly_contribution: profile?.monthly_contribution ?? "",
    q1: (profile?.quiz_answers?.q1 ?? "") as QuizAnswer | "",
    q2: (profile?.quiz_answers?.q2 ?? "") as QuizAnswer | "",
    q3: (profile?.quiz_answers?.q3 ?? "") as QuizAnswer | "",
    q4: (profile?.quiz_answers?.q4 ?? "") as QuizAnswer | "",
    q5: (profile?.quiz_answers?.q5 ?? "") as QuizAnswer | "",
  });

  const quizAnswers = { q1: form.q1, q2: form.q2, q3: form.q3, q4: form.q4, q5: form.q5 };
  const calculated = calculateRisk(quizAnswers);
  const riskCfg = RISK_CONFIG[calculated];
  const pct = Math.round(riskCfg.pct * 100);
  const currentAge = getAge(form.birth_date);

  const canSave =
    form.name.trim().length >= 2 &&
    isValidDate(form.birth_date) &&
    !!form.monthly_income &&
    !!form.monthly_contribution &&
    form.q1 && form.q2 && form.q3 && form.q4 && form.q5;

  const handleSave = () => {
    if (!canSave) return;
    setProfile({
      name:                 form.name.trim(),
      birth_date:           form.birth_date,
      monthly_income:       form.monthly_income,
      monthly_contribution: form.monthly_contribution,
      risk_tolerance:       calculated,
      quiz_answers:         quizAnswers as QuizAnswers,
    });
    Alert.alert("✅ Perfil actualizado", "Tus cambios se guardaron correctamente.", [
      { text: "OK", onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.content}>

        {/* ── Información personal ── */}
        <Text style={s.section}>Información personal</Text>

        <Text style={s.label}>Nombre completo</Text>
        <TextInput
          style={s.input} value={form.name}
          onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
          placeholder="Diego Arria" placeholderTextColor={colors.placeholder}
          autoCapitalize="words"
        />

        <Text style={[s.label, { marginTop: 14 }]}>Fecha de nacimiento</Text>
        <TextInput
          style={s.input} value={form.birth_date}
          onChangeText={(v) => setForm((f) => ({ ...f, birth_date: formatBirthDate(v) }))}
          placeholder="DD/MM/AAAA" placeholderTextColor={colors.placeholder}
          keyboardType="numeric" maxLength={10}
        />
        {form.birth_date.length === 10 && (
          <Text style={[s.hint, { color: isValidDate(form.birth_date) ? colors.accentLight : "#ef4444" }]}>
            {isValidDate(form.birth_date) ? `${currentAge} años` : "Fecha inválida"}
          </Text>
        )}

        {/* ── Situación financiera ── */}
        <Text style={[s.section, { marginTop: 24 }]}>Situación financiera</Text>

        <Text style={s.label}>Ingresos mensuales (USD)</Text>
        <TextInput
          style={s.input} value={form.monthly_income}
          onChangeText={(v) => setForm((f) => ({ ...f, monthly_income: v }))}
          placeholder="3000" placeholderTextColor={colors.placeholder} keyboardType="numeric"
        />

        <Text style={[s.label, { marginTop: 14 }]}>Aportación mensual planificada (USD)</Text>
        <TextInput
          style={s.input} value={form.monthly_contribution}
          onChangeText={(v) => setForm((f) => ({ ...f, monthly_contribution: v }))}
          placeholder="300" placeholderTextColor={colors.placeholder} keyboardType="numeric"
        />

        {/* ── Quiz ── */}
        <Text style={[s.section, { marginTop: 24 }]}>Diagnóstico de inversor</Text>
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
            <Text style={{ fontSize: 32 }}>{riskCfg.icon}</Text>
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
          style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!canSave}
        >
          <Text style={s.saveBtnText}>Guardar cambios</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 20 },
    section: {
      fontSize: 11, fontWeight: "700", color: c.accentLight,
      letterSpacing: 1, textTransform: "uppercase", marginBottom: 12,
    },
    label: { color: c.textSub, fontSize: 14, fontWeight: "500", marginBottom: 6 },
    hint: { fontSize: 12, marginTop: 4, marginBottom: 4 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: c.text, fontSize: 16,
    },
    quizBlock: { marginBottom: 24 },
    quizNum: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 6 },
    questionText: { fontSize: 15, fontWeight: "600", lineHeight: 22, marginBottom: 10 },
    option: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border,
      borderRadius: 12, padding: 12, marginBottom: 6,
    },
    optionActive: { borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.08)" },
    letterBadge: {
      width: 30, height: 30, borderRadius: 15,
      backgroundColor: c.border, alignItems: "center", justifyContent: "center",
    },
    letterText: { fontSize: 13, fontWeight: "700", color: c.textMuted },
    optionLabel: { flex: 1, fontSize: 13, lineHeight: 18 },
    profileCard: { borderRadius: 16, borderWidth: 1.5, padding: 16, marginBottom: 24 },
    profileRow: { flexDirection: "row", alignItems: "center" },
    profileType: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
    profileDesc: { fontSize: 12, lineHeight: 17 },
    barTrack: { height: 7, borderRadius: 4, overflow: "hidden", flexDirection: "row", marginBottom: 5 },
    barFill: { height: "100%", borderRadius: 4 },
    barLabels: { flexDirection: "row", justifyContent: "space-between" },
    barLabel: { fontSize: 10 },
    saveBtn: { backgroundColor: "#16a34a", borderRadius: 14, paddingVertical: 18, alignItems: "center", marginTop: 8 },
    saveBtnDisabled: { opacity: 0.4 },
    saveBtnText: { color: "white", fontWeight: "700", fontSize: 16 },
  });
}
