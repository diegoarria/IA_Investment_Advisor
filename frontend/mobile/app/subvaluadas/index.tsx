import React, { useState, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../../src/lib/ThemeContext";
import { screenerWeeklyApi } from "../../src/lib/api";

interface UndervaluedResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  intrinsic_value_base: number | null;
  margin_of_safety_pct: number | null;
  thesis_scores: Record<string, number> | null;
}

export default function SubvaluadasScreen() {
  const { colors } = useTheme();
  const [results, setResults] = useState<UndervaluedResult[]>([]);
  const [generatedAt, setGeneratedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sectorFilter, setSectorFilter] = useState("Todos");

  useEffect(() => {
    screenerWeeklyApi.getUndervalued(undefined, 30)
      .then((res: any) => {
        setResults(res.data?.results || []);
        setGeneratedAt(res.data?.generated_at || 0);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  const sectors = useMemo(() => {
    const unique = Array.from(new Set(results.map((r) => r.sector).filter(Boolean))) as string[];
    return ["Todos", ...unique.sort()];
  }, [results]);

  const filtered = sectorFilter === "Todos" ? results : results.filter((r) => r.sector === sectorFilter);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Acciones Subvaluadas (DCF)</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Todas las candidatas con margen de seguridad positivo real, mismo motor de DCF que Mentor IA.
          {generatedAt > 0 && ` Actualizado: ${new Date(generatedAt * 1000).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}.`}
        </Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accentLight} />
          </View>
        ) : results.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>
              Todavía no hay datos del screener semanal — vuelve más tarde.
            </Text>
          </View>
        ) : (
          <>
            {sectors.length > 2 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {sectors.map((s) => (
                    <TouchableOpacity key={s} onPress={() => setSectorFilter(s)}
                                       style={[styles.chip, {
                                         borderColor: sectorFilter === s ? colors.accent : colors.border,
                                         backgroundColor: sectorFilter === s ? colors.accent + "20" : colors.card,
                                       }]}>
                      <Text style={{ fontSize: 11, color: sectorFilter === s ? colors.accentLight : colors.textSub, fontWeight: "700" }}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
            <View style={[styles.listCard, { borderColor: colors.border }]}>
              {filtered.map((u, i) => (
                <View key={u.ticker} style={[styles.row, { borderTopColor: colors.border, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, backgroundColor: colors.card }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.ticker, { color: colors.text }]} numberOfLines={1}>
                      {u.ticker} {u.company_name ? `· ${u.company_name}` : ""}
                    </Text>
                    <Text style={[styles.meta, { color: colors.textDim }]} numberOfLines={1}>
                      Precio ${u.price} · Valor intrínseco ${u.intrinsic_value_base} · {u.sector || "N/D"}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 13, fontWeight: "900", color: "#22c55e" }}>+{u.margin_of_safety_pct}%</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 15, fontWeight: "800" },
  scroll: { padding: 16, paddingBottom: 40 },
  subtitle: { fontSize: 12, marginBottom: 16, lineHeight: 17 },
  center: { paddingVertical: 40, alignItems: "center" },
  emptyCard: { borderWidth: 1, borderRadius: 16, padding: 24 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  listCard: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14 },
  ticker: { fontSize: 13, fontWeight: "700" },
  meta: { fontSize: 10, marginTop: 2 },
});
