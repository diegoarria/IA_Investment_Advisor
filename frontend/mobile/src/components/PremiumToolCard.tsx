import React from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
} from "react-native";
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

export default function PremiumToolCard({
  title, tagline, description, icon, color, benefits, onUnlock,
}: Props) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      style={[s.card, { backgroundColor: colors.card, borderColor: color + "30" }]}
      onPress={onUnlock}
      activeOpacity={0.92}
    >
      {/* Top accent bar */}
      <View style={[s.accentBar, { backgroundColor: color }]} />

      <View style={s.body}>
        {/* Lock badge */}
        <View style={[s.lockBadge, { backgroundColor: color + "15", borderColor: color + "30" }]}>
          <Ionicons name="lock-closed" size={11} color={color} />
          <Text style={[s.lockText, { color }]}>PREMIUM</Text>
        </View>

        {/* Icon */}
        <View style={[s.iconWrap, { backgroundColor: color + "18" }]}>
          <Ionicons name={icon as any} size={34} color={color} />
        </View>

        {/* Title */}
        <Text style={[s.title, { color: colors.text }]}>{title}</Text>
        <Text style={[s.tagline, { color: colors.textMuted }]}>{tagline}</Text>

        {/* Description */}
        <Text style={[s.desc, { color: colors.textSub }]}>{description}</Text>

        {/* Benefits */}
        <View style={[s.benefitsBox, { backgroundColor: color + "08", borderColor: color + "20" }]}>
          {benefits.map((b) => (
            <View key={b.text} style={s.benefitRow}>
              <View style={[s.benefitDot, { backgroundColor: color + "30" }]}>
                <Ionicons name={b.icon as any} size={12} color={color} />
              </View>
              <Text style={[s.benefitText, { color: colors.textSub }]}>{b.text}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={[s.btn, { backgroundColor: color }]}
          onPress={onUnlock}
          activeOpacity={0.85}
        >
          <Ionicons name="flash" size={16} color="white" />
          <Text style={s.btnText}>Desbloquear con Premium</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card:       { borderRadius: 20, borderWidth: 1, overflow: "hidden", marginBottom: 4 },
  accentBar:  { height: 4 },
  body:       { padding: 20, alignItems: "center" },
  lockBadge:  { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 18 },
  lockText:   { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  iconWrap:   { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  title:      { fontSize: 20, fontWeight: "900", letterSpacing: -0.5, marginBottom: 4, textAlign: "center" },
  tagline:    { fontSize: 13, textAlign: "center", marginBottom: 14 },
  desc:       { fontSize: 13, lineHeight: 20, textAlign: "center", marginBottom: 18 },
  benefitsBox:{ width: "100%", borderRadius: 14, borderWidth: 1, padding: 14, gap: 10, marginBottom: 18 },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  benefitDot: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  benefitText:{ fontSize: 13, flex: 1, lineHeight: 18 },
  btn:        { flexDirection: "row", alignItems: "center", gap: 8, width: "100%", borderRadius: 14, paddingVertical: 14, justifyContent: "center" },
  btnText:    { color: "white", fontWeight: "800", fontSize: 15 },
});
