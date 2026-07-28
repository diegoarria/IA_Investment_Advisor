import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ViewStyle, StyleProp, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { decisionsApi } from "../lib/api";

type StreakData = {
  days: number;
  last_panic_sell_date: string | null;
  milestones: number[];
  claimed_milestones: number[];
  claimable_milestones: number[];
  next_milestone: number | null;
};

export default function MobilePanicStreakCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    decisionsApi.getPanicStreak().then((res: any) => setStreak(res.data)).catch(() => {});
  }, []);

  if (!streak) return null;

  const claimableNow = streak.claimable_milestones[0] ?? null;
  const progressTarget = streak.next_milestone ?? streak.milestones[streak.milestones.length - 1];
  const progressPct = Math.min((streak.days / progressTarget) * 100, 100);

  const handleClaim = async () => {
    if (!claimableNow || claiming) return;
    setClaiming(true);
    try {
      await decisionsApi.claimPanicStreakMilestone(claimableNow);
      const res: any = await decisionsApi.getPanicStreak();
      setStreak(res.data);
    } catch {
      // no-op — button stays visible to retry
    } finally {
      setClaiming(false);
    }
  };

  return (
    <View style={[{ borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 18, overflow: "hidden" }, style]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <Text style={{ fontSize: 10.5, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", color: colors.textMuted }}>
          {t("panicStreak.eyebrow")}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,168,94,0.12)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 }}>
          <Ionicons name="flame" size={13} color={colors.accentLight} />
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.accentLight }}>{t("panicStreak.badge")}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 8, marginBottom: 2 }}>
        <Text style={{ fontSize: 44, fontWeight: "900", letterSpacing: -0.5, color: colors.text }}>{streak.days}</Text>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textSub }}>{t("panicStreak.days")}</Text>
      </View>
      <Text style={{ fontSize: 13, color: colors.textSub, marginBottom: 16 }}>
        {t("panicStreak.caption")}
      </Text>

      <View style={{ height: 6, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden", marginBottom: 8 }}>
        <View style={{ height: "100%", width: `${progressPct}%`, borderRadius: 4, backgroundColor: colors.accent }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.accentLight }}>
          {t("panicStreak.dayLabel", { count: streak.days })}
        </Text>
        <Text style={{ fontSize: 11.5, color: colors.textDim }}>
          {streak.next_milestone ? t("panicStreak.nextMilestone", { days: streak.next_milestone }) : t("panicStreak.allMilestonesReached")}
        </Text>
      </View>

      {claimableNow && (
        <TouchableOpacity
          onPress={handleClaim}
          disabled={claiming}
          style={{ marginTop: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.accent, alignItems: "center", opacity: claiming ? 0.6 : 1 }}
        >
          {claiming
            ? <ActivityIndicator color="#04140c" />
            : <Text style={{ fontSize: 14, fontWeight: "800", color: "#04140c" }}>{t("panicStreak.claimCta", { days: claimableNow })}</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}
