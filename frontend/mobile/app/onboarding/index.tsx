import React, { useState, useMemo, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Image, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { profileApi } from "../../src/lib/api";
import { posthog } from "../../src/config/posthog";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useAppStore, RISK_CONFIG } from "../../src/lib/profileStore";
import type { QuizAnswer } from "../../src/lib/profileStore";

// ─── Types ────────────────────────────────────────────────────────────────────
type RiskTolerance = "conservative" | "moderate" | "aggressive";

function getCountries(t: TFunction) {
  return [
    { value: "MX", label: t("onboarding.countries.MX"), emoji: "🇲🇽" },
    { value: "US", label: t("onboarding.countries.US"), emoji: "🇺🇸" },
    { value: "CO", label: t("onboarding.countries.CO"), emoji: "🇨🇴" },
    { value: "AR", label: t("onboarding.countries.AR"), emoji: "🇦🇷" },
    { value: "VE", label: t("onboarding.countries.VE"), emoji: "🇻🇪" },
    { value: "PE", label: t("onboarding.countries.PE"), emoji: "🇵🇪" },
    { value: "CL", label: t("onboarding.countries.CL"), emoji: "🇨🇱" },
    { value: "ES", label: t("onboarding.countries.ES"), emoji: "🇪🇸" },
    { value: "OTHER", label: t("onboarding.countries.OTHER"), emoji: "🌍" },
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

function getKnowledgeLevels(t: TFunction) {
  return [
    { value: "B" as QuizAnswer, label: t("profileEdit.knowledgeLevels.basic.label"), emoji: "🌱", color: "#22c55e",
      desc: t("profileEdit.knowledgeLevels.basic.desc") },
    { value: "C" as QuizAnswer, label: t("profileEdit.knowledgeLevels.intermediate.label"), emoji: "📈", color: "#3b82f6",
      desc: t("profileEdit.knowledgeLevels.intermediate.desc") },
    { value: "D" as QuizAnswer, label: t("profileEdit.knowledgeLevels.advanced.label"), emoji: "🎯", color: "#a855f7",
      desc: t("profileEdit.knowledgeLevels.advanced.desc") },
  ];
}

function getRiskExtra(t: TFunction): Record<RiskTolerance, { emoji: string; desc: string }> {
  return {
    conservative: { emoji: "🛡️", desc: t("onboarding.riskExtra.conservative") },
    moderate:     { emoji: "⚖️", desc: t("onboarding.riskExtra.moderate") },
    aggressive:   { emoji: "🚀", desc: t("onboarding.riskExtra.aggressive") },
  };
}

function getQuizQ1(t: TFunction) {
  return {
    category: t("onboarding.quizQ1.category"),
    question: t("onboarding.quizQ1.question"),
    options: {
      A: t("onboarding.quizQ1.options.A"), B: t("onboarding.quizQ1.options.B"),
      C: t("onboarding.quizQ1.options.C"), D: t("onboarding.quizQ1.options.D"),
    } as Record<QuizAnswer, string>,
  };
}

function getQuizQ4(t: TFunction) {
  return {
    category: t("onboarding.quizQ4.category"),
    question: t("onboarding.quizQ4.question"),
    options: {
      A: t("onboarding.quizQ4.options.A"), B: t("onboarding.quizQ4.options.B"),
      C: t("onboarding.quizQ4.options.C"), D: t("onboarding.quizQ4.options.D"),
    } as Record<QuizAnswer, string>,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function calculateRisk(q1: string, q4: string): RiskTolerance {
  const m: Record<QuizAnswer, number> = { A: 1, B: 2, C: 3, D: 4 };
  const vals = [q1, q4].filter((v): v is QuizAnswer => "ABCD".includes(v));
  if (!vals.length) return "moderate";
  const avg = vals.reduce((s, v) => s + m[v], 0) / vals.length;
  return avg <= 2 ? "conservative" : avg <= 3 ? "moderate" : "aggressive";
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

// Adds thousand separators as the user types, while keeping the underlying
// state a plain parseable numeric string (no commas).
function formatWithCommas(raw: string): string {
  if (!raw) return "";
  const [intPart, decPart] = raw.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
}

function yearsToGoal(pmt: number, goal: number, annualRate: number): number | null {
  if (pmt <= 0 || goal <= 0) return null;
  const r = annualRate / 12;
  const n = Math.log(1 + (goal * r) / pmt) / Math.log(1 + r);
  if (!isFinite(n) || n <= 0) return null;
  return Math.ceil(n / 12);
}

type FormState = {
  name: string; birth_day: string; birth_month: string; birth_year: string;
  country: string;
  knowledge_level: QuizAnswer | "";
  monthly_income: string;
  initial_capital: string;
  monthly_contribution: string; investment_goal_amount: string;
  investment_horizon: string; investment_goal: string;
  q1: QuizAnswer | ""; q4: QuizAnswer | "";
  has_broker: "yes" | "no" | "";
  broker_name: string;
  has_investments: "yes" | "no" | "";
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const { t } = useTranslation();
  const COUNTRIES = getCountries(t);
  const GOALS = getGoals(t);
  const KNOWLEDGE_LEVELS = getKnowledgeLevels(t);
  const RISK_EXTRA = getRiskExtra(t);
  const QUIZ_Q1 = getQuizQ1(t);
  const QUIZ_Q4 = getQuizQ4(t);
  const setProfile    = useAppStore((state) => state.setProfile);
  const existingProfile = useAppStore((state) => state.profile);

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
    country: "",
    knowledge_level: "", monthly_income: "", initial_capital: "",
    monthly_contribution: "", investment_goal_amount: "",
    investment_horizon: "", investment_goal: "", q1: "", q4: "",
    has_broker: "", broker_name: "", has_investments: "",
  });
  const [showSession, setShowSession] = useState(false);
  const isFirstTimer = form.has_investments !== "yes";

  const firstName  = form.name.trim().split(" ")[0];
  const calculated = calculateRisk(form.q1, form.q4);
  const riskCfg    = RISK_CONFIG[calculated];
  const pct        = Math.round(riskCfg.pct * 100);
  const levelInfo  = KNOWLEDGE_LEVELS.find(l => l.value === form.knowledge_level);
  const goalInfo   = GOALS.find(g => g.value === form.investment_goal);

  const birthDateValid = (() => {
    const d = parseInt(form.birth_day), m = parseInt(form.birth_month), y = parseInt(form.birth_year);
    if (!d || !m || !y || y < 1920 || y > 2006) return false;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
    return Date.now() - dt.getTime() >= 18 * 365.25 * 86_400_000;
  })();

  const birthDateStr = birthDateValid
    ? `${form.birth_year}-${form.birth_month.padStart(2,"0")}-${form.birth_day.padStart(2,"0")}`
    : "";

  const userAge = birthDateStr
    ? Math.floor((Date.now() - new Date(birthDateStr).getTime()) / (365.25 * 86_400_000))
    : 0;

  const pmt        = Math.max(parseFloat(form.monthly_contribution) || 0, 0);
  const goalAmt    = Math.max(parseFloat(form.investment_goal_amount) || 0, 1);
  const horizonYrs = Math.max(parseInt(form.investment_horizon) || 10, 1);
  const annualRate = calculated === "conservative" ? 0.07 : calculated === "moderate" ? 0.10 : 0.12;
  const rateLabel  = calculated === "conservative" ? "7%" : calculated === "moderate" ? "10%" : "12%";
  const r          = annualRate / 12;
  const fvAt       = (months: number) => pmt > 0 ? Math.round(pmt * ((Math.pow(1 + r, months) - 1) / r)) : 0;
  const fvHorizon  = fvAt(horizonYrs * 12);
  const fvPlus10   = fvAt((horizonYrs + 10) * 12);
  const extraGain  = fvPlus10 - fvHorizon;
  const extraPct   = fvHorizon > 0 ? Math.round((extraGain / fvHorizon) * 100) : 0;
  const maxFV      = Math.max(fvPlus10, goalAmt);
  const yrsNeeded  = yearsToGoal(pmt, goalAmt, annualRate);
  const goalStatusLine = fvHorizon >= goalAmt
    ? t("onboarding.goalStatus.reached", { years: horizonYrs })
    : yrsNeeded
    ? t("onboarding.goalStatus.needsYears", { years: yrsNeeded, amount: fmtMoney(goalAmt) })
    : t("onboarding.goalStatus.wouldHave", { years: horizonYrs, amount: fmtMoney(fvHorizon) });

  // ── Quiz renderer ────────────────────────────────────────────────────────────
  const renderQuiz = (q: typeof QUIZ_Q1, field: "q1" | "q4") => (
    <View style={{ gap: 10 }}>
      <Text style={S.quizQuestion}>{q.question}</Text>
      {(["A","B","C","D"] as QuizAnswer[]).map((letter) => {
        const active = form[field] === letter;
        return (
          <TouchableOpacity
            key={letter}
            activeOpacity={0.75}
            style={[S.quizOption, active && S.quizOptionActive]}
            onPress={() => setForm(f => ({ ...f, [field]: letter }))}
          >
            <View style={[S.quizBadge, active && S.quizBadgeActive]}>
              <Text style={[S.quizBadgeText, active && { color: "#fff" }]}>{letter}</Text>
            </View>
            <Text style={[S.quizLabel, active && { color: "#fff" }]}>{q.options[letter]}</Text>
            {active && <Ionicons name="checkmark-circle" size={18} color="#00d47e" />}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // ── All steps ──────────────────────────────────────────────────────────────
  const STEPS = [
    // 0 — Nombre + Fecha
    {
      emoji: "👋",
      title: t("onboarding.step0.title"),
      sub: t("onboarding.step0.sub"),
      isValid: () => form.name.trim().length >= 2 && birthDateValid && !!form.country,
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

          <View>
            <Text style={S.label}>{t("onboarding.step0.whereInvestFrom")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {COUNTRIES.map((c) => {
                const active = form.country === c.value;
                return (
                  <TouchableOpacity
                    key={c.value}
                    onPress={() => setForm(f => ({ ...f, country: c.value }))}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 6,
                      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
                      borderWidth: 1,
                      borderColor: active ? "#00d47e" : "#1a1d27",
                      backgroundColor: active ? "rgba(0,212,126,0.1)" : "#111318",
                    }}
                  >
                    <Text style={{ fontSize: 16 }}>{c.emoji}</Text>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: active ? "#00d47e" : "#9ca3af" }}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      ),
    },

    // 1 — Nivel de conocimiento
    {
      emoji: "📚",
      title: firstName ? t("onboarding.step1.titleWithName", { name: firstName }) : t("onboarding.step1.title"),
      sub: t("onboarding.step1.sub"),
      isValid: () => !!form.knowledge_level,
      content: (
        <View style={{ gap: 12 }}>
          {KNOWLEDGE_LEVELS.map((lvl) => {
            const active = form.knowledge_level === lvl.value;
            return (
              <TouchableOpacity
                key={lvl.value}
                activeOpacity={0.8}
                onPress={() => setForm(f => ({ ...f, knowledge_level: lvl.value }))}
                style={[S.levelCard, active && { borderColor: lvl.color, backgroundColor: lvl.color + "10" }]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                  <View style={[S.levelEmojiWrap, active && { backgroundColor: lvl.color + "20" }]}>
                    <Text style={{ fontSize: 26 }}>{lvl.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.levelTitle, active && { color: lvl.color }]}>{lvl.label}</Text>
                    <Text style={S.levelDesc}>{lvl.desc}</Text>
                  </View>
                  {active && (
                    <View style={[S.checkCircle, { backgroundColor: lvl.color }]}>
                      <Ionicons name="checkmark" size={13} color="white" />
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ),
    },

    // 2 — Plan financiero
    {
      emoji: "💰",
      title: t("onboarding.step2.title"),
      sub: t("onboarding.step2.sub"),
      isValid: () => pmt > 0 && parseFloat(form.investment_goal_amount) > 0 && horizonYrs >= 1,
      content: (
        <View style={{ gap: 20 }}>
          <View>
            <Text style={S.label}>{t("onboarding.step2.monthlyIncome")}</Text>
            <View style={S.prefixWrap}>
              <Text style={S.prefix}>$</Text>
              <TextInput
                style={[S.input, S.prefixInput]}
                value={formatWithCommas(form.monthly_income)}
                onChangeText={(v) => { const raw = v.replace(/,/g, ""); if (raw === "" || /^\d*\.?\d*$/.test(raw)) setForm(f => ({ ...f, monthly_income: raw })); }}
                placeholder="2,000" placeholderTextColor="#374151"
                keyboardType="numeric"
              />
              <Text style={[S.prefix, { paddingRight: 18, fontSize: 13 }]}>{t("profileEdit.perMonth")}</Text>
            </View>
            <Text style={S.hint}>{t("onboarding.step2.monthlyIncomeHint")}</Text>
          </View>
          <View>
            <Text style={S.label}>{t("onboarding.step2.currentCapital")}</Text>
            <View style={S.prefixWrap}>
              <Text style={S.prefix}>$</Text>
              <TextInput
                style={[S.input, S.prefixInput]}
                value={formatWithCommas(form.initial_capital)}
                onChangeText={(v) => { const raw = v.replace(/,/g, ""); if (raw === "" || /^\d*\.?\d*$/.test(raw)) setForm(f => ({ ...f, initial_capital: raw })); }}
                placeholder="0" placeholderTextColor="#374151"
                keyboardType="numeric"
              />
            </View>
            <Text style={S.hint}>{t("onboarding.step2.capitalHint")}</Text>
          </View>
          <View>
            <Text style={S.label}>{t("onboarding.step2.monthlyAmount")}</Text>
            <View style={S.prefixWrap}>
              <Text style={S.prefix}>$</Text>
              <TextInput
                style={[S.input, S.prefixInput]}
                value={formatWithCommas(form.monthly_contribution)}
                onChangeText={(v) => { const raw = v.replace(/,/g, ""); if (raw === "" || /^\d*\.?\d*$/.test(raw)) setForm(f => ({ ...f, monthly_contribution: raw })); }}
                placeholder="500" placeholderTextColor="#374151"
                keyboardType="numeric"
              />
              <Text style={[S.prefix, { paddingRight: 18, fontSize: 13 }]}>{t("profileEdit.perMonth")}</Text>
            </View>
          </View>

          <View>
            <Text style={S.label}>{t("onboarding.step2.targetWealth")}</Text>
            <View style={S.prefixWrap}>
              <Text style={S.prefix}>$</Text>
              <TextInput
                style={[S.input, S.prefixInput]}
                value={formatWithCommas(form.investment_goal_amount)}
                onChangeText={(v) => { const raw = v.replace(/,/g, ""); if (raw === "" || /^\d*\.?\d*$/.test(raw)) setForm(f => ({ ...f, investment_goal_amount: raw })); }}
                placeholder="1,000,000" placeholderTextColor="#374151"
                keyboardType="numeric"
              />
            </View>
            <Text style={S.hint}>{t("onboarding.step2.wealthHint")}</Text>
          </View>

          <View>
            <Text style={S.label}>{t("onboarding.step2.years")}</Text>
            <View style={S.prefixWrap}>
              <TextInput
                style={[S.input, S.prefixInput, { flex: 1 }]}
                value={form.investment_horizon}
                onChangeText={(v) => setForm(f => ({ ...f, investment_horizon: v }))}
                placeholder="10" placeholderTextColor="#374151"
                keyboardType="numeric"
              />
              <Text style={[S.prefix, { paddingRight: 18, fontSize: 13 }]}>{t("profileEdit.years")}</Text>
            </View>
          </View>
        </View>
      ),
    },

    // 3 — Meta al invertir
    {
      emoji: "🎯",
      title: t("onboarding.step3.title"),
      sub: t("onboarding.step3.sub"),
      isValid: () => !!form.investment_goal,
      content: (
        <View style={S.goalGrid}>
          {GOALS.map((g) => {
            const active = form.investment_goal === g.value;
            return (
              <TouchableOpacity
                key={g.value}
                activeOpacity={0.8}
                onPress={() => setForm(f => ({ ...f, investment_goal: g.value }))}
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

    // 4 — Quiz q1
    {
      emoji: "🧠",
      title: QUIZ_Q1.category,
      sub: t("onboarding.step4.sub"),
      isValid: () => !!form.q1,
      content: renderQuiz(QUIZ_Q1, "q1"),
    },

    // 5 — Quiz q4
    {
      emoji: "📊",
      title: QUIZ_Q4.category,
      sub: t("onboarding.step5.sub"),
      isValid: () => !!form.q4,
      content: renderQuiz(QUIZ_Q4, "q4"),
    },

    // 6 — Experiencia en el mercado
    {
      emoji: "💼",
      title: t("onboarding.step6.title"),
      sub: t("onboarding.step6.sub"),
      isValid: () => !!form.has_broker && !!form.has_investments,
      content: (
        <View style={{ gap: 24 }}>
          <View style={{ gap: 10 }}>
            <Text style={S.label}>{t("onboarding.step6.hasBroker")}</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(["yes", "no"] as const).map((v) => {
                const active = form.has_broker === v;
                return (
                  <TouchableOpacity
                    key={v}
                    onPress={() => setForm(f => ({ ...f, has_broker: v, broker_name: v === "no" ? "" : f.broker_name }))}
                    style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, alignItems: "center",
                      borderColor: active ? "#00d47e" : "#1a1d27",
                      backgroundColor: active ? "rgba(0,212,126,0.1)" : "#111318" }}
                  >
                    <Text style={{ fontSize: 20, marginBottom: 4 }}>{v === "yes" ? "✅" : "❌"}</Text>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: active ? "#00d47e" : "#9ca3af" }}>
                      {v === "yes" ? t("onboarding.step6.yesHave") : t("onboarding.step6.noHave")}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {form.has_broker === "yes" && (
              <TextInput
                style={[S.input, { marginTop: 4 }]}
                value={form.broker_name}
                onChangeText={(v) => setForm(f => ({ ...f, broker_name: v }))}
                placeholder={t("onboarding.step6.brokerPlaceholder")}
                placeholderTextColor="#374151"
                autoCapitalize="words"
              />
            )}
          </View>

          <View style={{ gap: 10 }}>
            <Text style={S.label}>{t("onboarding.step6.hasInvestments")}</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(["yes", "no"] as const).map((v) => {
                const active = form.has_investments === v;
                return (
                  <TouchableOpacity
                    key={v}
                    onPress={() => setForm(f => ({ ...f, has_investments: v }))}
                    style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, alignItems: "center",
                      borderColor: active ? "#00d47e" : "#1a1d27",
                      backgroundColor: active ? "rgba(0,212,126,0.1)" : "#111318" }}
                  >
                    <Text style={{ fontSize: 20, marginBottom: 4 }}>{v === "yes" ? "📈" : "🌱"}</Text>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: active ? "#00d47e" : "#9ca3af" }}>
                      {v === "yes" ? t("onboarding.step6.yesHave") : t("onboarding.step6.starting")}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {form.has_investments === "no" && (
              <View style={{ backgroundColor: "rgba(0,212,126,0.06)", borderRadius: 12, padding: 12,
                             borderWidth: 1, borderColor: "rgba(0,212,126,0.2)", marginTop: 4 }}>
                <Text style={{ color: "#00d47e", fontSize: 12, fontWeight: "700", marginBottom: 4 }}>
                  {t("onboarding.step6.welcomeSessionIncluded")}
                </Text>
                <Text style={{ color: "#6b7280", fontSize: 11, lineHeight: 16 }}>
                  {t("onboarding.step6.welcomeSessionDesc")}
                </Text>
              </View>
            )}
          </View>
        </View>
      ),
    },

    // 7 — Perfil del inversor (reveal)
    {
      emoji: riskCfg?.color ? "" : "🎉",
      title: t("onboarding.step7.title", { name: firstName || t("onboarding.step7.investorFallback") }),
      sub: t("onboarding.step7.sub"),
      isValid: () => true,
      content: (
        <View style={{ gap: 16 }}>
          {/* Risk reveal card */}
          <View style={[S.revealCard, { borderColor: riskCfg.color + "44" }]}>
            <Text style={{ fontSize: 48, marginBottom: 10 }}>{RISK_EXTRA[calculated].emoji}</Text>
            <Text style={[S.revealType, { color: riskCfg.color }]}>{t("onboarding.step7.investorLabel", { label: riskCfg.label })}</Text>
            <Text style={S.revealDesc}>{RISK_EXTRA[calculated].desc}</Text>
            <View style={S.riskBar}>
              <View style={[S.riskBarFill, { flex: pct, backgroundColor: riskCfg.color }]} />
              {pct < 100 && <View style={{ flex: 100 - pct }} />}
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", width: "100%", marginTop: 4 }}>
              <Text style={S.riskBarLabel}>{t("profileEdit.lowRisk")}</Text>
              <Text style={S.riskBarLabel}>{t("profileEdit.highRisk")}</Text>
            </View>
          </View>

          {/* Summary */}
          <View style={S.summaryCard}>
            <Text style={S.summaryTitle}>{t("onboarding.step7.summaryTitle")}</Text>
            {[
              { label: t("onboarding.step7.summary.name"),    value: form.name },
              { label: t("onboarding.step7.summary.country"), value: COUNTRIES.find(c => c.value === form.country)?.label ?? "—" },
              { label: t("onboarding.step7.summary.age"),     value: userAge ? t("onboarding.step7.ageValue", { age: userAge }) : "—" },
              { label: t("onboarding.step7.summary.level"),   value: levelInfo ? `${levelInfo.emoji} ${levelInfo.label}` : "—" },
              { label: t("onboarding.step7.summary.goal"),    value: goalInfo  ? `${goalInfo.emoji} ${goalInfo.label}` : "—" },
              { label: t("onboarding.step7.summary.capital"), value: form.initial_capital ? `$${Number(form.initial_capital).toLocaleString()}` : "$0" },
              { label: t("onboarding.step7.summary.monthly"), value: t("onboarding.step7.monthlyValue", { amount: Number(form.monthly_contribution).toLocaleString() }) },
              { label: t("onboarding.step7.summary.broker"),  value: form.has_broker === "yes" ? (form.broker_name || t("onboarding.step7.yes")) : t("onboarding.step7.noBrokerYet") },
              { label: t("onboarding.step7.summary.horizon"), value: t("onboarding.step7.ageValue", { age: form.investment_horizon }) },
            ].map((row) => (
              <View key={row.label} style={S.summaryRow}>
                <Text style={S.summaryLabel}>{row.label}</Text>
                <Text style={S.summaryValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        </View>
      ),
    },

    // 7 — Proyección + features
    {
      emoji: "📈",
      title: t("onboarding.step8.title", { amount: fmtMoney(goalAmt) }),
      sub: t("onboarding.step8.sub"),
      isValid: () => true,
      content: (() => {
        const goalLinePct = Math.min((goalAmt / maxFV) * 100, 100);
        return (
          <View style={{ gap: 16 }}>
            {/* Projection bars */}
            <View style={S.projCard}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <Text style={S.projTitle}>{t("onboarding.step8.contributing", { amount: pmt.toLocaleString() })}</Text>
                <View style={{ backgroundColor: riskCfg.color + "20", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: riskCfg.color, fontSize: 11, fontWeight: "700" }}>~{rateLabel}{t("onboarding.step8.perYear")}</Text>
                </View>
              </View>

              {[
                { years: horizonYrs,      fv: fvHorizon, label: t("onboarding.step8.inYears", { years: horizonYrs }) },
                { years: horizonYrs + 10, fv: fvPlus10,  label: t("onboarding.step8.inYears", { years: horizonYrs + 10 }) },
              ].map(({ years, fv, label }) => {
                const barPct = Math.min((fv / maxFV) * 100, 100);
                return (
                  <View key={years} style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                      <Text style={{ color: "#9ca3af", fontSize: 12 }}>{label}</Text>
                      <Text style={{ color: fv >= goalAmt ? "#00d47e" : "#fff", fontSize: 14, fontWeight: "800" }}>
                        {fmtMoney(fv)}
                      </Text>
                    </View>
                    <View style={{ height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "#1f2330" }}>
                      <View style={{ position: "absolute", top: 0, bottom: 0, left: `${goalLinePct}%` as any,
                                     width: 2, backgroundColor: "#00d47e", zIndex: 2 }} />
                      <View style={{ width: `${barPct}%` as any, backgroundColor: fv >= goalAmt ? "#00d47e" : riskCfg.color,
                                     height: "100%", borderRadius: 4 }} />
                    </View>
                  </View>
                );
              })}

              <View style={S.goalStatusCard}>
                <Text style={{ fontSize: 16 }}>🎯</Text>
                <Text style={{ color: "#00d47e", fontSize: 12, fontWeight: "600", flex: 1 }}>{goalStatusLine}</Text>
              </View>

              <View style={S.compoundCard}>
                <Text style={{ fontSize: 16 }}>⏳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#818cf8", fontSize: 12, fontWeight: "700" }}>
                    {t("onboarding.step8.tenMoreYears", { gain: fmtMoney(extraGain), pct: extraPct })}
                  </Text>
                  <Text style={{ color: "#4b5563", fontSize: 10, marginTop: 4, lineHeight: 15 }}>
                    {t("onboarding.step8.compoundInterestNote")}
                  </Text>
                </View>
              </View>

              <Text style={{ color: "#374151", fontSize: 10, fontStyle: "italic", marginTop: 8 }}>
                {t("onboarding.step8.illustrativeNote")}
              </Text>
            </View>

            {/* Features */}
            <View style={S.summaryCard}>
              <Text style={[S.summaryTitle, { marginBottom: 12 }]}>{t("onboarding.step8.nuvosWorksForYou")}</Text>
              {[
                { icon: "🤖", title: t("onboarding.step8.features.ai.title"),        sub: t("onboarding.step8.features.ai.sub") },
                { icon: "📊", title: t("onboarding.step8.features.portfolio.title"), sub: t("onboarding.step8.features.portfolio.sub") },
                { icon: "📅", title: t("onboarding.step8.features.calendar.title"),  sub: t("onboarding.step8.features.calendar.sub") },
                { icon: "🎮", title: t("onboarding.step8.features.paper.title"),     sub: t("onboarding.step8.features.paper.sub") },
              ].map((f) => (
                <View key={f.title} style={S.featureRow}>
                  <Text style={{ fontSize: 20, flexShrink: 0 }}>{f.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>{f.title}</Text>
                    <Text style={{ color: "#6b7280", fontSize: 11, marginTop: 2, lineHeight: 16 }}>{f.sub}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        );
      })(),
    },

    // 8 — Disclaimer legal
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
    try {
      const profileData = {
        name:                   form.name.trim(),
        birth_date:             birthDateStr || undefined,
        country:                form.country || undefined,
        monthly_income:         form.monthly_income || undefined,
        initial_capital:        form.initial_capital || undefined,
        monthly_contribution:   form.monthly_contribution,
        investment_goal:        form.investment_goal,
        investment_goal_amount: form.investment_goal_amount,
        investment_horizon:     form.investment_horizon,
        knowledge_level:        form.knowledge_level,
        risk_tolerance:         calculated,
        quiz_answers:           { q1: form.q1, q4: form.q4 },
        has_broker:             form.has_broker === "yes",
        broker_name:            form.has_broker === "yes" ? (form.broker_name || undefined) : undefined,
        has_investments:        form.has_investments === "yes",
        mentor:                 null,
      };
      setProfile(profileData as unknown as import("../../src/lib/profileStore").UserProfile);
      profileApi.create(profileData as Record<string, unknown>).catch(() => {});
      posthog.capture("onboarding_completed", {
        risk_tolerance: calculated,
        knowledge_level: form.knowledge_level,
        investment_goal: form.investment_goal,
        investment_horizon: parseInt(form.investment_horizon) || 0,
        has_investments: form.has_investments === "yes",
        country: form.country,
      });
      setShowSession(true);
    } catch {
      setError(t("onboarding.saveProfileError"));
    } finally {
      setLoading(false);
    }
  };

  // ─── Sesión de Bienvenida ────────────────────────────────────────────────────
  if (showSession) {
    const agendaItems = [
      t("onboarding.session.agenda.defineGoals"),
      form.has_broker !== "yes" ? t("onboarding.session.agenda.openBroker") : t("onboarding.session.agenda.reviewBroker"),
      form.has_investments !== "yes" ? t("onboarding.session.agenda.firstInvestment") : t("onboarding.session.agenda.reviewInvestments"),
      t("onboarding.session.agenda.fullySetUp"),
    ];
    return (
      <View style={S.screen}>
        <View style={S.glowOrb} />
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {/* Badge */}
            <View style={{ alignItems: "center", marginBottom: 28 }}>
              <View style={{ backgroundColor: "rgba(0,212,126,0.12)", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6,
                             borderWidth: 1, borderColor: "rgba(0,212,126,0.3)", flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Text style={{ fontSize: 14 }}>{RISK_EXTRA[calculated].emoji}</Text>
                <Text style={{ color: "#00d47e", fontSize: 12, fontWeight: "800" }}>
                  {t("onboarding.session.profileBadge", { label: riskCfg.label, pct: riskCfg.pct * 100 | 0 })}
                </Text>
              </View>
            </View>

            {/* Headline */}
            <Text style={{ fontSize: 28, fontWeight: "900", color: "#fff", textAlign: "center", lineHeight: 34, marginBottom: 8 }}>
              {isFirstTimer ? t("onboarding.session.welcomeHeadline") : t("onboarding.session.almostReadyHeadline", { name: firstName })}
            </Text>
            <Text style={{ fontSize: 14, color: "#6b7280", textAlign: "center", lineHeight: 21, marginBottom: 28 }}>
              {isFirstTimer
                ? t("onboarding.session.welcomeSub")
                : t("onboarding.session.almostReadySub")}
            </Text>

            {/* Agenda */}
            {isFirstTimer && (
              <View style={{ backgroundColor: "#111318", borderRadius: 16, padding: 16, borderWidth: 1,
                             borderColor: "#1f2330", marginBottom: 20, gap: 12 }}>
                <Text style={{ color: "#9ca3af", fontSize: 11, fontWeight: "700", letterSpacing: 1.2,
                               textTransform: "uppercase", marginBottom: 4 }}>{t("onboarding.session.inYourSession")}</Text>
                {agendaItems.map((item, i) => (
                  <View key={i} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,212,126,0.15)",
                                   alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                      <Text style={{ color: "#00d47e", fontSize: 10, fontWeight: "800" }}>{i + 1}</Text>
                    </View>
                    <Text style={{ color: "#d1d5db", fontSize: 13, lineHeight: 20, flex: 1 }}>{item}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Outcomes */}
            <View style={{ gap: 8, marginBottom: 28 }}>
              {[t("onboarding.session.outcomes.0"), t("onboarding.session.outcomes.1"), t("onboarding.session.outcomes.2"), t("onboarding.session.outcomes.3")].map((o) => (
                <View key={o} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Text style={{ color: "#00d47e", fontSize: 14 }}>✅</Text>
                  <Text style={{ color: "#9ca3af", fontSize: 13 }}>{o}</Text>
                </View>
              ))}
            </View>

            {/* CTA */}
            {isFirstTimer ? (
              <TouchableOpacity
                onPress={() => Linking.openURL("https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai")}
                style={{ backgroundColor: "#00d47e", borderRadius: 16, paddingVertical: 16,
                         alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 12 }}
              >
                <Text style={{ fontSize: 16 }}>📅</Text>
                <Text style={{ color: "#000", fontSize: 16, fontWeight: "900" }}>{t("onboarding.session.scheduleCta")}</Text>
              </TouchableOpacity>
            ) : null}

            {/* Skip / Explore */}
            <TouchableOpacity
              onPress={() => router.replace("/(tabs)/chat")}
              style={{ paddingVertical: 14, alignItems: "center" }}
            >
              <Text style={{ color: "#6b7280", fontSize: 14, fontWeight: "600" }}>
                {isFirstTimer ? t("onboarding.session.exploreFirst") : t("onboarding.session.goToApp")}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={S.screen}>
      <View style={S.glowOrb} />
      <SafeAreaView style={{ flex: 1 }}>

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
  prefixWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderColor: "#1a1d27", borderRadius: 14,
    backgroundColor: "#111318",
  },
  prefix:      { paddingLeft: 18, fontSize: 16, fontWeight: "700", color: "#9ca3af" },
  prefixInput: { flex: 1, borderWidth: 0, paddingLeft: 6 },

  // ── Knowledge level cards ──
  levelCard: {
    borderWidth: 1.5, borderColor: "#1f2330", borderRadius: 18,
    padding: 16, backgroundColor: "#111318",
  },
  levelEmojiWrap: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: "#1f2330", alignItems: "center", justifyContent: "center",
  },
  levelTitle: { fontSize: 16, fontWeight: "800", color: "#fff", marginBottom: 4 },
  levelDesc:  { fontSize: 12, color: "#6b7280", lineHeight: 18 },

  // ── Goal grid ──
  goalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  goalCard: {
    width: "47%", borderWidth: 1.5, borderColor: "#1f2330",
    borderRadius: 18, padding: 16, backgroundColor: "#111318",
  },
  goalLabel: { fontSize: 12, fontWeight: "700", color: "#9ca3af", lineHeight: 17 },

  // ── Quiz ──
  quizQuestion: { fontSize: 17, fontWeight: "800", color: "#fff", lineHeight: 26, letterSpacing: -0.3, marginBottom: 16 },
  quizOption: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "#111318", borderWidth: 1.5, borderColor: "#1f2330",
    borderRadius: 16, padding: 16,
  },
  quizOptionActive: { borderColor: "#00d47e", backgroundColor: "rgba(0,212,126,0.06)" },
  quizBadge: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: "#1f2330", borderWidth: 1, borderColor: "#2a2d3a",
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  quizBadgeActive: { backgroundColor: "rgba(0,212,126,0.2)", borderColor: "#00d47e" },
  quizBadgeText: { fontSize: 14, fontWeight: "800", color: "#6b7280" },
  quizLabel:     { flex: 1, fontSize: 14, color: "#9ca3af", lineHeight: 21 },

  // ── Shared ──
  checkCircle: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },

  // ── Reveal step ──
  revealCard: {
    borderRadius: 20, borderWidth: 1.5, padding: 24,
    alignItems: "center", backgroundColor: "#111318",
  },
  revealType: { fontSize: 22, fontWeight: "900", marginBottom: 10, letterSpacing: -0.5 },
  revealDesc: { fontSize: 13, color: "#9ca3af", textAlign: "center", lineHeight: 20, marginBottom: 20 },
  riskBar:    { height: 8, borderRadius: 4, overflow: "hidden", flexDirection: "row", width: "100%", marginBottom: 8, backgroundColor: "#1f2330" },
  riskBarFill: { height: "100%", borderRadius: 4 },
  riskBarLabel: { fontSize: 10, color: "#4b5563", letterSpacing: 0.2 },

  // ── Summary card ──
  summaryCard: {
    backgroundColor: "#111318", borderWidth: 1, borderColor: "#1f2330",
    borderRadius: 18, padding: 18,
  },
  summaryTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", color: "#00d47e", marginBottom: 12 },
  summaryRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                  paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1f2330" },
  summaryLabel: { fontSize: 12, color: "#6b7280", fontWeight: "500" },
  summaryValue: { fontSize: 12, color: "#fff", fontWeight: "700", textAlign: "right", flex: 1, marginLeft: 16 },

  // ── Projection card ──
  projCard:    { backgroundColor: "#111318", borderRadius: 18, borderWidth: 1, borderColor: "#1f2330", padding: 18 },
  projTitle:   { fontSize: 13, fontWeight: "700", color: "#9ca3af" },
  goalStatusCard: {
    backgroundColor: "rgba(0,212,126,0.06)", borderRadius: 12, padding: 12, borderWidth: 1,
    borderColor: "rgba(0,212,126,0.2)", flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10,
  },
  compoundCard: {
    backgroundColor: "rgba(99,102,241,0.06)", borderRadius: 12, padding: 12, borderWidth: 1,
    borderColor: "rgba(99,102,241,0.2)", flexDirection: "row", alignItems: "center", gap: 10,
  },

  // ── Features ──
  featureRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1f2330",
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
