import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import {
  useAppStore, RISK_CONFIG, calculateRisk,
} from "../../src/lib/profileStore";
import type { QuizAnswer, QuizAnswers } from "../../src/lib/profileStore";
import { profileApi } from "../../src/lib/api";

// ─── Static data ──────────────────────────────────────────────────────────────
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
      desc: t("profileEditMobile.basicDescShort") },
    { value: "C" as QuizAnswer, label: t("profileEdit.knowledgeLevels.intermediate.label"), emoji: "📈", color: "#3b82f6",
      desc: t("profileEditMobile.intermediateDescShort") },
    { value: "D" as QuizAnswer, label: t("profileEdit.knowledgeLevels.advanced.label"), emoji: "🎯", color: "#a855f7",
      desc: t("profileEdit.knowledgeLevels.advanced.desc") },
  ];
}

function getQuiz(t: TFunction): {
  key: keyof QuizAnswers;
  num: string;
  category: string;
  question: string;
  options: Record<QuizAnswer, string>;
}[] {
  return [
    {
      key: "q1", num: "01", category: t("profileEdit.quiz.q1.category"),
      question: t("profileEdit.quiz.q1.question"),
      options: {
        A: t("profileEdit.quiz.q1.options.A"), B: t("profileEdit.quiz.q1.options.B"),
        C: t("profileEdit.quiz.q1.options.C"), D: t("profileEdit.quiz.q1.options.D"),
      },
    },
    {
      key: "q2", num: "02", category: t("profileEdit.quiz.q2.category"),
      question: t("profileEdit.quiz.q2.question"),
      options: {
        A: t("profileEdit.quiz.q2.options.A"), B: t("profileEdit.quiz.q2.options.B"),
        C: t("profileEdit.quiz.q2.options.C"), D: t("profileEdit.quiz.q2.options.D"),
      },
    },
    {
      key: "q3", num: "03", category: t("profileEdit.quiz.q3.category"),
      question: t("profileEdit.quiz.q3.question"),
      options: {
        A: t("profileEdit.quiz.q3.options.A"), B: t("profileEdit.quiz.q3.options.B"),
        C: t("profileEdit.quiz.q3.options.C"), D: t("profileEdit.quiz.q3.options.D"),
      },
    },
    {
      key: "q4", num: "04", category: t("profileEdit.quiz.q4.category"),
      question: t("profileEdit.quiz.q4.question"),
      options: {
        A: t("profileEdit.quiz.q4.options.A"), B: t("profileEdit.quiz.q4.options.B"),
        C: t("profileEdit.quiz.q4.options.C"), D: t("profileEdit.quiz.q4.options.D"),
      },
    },
    {
      key: "q5", num: "05", category: t("profileEdit.quiz.q5.category"),
      question: t("profileEdit.quiz.q5.question"),
      options: {
        A: t("profileEdit.quiz.q5.options.A"), B: t("profileEdit.quiz.q5.options.B"),
        C: t("profileEdit.quiz.q5.options.C"), D: t("profileEdit.quiz.q5.options.D"),
      },
    },
  ];
}

function getRiskDesc(t: TFunction): Record<string, string> {
  return {
    conservative: t("profileEditMobile.riskDesc.conservative"),
    moderate:     t("profileEditMobile.riskDesc.moderate"),
    aggressive:   t("profileEditMobile.riskDesc.aggressive"),
  };
}

function SectionCard({ icon, title, color, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; color: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <Text style={s.cardTitle}>{title}</Text>
        <View style={[s.cardIconChip, { backgroundColor: color + "18" }]}>
          <Ionicons name={icon} size={16} color={color} />
        </View>
      </View>
      {children}
    </View>
  );
}

