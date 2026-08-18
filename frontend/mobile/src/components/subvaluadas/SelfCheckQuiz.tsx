import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { decisionsApi } from "../../lib/api";

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
    <View style={{ marginTop: 18, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="clipboard-outline" size={18} color={colors.textMuted} />
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>{t("subvaluadas.selfCheckQuiz.title")}</Text>
      </View>
      <Text style={{ fontSize: 11, lineHeight: 15, color: colors.textMuted, marginTop: 4 }}>
        {t("subvaluadas.selfCheckQuiz.subtitle")}
      </Text>

      <View style={{ marginTop: 12, gap: 12 }}>
        {questions.map((q, i) => (
          <View key={i}>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.text, marginBottom: 5 }}>{q}</Text>
            <TextInput
              value={answers[i]}
              onChangeText={(v) => handleChange(i, v)}
              placeholder={t("subvaluadas.selfCheckQuiz.placeholder")}
              placeholderTextColor={colors.placeholder ?? colors.textMuted}
              multiline
              numberOfLines={2}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                paddingHorizontal: 10, paddingVertical: 8, fontSize: 12.5, color: colors.text,
                minHeight: 44, textAlignVertical: "top",
              }}
            />
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 }}>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!hasAnyAnswer || saving}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6,
            paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
            backgroundColor: colors.brandGreen ?? colors.accent, opacity: !hasAnyAnswer || saving ? 0.4 : 1,
          }}
        >
          {saving ? (
            <ActivityIndicator size="small" color="white" />
          ) : saved ? (
            <Ionicons name="checkmark" size={14} color="white" />
          ) : null}
          <Text style={{ fontSize: 12.5, fontWeight: "700", color: "white" }}>
            {saving ? t("subvaluadas.selfCheckQuiz.saving") : saved ? t("subvaluadas.selfCheckQuiz.saved") : t("subvaluadas.selfCheckQuiz.saveButton")}
          </Text>
        </TouchableOpacity>
        {error && (
          <Text style={{ fontSize: 11, color: "#ef4444" }}>{t("subvaluadas.selfCheckQuiz.saveError")}</Text>
        )}
      </View>
    </View>
  );
}
