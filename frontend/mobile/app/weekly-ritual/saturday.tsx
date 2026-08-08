import React, { useState } from "react";
import { View, Text, TouchableOpacity, TextInput, SafeAreaView, ActivityIndicator, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { weeklyRitualsApi } from "../../src/lib/api";

const GREEN = "#00d47e";

const STEPS: { key: "went_well" | "learned" | "would_do_differently"; emoji: string }[] = [
  { key: "went_well", emoji: "✅" },
  { key: "learned", emoji: "🧠" },
  { key: "would_do_differently", emoji: "🔁" },
];

export default function WeeklyRitualSaturdayScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const current = STEPS[step];
  const total = STEPS.length;

  const next = async () => {
    if (step + 1 < total) { setStep((s) => s + 1); return; }
    setSaving(true);
    try {
      await weeklyRitualsApi.saveReflection(answers);
      setDone(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[st.container, { backgroundColor: colors.bg }]}>
      <View style={st.center}>
        <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {done ? (
            <View style={{ padding: 24, alignItems: "center" }}>
              <Text style={{ fontSize: 36, marginBottom: 10 }}>🪞</Text>
              <Text style={{ fontSize: 17, fontWeight: "900", color: colors.text, marginBottom: 4 }}>{t("weeklyRitual.saturday.doneTitle")}</Text>
              <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 16, textAlign: "center" }}>{t("weeklyRitual.saturday.doneSubtitle")}</Text>
              <TouchableOpacity onPress={() => router.push("/weekly-ritual/saturday-history" as any)}>
                <Text style={{ fontSize: 13, fontWeight: "800", color: GREEN }}>{t("weeklyRitual.saturday.seeHistory")} →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={[st.headerRow, { borderColor: colors.border }]}>
                <Text style={{ fontSize: 12, fontWeight: "900", color: GREEN, marginBottom: 8 }}>🪞 {t("weeklyRitual.saturday.title")}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ flex: 1, height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: colors.border }}>
                    <View style={{ height: "100%", borderRadius: 3, width: `${(step / total) * 100}%`, backgroundColor: GREEN }} />
                  </View>
                  <Text style={{ fontSize: 10, color: colors.textMuted }}>{step + 1}/{total}</Text>
                </View>
              </View>

              <View style={{ padding: 20 }}>
                <Text style={{ fontSize: 14, fontWeight: "900", color: colors.text, marginBottom: 12 }}>
                  {current.emoji} {t(`weeklyRitual.saturday.prompts.${current.key}`)}
                </Text>
                <TextInput
                  value={answers[current.key] || ""}
                  onChangeText={(v) => setAnswers((a) => ({ ...a, [current.key]: v }))}
                  multiline
                  numberOfLines={4}
                  placeholder={t("weeklyRitual.saturday.placeholder")}
                  placeholderTextColor={colors.placeholder}
                  style={[st.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.bg }]}
                />
              </View>

              <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                <TouchableOpacity onPress={next} disabled={saving} style={{ backgroundColor: GREEN, borderRadius: 16, paddingVertical: 12, flexDirection: "row", justifyContent: "center", gap: 8 }}>
                  {saving && <ActivityIndicator size="small" color="#000" />}
                  <Text style={{ color: "#000", fontWeight: "900", fontSize: 14 }}>
                    {step + 1 >= total ? t("weeklyRitual.saturday.finish") : t("weeklyRitual.saturday.next")}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 420, borderRadius: 24, borderWidth: 1, overflow: "hidden" },
  headerRow: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1 },
  input: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, minHeight: 100, textAlignVertical: "top" },
});
