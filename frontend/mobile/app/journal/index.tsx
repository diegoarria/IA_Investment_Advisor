import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../../src/lib/ThemeContext";
import { journalApi } from "../../src/lib/api";

interface ThesisSummary {
  id: string;
  ticker: string;
  company_name: string | null;
  price_at_creation: number | null;
  intrinsic_value_base: number | null;
  created_at: string;
}

export default function JournalScreen() {
  const { colors } = useTheme();
  const [theses, setTheses] = useState<ThesisSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    journalApi.list()
      .then((res) => setTheses(res.data?.theses || []))
      .catch(() => setTheses([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Investment Journal</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Cada análisis completo que le pides a Mentor IA se guarda aquí — vuelve más adelante a revisar si la tesis se cumplió.
        </Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accentLight} />
          </View>
        ) : theses.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>
              Todavía no tienes tesis guardadas. Pídele a Mentor IA &quot;Analízame [empresa]&quot; para crear la primera.
            </Text>
          </View>
        ) : (
          <View style={[styles.historyCard, { borderColor: colors.border }]}>
            {theses.map((th, i) => (
              <TouchableOpacity key={th.id} onPress={() => router.push(`/journal/${th.id}` as any)}
                                 style={[styles.historyRow, { borderTopColor: colors.border, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, backgroundColor: colors.card }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.historyTitle, { color: colors.text }]} numberOfLines={1}>
                    {th.ticker} {th.company_name ? `· ${th.company_name}` : ""}
                  </Text>
                  <Text style={[styles.historyMeta, { color: colors.textDim }]}>
                    {new Date(th.created_at).toLocaleDateString()} · Precio ${th.price_at_creation ?? "N/D"} · Valor intrínseco ${th.intrinsic_value_base ?? "N/D"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
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
  subtitle: { fontSize: 12, marginBottom: 16 },
  center: { paddingVertical: 40, alignItems: "center" },
  emptyCard: { borderWidth: 1, borderRadius: 16, padding: 24 },
  historyCard: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14 },
  historyTitle: { fontSize: 13, fontWeight: "700" },
  historyMeta: { fontSize: 10, marginTop: 2 },
});
