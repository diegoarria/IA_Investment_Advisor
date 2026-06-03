import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";

interface Benefit {
  icon: string;
  text: string;
}

interface Props {
  title: string;
  tagline: string;
  description: string;
  icon: string;
  color: string;
  benefits: Benefit[];
  onUnlock: () => void;
}

export default function PremiumToolCard({ title, tagline, description, icon, color, benefits, onUnlock }: Props) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity onPress={onUnlock} activeOpacity={0.93} style={[s.card, { backgroundColor: colors.card }]}>

      {/* ── Hero section ───────────────────────────────── */}
      <View style={[s.hero, { backgroundColor: color + "18" }]}>
        {/* Decorative circles */}
        <View style={[s.circle1, { backgroundColor: color + "15" }]} />
        <View style={[s.circle2, { backgroundColor: color + "0A" }]} />

        {/* PREMIUM badge */}
        <View style={[s.badge, { backgroundColor: colors.card, borderColor: color + "50" }]}>
          <Ionicons name="lock-closed" size={9} color={color} />
          <Text style={[s.badgeText, { color }]}>PREMIUM</Text>
          <Ionicons name="sparkles" size={9} color={color} />
        </View>

        {/* Main icon */}
        <View style={[s.iconOuter, { backgroundColor: color + "25", borderColor: color + "40" }]}>
          <View style={[s.iconInner, { backgroundColor: color }]}>
            <Ionicons name={icon as any} size={30} color="white" />
          </View>
        </View>
      </View>

      {/* ── Content section ─────────────────────────────── */}
      <View style={s.content}>
        <Text style={[s.title, { color: colors.text }]}>{title}</Text>
        <Text style={[s.tagline, { color: color }]}>{tagline}</Text>
        <Text style={[s.desc, { color: colors.textMuted }]}>{description}</Text>

        {/* Benefits */}
        <View style={[s.benefitsWrap, { borderColor: colors.border }]}>
          {benefits.map((b, i) => (
            <View key={b.text} style={[
              s.benefit,
              i < benefits.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }
            ]}>
              <View style={[s.benefitIconBox, { backgroundColor: color + "12" }]}>
                <Text style={s.benefitEmoji}>{b.icon}</Text>
              </View>
              <Text style={[s.benefitText, { color: colors.textSub }]}>{b.text}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <TouchableOpacity onPress={onUnlock} activeOpacity={0.85} style={[s.btn, { backgroundColor: color }]}>
          <View style={[s.btnGlow, { backgroundColor: "rgba(255,255,255,0.12)" }]} />
          <Ionicons name="flash" size={17} color="white" />
          <Text style={s.btnText}>Desbloquear con Premium</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 24,
    overflow: "hidden",
    marginBottom: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },

  // Hero
  hero: {
    paddingTop: 36,
    paddingBottom: 28,
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
  },
  circle1: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    top: -60,
    right: -40,
  },
  circle2: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    bottom: -30,
    left: -20,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 20,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  iconOuter: {
    width: 88,
    height: 88,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  iconInner: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },

  // Content
  content: {
    padding: 22,
    paddingTop: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginBottom: 4,
    textAlign: "center",
  },
  tagline: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: 0.2,
  },
  desc: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 20,
  },

  // Benefits
  benefitsWrap: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 20,
  },
  benefit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  benefitIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  benefitEmoji: {
    fontSize: 17,
  },
  benefitText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
    fontWeight: "500",
  },

  // CTA
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 16,
    paddingVertical: 16,
    position: "relative",
    overflow: "hidden",
  },
  btnGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "50%",
  },
  btnText: {
    color: "white",
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: 0.3,
  },
});
