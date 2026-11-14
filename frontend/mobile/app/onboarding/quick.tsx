import React, { useState, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Linking, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { profileApi } from "../../src/lib/api";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../../src/lib/LanguageContext";
import { useAppStore } from "../../src/lib/profileStore";
import { useSubscriptionStore } from "../../src/lib/subscriptionStore";
import { useChatStore } from "../../src/lib/chatStore";
import {
  readOnboardingGoal, clearOnboardingGoal, checkOnboardingActivation,
} from "../../src/lib/onboardingAnalytics";

// Stage E (mobile parity, 2026-11): the one mandatory screen between
// "account created" and the product, replacing the old 9-step wizard
// (app/onboarding/index.tsx — left in place, untouched, no longer where a
// fresh signup is routed) with the same scope cut Web already shipped in
// Stage C: name, phone, investment goal and market perception all become
// optional personalization collected later, never part of the required
// path. Only two things stay mandatory, because they're real eligibility/
// compliance requirements, not UX questions: birth date (18+ gate) and the
// legal consent checkboxes — same copy, same two checkboxes mobile's own
// wizard already used (onboarding.step9.*), just not spread across 9
// screens anymore.
//
// Backend caveat (documented, not fixed here — same as Web's Stage D
// risk #6): none of this is enforced server-side. POST /profile accepts
// birth_date and terms_accepted_at/terms_version as plain optional fields
// with no validation at all. This screen is the only real gate today.

const TERMS_VERSION = "2026-11-quick-mobile";

export default function OnboardingQuickScreen() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const setProfile = useAppStore((s) => s.setProfile);

  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);

  const birthDateValid = (() => {
    const d = parseInt(day), m = parseInt(month), y = parseInt(year);
    if (!d || !m || !y || y < 1920 || y > new Date().getFullYear()) return false;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
    return Date.now() - dt.getTime() >= 18 * 365.25 * 86_400_000;
  })();
  const birthDateStr = birthDateValid ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : "";
  const canSubmit = birthDateValid && acceptedTerms && acceptedDisclaimer && !loading;

  const destinationForGoal = (goal: ReturnType<typeof readOnboardingGoal>): string => {
    if (goal === "company") return "/(tabs)/oportunidades";
    if (goal === "portfolio") return "/(tabs)/patrimonio";
    // "etf": the real Explorador de ETFs screen (Fase 9C) only exists on
    // the separate, unmerged `etf-phase0-asset-classification` branch —
    // this branch (onboarding-2-0, based on main) never had it. Falling
    // back to Home rather than a route that doesn't exist here. See the
    // Stage E report's "diferencias técnicas" section — merging that
    // branch in is Diego's call, not something to do unilaterally from
    // inside an onboarding change.
    return "/(tabs)/home";
  };

  const handleSubmit = async () => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true); setError("");

    const payload = {
      birth_date: birthDateStr,
      mentor: null,
      language,
      terms_accepted_at: new Date().toISOString(),
      terms_version: TERMS_VERSION,
    };

    const attempt = async (n: number): Promise<void> => {
      try {
        await profileApi.create(payload);
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        const isDefinitive = status !== undefined && status !== 503 && status !== 429;
        if (!isDefinitive && n < 2) {
          await new Promise((r) => setTimeout(r, 800 * (n + 1)));
          return attempt(n + 1);
        }
        throw err;
      }
    };

    try {
      await attempt(0);
      setProfile(payload as unknown as import("../../src/lib/profileStore").UserProfile);
      useSubscriptionStore.getState().fetchStatus().catch(() => {});

      const genericName = language === "en" ? "Investor" : "Inversor";
      const welcomeMsg = t("onboarding.welcome.messageNoGoal", { name: genericName });
      const chat = useChatStore.getState();
      chat.createSession();
      chat.setMessages([{ role: "assistant", content: welcomeMsg, timestamp: Date.now() }]);

      checkOnboardingActivation();

      const goal = readOnboardingGoal();
      const destination = destinationForGoal(goal);
      clearOnboardingGoal();
      router.replace(destination as any);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((d: { msg?: string }) => d?.msg ?? String(d)).join(", ")
        : typeof detail === "string" ? detail : null;
      setError(msg || t("onboarding.saveProfileError"));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <View style={S.screen}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
            <Text style={S.title}>{t("onboardingQuick.title")}</Text>
            <Text style={S.subtitle}>{t("onboardingQuick.subtitle")}</Text>

            <View style={{ marginTop: 24 }}>
              <Text style={S.label}>{t("onboarding.step0.birthDate")}</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TextInput
                  style={[S.input, { flex: 1, textAlign: "center" }]}
                  value={day} onChangeText={(v) => setDay(v.replace(/[^0-9]/g, "").slice(0, 2))}
                  placeholder="DD" placeholderTextColor="#374151" keyboardType="numeric" maxLength={2} autoFocus
                />
                <TextInput
                  style={[S.input, { flex: 1, textAlign: "center" }]}
                  value={month} onChangeText={(v) => setMonth(v.replace(/[^0-9]/g, "").slice(0, 2))}
                  placeholder="MM" placeholderTextColor="#374151" keyboardType="numeric" maxLength={2}
                />
                <TextInput
                  style={[S.input, { flex: 1.3, textAlign: "center" }]}
                  value={year} onChangeText={(v) => setYear(v.replace(/[^0-9]/g, "").slice(0, 4))}
                  placeholder="AAAA" placeholderTextColor="#374151" keyboardType="numeric" maxLength={4}
                />
              </View>
              <Text style={S.hint}>{t("onboarding.step0.ageHint")}</Text>
            </View>

            {/* Same legal evidence mobile's 9-step wizard already captured —
                unchanged copy, unchanged two checkboxes, just not its own
                separate step. */}
            <View style={[S.legalBox, { marginTop: 20 }]}>
              <Text style={S.legalBadge}>{t("onboarding.step9.legalBadge")}</Text>
              <Text style={S.legalBody}>
                {t("onboarding.step9.legalBodyPart1")}{" "}
                <Text style={{ color: "#fff", fontWeight: "700" }}>{t("onboarding.step9.legalBodyBold1")}</Text>.
                {" "}{t("onboarding.step9.legalBodyPart2")}{" "}
                <Text style={{ color: "#fff", fontWeight: "700" }}>{t("onboarding.step9.legalBodyBold2")}</Text>{" "}
                {t("onboarding.step9.legalBodyPart3")}
              </Text>
              <Text style={[S.legalBody, { marginTop: 8 }]}>
                {t("onboarding.step9.legalBodyPart4")}{" "}
                <Text style={{ color: "#fff", fontWeight: "700" }}>{t("onboarding.step9.legalBodyBold3")}</Text>
              </Text>
            </View>

            <TouchableOpacity style={[S.checkRow, { marginTop: 16 }]} onPress={() => setAcceptedTerms((v) => !v)} activeOpacity={0.7}>
              <View style={[S.checkbox, acceptedTerms && { borderColor: "#00d47e", backgroundColor: "#00d47e" }]}>
                {acceptedTerms && <Ionicons name="checkmark" size={12} color="white" />}
              </View>
              <Text style={S.checkLabel}>
                {t("onboarding.step9.termsPrefix")}{" "}
                <Text style={{ color: "#00d47e", textDecorationLine: "underline" }}
                      onPress={(e) => { e.stopPropagation(); Linking.openURL("https://nuvosai.com/terms"); }}>
                  {t("onboarding.step9.termsOfUse")}
                </Text>
                {" "}{t("onboarding.step9.and")}{" "}
                <Text style={{ color: "#00d47e", textDecorationLine: "underline" }}
                      onPress={(e) => { e.stopPropagation(); Linking.openURL("https://nuvosai.com/privacy"); }}>
                  {t("onboarding.step9.privacyPolicy")}
                </Text>.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={[S.checkRow, { marginTop: 14 }]} onPress={() => setAcceptedDisclaimer((v) => !v)} activeOpacity={0.7}>
              <View style={[S.checkbox, acceptedDisclaimer && { borderColor: "#00d47e", backgroundColor: "#00d47e" }]}>
                {acceptedDisclaimer && <Ionicons name="checkmark" size={12} color="white" />}
              </View>
              <Text style={S.checkLabel}>
                {t("onboarding.step9.understandPrefix")}{" "}
                <Text style={{ color: "#fff", fontWeight: "700" }}>{t("onboarding.step9.understandBold")}</Text>.
                {" "}{t("onboarding.step9.understandSuffix")}
              </Text>
            </TouchableOpacity>

            {error && (
              <View style={S.errorBox}>
                <Text style={{ color: "#f87171", fontSize: 13 }}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[S.submitBtn, !canSubmit && S.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
              activeOpacity={0.85}
            >
              {loading ? <ActivityIndicator color="#000" /> : (
                <Text style={S.submitText}>{t("onboardingQuick.continueButton")}</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0d12" },
  title: { fontSize: 26, fontWeight: "900", color: "#fff", letterSpacing: -0.6, lineHeight: 32, marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#6b7280", lineHeight: 21 },
  label: { color: "#9ca3af", fontSize: 13, fontWeight: "600", letterSpacing: 0.2, marginBottom: 9 },
  hint: { color: "#4b5563", fontSize: 11, marginTop: 6, lineHeight: 16 },
  input: {
    backgroundColor: "#111318", borderWidth: 1, borderColor: "#1a1d27",
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16,
    color: "#fff", fontSize: 16,
  },
  legalBox: { borderWidth: 1, borderColor: "rgba(245,158,11,0.3)", backgroundColor: "rgba(245,158,11,0.06)", borderRadius: 16, padding: 18 },
  legalBadge: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, color: "#f59e0b", marginBottom: 10 },
  legalBody: { fontSize: 12, color: "#9ca3af", lineHeight: 19 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#2a2d3a",
    alignItems: "center", justifyContent: "center", marginTop: 1, flexShrink: 0,
  },
  checkLabel: { flex: 1, fontSize: 13, color: "#9ca3af", lineHeight: 20 },
  errorBox: { marginTop: 16, borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 14, padding: 14 },
  submitBtn: {
    marginTop: 24, backgroundColor: "#00d47e", borderRadius: 16,
    paddingVertical: 17, alignItems: "center", justifyContent: "center",
    shadowColor: "#00d47e", shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 8,
  },
  submitBtnDisabled: { opacity: 0.35 },
  submitText: { color: "#000", fontWeight: "900", fontSize: 16, letterSpacing: 0.1 },
});
