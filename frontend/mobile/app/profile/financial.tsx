import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, ActivityIndicator, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../src/lib/ThemeContext";
import { financialProfileApi } from "../../src/lib/api";

const STYLES: { value: string; label: string; emoji: string }[] = [
  { value: "value",    label: "Value",      emoji: "📖" },
  { value: "growth",   label: "Growth",     emoji: "🚀" },
  { value: "dividend", label: "Dividendos", emoji: "💰" },
  { value: "index",    label: "Indexado",   emoji: "📊" },
  { value: "momentum", label: "Momentum",   emoji: "⚡" },
];

const GOAL_TYPES: { value: string; label: string }[] = [
  { value: "retirement",     label: "Retiro" },
  { value: "house",          label: "Casa" },
  { value: "freedom_number", label: "Número de libertad" },
  { value: "education",      label: "Educación" },
  { value: "emergency_fund", label: "Fondo de emergencia" },
  { value: "custom",         label: "Otra meta" },
];

interface Goal {
  id: string;
  goal_type: string;
  label?: string;
  target_usd?: number;
  is_primary: boolean;
}

export default function FinancialProfileScreen() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [netWorth, setNetWorth] = useState("");
  const [expenses, setExpenses] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [style, setStyle] = useState("not_set");
  const [horizon, setHorizon] = useState("");
  const [freedomTarget, setFreedomTarget] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [addingGoal, setAddingGoal] = useState(false);
  const [goalType, setGoalType] = useState("freedom_number");
  const [goalAmount, setGoalAmount] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [profRes, goalsRes] = await Promise.all([
          financialProfileApi.get(),
          financialProfileApi.getGoals(),
        ]);
        const p = profRes.data;
        setNetWorth(p.net_worth_usd != null ? String(p.net_worth_usd) : "");
        setExpenses(p.monthly_expenses_usd != null ? String(p.monthly_expenses_usd) : "");
        setCurrency(p.currency || "USD");
        setStyle(p.investing_style || "not_set");
        setHorizon(p.time_horizon_years != null ? String(p.time_horizon_years) : "");
        setFreedomTarget(p.financial_freedom_target_usd != null ? String(p.financial_freedom_target_usd) : "");
        setGoals(goalsRes.data?.goals || []);
      } catch {
        // leave fields blank — user can still fill and save
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const fields: Record<string, unknown> = { currency, investing_style: style };
      if (netWorth) fields.net_worth_usd = parseFloat(netWorth);
      if (expenses) fields.monthly_expenses_usd = parseFloat(expenses);
      if (horizon) fields.time_horizon_years = parseInt(horizon, 10);
      if (freedomTarget) fields.financial_freedom_target_usd = parseFloat(freedomTarget);
      await financialProfileApi.update(fields);
      Alert.alert("Guardado", "Tu perfil financiero se actualizó.");
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  const handleAddGoal = async () => {
    if (!goalAmount) return;
    try {
      const res = await financialProfileApi.addGoal({
        goal_type: goalType,
        target_usd: parseFloat(goalAmount),
        is_primary: goals.length === 0,
      });
      setGoals((g) => [...g, { id: res.data.id, goal_type: goalType, target_usd: parseFloat(goalAmount), is_primary: g.length === 0 }]);
      setGoalAmount("");
      setAddingGoal(false);
    } catch (e: any) {
      Alert.alert("Error", "No se pudo agregar la meta.");
    }
  };

  const handleDeleteGoal = async (id: string) => {
    try {
      await financialProfileApi.deleteGoal(id);
      setGoals((g) => g.filter((x) => x.id !== id));
    } catch {}
  };

  if (loading) {
    return (
      <SafeAreaView style={[st.container, { backgroundColor: colors.bg }]}>
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.accentLight} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[st.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
        <Text style={[st.section, { color: colors.textDim }]}>Tu situación financiera</Text>

        <Text style={[st.label, { color: colors.textMuted }]}>Patrimonio neto (USD)</Text>
        <TextInput
          style={[st.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
          value={netWorth} onChangeText={setNetWorth} keyboardType="numeric"
          placeholder="120000" placeholderTextColor={colors.placeholder}
        />

        <Text style={[st.label, { color: colors.textMuted, marginTop: 16 }]}>Gastos mensuales (USD)</Text>
        <TextInput
          style={[st.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
          value={expenses} onChangeText={setExpenses} keyboardType="numeric"
          placeholder="3000" placeholderTextColor={colors.placeholder}
        />

        <Text style={[st.label, { color: colors.textMuted, marginTop: 16 }]}>Moneda</Text>
        <TextInput
          style={[st.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
          value={currency} onChangeText={(v) => setCurrency(v.toUpperCase().slice(0, 3))}
          placeholder="USD" placeholderTextColor={colors.placeholder} autoCapitalize="characters"
        />

        <Text style={[st.section, { color: colors.textDim, marginTop: 28 }]}>Estilo de inversión</Text>
        <View style={st.chipsRow}>
          {STYLES.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              onPress={() => setStyle(opt.value)}
              style={[
                st.chip,
                { borderColor: style === opt.value ? colors.accent : colors.border, backgroundColor: style === opt.value ? colors.accent + "18" : colors.card },
              ]}
            >
              <Text style={{ fontSize: 14 }}>{opt.emoji}</Text>
              <Text style={[st.chipText, { color: style === opt.value ? colors.accentLight : colors.textMuted }]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[st.section, { color: colors.textDim, marginTop: 28 }]}>Horizonte y meta</Text>

        <Text style={[st.label, { color: colors.textMuted }]}>Horizonte de tiempo (años)</Text>
        <TextInput
          style={[st.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
          value={horizon} onChangeText={setHorizon} keyboardType="numeric"
          placeholder="15" placeholderTextColor={colors.placeholder}
        />

        <Text style={[st.label, { color: colors.textMuted, marginTop: 16 }]}>Meta de libertad financiera (USD)</Text>
        <TextInput
          style={[st.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
          value={freedomTarget} onChangeText={setFreedomTarget} keyboardType="numeric"
          placeholder="1000000" placeholderTextColor={colors.placeholder}
        />

        <TouchableOpacity
          style={[st.saveBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={st.saveBtnText}>{saving ? "Guardando..." : "Guardar cambios"}</Text>
        </TouchableOpacity>

        <View style={st.sectionHeaderRow}>
          <Text style={[st.section, { color: colors.textDim }]}>Tus metas</Text>
          <TouchableOpacity onPress={() => setAddingGoal((v) => !v)}>
            <Ionicons name={addingGoal ? "close" : "add-circle-outline"} size={22} color={colors.accentLight} />
          </TouchableOpacity>
        </View>

        {goals.map((g) => (
          <View key={g.id} style={[st.goalRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[st.goalType, { color: colors.text }]}>
                {GOAL_TYPES.find((t) => t.value === g.goal_type)?.label || g.goal_type}
              </Text>
              {g.target_usd != null && (
                <Text style={[st.goalAmount, { color: colors.textMuted }]}>${g.target_usd.toLocaleString()}</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => handleDeleteGoal(g.id)}>
              <Ionicons name="trash-outline" size={18} color={colors.textDim} />
            </TouchableOpacity>
          </View>
        ))}

        {addingGoal && (
          <View style={[st.addGoalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={st.chipsRow}>
              {GOAL_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  onPress={() => setGoalType(t.value)}
                  style={[
                    st.chip,
                    { borderColor: goalType === t.value ? colors.accent : colors.border, backgroundColor: goalType === t.value ? colors.accent + "18" : "transparent" },
                  ]}
                >
                  <Text style={[st.chipText, { color: goalType === t.value ? colors.accentLight : colors.textMuted }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[st.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.text, marginTop: 10 }]}
              value={goalAmount} onChangeText={setGoalAmount} keyboardType="numeric"
              placeholder="Monto objetivo (USD)" placeholderTextColor={colors.placeholder}
            />
            <TouchableOpacity style={[st.saveBtn, { backgroundColor: colors.accent, marginTop: 10 }]} onPress={handleAddGoal}>
              <Text style={st.saveBtnText}>Agregar meta</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  section: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12 },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 28, marginBottom: 12 },
  label: { fontSize: 13, marginBottom: 6, fontWeight: "600" },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: "700" },
  saveBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  goalRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  goalType: { fontSize: 14, fontWeight: "700" },
  goalAmount: { fontSize: 12, marginTop: 2 },
  addGoalCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 4 },
});
