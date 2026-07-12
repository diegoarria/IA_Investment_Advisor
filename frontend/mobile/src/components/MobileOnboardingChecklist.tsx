import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";

export interface OnboardingStep {
  emoji: string;
  title: string;
  description: string;
  completed: boolean;
  // Optional lighter-weight way to complete this step without taking the
  // primary action (e.g. "ya tengo cuenta en broker" instead of booking a
  // call).
  secondaryAction?: { label: string; onPress: () => void };
}

interface Props {
  steps: OnboardingStep[];
  onStepPress: (index: number) => void;
}

export default function MobileOnboardingChecklist({ steps, onStepPress }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const completedCount = steps.filter((s) => s.completed).length;

  if (completedCount === steps.length) return null;

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: "rgba(0,212,126,0.3)" }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.rocketEmoji}>🚀</Text>
          <View>
            <Text style={[s.headerTitle, { color: colors.text }]}>{t("mobileOnboardingChecklist.title")}</Text>
            <Text style={[s.headerSub, { color: colors.textMuted }]}>
              {t("mobileOnboardingChecklist.progress", { completed: completedCount, total: steps.length })}
            </Text>
          </View>
        </View>
        <View style={s.dots}>
          {steps.map((st, i) => (
            <View
              key={i}
              style={[s.dot, { backgroundColor: st.completed ? "#00d47e" : colors.bgRaised }]}
            />
          ))}
        </View>
      </View>

      {/* Progress bar */}
      <View style={[s.progressTrack, { backgroundColor: colors.bgRaised }]}>
        <View
          style={[
            s.progressFill,
            { width: `${(completedCount / steps.length) * 100}%` as any },
          ]}
        />
      </View>

      {/* Steps */}
      {steps.map((step, i) => (
        <TouchableOpacity
          key={i}
          onPress={() => !step.completed && onStepPress(i)}
          disabled={step.completed}
          activeOpacity={step.completed ? 1 : 0.7}
          style={[
            s.stepRow,
            { borderTopColor: colors.border },
          ]}
        >
          <View
            style={[
              s.stepIcon,
              {
                backgroundColor: step.completed ? "#00d47e" : colors.bgRaised,
                borderColor: step.completed ? "#00d47e" : colors.border,
              },
            ]}
          >
            {step.completed ? (
              <Ionicons name="checkmark" size={14} color="#000" />
            ) : (
              <Text style={s.stepEmoji}>{step.emoji}</Text>
            )}
          </View>
          <View style={s.stepText}>
            <Text
              style={[
                s.stepTitle,
                { color: step.completed ? colors.textMuted : colors.text },
              ]}
            >
              {step.title}
            </Text>
            <Text style={[s.stepDesc, { color: colors.textDim }]}>{step.description}</Text>
            {!step.completed && step.secondaryAction && (
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation(); step.secondaryAction!.onPress(); }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={[s.stepSecondary, { color: "#00d47e" }]}>{step.secondaryAction.label}</Text>
              </TouchableOpacity>
            )}
          </View>
          {!step.completed && (
            <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  rocketEmoji: { fontSize: 22 },
  headerTitle: { fontSize: 13, fontWeight: "800" },
  headerSub: { fontSize: 11, marginTop: 1 },
  dots: { flexDirection: "row", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  progressTrack: {
    height: 5,
    marginHorizontal: 16,
    borderRadius: 10,
    marginBottom: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 10,
    backgroundColor: "#00d47e",
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  stepEmoji: { fontSize: 14, lineHeight: 18 },
  stepText: { flex: 1 },
  stepTitle: { fontSize: 13, fontWeight: "700", lineHeight: 17 },
  stepDesc: { fontSize: 11, marginTop: 1, lineHeight: 15 },
  stepSecondary: { fontSize: 11, fontWeight: "800", marginTop: 4, textDecorationLine: "underline" },
});
