import React from "react";
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import MobileTourBanner from "../../src/components/MobileTourBanner";
import { useTheme } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";
import { useLearnStore } from "../../src/lib/learnStore";

// ─── Category data ───────────────────────────────────────────────────────────

function getCategories(t: TFunction) {
  return [
    { emoji: "📚", title: t("academy.categories.basics") },
    { emoji: "🏦", title: t("academy.categories.instruments") },
    { emoji: "📊", title: t("academy.categories.analysis") },
    { emoji: "🎯", title: t("academy.categories.strategies") },
    { emoji: "🧠", title: t("academy.categories.psychology") },
    { emoji: "🌐", title: t("academy.categories.macro") },
  ];
}

// ─── Streak Ring ─────────────────────────────────────────────────────────────

function StreakRing({ streak, colors }: { streak: number; colors: any }) {
  const { t } = useTranslation();
  const fire = streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "✨";
  const days = t("academy.days");
  return (
    <View
      style={[
        ss.streakRing,
        { borderColor: streak > 0 ? "#f59e0b" : colors.border },
      ]}
    >
      <Text style={ss.streakEmoji}>{fire}</Text>
      <Text style={[ss.streakNum, { color: streak > 0 ? "#f59e0b" : colors.textMuted }]}>
        {streak}
      </Text>
      <Text style={[ss.streakDays, { color: colors.textMuted }]}>{days}</Text>
    </View>
  );
}

// ─── Aprendizaje Tab ─────────────────────────────────────────────────────────

function AprendizajeTab({ colors, isTour }: { colors: any; isTour?: boolean }) {
  const { t } = useTranslation();
  const streak = useLearnStore((s) => s.streak);
  const completedToday = useLearnStore((s) => s.completedToday);
  const CATEGORIES = getCategories(t);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 16 }}>
      {/* Streak Card */}
      <View style={[ss.streakCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <StreakRing streak={streak} colors={colors} />
        <View style={ss.streakInfo}>
          <Text style={[ss.streakTitle, { color: colors.text }]}>
            {streak === 1 ? t("academy.streakTitleOne", { count: streak }) : t("academy.streakTitleOther", { count: streak })}
          </Text>
          <Text style={[ss.streakSub, { color: colors.textMuted }]}>
            {streak > 0
              ? completedToday
                ? t("academy.streakActiveDone")
                : t("academy.streakActivePending")
              : t("academy.streakInactive")}
          </Text>
        </View>
      </View>

      {/* Category Grid */}
      <View>
        <Text style={[ss.sectionLabel, { color: colors.textMuted }]}>{t("academy.exploreTopics")}</Text>
        <View style={ss.categoryGrid}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.title}
              onPress={() => router.push("/(tabs)/learn")}
              activeOpacity={0.75}
              style={[ss.categoryCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={ss.categoryEmoji}>{cat.emoji}</Text>
              <Text style={[ss.categoryTitle, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{cat.title}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Ver todos button */}
      <TouchableOpacity
        onPress={() => router.push("/(tabs)/learn")}
        activeOpacity={0.8}
        style={[ss.btn, { backgroundColor: colors.accent }, isTour && { borderWidth: 3, borderColor: "#fff" }]}
      >
        <Ionicons name="library-outline" size={16} color="#fff" />
        <Text style={ss.btnText}>{t("academy.seeAll")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function AcademyScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const openSidebar = useAppStore((s) => s.openSidebar);
  const { tour } = useLocalSearchParams<{ tour?: string }>();
  const isTour = tour === "4";

  return (
    <SafeAreaView edges={["top"]} style={[ss.safe, { backgroundColor: colors.bg }]}>
      {/* Header */}
      <View style={[ss.header, { borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: 10 }]}>
        <TouchableOpacity onPress={openSidebar} style={{ width: 36, height: 36, justifyContent: "center", gap: 6 }} activeOpacity={0.7}>
          <View style={{ height: 2, borderRadius: 1, width: 22, backgroundColor: colors.textSub }} />
          <View style={{ height: 2, borderRadius: 1, width: 14, backgroundColor: colors.accentLight }} />
        </TouchableOpacity>
        <View>
          <Text style={[ss.headerSub, { color: colors.textMuted }]}>{t("academy.headerSub")}</Text>
          <Text style={[ss.headerTitle, { color: colors.text }]}>{t("academy.headerTitle")}</Text>
        </View>
      </View>

      {/* Content */}
      <AprendizajeTab colors={colors} isTour={isTour} />

      {isTour && (
        <MobileTourBanner
          step={4}
          title={t("academy.tour.title")}
          description={t("academy.tour.description")}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  safe: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  // Streak
  streakCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  streakRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2.5,
    alignItems: "center",
    justifyContent: "center",
  },
  streakEmoji: {
    fontSize: 20,
    lineHeight: 24,
  },
  streakNum: {
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 18,
  },
  streakDays: {
    fontSize: 10,
    fontWeight: "600",
  },
  streakInfo: {
    flex: 1,
  },
  streakTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 4,
  },
  streakSub: {
    fontSize: 13,
    lineHeight: 18,
  },
  // Category Grid
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryCard: {
    width: "30.5%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: "flex-start",
  },
  categoryEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  categoryTitle: {
    fontSize: 12,
    fontWeight: "700",
  },
  // Button
  btn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  btnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
