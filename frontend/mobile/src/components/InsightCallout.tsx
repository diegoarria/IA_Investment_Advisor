import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Mobile mirror of web's components/ui/InsightCallout.tsx — the shared
// "why this matters to your decision" pattern (Diego, 2026-09-11). Real
// data in, one honest sentence connecting it to a decision the user can
// actually make — never a generic tip, never shown when there's nothing
// real to say (the caller owns that, this component never fabricates a
// fallback).
const GOLD = "#D4A24C";

export default function InsightCallout({
  icon = "bulb", title, body, ctaLabel, onPressCta, colors,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  ctaLabel?: string;
  onPressCta?: () => void;
  /** Same theme colors object every screen already threads through
   * (colors.text / colors.textMuted) — keeps this component correct in
   * both light and dark mode instead of hardcoding one. */
  colors: { text: string; textMuted: string };
}) {
  return (
    <View style={{
      flexDirection: "row", gap: 12, borderRadius: 16, padding: 14,
      borderWidth: 1, borderColor: `${GOLD}40`, backgroundColor: `${GOLD}0d`,
    }}>
      <View style={{
        width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center",
        backgroundColor: `${GOLD}20`, flexShrink: 0,
      }}>
        <Ionicons name={icon} size={16} color={GOLD} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text, marginBottom: 3 }}>{title}</Text>
        <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.textMuted }}>{body}</Text>
        {ctaLabel && (
          <TouchableOpacity onPress={onPressCta} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: GOLD }}>{ctaLabel}</Text>
            <Ionicons name="arrow-forward" size={12} color={GOLD} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
