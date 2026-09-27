import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, TextInput, SafeAreaView, ActivityIndicator, StyleSheet } from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { weeklyRitualsApi } from "../../src/lib/api";

const GREEN = "#00d47e";

// Diego (2026-09-27): these answers are what Arthur remembers week over
// week, so they can never be lost. A failed save used to be swallowed
// silently (no message, nothing stored). Now: answers are kept as a local
// draft while typing, the save retries, and a failure says so and keeps
// everything on screen to try again.
const DRAFT_KEY = "weeklyRitual.saturday.draft.v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Monday of the current week in US Eastern — same week the backend files the reflection under.
function currentWeekKeyET(): string {
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

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
  const [saveError, setSaveError] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const current = STEPS[step];
  const total = STEPS.length;

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        const draft = raw ? JSON.parse(raw) : null;
        if (draft?.week && draft.week === currentWeekKeyET() && draft.answers) {
          setAnswers(draft.answers);
          setStep(Math.min(Math.max(0, draft.step || 0), STEPS.length - 1));
        }
      } catch {}
      setDraftLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!draftLoaded || done) return;
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ week: currentWeekKeyET(), step, answers })).catch(() => {});
  }, [answers, step, draftLoaded, done]);

  const next = async () => {
    if (step + 1 < total) { setStep((s) => s + 1); return; }
    setSaving(true);
    setSaveError(false);
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await weeklyRitualsApi.saveReflection(answers);
          setDone(true);
          AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
          return;
        } catch {
          if (attempt < 3) await sleep(1000 * 2 ** attempt);
        }
      }
      setSaveError(true);
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
                {saveError && (
                  <Text style={{ fontSize: 12, color: "#f87171", marginBottom: 10 }}>{t("weeklyRitual.saturday.saveError")}</Text>
                )}
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
