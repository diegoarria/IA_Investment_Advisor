import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../lib/ThemeContext";

// Header for the weekly-ritual screens (Diego, 2026-09-27) — replaces the
// stack's default header, which showed the raw route names ("index" /
// "weekly-ritual"). These screens are often opened straight from a push,
// with nothing behind them in the stack, so back falls through to Home.
// `title` is optional: the flashcard screens (question, Saturday) already
// carry their own title inside the card.
export default function RitualHeader({ title }: { title?: string }) {
  const { colors } = useTheme();

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home" as any);
  };

  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }}>
      <TouchableOpacity
        onPress={goBack}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={{
          width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center",
          backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        }}
      >
        <Ionicons name="chevron-back" size={20} color={colors.text} />
      </TouchableOpacity>
      <Text numberOfLines={1} style={{ flex: 1, textAlign: "center", fontSize: 16, fontWeight: "800", color: colors.text, marginHorizontal: 8 }}>
        {title ?? ""}
      </Text>
      <View style={{ width: 38 }} />
    </View>
  );
}
