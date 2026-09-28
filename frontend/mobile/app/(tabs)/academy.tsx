import React from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Svg, { Circle } from "react-native-svg";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";
import { useLearnStore, getNextMilestone } from "../../src/lib/learnStore";

// Aprendizaje hub — redesigned 2026-09-27 (Diego: "muy corporativo,
// formal, elegante"): neutral surfaces, hairline borders, one accent, line
// icons instead of emoji, clear hierarchy. Same data as before (streak,
// topics completed, categories); each category now opens the topic list
// already filtered to it.

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function getCategories(t: TFunction): { id: string; icon: IoniconName; title: string; hint: string }[] {
  return [
    { id: "basics",      icon: "library-outline",   title: t("academy.categories.basics"),      hint: t("academy.categoryHints.basics") },
    { id: "instruments", icon: "business-outline",  title: t("academy.categories.instruments"), hint: t("academy.categoryHints.instruments") },
    { id: "analysis",    icon: "analytics-outline", title: t("academy.categories.analysis"),    hint: t("academy.categoryHints.analysis") },
    { id: "strategies",  icon: "flag-outline",      title: t("academy.categories.strategies"),  hint: t("academy.categoryHints.strategies") },
    { id: "psychology",  icon: "bulb-outline",      title: t("academy.categories.psychology"),  hint: t("academy.categoryHints.psychology") },
    { id: "macro",       icon: "earth-outline",     title: t("academy.categories.macro"),       hint: t("academy.categoryHints.macro") },
  ];
}

// Progress toward the next streak milestone.
function ProgressRing({ streak, target, colors, label }: { streak: number; target: number | null; colors: any; label: string }) {
  const size = 84, stroke = 6, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = target ? Math.min(1, streak / target) : 1;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r} stroke={colors.accentLight} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.5 }}>{streak}</Text>
      <Text style={{ fontSize: 10, fontWeight: "700", color: colors.textMuted, marginTop: -2, textTransform: "uppercase", letterSpacing: 0.8 }}>
        {label}
      </Text>
    </View>
  );
}

export default function AcademyScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const openSidebar = useAppStore((s) => s.openSidebar);
  const streak = useLearnStore((s) => s.streak);
  const completedToday = useLearnStore((s) => s.completedToday);
  const completedTopicIds = useLearnStore((s) => s.completedTopicIds);
  const next = getNextMilestone(streak);
  const CATEGORIES = getCategories(t);

  return (
    <SafeAreaView edges={["top"]} style={[ss.safe, { backgroundColor: colors.bg }]}>
      {/* Header */}
      <View style={[ss.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={openSidebar} style={ss.menuBtn} activeOpacity={0.7} accessibilityLabel="Menu">
          <View style={{ height: 2, borderRadius: 1, width: 20, backgroundColor: colors.textSub }} />
          <View style={{ height: 2, borderRadius: 1, width: 13, backgroundColor: colors.accentLight }} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[ss.eyebrow, { color: colors.textMuted }]}>{t("academy.headerSub")}</Text>
          <Text style={[ss.headerTitle, { color: colors.text }]}>{t("academy.headerTitle")}</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ss.content}>
        {/* Progress */}
        <View style={[ss.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ss.eyebrow, { color: colors.textMuted, marginBottom: 14 }]}>{t("academy.progressEyebrow")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
            <ProgressRing streak={streak} target={next?.days ?? null} colors={colors} label={t("academy.days")} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[ss.progressTitle, { color: colors.text }]}>
                {streak === 1 ? t("academy.streakTitleOne", { count: streak }) : t("academy.streakTitleOther", { count: streak })}
              </Text>
              <Text style={[ss.progressSub, { color: colors.textMuted }]}>
                {streak > 0
                  ? completedToday ? t("academy.streakActiveDone") : t("academy.streakActivePending")
                  : t("academy.streakInactive")}
              </Text>
            </View>
          </View>

          <View style={[ss.statsRow, { borderTopColor: colors.border }]}>
            <View style={ss.stat}>
              <Text style={[ss.statValue, { color: colors.text }]}>{completedTopicIds.length}</Text>
              <Text style={[ss.statLabel, { color: colors.textMuted }]}>{t("academy.completedTopics")}</Text>
            </View>
            <View style={[ss.statDivider, { backgroundColor: colors.border }]} />
            <View style={ss.stat}>
              <Text style={[ss.statValue, { color: colors.text }]}>
                {next ? t("academy.nextGoalValue", { count: next.days }) : "—"}
              </Text>
              <Text style={[ss.statLabel, { color: colors.textMuted }]}>
                {next ? t("academy.nextGoal") : t("academy.allGoals")}
              </Text>
            </View>
          </View>
        </View>

        {/* Topics */}
        <Text style={[ss.eyebrow, { color: colors.textMuted, marginTop: 8, marginBottom: 12 }]}>{t("academy.exploreTopics")}</Text>
        <View style={[ss.list, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {CATEGORIES.map((cat, i) => (
            <TouchableOpacity
              key={cat.id}
              onPress={() => router.push({ pathname: "/(tabs)/learn", params: { cat: cat.id } } as any)}
              activeOpacity={0.7}
              style={[ss.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
            >
              <View style={[ss.rowIcon, { backgroundColor: colors.accentLight + "14" }]}>
                <Ionicons name={cat.icon} size={19} color={colors.accentLight} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[ss.rowTitle, { color: colors.text }]} numberOfLines={1}>{cat.title}</Text>
                <Text style={[ss.rowHint, { color: colors.textMuted }]} numberOfLines={1}>{cat.hint}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={() => router.push("/(tabs)/learn")}
          activeOpacity={0.85}
          style={[ss.cta, { backgroundColor: colors.accent }]}
        >
          <Ionicons name="library-outline" size={17} color="#fff" />
          <Text style={ss.ctaText}>{t("academy.seeAll")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuBtn: { width: 36, height: 36, justifyContent: "center", gap: 6 },
  eyebrow: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 },
  headerTitle: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6, marginTop: 2 },
  content: { padding: 20, paddingBottom: 40, gap: 12 },

  card: { borderRadius: 20, borderWidth: 1, padding: 20 },
  progressTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  progressSub: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  statsRow: { flexDirection: "row", alignItems: "center", marginTop: 18, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  stat: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  statLabel: { fontSize: 11, fontWeight: "600", marginTop: 2, textAlign: "center" },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: "stretch" },

  list: { borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
  rowHint: { fontSize: 12.5, marginTop: 2 },

  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, paddingVertical: 15, marginTop: 8 },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
