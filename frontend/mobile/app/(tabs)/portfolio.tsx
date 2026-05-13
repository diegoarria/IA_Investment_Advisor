import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, ActivityIndicator, SafeAreaView
} from "react-native";
import { marketApi } from "../../src/lib/api";

type Scenario = "conservative" | "moderate" | "aggressive";

const SCENARIOS: { value: Scenario; emoji: string; label: string; desc: string }[] = [
  { value: "conservative", emoji: "🛡️", label: "Conservador", desc: "Estabilidad y dividendos" },
  { value: "moderate", emoji: "⚖️", label: "Moderado", desc: "Balance crecimiento/protección" },
  { value: "aggressive", emoji: "🚀", label: "Agresivo", desc: "Máximo crecimiento" },
];

export default function PortfolioScreen() {
  const [scenario, setScenario] = useState<Scenario>("moderate");
  const [capital, setCapital] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);

  const simulate = async () => {
    setLoading(true);
    setAnalysis("");
    try {
      const res = await marketApi.getPortfolio(scenario, capital ? parseFloat(capital) : undefined);
      setAnalysis(res.data.analysis);
    } catch {
      setAnalysis("Error al generar el análisis. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.scenarioRow}>
          {SCENARIOS.map((s) => (
            <TouchableOpacity
              key={s.value}
              style={[styles.scenarioCard, scenario === s.value && styles.scenarioActive]}
              onPress={() => setScenario(s.value)}
            >
              <Text style={styles.scenarioEmoji}>{s.emoji}</Text>
              <Text style={[styles.scenarioLabel, scenario === s.value && { color: "white" }]}>{s.label}</Text>
              <Text style={styles.scenarioDesc}>{s.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Capital de referencia (USD, opcional)</Text>
        <TextInput
          style={styles.input}
          value={capital}
          onChangeText={setCapital}
          placeholder="10000"
          placeholderTextColor="#4b5563"
          keyboardType="numeric"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={simulate}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Simular portafolio</Text>}
        </TouchableOpacity>

        {analysis !== "" && (
          <View style={styles.resultCard}>
            <Text style={styles.resultText}>{analysis}</Text>
            <View style={styles.disclaimer}>
              <Text style={styles.disclaimerText}>
                ⚠️ Análisis educativo hipotético. No es asesoramiento financiero.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f1117" },
  content: { padding: 16, paddingBottom: 32 },
  scenarioRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  scenarioCard: {
    flex: 1, backgroundColor: "#1a1d27", borderWidth: 1, borderColor: "#2a2d3a",
    borderRadius: 12, padding: 12, alignItems: "center"
  },
  scenarioActive: { borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.1)" },
  scenarioEmoji: { fontSize: 24, marginBottom: 4 },
  scenarioLabel: { color: "#d1d5db", fontWeight: "600", fontSize: 13 },
  scenarioDesc: { color: "#6b7280", fontSize: 10, textAlign: "center", marginTop: 2 },
  label: { color: "#d1d5db", fontSize: 14, fontWeight: "500", marginBottom: 8 },
  input: {
    backgroundColor: "#1a1d27", borderWidth: 1, borderColor: "#2a2d3a",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: "white", fontSize: 15, marginBottom: 16
  },
  button: {
    backgroundColor: "#16a34a", borderRadius: 12, paddingVertical: 16,
    alignItems: "center", marginBottom: 20
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "white", fontWeight: "600", fontSize: 16 },
  resultCard: {
    backgroundColor: "#1a1d27", borderWidth: 1, borderColor: "#2a2d3a",
    borderRadius: 16, padding: 16
  },
  resultText: { color: "#e8eaed", fontSize: 14, lineHeight: 22 },
  disclaimer: {
    marginTop: 12, backgroundColor: "rgba(234,179,8,0.1)",
    borderWidth: 1, borderColor: "rgba(234,179,8,0.3)", borderRadius: 8, padding: 10
  },
  disclaimerText: { color: "#ca8a04", fontSize: 12 },
});
