import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, SafeAreaView, ActivityIndicator, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { weeklyRitualsApi } from "../../src/lib/api";

interface Reflection {
  week_start_date: string;
  went_well: string | null;
  learned: string | null;
  would_do_differently: string | null;
}

export default function WeeklyRitualSaturdayHistoryScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    weeklyRitualsApi.getReflectionHistory()
      .then((res) => setReflections(res.data?.reflections || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView style={[st.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={st.content}>
        <Text style={[st.title, { color: colors.text }]}>🪞 {t("weeklyRitual.saturday.historyTitle")}</Text>

        {loading ? (
          <ActivityIndicator color={colors.accentLight} style={{ marginTop: 40 }} />
        ) : reflections.length === 0 ? (
          <View style={[st.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>{t("weeklyRitual.saturday.historyEmpty")}</Text>
          </View>
        ) : (
          reflections.map((r) => (
            <View key={r.week_start_date} style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={{ fontSize: 11, fontWeight: "800", color: colors.accentLight, marginBottom: 8 }}>{r.week_start_date}</Text>
              {!!r.went_well && <Text style={{ fontSize: 12, color: colors.textSub, marginBottom: 6 }}>✅ {r.went_well}</Text>}
              {!!r.learned && <Text style={{ fontSize: 12, color: colors.textSub, marginBottom: 6 }}>🧠 {r.learned}</Text>}
              {!!r.would_do_differently && <Text style={{ fontSize: 12, color: colors.textSub }}>🔁 {r.would_do_differently}</Text>}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 16 },
  emptyCard: { borderRadius: 20, borderWidth: 1, padding: 32, alignItems: "center" },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
});
