import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ViewStyle, StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { notificationsApi } from "../lib/api";
import { isDismissedToday, dismissToday } from "../lib/dailyDismiss";

const DISMISS_KEY = "nuvos_morning_brief_seen";

interface Brief {
  title: string;
  bullets: string[];
}

export default function MorningBriefCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [dismissed, setDismissed] = useState(true); // avoid a flash before the dismiss check resolves

  useEffect(() => {
    isDismissedToday(DISMISS_KEY).then((already) => {
      if (already) return;
      setDismissed(false);
      notificationsApi
        .getMorningBrief()
        .then((res: any) => {
          if (res.data?.title && res.data?.bullets?.length) setBrief(res.data);
        })
        .catch(() => {});
    });
  }, []);

  const close = () => {
    dismissToday(DISMISS_KEY);
    setDismissed(true);
  };

  if (dismissed || !brief) return null;

  return (
    <View style={[{ padding: 14, borderRadius: 16, borderWidth: 1, backgroundColor: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.2)" }, style]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, gap: 10 }}>
        <Text style={{ flex: 1, fontSize: 14.5, fontWeight: "700", color: colors.text }}>{brief.title}</Text>
        <TouchableOpacity onPress={close} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      <View style={{ gap: 5, marginBottom: 10 }}>
        {brief.bullets.map((b, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 6 }}>
            <Text style={{ color: colors.accentLight, fontSize: 13 }}>•</Text>
            <Text style={{ flex: 1, fontSize: 13, color: colors.textSub }}>{b}</Text>
          </View>
        ))}
      </View>
      <TouchableOpacity
        onPress={close}
        style={{ alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.accent }}
      >
        <Text style={{ fontSize: 12, fontWeight: "800", color: "#fff" }}>{t("morningBrief.read")}</Text>
      </TouchableOpacity>
    </View>
  );
}
