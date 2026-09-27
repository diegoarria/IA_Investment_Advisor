import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, SafeAreaView, ActivityIndicator, StyleSheet, AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { weeklyRitualsApi } from "../../src/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";

const GREEN = "#00d47e";

// Diego (2026-09-27): this screen must ALWAYS open. It used to make one
// request and, if that one failed (cold start from the Sunday push,
// network not up yet, a token refresh mid-flight), sat on an error
// message forever. Now: retry with backoff, show this week's cached
// question instantly, a real retry button, and a retry on app resume.
const RETRY_DELAYS_MS = [0, 1500, 3000, 6000, 10000];
const CACHE_KEY = "weeklyRitual.question.v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Same week key as the backend's _current_question_week_key: Monday of the
// current week in US Eastern time — a cached question is only shown if
// it's still this week's.
function currentWeekKeyET(): string | null {
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

interface QuestionData {
  question_id: string;
  date?: string;
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
  const [voteError, setVoteError] = useState(false);
  const [revealNuvos, setRevealNuvos] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [error, setError] = useState(false);
  const loadSeq = useRef(0);
  const hasDataRef = useRef(false);
  hasDataRef.current = data !== null;

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(false);
    for (const delay of RETRY_DELAYS_MS) {
      if (delay) await sleep(delay);
      if (seq !== loadSeq.current) return;
      try {
        const res = await weeklyRitualsApi.getQuestion(i18n.language);
        if (seq !== loadSeq.current) return;
        setData(res.data);
        setLoading(false);
        try {
          const { voted, my_choice, pct_a, pct_b, nuvos_choice, nuvos_explanation, ...question } = res.data;
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ lang: i18n.language, question }));
        } catch {}
        return;
      } catch (e: any) {
        // 404 = the backend truly has no question (empty bank) — retrying won't change that.
        if (e?.response?.status === 404) break;
      }
    }
    if (seq !== loadSeq.current) return;
    setLoading(false);
    // With a cached copy on screen the user can still read and vote — the
    // error state is only for "nothing to show at all".
    if (!hasDataRef.current) setError(true);
  }, [i18n.language]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        const cached = raw ? JSON.parse(raw) : null;
        const week = currentWeekKeyET();
        if (cached?.question && cached.lang === i18n.language && week && cached.question.date === week) {
          setData((d) => d ?? { ...cached.question, voted: false, my_choice: null, nuvos_choice: null, nuvos_explanation: null });
        }
      } catch {}
    })();
    load();
  }, [load]);

  // Coming back to the app after a failed load (e.g. turned wifi back on) retries on its own.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && error) load();
    });
    return () => sub.remove();
  }, [error, load]);

  const choose = async (choice: "a" | "b") => {
    if (voting || data?.voted) return;
    setVoting(true);
    setVoteError(false);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await weeklyRitualsApi.vote(choice);
          setData((d) => d ? { ...d, voted: true, my_choice: choice, pct_a: res.data.pct_a, pct_b: res.data.pct_b } : d);
          return;
        } catch (e: any) {
          // 409 = already voted this week (another device, or a cached
          // screen) — reload into the real voted state.
          if (e?.response?.status === 409) { load(); return; }
          if (attempt < 2) await sleep(1000 * (attempt + 1));
        }
      }
      setVoteError(true);
    } finally {
      setVoting(false);
    }
  };

  return (
    <SafeAreaView style={[st.container, { backgroundColor: colors.bg }]}>
      <View style={st.center}>
        {!data && loading ? (
          <ActivityIndicator color={GREEN} />
        ) : error || !data ? (
          <View style={{ alignItems: "center", gap: 14 }}>
            <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: "center" }}>{t("weeklyRitual.question.error")}</Text>
            <TouchableOpacity onPress={load} style={[st.cta, { backgroundColor: GREEN, paddingHorizontal: 28 }]}>
              <Text style={{ color: "#000", fontWeight: "900", fontSize: 13 }}>{t("weeklyRitual.question.retry")}</Text>
            </TouchableOpacity>
          </View>
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

              {voteError && !data.voted && (
                <Text style={{ fontSize: 11, marginTop: 8, color: "#f87171" }}>{t("weeklyRitual.question.voteError")}</Text>
              )}

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
