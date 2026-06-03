import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";

interface Benefit {
  icon: string; // emoji string, e.g. "📊"
  text: string;
}

interface Props {
  title: string;
  tagline: string;
  description: string;
  icon: string; // Ionicons name for the main icon
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
      {/* Accent bar */}
      <View style={[s.accentBar, { backgroundColor: color }]} />

      <View style={s.body}>
        {/* Lock badge */}
        <View style={[s.lockBadge, { backgroundColor: color + "15", borderColor: color + "30" }]}>
          <Ionicons name="lock-closed" size={11} color={color} />
          <Text style={[s.lockText, { color }]}>PREMIUM</Text>
        </View>

        {/* Main icon */}
        <View style={[s.iconWrap, { backgroundColor: color + "18" }]}>
          <Ionicons name={icon as any} size={36} color={color} />
        </View>

        {/* Title */}
        <Text style={[s.title, { color: colors.text }]}>{title}</Text>
        <Text style={[s.tagline, { color: colors.textMuted }]}>{tagline}</Text>

        {/* Description */}
        <Text style={[s.desc, { color: colors.textSub }]}>{description}</Text>

        {/* Benefits — 2-column grid like web */}
        <View style={s.grid}>
          {benefits.map((b) => (
            <View key={b.text} style={[s.benefitCell, { backgroundColor: color + "0A", borderColor: color + "22" }]}>
              <Text style={s.benefitIcon}>{b.icon}</Text>
              <Text style={[s.benefitText, { color: colors.textSub }]}>{b.text}</Text>
            </View>
          ))}
        </View>

        {/* CTA with gradient simulation */}
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
  card:        { borderRadius: 20, borderWidth: 1, overflow: "hidden", marginBottom: 4 },
  accentBar:   { height: 4 },
  body:        { padding: 22, alignItems: "center" },
  lockBadge:   { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 20 },
  lockText:    { fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  iconWrap:    { width: 76, height: 76, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  title:       { fontSize: 21, fontWeight: "900", letterSpacing: -0.5, marginBottom: 5, textAlign: "center" },
  tagline:     { fontSize: 13, textAlign: "center", marginBottom: 14 },
  desc:        { fontSize: 13, lineHeight: 20, textAlign: "center", marginBottom: 18 },
  grid:        { flexDirection: "row", flexWrap: "wrap", gap: 8, width: "100%", marginBottom: 20 },
  benefitCell: { width: "47%", borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  benefitIcon: { fontSize: 18 },
  benefitText: { fontSize: 12, lineHeight: 17 },
  btn:         { flexDirection: "row", alignItems: "center", gap: 8, width: "100%", borderRadius: 14, paddingVertical: 15, justifyContent: "center" },
  btnText:     { color: "white", fontWeight: "800", fontSize: 15 },
});
