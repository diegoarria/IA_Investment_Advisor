import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useTheme } from "../lib/ThemeContext";

function getSteps(t: TFunction) {
  return [
    {
      emoji: "👋",
      color: "#00b96d",
      title: t("tutorialModal.steps.welcome.title"),
      subtitle: t("tutorialModal.steps.welcome.subtitle"),
      desc: t("tutorialModal.steps.welcome.desc"),
      tip: t("tutorialModal.steps.welcome.tip"),
    },
    {
      emoji: "🏠",
      color: "#00b96d",
      title: t("tutorialModal.steps.dashboard.title"),
      subtitle: t("tutorialModal.steps.dashboard.subtitle"),
      desc: t("tutorialModal.steps.dashboard.desc"),
      tip: t("tutorialModal.steps.dashboard.tip"),
    },
    {
      emoji: "💬",
      color: "#10b981",
      title: t("tutorialModal.steps.chat.title"),
      subtitle: t("tutorialModal.steps.chat.subtitle"),
      desc: t("tutorialModal.steps.chat.desc"),
      tip: t("tutorialModal.steps.chat.tip"),
    },
    {
      emoji: "📊",
      color: "#3b82f6",
      title: t("tutorialModal.steps.portfolio.title"),
      subtitle: t("tutorialModal.steps.portfolio.subtitle"),
      desc: t("tutorialModal.steps.portfolio.desc"),
      tip: t("tutorialModal.steps.portfolio.tip"),
    },
    {
      emoji: "📅",
      color: "#f59e0b",
      title: t("tutorialModal.steps.calendar.title"),
      subtitle: t("tutorialModal.steps.calendar.subtitle"),
      desc: t("tutorialModal.steps.calendar.desc"),
      tip: t("tutorialModal.steps.calendar.tip"),
    },
    {
      emoji: "👁️",
      color: "#0ea5e9",
      title: t("tutorialModal.steps.watchlist.title"),
      subtitle: t("tutorialModal.steps.watchlist.subtitle"),
      desc: t("tutorialModal.steps.watchlist.desc"),
      tip: t("tutorialModal.steps.watchlist.tip"),
    },
    {
      emoji: "📚",
      color: "#06b6d4",
      title: t("tutorialModal.steps.learning.title"),
      subtitle: t("tutorialModal.steps.learning.subtitle"),
      desc: t("tutorialModal.steps.learning.desc"),
      tip: t("tutorialModal.steps.learning.tip"),
    },
    {
      emoji: "🧠",
      color: "#a855f7",
      title: t("tutorialModal.steps.profile.title"),
      subtitle: t("tutorialModal.steps.profile.subtitle"),
      desc: t("tutorialModal.steps.profile.desc"),
      tip: t("tutorialModal.steps.profile.tip"),
    },
  ];
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function TutorialModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [step, setStep] = useState(0);

  const STEPS = getSteps(t);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const progress = ((step + 1) / STEPS.length) * 100;

  const handleNext = () => {
    if (isLast) { onClose(); setStep(0); }
    else setStep(step + 1);
  };

  const handleClose = () => { onClose(); setStep(0); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* Progress bar */}
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.progressFill, { width: `${progress}%` as any, backgroundColor: current.color }]} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.stepLabel, { color: colors.textDim }]}>
              {step + 1} / {STEPS.length}
            </Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            {/* Emoji */}
            <View style={styles.emojiWrap}>
              <View style={[styles.emojiBox, { backgroundColor: current.color + "18", borderColor: current.color + "35" }]}>
                <Text style={styles.emoji}>{current.emoji}</Text>
              </View>
            </View>

            {/* Text */}
            <Text style={[styles.title, { color: colors.text }]}>{current.title}</Text>
            <Text style={[styles.subtitle, { color: current.color }]}>{current.subtitle}</Text>
            <Text style={[styles.desc, { color: colors.textSub }]}>{current.desc}</Text>

            {/* Tip */}
            <View style={[styles.tip, { backgroundColor: current.color + "0e", borderColor: current.color + "25" }]}>
              <Text style={[styles.tipText, { color: colors.textMuted }]}>{current.tip}</Text>
            </View>

            {/* Navigation */}
            <View style={styles.nav}>
              {step > 0 ? (
                <TouchableOpacity
                  style={[styles.btnBack, { backgroundColor: colors.bg, borderColor: colors.border }]}
                  onPress={() => setStep(step - 1)}
                >
                  <Ionicons name="arrow-back" size={16} color={colors.textMuted} />
                  <Text style={[styles.btnBackText, { color: colors.textMuted }]}>{t("tutorialModal.back")}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.btnBack, { backgroundColor: colors.bg, borderColor: colors.border }]}
                  onPress={handleClose}
                >
                  <Text style={[styles.btnBackText, { color: colors.textMuted }]}>{t("tutorialModal.skip")}</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.btnNext, { backgroundColor: current.color, shadowColor: current.color }]}
                onPress={handleNext}
              >
                <Text style={styles.btnNextText}>{isLast ? t("tutorialModal.start") : t("tutorialModal.next")}</Text>
                {!isLast && <Ionicons name="arrow-forward" size={16} color="white" />}
              </TouchableOpacity>
            </View>

            {/* Dots */}
            <View style={styles.dots}>
              {STEPS.map((_, i) => (
                <TouchableOpacity key={i} onPress={() => setStep(i)}>
                  <View style={[
                    styles.dot,
                    {
                      width: i === step ? 20 : 6,
                      backgroundColor: i === step ? current.color : colors.border,
                    },
                  ]} />
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center", justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%", maxWidth: 420,
    borderRadius: 28, borderWidth: 1,
    overflow: "hidden",
    maxHeight: "90%",
  },
  progressTrack: { height: 3, width: "100%" },
  progressFill: { height: 3, borderRadius: 2 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8,
  },
  stepLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  emojiWrap: { alignItems: "center", marginVertical: 16 },
  emojiBox: {
    width: 80, height: 80, borderRadius: 24,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5,
  },
  emoji: { fontSize: 38 },
  title: {
    fontSize: 20, fontWeight: "900", textAlign: "center",
    marginBottom: 4, paddingHorizontal: 20, letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 11, fontWeight: "700", textAlign: "center",
    textTransform: "uppercase", letterSpacing: 0.8,
    marginBottom: 14, paddingHorizontal: 20,
  },
  desc: {
    fontSize: 14, lineHeight: 22, textAlign: "center",
    paddingHorizontal: 20, marginBottom: 14,
  },
  tip: {
    marginHorizontal: 20, borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20,
  },
  tipText: { fontSize: 12, lineHeight: 18 },
  nav: {
    flexDirection: "row", gap: 10,
    paddingHorizontal: 20, marginBottom: 16,
  },
  btnBack: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 18,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  btnBackText: { fontSize: 13, fontWeight: "600" },
  btnNext: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderRadius: 18, paddingVertical: 12,
    shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  btnNextText: { color: "white", fontWeight: "700", fontSize: 14 },
  dots: {
    flexDirection: "row", justifyContent: "center",
    gap: 6, paddingBottom: 20,
  },
  dot: { height: 6, borderRadius: 3 },
});
