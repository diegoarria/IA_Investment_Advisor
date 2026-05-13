import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, Alert
} from "react-native";
import { router } from "expo-router";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import {
  useAppStore, RISK_CONFIG, getAge, formatBirthDate,
} from "../../src/lib/profileStore";
import type { RiskTolerance, Experience, Goal } from "../../src/lib/profileStore";

const GOALS: { value: Goal; label: string }[] = [
  { value: "capital_preservation", label: "Preservar capital" },
  { value: "income", label: "Generar ingresos" },
  { value: "growth", label: "Crecimiento" },
  { value: "aggressive_growth", label: "Crecimiento agresivo" },
  { value: "retirement", label: "Retiro / Jubilación" },
];

const RISK_DESC: Record<RiskTolerance, string> = {
  conservative: "Priorizas la seguridad y la preservación de tu capital.",
  moderate:     "Buscas equilibrio entre crecimiento y protección.",
  aggressive:   "Tu objetivo es el máximo crecimiento a largo plazo.",
};

function calculateRisk(form: {
  birth_date: string;
  investment_experience: Experience | "";
  time_horizon_years: string;
  investment_goals: Goal[];
}): RiskTolerance {
  let score = 0; let count = 0;
  const age = getAge(form.birth_date) || 30;
  if (age <= 28) score += 3; else if (age <= 38) score += 2.5;
  else if (age <= 48) score += 2; else if (age <= 58) score += 1.5; else score += 1;
  count++;
  if (form.investment_experience === "advanced") score += 3;
  else if (form.investment_experience === "intermediate") score += 2; else score += 1;
  count++;
  const horizon = parseInt(form.time_horizon_years) || 5;
  if (horizon >= 15) score += 3; else if (horizon >= 8) score += 2.5;
  else if (horizon >= 4) score += 2; else score += 1;
  count++;
  if (form.investment_goals.length > 0) {
    const gs: Record<Goal, number> = {
      capital_preservation: 1, income: 1.5, retirement: 1.5, growth: 2.5, aggressive_growth: 3,
    };
    score += form.investment_goals.reduce((s, g) => s + gs[g], 0) / form.investment_goals.length;
    count++;
  }
  const avg = score / count;
  if (avg <= 1.75) return "conservative";
  if (avg <= 2.35) return "moderate";
  return "aggressive";
}

function isValidDate(d: string) {
  const age = getAge(d);
  return d.length === 10 && age >= 10 && age <= 100;
}

export default function EditProfileScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { profile, setProfile } = useAppStore();

  const [form, setForm] = useState({
    name:                  profile?.name ?? "",
    birth_date:            profile?.birth_date ?? "",
    monthly_income:        profile?.monthly_income ?? "",
    monthly_contribution:  profile?.monthly_contribution ?? "",
    investment_experience: (profile?.investment_experience ?? "") as Experience | "",
    time_horizon_years:    profile?.time_horizon_years ?? "",
    investment_goals:      profile?.investment_goals ?? ([] as Goal[]),
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
  const currentAge = getAge(form.birth_date);

  const canSave =
    form.name.trim().length >= 2 &&
    isValidDate(form.birth_date) &&
    !!form.monthly_income &&
    !!form.monthly_contribution &&
    !!form.investment_experience &&
    !!form.time_horizon_years &&
    form.investment_goals.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    setProfile({
      name:                  form.name.trim(),
      birth_date:            form.birth_date,
      monthly_income:        form.monthly_income,
      monthly_contribution:  form.monthly_contribution,
      risk_tolerance:        calculated,
      investment_experience: form.investment_experience as Experience,
      time_horizon_years:    form.time_horizon_years,
      investment_goals:      form.investment_goals,
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
          onChangeText={(v) => setForm({ ...form, name: v })}
          placeholder="Diego Arria" placeholderTextColor={colors.placeholder}
          autoCapitalize="words"
        />

        <Text style={[s.label, { marginTop: 14 }]}>Fecha de nacimiento</Text>
        <TextInput
          style={s.input} value={form.birth_date}
          onChangeText={(v) => setForm({ ...form, birth_date: formatBirthDate(v) })}
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
          onChangeText={(v) => setForm({ ...form, monthly_income: v })}
          placeholder="3000" placeholderTextColor={colors.placeholder} keyboardType="numeric"
        />

        <Text style={[s.label, { marginTop: 14 }]}>Aportación mensual planificada (USD)</Text>
        <TextInput
          style={s.input} value={form.monthly_contribution}
          onChangeText={(v) => setForm({ ...form, monthly_contribution: v })}
          placeholder="300" placeholderTextColor={colors.placeholder} keyboardType="numeric"
        />

        {/* ── Experiencia ── */}
        <Text style={[s.section, { marginTop: 24 }]}>Experiencia invirtiendo</Text>
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

        {/* ── Horizonte ── */}
        <Text style={[s.section, { marginTop: 24 }]}>Horizonte de inversión</Text>
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

        {/* ── Objetivos ── */}
        <Text style={[s.section, { marginTop: 24 }]}>Objetivos (elige varios)</Text>
        {GOALS.map(({ value, label }) => (
          <TouchableOpacity
            key={value}
            style={[s.option, s.optionSmall, form.investment_goals.includes(value) && s.optionActive]}
            onPress={() => toggleGoal(value)}
          >
            <Text style={[s.optionTitle, form.investment_goals.includes(value) && { color: colors.text }]}>{label}</Text>
          </TouchableOpacity>
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

        {/* ── Botón guardar ── */}
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
    section: { fontSize: 12, fontWeight: "700", color: c.accentLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 },
    label: { color: c.textSub, fontSize: 14, fontWeight: "500", marginBottom: 6 },
    hint: { fontSize: 12, marginTop: 4, marginBottom: 4 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: c.text, fontSize: 16,
    },
    option: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 12, padding: 14, marginBottom: 6,
    },
    optionSmall: { paddingVertical: 12 },
    optionActive: { borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.1)" },
    optionTitle: { color: c.textSub, fontWeight: "600", fontSize: 15 },
    optionDesc: { color: c.textDim, fontSize: 13, marginTop: 2 },
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
