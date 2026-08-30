import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { profileApi } from "../../src/lib/api";
import { posthog } from "../../src/config/posthog";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../../src/lib/LanguageContext";
import type { TFunction } from "i18next";
import { useAppStore } from "../../src/lib/profileStore";
import { useSubscriptionStore } from "../../src/lib/subscriptionStore";
import { useChatStore } from "../../src/lib/chatStore";

// E.164 dial codes for the phone step.
function getDialCodes(t: TFunction) {
  return [
    { value: "MX", code: "+52", label: t("onboarding.countries.MX"), emoji: "🇲🇽" },
    { value: "US", code: "+1",  label: t("onboarding.countries.US"), emoji: "🇺🇸" },
    { value: "CO", code: "+57", label: t("onboarding.countries.CO"), emoji: "🇨🇴" },
    { value: "AR", code: "+54", label: t("onboarding.countries.AR"), emoji: "🇦🇷" },
    { value: "VE", code: "+58", label: t("onboarding.countries.VE"), emoji: "🇻🇪" },
    { value: "PE", code: "+51", label: t("onboarding.countries.PE"), emoji: "🇵🇪" },
    { value: "CL", code: "+56", label: t("onboarding.countries.CL"), emoji: "🇨🇱" },
    { value: "ES", code: "+34", label: t("onboarding.countries.ES"), emoji: "🇪🇸" },
  ];
}

function getGoals(t: TFunction) {
  return [
    { value: "house",             label: t("profileEdit.goals.house"),             emoji: "🏠" },
    { value: "car",               label: t("profileEdit.goals.car"),               emoji: "🚗" },
    { value: "passive_income",    label: t("profileEdit.goals.passive_income"),    emoji: "💸" },
    { value: "retirement",        label: t("profileEdit.goals.retirement"),        emoji: "👴" },
    { value: "financial_freedom", label: t("profileEdit.goals.financial_freedom"), emoji: "🦅" },
    { value: "long_term_wealth",  label: t("profileEdit.goals.long_term_wealth"),  emoji: "🏛️" },
  ];
}

// "¿Qué has escuchado de la bolsa?" — multi-select, fully optional. Picking
// "hasBrokerInvests" doubles as an implicit has_broker/has_investments=true
// signal, so it doesn't need its own separate step anymore.
function getMarketPerceptionOptions(t: TFunction) {
  return [
    { value: "casino",             label: t("onboarding.marketPerception.options.casino"),          emoji: "🎰" },
    { value: "only_rich",          label: t("onboarding.marketPerception.options.onlyRich"),         emoji: "💰" },
    { value: "need_expert",        label: t("onboarding.marketPerception.options.needExpert"),       emoji: "🎓" },
    { value: "has_broker_invests", label: t("onboarding.marketPerception.options.hasBrokerInvests"), emoji: "📈" },
    { value: "other",              label: t("onboarding.marketPerception.options.other"),            emoji: "💬" },
  ];
}

