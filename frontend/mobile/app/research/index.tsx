import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, ActivityIndicator, Linking, AppState,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { researchApi, upsellsApi } from "../../src/lib/api";
import { useSubscriptionStore } from "../../src/lib/subscriptionStore";

type ViewState = "compose" | "plan" | "awaiting_checkout" | "progress" | "error";

interface Plan {
  companies: string[];
  relevant_blocks: string[];
  summary: string;
}

const EXAMPLE_PROMPTS = [
  "Analiza Amazon como inversión a 10 años considerando mi portafolio",
  "Compara Amazon, MercadoLibre y Alibaba y dime cuál encaja mejor con mi estrategia",
  "Encuentra empresas de calidad con ROIC > 20% y buen flujo de caja libre",
  "¿Qué empresa de semiconductores complementaría mejor mi portafolio?",
];

export default function ResearchScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { ticker } = useLocalSearchParams<{ ticker?: string }>();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;
  const price = isPremium ? 9.99 : 19.99;

  const [view, setView] = useState<ViewState>("compose");
  const [requestText, setRequestText] = useState(ticker ? t("research.compose.tickerPrefill", { ticker }) : "");
  const [jobId, setJobId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [history, setHistory] = useState<{ id: string; title: string; companies: string[]; created_at: string }[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const s = makeStyles(colors);

  useEffect(() => {
    researchApi.listReports().then((res) => setHistory(res.data?.reports || [])).catch(() => {});
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const pollJob = useCallback((id: string) => {
    setView("progress");
    const startedAt = Date.now();
    stopPolling();
    pollRef.current = setInterval(async () => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
      try {
        const res = await researchApi.getJob(id);
        setCurrentStage(res.data.current_stage || "");
        if (res.data.status === "completed") {
          stopPolling();
          router.replace(`/research/${res.data.report_id}` as any);
        } else if (res.data.status === "failed") {
          stopPolling();
          setError(res.data.error || t("research.progress.genericError"));
          setView("error");
        }
      } catch {}
    }, 2500);
  }, [stopPolling, t]);

  // Mobile checkout completes in the system browser (no in-app redirect back
  // with job_id like web has) — so when the app regains focus after being in
  // "awaiting_checkout", check if there's now an active/researching job.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && view === "awaiting_checkout") {
        researchApi.getActiveJob().then((res) => {
          if (res.data?.id) pollJob(res.data.id);
        }).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [view, pollJob]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleSubmitRequest = async () => {
    if (!requestText.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await researchApi.createPlan(requestText.trim());
      if (res.data?.error) { setError(res.data.error); setLoading(false); return; }
      setJobId(res.data.job_id);
      setPlan(res.data.plan);
      setView("plan");
    } catch {
      setError(t("research.compose.planError"));
    }
    setLoading(false);
  };

  const handleConfirmAndPay = async () => {
    if (!jobId) return;
    setLoading(true); setError(null);
    try {
      const res = await upsellsApi.checkout("deep_research", isPremium ? "premium" : "free", "research_screen", { job_id: jobId });
      if (res.data?.url) {
        Linking.openURL(res.data.url);
        setView("awaiting_checkout");
      } else {
        setError(res.data?.error || t("research.plan.checkoutError"));
      }
    } catch {
      setError(t("research.plan.checkoutError"));
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.text }]}>{t("research.title")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[s.subtitle, { color: colors.textMuted }]}>{t("research.subtitle")}</Text>

        {view === "compose" && (
          <View>
            <TextInput
              value={requestText}
              onChangeText={setRequestText}
              multiline
              numberOfLines={4}
              placeholder={t("research.compose.placeholder") ?? undefined}
              placeholderTextColor={colors.placeholder}
              style={[s.textarea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            />
            <View style={s.chipsWrap}>
              {EXAMPLE_PROMPTS.map((p) => (
                <TouchableOpacity key={p} onPress={() => setRequestText(p)}
                                   style={[s.chip, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <Text style={[s.chipText, { color: colors.textDim }]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {error && <Text style={s.errorText}>{error}</Text>}
            <TouchableOpacity onPress={handleSubmitRequest} disabled={loading || !requestText.trim()}
                              style={[s.primaryBtn, { backgroundColor: colors.accent, opacity: (loading || !requestText.trim()) ? 0.5 : 1 }]}>
              {loading ? <ActivityIndicator color="#000" /> : <Ionicons name="sparkles" size={16} color="#000" />}
              <Text style={s.primaryBtnText}>{t("research.compose.submit")}</Text>
            </TouchableOpacity>

            {history.length > 0 && (
              <View style={{ marginTop: 28 }}>
                <Text style={[s.sectionLabel, { color: colors.textMuted }]}>{t("research.history.title")}</Text>
                <View style={[s.historyCard, { borderColor: colors.border }]}>
                  {history.map((r, i) => (
                    <TouchableOpacity key={r.id} onPress={() => router.push(`/research/${r.id}` as any)}
                                       style={[s.historyRow, { borderTopColor: colors.border, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, backgroundColor: colors.card }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.historyTitle, { color: colors.text }]} numberOfLines={1}>{r.title}</Text>
                        <Text style={[s.historyMeta, { color: colors.textDim }]}>
                          {r.companies?.join(", ")} · {new Date(r.created_at).toLocaleDateString()}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {view === "plan" && plan && (
          <View>
            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[s.cardLabel, { color: colors.accentLight }]}>{t("research.plan.title")}</Text>
              <Text style={[s.cardText, { color: colors.text }]}>{plan.summary}</Text>
              {plan.companies?.length > 0 && (
                <View style={s.chipsWrap}>
                  {plan.companies.map((c) => (
                    <View key={c} style={[s.tickerChip, { backgroundColor: colors.bgRaised ?? colors.border }]}>
                      <Text style={[s.tickerChipText, { color: colors.textSub ?? colors.text }]}>{c}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={[s.card, s.priceRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View>
                <Text style={[s.priceLabel, { color: colors.textMuted }]}>
                  {isPremium ? t("research.plan.premiumPrice") : t("research.plan.freePrice")}
                </Text>
                <Text style={s.priceValue}>${price.toFixed(2)}</Text>
              </View>
            </View>

            {error && <Text style={s.errorText}>{error}</Text>}
            <TouchableOpacity onPress={handleConfirmAndPay} disabled={loading}
                              style={[s.primaryBtn, { backgroundColor: colors.accent, opacity: loading ? 0.5 : 1 }]}>
              {loading ? <ActivityIndicator color="#000" /> : <Ionicons name="arrow-forward" size={16} color="#000" />}
              <Text style={s.primaryBtnText}>{t("research.plan.confirm")}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setView("compose")} style={{ paddingVertical: 10, alignItems: "center" }}>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{t("research.plan.back")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {view === "awaiting_checkout" && (
          <View style={[s.card, { alignItems: "center", padding: 28, backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="card-outline" size={28} color={colors.accentLight} style={{ marginBottom: 10 }} />
            <Text style={[s.cardText, { color: colors.text, textAlign: "center" }]}>{t("research.plan.checkoutOpened")}</Text>
          </View>
        )}

        {view === "progress" && (
          <View style={[s.card, { alignItems: "center", padding: 28, backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator size="large" color={colors.accentLight} style={{ marginBottom: 14 }} />
            <Text style={[s.cardText, { color: colors.text, fontWeight: "700", textAlign: "center" }]}>
              {currentStage || t("research.progress.starting")}
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>
              {t("research.progress.elapsed", { seconds: elapsedSec })}
            </Text>
            <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 8 }}>{t("research.progress.estimate")}</Text>
          </View>
        )}

        {view === "error" && (
          <View style={[s.card, { alignItems: "center", padding: 24, backgroundColor: colors.card, borderColor: "rgba(239,68,68,0.35)" }]}>
            <Ionicons name="warning-outline" size={24} color="#ef4444" style={{ marginBottom: 8 }} />
            <Text style={[s.cardText, { color: colors.text, textAlign: "center" }]}>{error}</Text>
            <TouchableOpacity onPress={() => { setView("compose"); setError(null); }}
                              style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.border }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>{t("research.progress.tryAgain")}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(_colors: unknown) {
  return StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
    backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 15, fontWeight: "800" },
    scroll: { padding: 16, paddingBottom: 40 },
    subtitle: { fontSize: 12, marginBottom: 16 },
    textarea: { borderWidth: 1, borderRadius: 16, padding: 14, fontSize: 13, minHeight: 100, textAlignVertical: "top" },
    chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
    chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, maxWidth: "100%" },
    chipText: { fontSize: 11 },
    errorText: { fontSize: 12, color: "#ef4444", marginTop: 10 },
    primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 16, marginTop: 16 },
    primaryBtnText: { fontSize: 13, fontWeight: "900", color: "#000" },
    sectionLabel: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
    historyCard: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
    historyRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14 },
    historyTitle: { fontSize: 13, fontWeight: "700" },
    historyMeta: { fontSize: 10, marginTop: 2 },
    card: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12 },
    cardLabel: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
    cardText: { fontSize: 13, lineHeight: 19 },
    tickerChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
    tickerChipText: { fontSize: 11, fontWeight: "800" },
    priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    priceLabel: { fontSize: 11 },
    priceValue: { fontSize: 22, fontWeight: "900", color: "#22c55e" },
  });
}
