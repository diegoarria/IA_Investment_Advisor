import React, { useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";

interface Props {
  step: number;
  totalSteps?: number;
  title: string;
  description: string;
  ctaLabel?: string;
  onDismiss?: () => void;
}

export default function MobileTourBanner({
  step,
  totalSteps = 5,
  title,
  description,
  ctaLabel,
  onDismiss,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const slideAnim = useRef(new Animated.Value(120)).current;
  const resolvedCtaLabel = ctaLabel ?? t("mobileTourBanner.defaultCta");

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();
  }, []);

  const dismiss = () => {
    Animated.timing(slideAnim, { toValue: 120, duration: 200, useNativeDriver: true }).start(() => {
      if (onDismiss) onDismiss();
      else router.push("/(tabs)/home");
    });
  };

  return (
    <Animated.View
      style={[
        s.container,
        { backgroundColor: colors.card, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={s.row}>
        <View style={[s.badge, { backgroundColor: "rgba(0,212,126,0.12)" }]}>
          <Text style={s.badgeText}>
            {t("mobileTourBanner.step", { step, total: totalSteps })}
          </Text>
        </View>
        <TouchableOpacity onPress={dismiss} hitSlop={12}>
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <Text style={[s.title, { color: colors.text }]}>{title}</Text>
      <Text style={[s.desc, { color: colors.textMuted }]}>{description}</Text>

      <TouchableOpacity style={s.cta} onPress={dismiss} activeOpacity={0.8}>
        <Text style={s.ctaText}>{resolvedCtaLabel}</Text>
      </TouchableOpacity>

      {/* Green top accent line */}
      <View style={s.accentLine} />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 90,
    left: 16,
    right: 16,
    borderRadius: 20,
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
    zIndex: 9999,
    overflow: "hidden",
  },
  accentLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "#00d47e",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#00d47e",
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 6,
  },
  desc: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  cta: {
    backgroundColor: "#00d47e",
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
  },
  ctaText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "800",
  },
});
