import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { decisionsApi } from "../../lib/api";
import { GlowCard } from "./companyDiagnosticShared";

// Self-Check mini-quiz — hasta abajo de la pantalla de Oportunidades
// (Diego). 5 preguntas de comprensión libres, todas opcionales; lo que el
// usuario responda se guarda como Q&A estructurado en su Diario de
// Decisiones existente (investment_decisions.quiz_answers, migración 075).
// Same viColors-driven styling as the rest of this screen — no new palette.
export function SelfCheckQuiz({ ticker, colors }: { ticker: string; colors: any }) {
  const { t } = useTranslation();
  const questions = t("subvaluadas.selfCheckQuiz.questions", { returnObjects: true }) as string[];
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  const hasAnyAnswer = answers.some((a) => a.trim() !== "");

  const handleChange = (i: number, value: string) => {
    setSaved(false);
    setAnswers((prev) => prev.map((a, idx) => (idx === i ? value : a)));
  };

  const handleSave = async () => {
    if (!hasAnyAnswer || saving) return;
    setSaving(true);
    setError(false);
    try {
      const quiz_answers = questions
        .map((q, i) => ({ question: q, answer: answers[i].trim() }))
        .filter((qa) => qa.answer !== "");
      await decisionsApi.log({
        action: "hold",
        ticker,
        trigger: "research",
        notes: `${t("subvaluadas.selfCheckQuiz.title")} — ${ticker}`,
        quiz_answers,
      });
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlowCard colors={colors} style={{ marginTop: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgRaised }}>
          <Ionicons name="clipboard-outline" size={18} color={colors.textSub} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.2 }}>{t("subvaluadas.selfCheckQuiz.title")}</Text>
          <Text style={{ fontSize: 12, lineHeight: 16, color: colors.textMuted, marginTop: 2 }}>
            {t("subvaluadas.selfCheckQuiz.subtitle")}
          </Text>
        </View>
      </View>

      <View style={{ marginTop: 18, gap: 16 }}>
        {questions.map((q, i) => (
          <View key={i}>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: "900", color: colors.textMuted, fontVariant: ["tabular-nums"] }}>{i + 1}.</Text>
              <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 19, fontWeight: "600", color: colors.text }}>{q}</Text>
            </View>
            <TextInput
              value={answers[i]}
              onChangeText={(v) => handleChange(i, v)}
              placeholder={t("subvaluadas.selfCheckQuiz.placeholder")}
              placeholderTextColor={colors.placeholder ?? colors.textMuted}
              multiline
              numberOfLines={2}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.bgRaised,
                paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, color: colors.text,
                minHeight: 52, textAlignVertical: "top",
              }}
            />
          </View>
        ))}
      </View>

      <View style={{ gap: 10, marginTop: 18 }}>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!hasAnyAnswer || saving}
          style={{
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
            paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14,
            backgroundColor: colors.brandGreen ?? colors.accent, opacity: !hasAnyAnswer || saving ? 0.4 : 1,
          }}
        >
          {saving ? (
            <ActivityIndicator size="small" color="white" />
          ) : saved ? (
            <Ionicons name="checkmark" size={14} color="white" />
          ) : null}
          <Text style={{ fontSize: 14, fontWeight: "800", color: "white" }}>
            {saving ? t("subvaluadas.selfCheckQuiz.saving") : saved ? t("subvaluadas.selfCheckQuiz.saved") : t("subvaluadas.selfCheckQuiz.saveButton")}
          </Text>
        </TouchableOpacity>
        {error && (
          <Text style={{ fontSize: 12, color: "#ef4444", textAlign: "center" }}>{t("subvaluadas.selfCheckQuiz.saveError")}</Text>
        )}
      </View>
    </GlowCard>
  );
}
