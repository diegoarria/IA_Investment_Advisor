import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView
} from "react-native";
import { router } from "expo-router";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useAppStore, RISK_CONFIG, getAge, formatBirthDate } from "../../src/lib/profileStore";
import type { RiskTolerance, Experience, Goal } from "../../src/lib/profileStore";

const GOALS: { value: Goal; label: string }[] = [
  { value: "capital_preservation", label: "Preservar capital" },
  { value: "income", label: "Generar ingresos" },
  { value: "growth", label: "Crecimiento" },
  { value: "aggressive_growth", label: "Crecimiento agresivo" },
  { value: "retirement", label: "Retiro / Jubilación" },
];

const RISK_DESC: Record<RiskTolerance, string> = {
  conservative: "Priorizas la seguridad y la preservación de tu capital. Prefieres rendimientos estables aunque menores.",
  moderate:     "Buscas equilibrio entre crecimiento y protección. Aceptas cierta volatilidad por mejores retornos.",
  aggressive:   "Tu objetivo es el máximo crecimiento. Tienes tolerancia a la alta volatilidad en el largo plazo.",
};

function calculateRisk(form: {
  birth_date: string;
  investment_experience: Experience | "";
  time_horizon_years: string;
  investment_goals: Goal[];
}): RiskTolerance {
  let score = 0;
  let count = 0;

  const age = getAge(form.birth_date) || 30;
  if (age <= 28)      score += 3;
  else if (age <= 38) score += 2.5;
  else if (age <= 48) score += 2;
  else if (age <= 58) score += 1.5;
  else                score += 1;
  count++;

  if (form.investment_experience === "advanced")           score += 3;
  else if (form.investment_experience === "intermediate")  score += 2;
  else                                                     score += 1;
  count++;

  const horizon = parseInt(form.time_horizon_years) || 5;
  if (horizon >= 15)     score += 3;
  else if (horizon >= 8) score += 2.5;
  else if (horizon >= 4) score += 2;
  else                   score += 1;
  count++;

  if (form.investment_goals.length > 0) {
    const goalScores: Record<Goal, number> = {
      capital_preservation: 1, income: 1.5, retirement: 1.5, growth: 2.5, aggressive_growth: 3,
    };
    const avg = form.investment_goals.reduce((s, g) => s + goalScores[g], 0) / form.investment_goals.length;
    score += avg;
    count++;
  }

  const avg = score / count;
  if (avg <= 1.75) return "conservative";
  if (avg <= 2.35) return "moderate";
  return "aggressive";
}

function isValidDate(d: string): boolean {
  if (d.length !== 10) return false;
  const age = getAge(d);
  return age >= 10 && age <= 100;
}

