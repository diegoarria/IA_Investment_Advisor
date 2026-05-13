import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, ActivityIndicator
} from "react-native";
import { router } from "expo-router";

type RiskTolerance = "conservative" | "moderate" | "aggressive";
type Experience = "beginner" | "intermediate" | "advanced";
type Goal = "capital_preservation" | "income" | "growth" | "aggressive_growth" | "retirement";

const GOALS: { value: Goal; label: string }[] = [
  { value: "capital_preservation", label: "Preservar capital" },
  { value: "income", label: "Generar ingresos" },
  { value: "growth", label: "Crecimiento" },
  { value: "aggressive_growth", label: "Crecimiento agresivo" },
  { value: "retirement", label: "Retiro / Jubilación" },
];

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const [loading] = useState(false);
  const [form, setForm] = useState({
    age: "",
    monthly_income: "",
    risk_tolerance: "" as RiskTolerance | "",
    investment_experience: "" as Experience | "",
    time_horizon_years: "",
    investment_goals: [] as Goal[],
    financial_concerns: "",
  });

  const toggleGoal = (g: Goal) => {
    setForm((f) => ({
      ...f,
      investment_goals: f.investment_goals.includes(g)
        ? f.investment_goals.filter((x) => x !== g)
        : [...f.investment_goals, g],
    }));
  };

  const steps = [
    {
      title: "Tu situación",
      isValid: () => !!form.age && !!form.monthly_income,
      content: (
        <View style={s.fields}>
          <Text style={s.label}>Tu edad</Text>
          <TextInput style={s.input} value={form.age} onChangeText={(v) => setForm({ ...form, age: v })}
            placeholder="35" placeholderTextColor="#4b5563" keyboardType="numeric" />
          <Text style={[s.label, { marginTop: 16 }]}>Ingresos mensuales (USD)</Text>
          <TextInput style={s.input} value={form.monthly_income} onChangeText={(v) => setForm({ ...form, monthly_income: v })}
            placeholder="3000" placeholderTextColor="#4b5563" keyboardType="numeric" />
        </View>
      ),
    },
    {
      title: "Tu experiencia",
      isValid: () => !!form.investment_experience,
      content: (
        <View style={s.fields}>
          {([
            { v: "beginner", l: "Principiante", d: "Nunca he invertido o menos de 1 año" },
            { v: "intermediate", l: "Intermedio", d: "Conozco acciones y ETFs básicos" },
            { v: "advanced", l: "Avanzado", d: "Manejo ratios financieros y análisis" },
          ] as const).map(({ v, l, d }) => (
            <TouchableOpacity key={v} style={[s.option, form.investment_experience === v && s.optionActive]}
              onPress={() => setForm({ ...form, investment_experience: v })}>
              <Text style={[s.optionTitle, form.investment_experience === v && { color: "white" }]}>{l}</Text>
              <Text style={s.optionDesc}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ),
    },
    {
      title: "Tolerancia al riesgo",
      isValid: () => !!form.risk_tolerance,
      content: (
        <View style={s.fields}>
          {([
            { v: "conservative", l: "🛡️ Conservador", d: "Prefiero seguridad sobre rentabilidad" },
            { v: "moderate", l: "⚖️ Moderado", d: "Balance entre crecimiento y estabilidad" },
            { v: "aggressive", l: "🚀 Agresivo", d: "Acepto alta volatilidad por mayor retorno" },
          ] as const).map(({ v, l, d }) => (
            <TouchableOpacity key={v} style={[s.option, form.risk_tolerance === v && s.optionActive]}
              onPress={() => setForm({ ...form, risk_tolerance: v })}>
              <Text style={[s.optionTitle, form.risk_tolerance === v && { color: "white" }]}>{l}</Text>
              <Text style={s.optionDesc}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ),
    },
    {
      title: "Objetivos",
      isValid: () => !!form.time_horizon_years && form.investment_goals.length > 0,
      content: (
        <View style={s.fields}>
          <Text style={s.label}>Horizonte de inversión</Text>
          {([
            { v: "3", l: "Menos de 3 años" },
            { v: "5", l: "3–5 años" },
            { v: "10", l: "5–10 años" },
            { v: "20", l: "Más de 10 años" },
          ] as const).map(({ v, l }) => (
            <TouchableOpacity key={v} style={[s.option, s.optionSmall, form.time_horizon_years === v && s.optionActive]}
              onPress={() => setForm({ ...form, time_horizon_years: v })}>
              <Text style={[s.optionTitle, form.time_horizon_years === v && { color: "white" }]}>{l}</Text>
            </TouchableOpacity>
          ))}
          <Text style={[s.label, { marginTop: 16 }]}>Tus objetivos (puedes elegir varios)</Text>
          {GOALS.map(({ value, label }) => (
            <TouchableOpacity key={value} style={[s.option, s.optionSmall, form.investment_goals.includes(value) && s.optionActive]}
              onPress={() => toggleGoal(value)}>
              <Text style={[s.optionTitle, form.investment_goals.includes(value) && { color: "white" }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ),
    },
  ];

  const current = steps[step];

  const handleNext = async () => {
    if (step < steps.length - 1) { setStep(step + 1); return; }
    router.replace("/(tabs)/chat");
  };

  return (
    <SafeAreaView style={s.container}>
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
          disabled={!current.isValid() || loading}
        >
          {loading ? <ActivityIndicator color="white" /> : (
            <Text style={s.nextText}>{step === steps.length - 1 ? "Comenzar" : "Siguiente"}</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f1117" },
  progressRow: { flexDirection: "row", gap: 4, paddingHorizontal: 20, paddingTop: 16 },
  progressBar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "#2a2d3a" },
  progressActive: { backgroundColor: "#22c55e" },
  content: { padding: 20, paddingBottom: 40 },
  stepTitle: { fontSize: 22, fontWeight: "700", color: "white", marginBottom: 20 },
  fields: { gap: 8 },
  label: { color: "#d1d5db", fontSize: 14, fontWeight: "500", marginBottom: 6 },
  input: {
    backgroundColor: "#1a1d27", borderWidth: 1, borderColor: "#2a2d3a",
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: "white", fontSize: 16,
  },
  option: {
    backgroundColor: "#1a1d27", borderWidth: 1, borderColor: "#2a2d3a",
    borderRadius: 12, padding: 14, marginBottom: 4,
  },
  optionSmall: { paddingVertical: 12 },
  optionActive: { borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.1)" },
  optionTitle: { color: "#d1d5db", fontWeight: "600", fontSize: 15 },
  optionDesc: { color: "#6b7280", fontSize: 13, marginTop: 2 },
  footer: { flexDirection: "row", gap: 10, padding: 20, borderTopWidth: 1, borderTopColor: "#2a2d3a" },
  backBtn: {
    borderWidth: 1, borderColor: "#2a2d3a", borderRadius: 12,
    paddingVertical: 16, paddingHorizontal: 20, alignItems: "center",
  },
  backText: { color: "#9ca3af", fontWeight: "500" },
  nextBtn: { flex: 1, backgroundColor: "#16a34a", borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  nextDisabled: { opacity: 0.4 },
  nextText: { color: "white", fontWeight: "600", fontSize: 16 },
});
