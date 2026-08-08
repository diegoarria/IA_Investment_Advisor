import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, SafeAreaView, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { weeklyRitualsApi } from "../../src/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";

const GREEN = "#00d47e";

interface QuestionData {
  question_id: string;
  question: string;
  option_a: string;
  option_b: string;
  voted: boolean;
  my_choice: "a" | "b" | null;
  pct_a?: number | null;
  pct_b?: number | null;
  nuvos_choice: "a" | "b" | null;
  nuvos_explanation: string | null;
}

export default function WeeklyRitualQuestionScreen() {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);

  const [data, setData] = useState<QuestionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [revealNuvos, setRevealNuvos] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true);
    weeklyRitualsApi.getQuestion(i18n.language)
      .then((res) => setData(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const choose = async (choice: "a" | "b") => {
    if (voting || data?.voted) return;
    setVoting(true);
    try {
      const res = await weeklyRitualsApi.vote(choice);
      setData((d) => d ? { ...d, voted: true, my_choice: choice, pct_a: res.data.pct_a, pct_b: res.data.pct_b } : d);
    } catch {
      load();
    } finally {
      setVoting(false);
    }
  };

  return (
    <SafeAreaView style={[st.container, { backgroundColor: colors.bg }]}>
      <View style={st.center}>
        {loading ? (
          <ActivityIndicator color={GREEN} />
        ) : error || !data ? (
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t("weeklyRitual.question.error")}</Text>
        ) : (
          <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[st.headerRow, { borderColor: colors.border }]}>
              <Text style={{ fontSize: 12, fontWeight: "900", color: GREEN }}>🎯 {t("weeklyRitual.question.title")}</Text>
            </View>

            <View style={st.body}>
              <Text style={[st.question, { color: colors.text }]}>{data.question}</Text>

              {(["a", "b"] as const).map((opt) => {
                const label = opt === "a" ? data.option_a : data.option_b;
                const pctVal = opt === "a" ? data.pct_a : data.pct_b;
                const isMine = data.my_choice === opt;
                const bg = data.voted && isMine ? "rgba(0,212,126,0.08)" : colors.bg;
                const border = data.voted && isMine ? "rgba(0,212,126,0.4)" : colors.border;
                const textColor = data.voted && isMine ? GREEN : colors.textSub;
                return (
                  <TouchableOpacity
                    key={opt}
                    onPress={() => choose(opt)}
                    disabled={data.voted || voting}
                    style={[st.option, { backgroundColor: bg, borderColor: border }]}
                  >
                    <Text style={{ color: textColor, fontSize: 14, fontWeight: "600", flex: 1 }}>{label}</Text>
                    {data.voted && pctVal !== null && pctVal !== undefined && (
                      <Text style={{ color: textColor, fontSize: 13, fontWeight: "900" }}>{pctVal}%</Text>
                    )}
                  </TouchableOpacity>
                );
              })}

              {data.voted && (
                <Text style={{ fontSize: 11, marginTop: 8, color: colors.textMuted }}>
                  {t("weeklyRitual.question.communityVoted", {
                    pct: data.my_choice === "a" ? data.pct_a : data.pct_b,
                    option: data.my_choice === "a" ? data.option_a : data.option_b,
                  })}
                </Text>
              )}
            </View>

            {data.voted && (
              <View style={st.footer}>
                {!isPremium ? (
                  <TouchableOpacity onPress={() => setPaywallOpen(true)} style={[st.cta, { backgroundColor: colors.bgRaised, flexDirection: "row", justifyContent: "center", gap: 6 }]}>
                    <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                    <Text style={{ color: colors.textMuted, fontWeight: "800", fontSize: 13 }}>{t("weeklyRitual.question.premiumCta")}</Text>
                  </TouchableOpacity>
                ) : !revealNuvos ? (
                  <TouchableOpacity onPress={() => setRevealNuvos(true)} style={[st.cta, { backgroundColor: GREEN }]}>
                    <Text style={{ color: "#000", fontWeight: "900", fontSize: 13, textAlign: "center" }}>{t("weeklyRitual.question.revealCta")}</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={[st.reveal, { backgroundColor: "rgba(0,212,126,0.06)", borderColor: "rgba(0,212,126,0.2)" }]}>
                    <Text style={{ fontSize: 12, fontWeight: "900", color: GREEN, marginBottom: 6 }}>
                      {t("weeklyRitual.question.nuvosChoiceLabel", { option: data.nuvos_choice === "a" ? data.option_a : data.option_b })}
                    </Text>
                    <Text style={{ fontSize: 12, lineHeight: 18, color: colors.textSub }}>{data.nuvos_explanation}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}
      </View>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("weeklyRitual.question.paywallReason")} />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 420, borderRadius: 24, borderWidth: 1, overflow: "hidden" },
  headerRow: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1 },
  body: { padding: 20 },
  question: { fontSize: 14, fontWeight: "900", marginBottom: 16, lineHeight: 20 },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1, marginBottom: 8 },
  footer: { paddingHorizontal: 20, paddingBottom: 20 },
  cta: { paddingVertical: 12, borderRadius: 16 },
  reveal: { borderRadius: 16, borderWidth: 1, padding: 14 },
});