export default function OnboardingScreen() {
  const { colors, isDark, toggle } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const setProfile = useAppStore((state) => state.setProfile);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "",
    birth_date: "",
    monthly_income: "",
    monthly_contribution: "",
    investment_experience: "" as Experience | "",
    time_horizon_years: "",
    investment_goals: [] as Goal[],
  });

  const toggleGoal = (g: Goal) =>
    setForm((f) => ({
      ...f,
      investment_goals: f.investment_goals.includes(g)
        ? f.investment_goals.filter((x) => x !== g)
        : [...f.investment_goals, g],
    }));

  const calculated = calculateRisk(form);
  const riskCfg = RISK_CONFIG[calculated];
  const pct = Math.round(riskCfg.pct * 100);
  const firstName = form.name.trim().split(" ")[0];
  const currentAge = getAge(form.birth_date);

  const EXPERIENCE_LABELS: Record<string, string> = {
    beginner: "Principiante", intermediate: "Intermedio", advanced: "Avanzado",
  };
  const HORIZON_LABELS: Record<string, string> = {
    "3": "Menos de 3 años", "5": "3–5 años", "10": "5–10 años", "20": "Más de 10 años",
  };

  const steps = [
    {
      title: "¡Bienvenido! ¿Cómo te llamas?",
      isValid: () => form.name.trim().length >= 2,
      content: (
        <View style={s.fields}>
          <Text style={s.label}>Tu nombre completo</Text>
          <TextInput
            style={s.input} value={form.name}
            onChangeText={(v) => setForm({ ...form, name: v })}
            placeholder="Ej. Diego Arria"
            placeholderTextColor={colors.placeholder}
            autoCapitalize="words" autoFocus
          />
          <Text style={[s.hint, { color: colors.textMuted }]}>
            Así te llamaremos dentro de la app y la IA sabrá cómo dirigirse a ti.
          </Text>
        </View>
      ),
    },
    {
      title: `Hola, ${firstName || "!"}  Tu situación financiera`,
      isValid: () => isValidDate(form.birth_date) && !!form.monthly_income && !!form.monthly_contribution,
      content: (
        <View style={s.fields}>
          <Text style={s.label}>Fecha de nacimiento</Text>
          <TextInput
            style={s.input} value={form.birth_date}
            onChangeText={(v) => setForm({ ...form, birth_date: formatBirthDate(v) })}
            placeholder="DD/MM/AAAA"
            placeholderTextColor={colors.placeholder}
            keyboardType="numeric" maxLength={10}
          />
          {form.birth_date.length === 10 && (
            <Text style={[s.hint, { color: isValidDate(form.birth_date) ? colors.accentLight : "#ef4444" }]}>
              {isValidDate(form.birth_date) ? `Tienes ${currentAge} años` : "Fecha inválida"}
            </Text>
          )}

          <Text style={[s.label, { marginTop: 16 }]}>Ingresos mensuales (USD)</Text>
          <TextInput
            style={s.input} value={form.monthly_income}
            onChangeText={(v) => setForm({ ...form, monthly_income: v })}
            placeholder="3000" placeholderTextColor={colors.placeholder} keyboardType="numeric"
          />

          <Text style={[s.label, { marginTop: 16 }]}>Aportación mensual planificada (USD)</Text>
          <TextInput
            style={s.input} value={form.monthly_contribution}
            onChangeText={(v) => setForm({ ...form, monthly_contribution: v })}
            placeholder="300" placeholderTextColor={colors.placeholder} keyboardType="numeric"
          />
          <Text style={[s.hint, { color: colors.textMuted }]}>
            Esta info ayuda a la IA a darte recomendaciones precisas y personalizadas.
          </Text>
        </View>
      ),
    },
    {
      title: "Tu experiencia invirtiendo",
      isValid: () => !!form.investment_experience,
      content: (
        <View style={s.fields}>
          {([
            { v: "beginner",     l: "Principiante", d: "Nunca he invertido o menos de 1 año" },
            { v: "intermediate", l: "Intermedio",   d: "Conozco acciones y ETFs básicos" },
            { v: "advanced",     l: "Avanzado",     d: "Manejo ratios financieros y análisis" },
          ] as const).map(({ v, l, d }) => (
            <TouchableOpacity
              key={v}
              style={[s.option, form.investment_experience === v && s.optionActive]}
              onPress={() => setForm({ ...form, investment_experience: v })}
            >
              <Text style={[s.optionTitle, form.investment_experience === v && { color: colors.text }]}>{l}</Text>
              <Text style={s.optionDesc}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ),
    },
    {
      title: "Tus objetivos de inversión",
      isValid: () => !!form.time_horizon_years && form.investment_goals.length > 0,
      content: (
        <View style={s.fields}>
          <Text style={s.label}>Horizonte de inversión</Text>
          {([
            { v: "3",  l: "Menos de 3 años" },
            { v: "5",  l: "3–5 años" },
            { v: "10", l: "5–10 años" },
            { v: "20", l: "Más de 10 años" },
          ] as const).map(({ v, l }) => (
            <TouchableOpacity
              key={v}
              style={[s.option, s.optionSmall, form.time_horizon_years === v && s.optionActive]}
              onPress={() => setForm({ ...form, time_horizon_years: v })}
            >
              <Text style={[s.optionTitle, form.time_horizon_years === v && { color: colors.text }]}>{l}</Text>
            </TouchableOpacity>
          ))}
          <Text style={[s.label, { marginTop: 16 }]}>¿Qué quieres lograr? (elige varios)</Text>
          {GOALS.map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              style={[s.option, s.optionSmall, form.investment_goals.includes(value) && s.optionActive]}
              onPress={() => toggleGoal(value)}
            >
              <Text style={[s.optionTitle, form.investment_goals.includes(value) && { color: colors.text }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ),
    },
    {
      title: `Tu perfil, ${firstName || "!"}`,
      isValid: () => true,
      content: (
        <View style={s.fields}>
          <Text style={[s.revealSub, { color: colors.textMuted }]}>
            Analizamos tu edad, experiencia, horizonte y objetivos para determinar tu perfil.
          </Text>
          <View style={[s.revealCard, { backgroundColor: colors.card, borderColor: riskCfg.color + "55" }]}>
            <Text style={s.revealIcon}>{riskCfg.icon}</Text>
            <Text style={[s.revealType, { color: colors.text }]}>{riskCfg.label}</Text>
            <Text style={[s.revealDesc, { color: colors.textMuted }]}>{RISK_DESC[calculated]}</Text>
            <View style={[s.barTrack, { backgroundColor: colors.border }]}>
              <View style={[s.barFill, { flex: pct, backgroundColor: riskCfg.color }]} />
              {pct < 100 && <View style={{ flex: 100 - pct }} />}
            </View>
            <View style={s.barLabels}>
              <Text style={[s.barLabel, { color: colors.textDim }]}>Bajo riesgo</Text>
              <Text style={[s.barLabel, { color: colors.textDim }]}>Alto riesgo</Text>
            </View>
          </View>

          <Text style={[s.factorsTitle, { color: colors.textSub }]}>Resumen de tu perfil</Text>
          {[
            { label: "Nombre",      value: form.name },
            { label: "Edad",        value: `${currentAge} años (${form.birth_date})` },
            { label: "Ingresos",    value: `$${Number(form.monthly_income).toLocaleString()} / mes` },
            { label: "Aportación",  value: `$${Number(form.monthly_contribution).toLocaleString()} / mes` },
            { label: "Experiencia", value: EXPERIENCE_LABELS[form.investment_experience] || "" },
            { label: "Horizonte",   value: HORIZON_LABELS[form.time_horizon_years] || "" },
          ].map((f) => (
            <View key={f.label} style={[s.factorRow, { borderColor: colors.border }]}>
              <Text style={[s.factorLabel, { color: colors.textMuted }]}>{f.label}</Text>
              <Text style={[s.factorValue, { color: colors.text }]}>{f.value}</Text>
            </View>
          ))}
        </View>
      ),
    },
  ];

  const current = steps[step];
  const isLastStep = step === steps.length - 1;

  const handleNext = () => {
    if (!isLastStep) { setStep(step + 1); return; }
    setProfile({
      name: form.name.trim(),
      birth_date: form.birth_date,
      monthly_income: form.monthly_income,
      monthly_contribution: form.monthly_contribution,
      risk_tolerance: calculated,
      investment_experience: form.investment_experience as Experience,
      time_horizon_years: form.time_horizon_years,
      investment_goals: form.investment_goals,
    });
    router.replace("/(tabs)/chat");
  };

  return (
    <SafeAreaView style={s.container}>
      <TouchableOpacity style={s.themeToggle} onPress={toggle}>
        <Text style={{ fontSize: 20 }}>{isDark ? "☀️" : "🌙"}</Text>
      </TouchableOpacity>

      <View style={s.progressRow}>
        {steps.map((_, i) => (
          <View key={i} style={[s.progressBar, i <= step && s.progressActive]} />
        ))}
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.stepTitle}>{current.title}</Text>
        {current.content}
      </ScrollView>

      <View style={s.footer}>
        {step > 0 && (
          <TouchableOpacity style={s.backBtn} onPress={() => setStep(step - 1)}>
            <Text style={s.backText}>Atrás</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.nextBtn, !current.isValid() && s.nextDisabled]}
          onPress={handleNext}
          disabled={!current.isValid()}
        >
          <Text style={s.nextText}>{isLastStep ? "¡Comenzar!" : "Siguiente"}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    themeToggle: { position: "absolute", top: 56, right: 24, zIndex: 10 },
    progressRow: { flexDirection: "row", gap: 4, paddingHorizontal: 20, paddingTop: 16 },
    progressBar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: c.border },
    progressActive: { backgroundColor: "#22c55e" },
    content: { padding: 20, paddingBottom: 40 },
    stepTitle: { fontSize: 22, fontWeight: "700", color: c.text, marginBottom: 16 },
    fields: { gap: 8 },
    label: { color: c.textSub, fontSize: 14, fontWeight: "500", marginBottom: 6 },
    hint: { fontSize: 12, lineHeight: 17, marginTop: 4 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: c.text, fontSize: 16,
    },
    option: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 12, padding: 14, marginBottom: 4,
    },
    optionSmall: { paddingVertical: 12 },
    optionActive: { borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.1)" },
    optionTitle: { color: c.textSub, fontWeight: "600", fontSize: 15 },
    optionDesc: { color: c.textDim, fontSize: 13, marginTop: 2 },
    revealSub: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
    revealCard: { borderRadius: 16, borderWidth: 1.5, padding: 20, alignItems: "center", marginBottom: 20 },
    revealIcon: { fontSize: 48, marginBottom: 8 },
    revealType: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
    revealDesc: { fontSize: 13, textAlign: "center", lineHeight: 18, marginBottom: 16 },
    barTrack: { height: 8, borderRadius: 4, overflow: "hidden", flexDirection: "row", width: "100%", marginBottom: 6 },
    barFill: { height: "100%", borderRadius: 4 },
    barLabels: { flexDirection: "row", justifyContent: "space-between", width: "100%" },
    barLabel: { fontSize: 10 },
    factorsTitle: { fontSize: 13, fontWeight: "600", marginBottom: 8, marginTop: 4 },
    factorRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1 },
    factorLabel: { fontSize: 13 },
    factorValue: { fontSize: 13, fontWeight: "600" },
    footer: { flexDirection: "row", gap: 10, padding: 20, borderTopWidth: 1, borderTopColor: c.border },
    backBtn: {
      borderWidth: 1, borderColor: c.border, borderRadius: 12,
      paddingVertical: 16, paddingHorizontal: 20, alignItems: "center",
    },
    backText: { color: c.textMuted, fontWeight: "500" },
    nextBtn: { flex: 1, backgroundColor: "#16a34a", borderRadius: 12, paddingVertical: 16, alignItems: "center" },
    nextDisabled: { opacity: 0.4 },
    nextText: { color: "white", fontWeight: "600", fontSize: 16 },
  });
}