export default function EditProfileScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const GOALS = getGoals(t);
  const KNOWLEDGE_LEVELS = getKnowledgeLevels(t);
  const QUIZ = getQuiz(t);
  const RISK_DESC = getRiskDesc(t);
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { profile, setProfile } = useAppStore();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    monthly_income:         profile?.monthly_income ?? "",
    monthly_contribution:   profile?.monthly_contribution ?? "",
    investment_goal:        profile?.investment_goal ?? "",
    investment_goal_amount: profile?.investment_goal_amount ?? "",
    investment_horizon:     profile?.investment_horizon ?? "",
    knowledge_level:        (profile?.quiz_answers?.q3 ?? profile?.knowledge_level ?? "") as QuizAnswer | "",
    q1: (profile?.quiz_answers?.q1 ?? "") as QuizAnswer | "",
    q2: (profile?.quiz_answers?.q2 ?? "") as QuizAnswer | "",
    q3: (profile?.quiz_answers?.q3 ?? "") as QuizAnswer | "",
    q4: (profile?.quiz_answers?.q4 ?? "") as QuizAnswer | "",
    q5: (profile?.quiz_answers?.q5 ?? "") as QuizAnswer | "",
  });

  const quizAnswers = { q1: form.q1, q2: form.q2, q3: form.q3, q4: form.q4, q5: form.q5 };
  const calculated  = calculateRisk(quizAnswers);
  const riskCfg     = RISK_CONFIG[calculated];
  const pct         = Math.round(riskCfg.pct * 100);

  const canSave = !!form.monthly_income && !!form.monthly_contribution;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const updates = {
        monthly_income:         form.monthly_income,
        monthly_contribution:   form.monthly_contribution,
        investment_goal:        form.investment_goal || undefined,
        investment_goal_amount: form.investment_goal_amount || undefined,
        investment_horizon:     form.investment_horizon || undefined,
        knowledge_level:        form.knowledge_level || undefined,
        risk_tolerance:         calculated,
        quiz_answers:           quizAnswers,
      };
      setProfile({
        ...(profile ?? {}),
        ...updates,
        name:      profile?.name ?? "",
        avatarUri: profile?.avatarUri ?? null,
        mentor:    profile?.mentor ?? null,
      } as any);
      await profileApi.update(updates as Record<string, unknown>);
      Alert.alert(t("profileEditMobile.updatedTitle"), t("profileEditMobile.updatedBody"), [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert(t("profileEditMobile.error"), t("profileEdit.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <SafeAreaView style={s.container}>
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >

          {/* ── Situación financiera ── */}
          <SectionCard icon="wallet-outline" title={t("profileEdit.financialSituation")} color={colors.accentLight}>
            <View style={s.row2}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{t("profileEdit.monthlyIncome")}</Text>
                <View style={s.prefixWrap}>
                  <Text style={s.prefix}>$</Text>
                  <TextInput
                    style={s.prefixInput} value={String(form.monthly_income)}
                    onChangeText={(v) => setForm((f) => ({ ...f, monthly_income: v }))}
                    placeholder="3000" placeholderTextColor={colors.placeholder} keyboardType="numeric"
                  />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{t("profileEdit.monthlyContribution")}</Text>
                <View style={s.prefixWrap}>
                  <Text style={s.prefix}>$</Text>
                  <TextInput
                    style={s.prefixInput} value={String(form.monthly_contribution)}
                    onChangeText={(v) => setForm((f) => ({ ...f, monthly_contribution: v }))}
                    placeholder="500" placeholderTextColor={colors.placeholder} keyboardType="numeric"
                  />
                </View>
              </View>
            </View>
          </SectionCard>

          {/* ── Tu plan ── */}
          <SectionCard icon="flag-outline" title={t("profileEdit.investmentPlan")} color={colors.accentLight}>
            <View style={s.row2}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{t("profileEdit.targetWealth")}</Text>
                <View style={s.prefixWrap}>
                  <Text style={s.prefix}>$</Text>
                  <TextInput
                    style={s.prefixInput} value={String(form.investment_goal_amount)}
                    onChangeText={(v) => setForm((f) => ({ ...f, investment_goal_amount: v }))}
                    placeholder="1,000,000" placeholderTextColor={colors.placeholder} keyboardType="numeric"
                  />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{t("profileEdit.investmentHorizon")}</Text>
                <View style={s.prefixWrap}>
                  <TextInput
                    style={[s.prefixInput, { flex: 1, paddingLeft: 16 }]} value={String(form.investment_horizon)}
                    onChangeText={(v) => setForm((f) => ({ ...f, investment_horizon: v }))}
                    placeholder="10" placeholderTextColor={colors.placeholder} keyboardType="numeric"
                  />
                  <Text style={s.suffix}>{t("profileEdit.years")}</Text>
                </View>
              </View>
            </View>

            <Text style={[s.label, { marginTop: 16 }]}>{t("profileEdit.investingGoal")}</Text>
            <View style={s.goalGrid}>
              {GOALS.map((g) => {
                const active = form.investment_goal === g.value;
                return (
                  <TouchableOpacity
                    key={g.value} activeOpacity={0.75}
                    onPress={() => setForm((f) => ({ ...f, investment_goal: g.value }))}
                    style={[s.goalCard, {
                      borderColor: active ? colors.accentLight : colors.border,
                      backgroundColor: active ? colors.accentLight + "15" : colors.bgRaised,
                    }]}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                      <Text style={{ fontSize: 20 }}>{g.emoji}</Text>
                      {active && (
                        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.accentLight,
                                       alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="checkmark" size={10} color="white" />
                        </View>
                      )}
                    </View>
                    <Text style={{ fontSize: 11, fontWeight: "700",
                                   color: active ? colors.accentLight : colors.textSub, lineHeight: 15 }}>
                      {g.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </SectionCard>

          {/* ── Nivel de conocimiento ── */}
          <SectionCard icon="school-outline" title={t("profileEdit.knowledgeLevel")} color={colors.accentLight}>
            {KNOWLEDGE_LEVELS.map((lvl) => {
              const active = form.knowledge_level === lvl.value;
              return (
                <TouchableOpacity
                  key={lvl.value} activeOpacity={0.75}
                  onPress={() => setForm((f) => ({ ...f, knowledge_level: lvl.value }))}
                  style={[s.levelCard, {
                    borderColor: active ? lvl.color : colors.border,
                    backgroundColor: active ? lvl.color + "12" : colors.bgRaised,
                  }]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Text style={{ fontSize: 22 }}>{lvl.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "800", color: active ? lvl.color : colors.text }}>
                        {lvl.label}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.textSub, marginTop: 2, lineHeight: 15 }}>
                        {lvl.desc}
                      </Text>
                    </View>
                    {active && (
                      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: lvl.color,
                                     alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Ionicons name="checkmark" size={12} color="white" />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </SectionCard>

          {/* ── Quiz ── */}
          <SectionCard icon="clipboard-outline" title={t("profileEdit.diagnostic")} color={colors.accentLight}>
            {QUIZ.map((q, i) => (
              <View key={q.key} style={[s.quizBlock, i === QUIZ.length - 1 && { marginBottom: 0 }]}>
                <Text style={[s.quizNum, { color: colors.accentLight }]}>{q.num} · {q.category}</Text>
                <Text style={[s.questionText, { color: colors.text }]}>{q.question}</Text>
                {(["A", "B", "C", "D"] as QuizAnswer[]).map((letter) => {
                  const selected = form[q.key] === letter;
                  return (
                    <TouchableOpacity
                      key={letter}
                      style={[s.option, selected && { borderColor: colors.accent, backgroundColor: colors.accent + "15" }]}
                      onPress={() => setForm((f) => ({ ...f, [q.key]: letter }))}
                      activeOpacity={0.75}
                    >
                      <View style={[s.letterBadge, selected && { backgroundColor: colors.accent }]}>
                        <Text style={[s.letterText, selected && { color: "white" }]}>{letter}</Text>
                      </View>
                      <Text style={[s.optionLabel, { color: selected ? colors.text : colors.textSub }]}>
                        {q.options[letter]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </SectionCard>

          {/* ── Perfil resultante ── */}
          <SectionCard icon="shield-checkmark-outline" title={t("profileEdit.resultingProfile")} color={riskCfg.color}>
            <View style={s.profileRow}>
              <Ionicons name={riskCfg.icon} size={30} color={riskCfg.color} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[s.profileType, { color: colors.text }]}>{riskCfg.label}</Text>
                <Text style={[s.profileDesc, { color: colors.textMuted }]}>{RISK_DESC[calculated]}</Text>
              </View>
            </View>
            <View style={[s.barTrack, { backgroundColor: colors.border, marginTop: 12 }]}>
              <View style={[s.barFill, { flex: pct, backgroundColor: riskCfg.color }]} />
              {pct < 100 && <View style={{ flex: 100 - pct }} />}
            </View>
            <View style={s.barLabels}>
              <Text style={[s.barLabel, { color: colors.textDim }]}>{t("profileEdit.lowRisk")}</Text>
              <Text style={[s.barLabel, { color: colors.textDim }]}>{t("profileEdit.highRisk")}</Text>
            </View>
          </SectionCard>

        </ScrollView>

        {/* Sticky save bar — always reachable, mirrors the web redesign */}
        <View style={s.footer}>
          <TouchableOpacity
            style={[s.saveBtn, (!canSave || saving) && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!canSave || saving}
            activeOpacity={0.85}
          >
            <Text style={s.saveBtnText}>{saving ? t("profileEdit.saving") : t("profileEdit.saveChanges")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container:    { flex: 1, backgroundColor: c.bg },
    content:      { padding: 16, paddingBottom: 24 },
    card: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 18, padding: 16, marginBottom: 14,
    },
    cardHeader: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14,
    },
    cardTitle: { fontSize: 15, fontWeight: "700", color: c.text },
    cardIconChip: {
      width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center",
    },
    row2:         { flexDirection: "row", gap: 10 },
    label:        { color: c.textSub, fontSize: 12.5, fontWeight: "600", marginBottom: 6 },
    prefixWrap:   { flexDirection: "row", alignItems: "center", backgroundColor: c.bgRaised,
                    borderWidth: 1, borderColor: c.border, borderRadius: 12 },
    prefix:       { paddingLeft: 14, fontSize: 15, color: c.textMuted },
    prefixInput:  { flex: 1, paddingHorizontal: 8, paddingVertical: 13, color: c.text, fontSize: 15 },
    suffix:       { paddingRight: 14, fontSize: 12, color: c.textMuted },
    goalGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    goalCard: {
      width: "30.5%", borderWidth: 1.5, borderRadius: 14, padding: 10,
    },
    levelCard: {
      borderWidth: 1.5, borderRadius: 14, padding: 13, marginBottom: 8,
    },
    quizBlock:    { marginBottom: 22 },
    quizNum:      { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 6 },
    questionText: { fontSize: 14, fontWeight: "600", lineHeight: 20, marginBottom: 10 },
    option: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: c.bgRaised, borderWidth: 1.5, borderColor: c.border,
      borderRadius: 12, padding: 12, marginBottom: 6,
    },
    letterBadge:   { width: 28, height: 28, borderRadius: 14,
                     backgroundColor: c.border, alignItems: "center", justifyContent: "center" },
    letterText:    { fontSize: 12.5, fontWeight: "700", color: c.textMuted },
    optionLabel:   { flex: 1, fontSize: 13, lineHeight: 18 },
    profileRow:    { flexDirection: "row", alignItems: "center" },
    profileType:   { fontSize: 15, fontWeight: "700", marginBottom: 4 },
    profileDesc:   { fontSize: 12, lineHeight: 17 },
    barTrack:      { height: 7, borderRadius: 4, overflow: "hidden", flexDirection: "row", marginBottom: 5 },
    barFill:       { height: "100%", borderRadius: 4 },
    barLabels:     { flexDirection: "row", justifyContent: "space-between" },
    barLabel:      { fontSize: 10 },
    footer: {
      paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14,
      borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg,
    },
    saveBtn:       { backgroundColor: c.accent, borderRadius: 14, paddingVertical: 16,
                     alignItems: "center" },
    saveBtnDisabled: { opacity: 0.4 },
    saveBtnText:   { color: "white", fontWeight: "700", fontSize: 15.5 },
  });
}
