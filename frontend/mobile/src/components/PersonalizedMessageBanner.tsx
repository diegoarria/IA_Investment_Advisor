import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ViewStyle, StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";
import { useSubscriptionStore, hasPremiumAccess } from "../lib/subscriptionStore";
import { progressApi } from "../lib/api";

export default function PersonalizedMessageBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);

  const [message, setMessage] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isPremium) return;
    progressApi
      .getPersonalizedMessage()
      .then((res: any) => setMessage(res.data?.message ?? null))
      .catch(() => {});
  }, [isPremium]);

  if (!isPremium || dismissed || !message) return null;

  return (
    <View style={[{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, backgroundColor: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.25)" }, style]}>
      <Ionicons name="sparkles" size={16} color={colors.accentLight} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, fontSize: 13, color: colors.text }}>{message}</Text>
      <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={15} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}
