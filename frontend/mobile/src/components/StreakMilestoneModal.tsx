import React, { useEffect, useRef } from "react";
import {
  Modal, View, Text, TouchableOpacity, Animated, Easing, StyleSheet,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import type { StreakMilestone } from "../lib/learnStore";

interface Props {
  milestone: StreakMilestone | null;
  onClaim: () => void;
  claiming?: boolean;
  successMessage?: string | null;
}

export default function StreakMilestoneModal({ milestone, onClaim, claiming, successMessage }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const scale  = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const pulse  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!milestone) return;
    scale.setValue(0.7);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale,   { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
    ]).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulse, { toValue: 1,    duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [milestone]);

  if (!milestone) return null;

  const isBig = milestone.premiumBonus != null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClaim}>
      <View style={s.backdrop}>
        <Animated.View style={[s.card, { backgroundColor: colors.card, borderColor: "rgba(245,158,11,0.4)", opacity, transform: [{ scale }] }]}>

          {/* Emoji pulse */}
          <Animated.View style={{ transform: [{ scale: pulse }], marginBottom: 8 }}>
            <Text style={s.emoji}>{milestone.emoji}</Text>
          </Animated.View>

          {/* Stars decoration */}
          <Text style={s.stars}>✨ ✨ ✨</Text>

          <Text style={[s.title, { color: colors.text }]}>{milestone.title}</Text>
          <Text style={[s.days, { color: "#f59e0b" }]}>{t("streakMilestoneModal.daysStreak", { days: milestone.days })}</Text>

          {/* Reward badge */}
          <View style={[s.rewardBadge, { borderColor: isBig ? "rgba(245,158,11,0.5)" : "rgba(0,212,126,0.4)", backgroundColor: isBig ? "rgba(245,158,11,0.08)" : "rgba(0,212,126,0.08)" }]}>
            <Text style={[s.rewardLabel, { color: isBig ? "#f59e0b" : "#00d47e" }]}>🎁 {milestone.reward}</Text>
          </View>

          <Text style={[s.description, { color: colors.textMuted }]}>{milestone.description}</Text>

          {successMessage ? (
            <View style={[s.btn, { backgroundColor: "rgba(0,212,126,0.15)", borderWidth: 1, borderColor: "rgba(0,212,126,0.4)" }]}>
              <Text style={[s.btnText, { color: "#00d47e" }]}>{successMessage}</Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={onClaim}
              disabled={claiming}
              activeOpacity={0.85}
              style={[s.btn, { backgroundColor: claiming ? "rgba(245,158,11,0.2)" : "#f59e0b" }]}
            >
              <Text style={[s.btnText, { color: claiming ? "rgba(255,255,255,0.4)" : "#000" }]}>
                {claiming ? t("streakMilestoneModal.claiming") : t("streakMilestoneModal.claimReward")}
              </Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 28,
    borderWidth: 1.5,
    padding: 28,
    alignItems: "center",
    gap: 10,
  },
  emoji:       { fontSize: 64, lineHeight: 72 },
  stars:       { fontSize: 18, letterSpacing: 6, opacity: 0.7 },
  title:       { fontSize: 26, fontWeight: "900", textAlign: "center" },
  days:        { fontSize: 15, fontWeight: "700" },
  rewardBadge: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8, marginTop: 4 },
  rewardLabel: { fontSize: 15, fontWeight: "800", textAlign: "center" },
  description: { fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 4 },
  btn:         { marginTop: 12, width: "100%", paddingVertical: 15, borderRadius: 18, alignItems: "center" },
  btnText:     { fontSize: 16, fontWeight: "900" },
});