type FormState = {
  name: string; birth_day: string; birth_month: string; birth_year: string;
  phone_dial_code: string; phone_local: string;
  investment_goal: string;
  market_perception: string[];
  market_perception_other: string;
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const { t } = useTranslation();
  const DIAL_CODES = getDialCodes(t);
  const GOALS = getGoals(t);
  const MARKET_PERCEPTION_OPTIONS = getMarketPerceptionOptions(t);
  const setProfile    = useAppStore((state) => state.setProfile);
  const existingProfile = useAppStore((state) => state.profile);
  const { language } = useLanguage();

  useEffect(() => {
    if (existingProfile?.name) { router.replace("/(tabs)/home"); return; }
    profileApi.get().then(() => router.replace("/(tabs)/home")).catch(() => {});
  }, []);

  const [step, setStep]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [acceptedTerms, setAcceptedTerms]           = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);

  const [form, setForm] = useState<FormState>({
    name: "", birth_day: "", birth_month: "", birth_year: "",
    phone_dial_code: "", phone_local: "",
    investment_goal: "", market_perception: [], market_perception_other: "",
  });

  // ── Draft autosave ───────────────────────────────────────────────────────────
  // A multi-step flow held only in memory loses everything the instant the
  // app is backgrounded and killed by the OS, a phone call interrupts, or the
  // device just restarts mid-onboarding. Persist every answer as it's typed
  // and restore it on the next launch, so an interruption never means
  // starting over.
  const draftKeyRef = useRef<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const uid = (await SecureStore.getItemAsync("user_id").catch(() => null)) ?? "guest";
      draftKeyRef.current = `onboarding_draft__${uid}`;
      try {
        const raw = await AsyncStorage.getItem(draftKeyRef.current);
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft.form) setForm((f) => ({ ...f, ...draft.form }));
          if (typeof draft.step === "number") setStep(draft.step);
          if (typeof draft.acceptedTerms === "boolean") setAcceptedTerms(draft.acceptedTerms);
          if (typeof draft.acceptedDisclaimer === "boolean") setAcceptedDisclaimer(draft.acceptedDisclaimer);
        }
      } catch { /* corrupted/unreadable draft — just start fresh, never crash onboarding over it */ }
      setDraftLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!draftLoaded || !draftKeyRef.current) return;
    const id = setTimeout(() => {
      AsyncStorage.setItem(draftKeyRef.current!, JSON.stringify({ form, step, acceptedTerms, acceptedDisclaimer })).catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [form, step, acceptedTerms, acceptedDisclaimer, draftLoaded]);

  const phoneDigits = form.phone_local.replace(/\D/g, "");
  // Mirrors the server's E.164 check (backend/app/models/user.py:
  // ^\+[1-9]\d{6,14}$, i.e. 7-15 digits total INCLUDING the dial code).
  const dialDigits = form.phone_dial_code.replace(/\D/g, "").length;
  const phoneValid  = !!form.phone_dial_code && phoneDigits.length >= 7 && (dialDigits + phoneDigits.length) <= 15;
  // Phone is optional — only block progress if they started filling it in
  // but left it incomplete/invalid, never if they left it untouched.
  const phoneStepValid = (!form.phone_dial_code && !form.phone_local) || phoneValid;
  const firstName  = form.name.trim().split(" ")[0];

  const birthDateValid = (() => {
    const d = parseInt(form.birth_day), m = parseInt(form.birth_month), y = parseInt(form.birth_year);
    // Upper bound is just a sanity check against typos (a year in the
    // future) — the real 18+ enforcement is the elapsed-time check below.
    if (!d || !m || !y || y < 1920 || y > new Date().getFullYear()) return false;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
    return Date.now() - dt.getTime() >= 18 * 365.25 * 86_400_000;
  })();

  const birthDateStr = birthDateValid
    ? `${form.birth_year}-${form.birth_month.padStart(2,"0")}-${form.birth_day.padStart(2,"0")}`
    : "";

  const toggleMarketPerception = (value: string) => {
    setForm((f) => {
      const has = f.market_perception.includes(value);
      return {
        ...f,
        market_perception: has
          ? f.market_perception.filter((v) => v !== value)
          : [...f.market_perception, value],
      };
    });
  };

  // ── All steps ──────────────────────────────────────────────────────────────
  const STEPS = [
    // 0 — Intro: qué es Nuvos, antes de pedir cualquier dato. Feedback de
    // usuario (2026-08-29): "le gustó mucho la app, pero no entendió de qué
    // se trataba" — repite literalmente el ancla del login ("Decide mejor.")
    // en vez de ir directo a pedir nombre/fecha de nacimiento sin contexto.
    {
      emoji: "🧭",
      title: t("onboarding.stepIntro.title"),
      sub: t("onboarding.stepIntro.sub"),
      isValid: () => true,
      content: (
        <View style={{ backgroundColor: "rgba(0,212,126,0.06)", borderWidth: 1.5, borderColor: "rgba(0,212,126,0.3)", borderRadius: 16, padding: 16 }}>
          <Text style={{ fontSize: 13, color: "#d1d5db", lineHeight: 20 }}>
            {t("onboarding.stepIntro.footnote")}
          </Text>
        </View>
      ),
    },
    // 1 — Nombre + Fecha de nacimiento (obligatorio)
    {
      emoji: "👋",
      title: t("onboarding.step0.title"),
      sub: t("onboarding.step0.sub"),
      isValid: () => form.name.trim().length >= 2 && birthDateValid,
      content: (
        <View style={{ gap: 20 }}>
          <View>
            <Text style={S.label}>{t("onboarding.step0.fullName")}</Text>
            <TextInput
              style={S.input} value={form.name}
              onChangeText={(v) => setForm(f => ({ ...f, name: v }))}
              placeholder={t("onboarding.step0.namePlaceholder")} placeholderTextColor="#374151"
              autoCapitalize="words" autoFocus
            />
            <Text style={S.hint}>{t("onboarding.step0.nameHint")}</Text>
          </View>

          <View>
            <Text style={S.label}>{t("onboarding.step0.birthDate")}</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TextInput
                style={[S.input, { flex: 1, textAlign: "center" }]}
                value={form.birth_day}
                onChangeText={(v) => setForm(f => ({ ...f, birth_day: v.replace(/[^0-9]/g,"").slice(0,2) }))}
                placeholder="DD" placeholderTextColor="#374151"
                keyboardType="numeric" maxLength={2}
              />
              <TextInput
                style={[S.input, { flex: 1.4, textAlign: "center" }]}
                value={form.birth_month}
                onChangeText={(v) => setForm(f => ({ ...f, birth_month: v.replace(/[^0-9]/g,"").slice(0,2) }))}
                placeholder="MM" placeholderTextColor="#374151"
                keyboardType="numeric" maxLength={2}
              />
              <TextInput
                style={[S.input, { flex: 2, textAlign: "center" }]}
                value={form.birth_year}
                onChangeText={(v) => setForm(f => ({ ...f, birth_year: v.replace(/[^0-9]/g,"").slice(0,4) }))}
                placeholder="AAAA" placeholderTextColor="#374151"
                keyboardType="numeric" maxLength={4}
              />
            </View>
            <Text style={S.hint}>{t("onboarding.step0.ageHint")}</Text>
          </View>
        </View>
      ),
    },

    // 1 — Teléfono (opcional)
    {
      emoji: "📱",
      title: firstName ? t("onboarding.stepPhone.titleWithName", { name: firstName }) : t("onboarding.stepPhone.title"),
      sub: t("onboarding.stepPhone.sub"),
      isValid: () => phoneStepValid,
      content: (
        <View>
          <Text style={S.label}>{t("onboarding.step0.phoneLabel")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {DIAL_CODES.map((d) => {
              const active = form.phone_dial_code === d.code;
              return (
                <TouchableOpacity
                  key={d.value}
                  onPress={() => setForm(f => ({ ...f, phone_dial_code: d.code }))}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 4,
                    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10,
                    borderWidth: 1,
                    borderColor: active ? "#00d47e" : "#1a1d27",
                    backgroundColor: active ? "rgba(0,212,126,0.1)" : "#111318",
                  }}
                >
                  <Text style={{ fontSize: 14 }}>{d.emoji}</Text>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: active ? "#00d47e" : "#9ca3af" }}>{d.code}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={[S.input, { marginTop: 8 }]} value={form.phone_local}
            onChangeText={(v) => setForm(f => ({ ...f, phone_local: v }))}
            placeholder={t("onboarding.step0.phonePlaceholder")} placeholderTextColor="#374151"
            keyboardType="phone-pad" autoFocus
          />
          <Text style={S.hint}>{t("onboarding.stepPhone.phoneHint")}</Text>
        </View>
      ),
    },

    // 2 — Meta financiera al invertir (opcional)
    {
      emoji: "🎯",
      title: t("onboarding.step3.title"),
      sub: t("onboarding.step3.sub"),
      isValid: () => true,
      content: (
        <View style={S.goalGrid}>
          {GOALS.map((g) => {
            const active = form.investment_goal === g.value;
            return (
              <TouchableOpacity
                key={g.value}
                activeOpacity={0.8}
                onPress={() => setForm(f => ({ ...f, investment_goal: f.investment_goal === g.value ? "" : g.value }))}
                style={[S.goalCard, active && { borderColor: "#00d47e", backgroundColor: "rgba(0,212,126,0.08)" }]}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <Text style={{ fontSize: 28 }}>{g.emoji}</Text>
                  {active && (
                    <View style={[S.checkCircle, { backgroundColor: "#00d47e", width: 18, height: 18, borderRadius: 9 }]}>
                      <Ionicons name="checkmark" size={10} color="white" />
                    </View>
                  )}
                </View>
                <Text style={[S.goalLabel, active && { color: "#00d47e" }]}>{g.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ),
    },

    // 3 — ¿Qué has escuchado de la bolsa? (opcional, selección múltiple)
    {
      emoji: "💬",
      title: firstName ? t("onboarding.marketPerception.titleWithName", { name: firstName }) : t("onboarding.marketPerception.title"),
      sub: t("onboarding.marketPerception.sub"),
      isValid: () => true,
      content: (
        <View style={{ gap: 10 }}>
          {MARKET_PERCEPTION_OPTIONS.map((opt) => {
            const active = form.market_perception.includes(opt.value);
            return (
              <TouchableOpacity
                key={opt.value}
                activeOpacity={0.8}
                onPress={() => toggleMarketPerception(opt.value)}
                style={[S.quizOption, active && S.quizOptionActive]}
              >
                <Text style={{ fontSize: 18 }}>{opt.emoji}</Text>
                <Text style={[S.quizLabel, active && { color: "#fff" }]}>{opt.label}</Text>
                <View style={[S.checkbox, active && { borderColor: "#00d47e", backgroundColor: "#00d47e" }]}>
                  {active && <Ionicons name="checkmark" size={12} color="white" />}
                </View>
              </TouchableOpacity>
            );
          })}
          {form.market_perception.includes("other") && (
            <TextInput
              style={S.input}
              value={form.market_perception_other}
              onChangeText={(v) => setForm(f => ({ ...f, market_perception_other: v }))}
              placeholder={t("onboarding.marketPerception.otherPlaceholder")}
              placeholderTextColor="#374151"
              autoFocus
            />
          )}
          <Text style={{ color: "#6b7280", fontSize: 11, lineHeight: 16 }}>
            {t("onboarding.marketPerception.helper")}
          </Text>
        </View>
      ),
    },

    // 4 — Disclaimer legal (obligatorio)
    {
      emoji: "📋",
      title: t("onboarding.step9.title"),
      sub: t("onboarding.step9.sub"),
      isValid: () => acceptedTerms && acceptedDisclaimer,
      content: (
        <View style={{ gap: 16 }}>
          <View style={S.legalBox}>
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

          <TouchableOpacity style={S.checkRow} onPress={() => setAcceptedTerms(v => !v)} activeOpacity={0.7}>
            <View style={[S.checkbox, acceptedTerms && { borderColor: "#00d47e", backgroundColor: "#00d47e" }]}>
              {acceptedTerms && <Ionicons name="checkmark" size={12} color="white" />}
            </View>
            <Text style={S.checkLabel}>
              {t("onboarding.step9.termsPrefix")}{" "}
              <Text style={{ color: "#00d47e", textDecorationLine: "underline" }}>{t("onboarding.step9.termsOfUse")}</Text>
              {" "}{t("onboarding.step9.and")}{" "}
              <Text style={{ color: "#00d47e", textDecorationLine: "underline" }}>{t("onboarding.step9.privacyPolicy")}</Text>.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={S.checkRow} onPress={() => setAcceptedDisclaimer(v => !v)} activeOpacity={0.7}>
            <View style={[S.checkbox, acceptedDisclaimer && { borderColor: "#00d47e", backgroundColor: "#00d47e" }]}>
              {acceptedDisclaimer && <Ionicons name="checkmark" size={12} color="white" />}
            </View>
            <Text style={S.checkLabel}>
              {t("onboarding.step9.understandPrefix")}{" "}
              <Text style={{ color: "#fff", fontWeight: "700" }}>{t("onboarding.step9.understandBold")}</Text>.
              {" "}{t("onboarding.step9.understandSuffix")}
            </Text>
          </TouchableOpacity>
        </View>
      ),
    },
  ];

  const current    = STEPS[step];
  const isLastStep = step === STEPS.length - 1;
  const totalSteps = STEPS.length;

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handleNext = async () => {
    if (!isLastStep) {
      posthog.capture("onboarding_step_advanced", { step_index: step, step_total: STEPS.length });
      setStep(step + 1);
      return;
    }
    setLoading(true); setError("");

    const profileData: Record<string, unknown> = {
      name:              form.name.trim(),
      birth_date:        birthDateStr || undefined,
      mentor:            null,
      language,
      terms_accepted_at: new Date().toISOString(),
      terms_version:     "2026-06",
    };
    if (form.phone_dial_code && phoneDigits.length >= 7) {
      profileData.phone_number = form.phone_dial_code + phoneDigits;
    }
    if (form.investment_goal) profileData.investment_goal = form.investment_goal;
    if (form.market_perception.length) profileData.market_perception = form.market_perception;
    if (form.market_perception.includes("other") && form.market_perception_other.trim()) {
      profileData.market_perception_other = form.market_perception_other.trim();
    }
    // Picking "ya tengo broker y ya invierto" answers has_broker/has_investments
    // right away instead of asking those as their own separate step.
    if (form.market_perception.includes("has_broker_invests")) {
      profileData.has_broker = true;
      profileData.has_investments = true;
    }

    // This is the single most important write in the whole app — no row
    // here means no trial, no personalization, nothing. Retry a couple of
    // times with backoff on a transient failure before giving up, instead
    // of letting one flaky request strand the user.
    const attempt = async (n: number): Promise<void> => {
      try {
        await profileApi.create(profileData);
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
      // Only reflect success in local state / analytics / navigation once
      // the server has actually confirmed the profile exists — a failed
      // save must never look identical to a successful one to the user.
      setProfile(profileData as unknown as import("../../src/lib/profileStore").UserProfile);
      if (draftKeyRef.current) AsyncStorage.removeItem(draftKeyRef.current).catch(() => {});
      // The trial starts server-side the instant this profile row is
      // created (see backend profile.py) — refresh subscription status now
      // that it's actually confirmed created.
      useSubscriptionStore.getState().fetchStatus().catch(() => {});

      // ── Inyectar mensaje de bienvenida del mentor en el chat ────────────
      // Mirrors web's onboarding/page.tsx — the onboarding is short on
      // purpose (Arthur doesn't know the user's risk profile/broker/numbers
      // yet), so the welcome message says so explicitly, opening with the
      // same anchor line as the login screen instead of going straight into
      // portfolio questions.
      const goalLabel = form.investment_goal ? (GOALS.find((g) => g.value === form.investment_goal)?.label ?? "") : "";
      const welcomeMsg = goalLabel
        ? t("onboarding.welcome.messageWithGoal", { name: firstName, goal: goalLabel })
        : t("onboarding.welcome.messageNoGoal", { name: firstName });
      const chat = useChatStore.getState();
      chat.createSession();
      chat.setMessages([{ role: "assistant", content: welcomeMsg, timestamp: Date.now() }]);

      posthog.capture("onboarding_completed", {
        investment_goal: form.investment_goal || null,
        market_perception: form.market_perception,
      });
      router.replace("/(tabs)/home");
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((d: { msg?: string }) => d?.msg ?? String(d)).join(", ")
        : typeof detail === "string" ? detail : null;
      setError(msg || t("onboarding.saveProfileError"));
    } finally {
      setLoading(false);
    }
  };


  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={S.screen}>
      <View style={S.glowOrb} />
      <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
      >

        {/* ── Top nav ── */}
        <View style={S.topNav}>
          <TouchableOpacity
            style={S.backBtn}
            onPress={() => step === 0 ? router.replace("/") : setStep(step - 1)}
          >
            <Ionicons name="arrow-back" size={20} color="#9ca3af" />
          </TouchableOpacity>

          {/* Step dots */}
          <View style={S.dotsRow}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  S.dot,
                  i < step && S.dotDone,
                  i === step && S.dotActive,
                ]}
              />
            ))}
          </View>

          <View style={{ width: 36 }} />
        </View>

        {/* ── Progress bar ── */}
        <View style={S.progressTrack}>
          <View style={[S.progressFill, { width: `${((step + 1) / totalSteps) * 100}%` as any }]} />
        </View>

        <ScrollView
          contentContainerStyle={S.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Step emoji + header */}
          <View style={S.stepHeader}>
            {current.emoji ? (
              <View style={S.stepEmojiBubble}>
                <Text style={{ fontSize: 28 }}>{current.emoji}</Text>
              </View>
            ) : null}
            <Text style={S.stepCounter}>{t("onboarding.stepCounter", { current: step + 1, total: totalSteps })}</Text>
            <Text style={S.stepTitle}>{current.title}</Text>
            <Text style={S.stepSub}>{current.sub}</Text>
          </View>

          {current.content}

          {!!error && (
            <View style={S.errorBox}>
              <Text style={{ color: "#ef4444", fontSize: 13 }}>{error}</Text>
            </View>
          )}
        </ScrollView>

        {/* ── Footer ── */}
        <View style={S.footer}>
          {step > 0 && (
            <TouchableOpacity style={S.footerBack} onPress={() => setStep(step - 1)}>
              <Text style={S.footerBackText}>{t("onboarding.back")}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[S.footerNext, (!(current.isValid?.() ?? true) || loading) && S.footerNextDisabled]}
            onPress={handleNext}
            disabled={!(current.isValid?.() ?? true) || loading}
          >
            <Text style={S.footerNextText}>
              {loading ? t("onboarding.savingButton") : isLastStep ? t("onboarding.startButton") : t("onboarding.nextButton")}
            </Text>
            {!loading && !isLastStep && (
              <Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} />
            )}
          </TouchableOpacity>
        </View>

      </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles — always dark ────────────────────────────────────────────────────
const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0d12" },
  glowOrb: {
    position: "absolute", top: -100, alignSelf: "center",
    width: 300, height: 300, borderRadius: 150,
    backgroundColor: "rgba(0,212,126,0.05)",
  },

  // ── Navigation ──
  topNav: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center",
    backgroundColor: "#111318", borderWidth: 1, borderColor: "#1a1d27",
  },
  dotsRow: { flexDirection: "row", gap: 5, alignItems: "center" },
  dot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: "#1f2330",
  },
  dotDone: { backgroundColor: "#374151" },
  dotActive: { width: 18, backgroundColor: "#00d47e" },

  // ── Progress ──
  progressTrack: { height: 2, backgroundColor: "#111318", marginHorizontal: 0 },
  progressFill: { height: 2, backgroundColor: "#00d47e" },

  // ── Content ──
  content: { padding: 24, paddingBottom: 16 },
  stepHeader: { marginBottom: 28 },
  stepEmojiBubble: {
    width: 56, height: 56, borderRadius: 16, backgroundColor: "#111318",
    borderWidth: 1, borderColor: "#1f2330",
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  stepCounter: { color: "#00d47e", fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 },
  stepTitle:   { fontSize: 26, fontWeight: "900", color: "#fff", letterSpacing: -0.6, lineHeight: 32, marginBottom: 8 },
  stepSub:     { fontSize: 14, color: "#6b7280", lineHeight: 21 },

  // ── Inputs ──
  label: { color: "#9ca3af", fontSize: 13, fontWeight: "600", letterSpacing: 0.2, marginBottom: 9 },
  hint:  { color: "#4b5563", fontSize: 11, marginTop: 6, lineHeight: 16 },
  input: {
    backgroundColor: "#111318", borderWidth: 1, borderColor: "#1a1d27",
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16,
    color: "#fff", fontSize: 16,
  },

  // ── Goal grid ──
  goalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  goalCard: {
    width: "47%", borderWidth: 1.5, borderColor: "#1f2330",
    borderRadius: 18, padding: 16, backgroundColor: "#111318",
  },
  goalLabel: { fontSize: 12, fontWeight: "700", color: "#9ca3af", lineHeight: 17 },

  // ── Market perception (multi-select) ──
  quizOption: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#111318", borderWidth: 1.5, borderColor: "#1f2330",
    borderRadius: 16, padding: 14,
  },
  quizOptionActive: { borderColor: "#00d47e", backgroundColor: "rgba(0,212,126,0.06)" },
  quizLabel: { flex: 1, fontSize: 14, color: "#9ca3af", lineHeight: 21 },

  // ── Shared ──
  checkCircle: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },

  // ── Legal ──
  legalBox:   { borderWidth: 1, borderColor: "rgba(245,158,11,0.3)", backgroundColor: "rgba(245,158,11,0.06)", borderRadius: 16, padding: 18 },
  legalBadge: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, color: "#f59e0b", marginBottom: 10 },
  legalBody:  { fontSize: 12, color: "#9ca3af", lineHeight: 19 },
  checkRow:   { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  checkbox:   { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#2a2d3a",
                alignItems: "center", justifyContent: "center", marginTop: 1, flexShrink: 0 },
  checkLabel: { flex: 1, fontSize: 13, color: "#9ca3af", lineHeight: 20 },

  // ── Footer ──
  footer: {
    flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: "#111318",
    backgroundColor: "#0a0d12",
  },
  footerBack: {
    borderWidth: 1, borderColor: "#1f2330", borderRadius: 16,
    paddingVertical: 17, paddingHorizontal: 22, alignItems: "center",
    backgroundColor: "#111318",
  },
  footerBackText: { color: "#6b7280", fontWeight: "600", fontSize: 15 },
  footerNext: {
    flex: 1, backgroundColor: "#00d47e", borderRadius: 16,
    paddingVertical: 17, alignItems: "center", justifyContent: "center",
    flexDirection: "row",
    shadowColor: "#00d47e", shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 8,
  },
  footerNextDisabled: { opacity: 0.35 },
  footerNextText:     { color: "#000", fontWeight: "900", fontSize: 16, letterSpacing: 0.1 },

  // ── Error ──
  errorBox: { marginTop: 16, borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 14, padding: 14 },
});
