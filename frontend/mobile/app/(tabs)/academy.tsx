import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import MobileTourBanner from "../../src/components/MobileTourBanner";
import { useTheme } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";
import { useLearnStore } from "../../src/lib/learnStore";

// ─── Sub-tabs ────────────────────────────────────────────────────────────────

const TABS = ["Aprendizaje", "Videos"] as const;
type TabId = (typeof TABS)[number];

// ─── Category data ───────────────────────────────────────────────────────────

const CATEGORIES = [
  { emoji: "📚", title: "Básicos" },
  { emoji: "🏦", title: "Instrumentos" },
  { emoji: "📊", title: "Análisis" },
  { emoji: "🎯", title: "Estrategias" },
  { emoji: "🧠", title: "Psicología" },
  { emoji: "🌐", title: "Macro" },
];

// ─── Streak Ring ─────────────────────────────────────────────────────────────

function StreakRing({ streak, colors }: { streak: number; colors: any }) {
  const fire = streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "✨";
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
      <Text style={[ss.streakDays, { color: colors.textMuted }]}>días</Text>
    </View>
  );
}

// ─── Aprendizaje Tab ─────────────────────────────────────────────────────────

function AprendizajeTab({ colors, isTour }: { colors: any; isTour?: boolean }) {
  const streak = useLearnStore((s) => s.streak);
  const completedToday = useLearnStore((s) => s.completedToday);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 16 }}>
      {/* Streak Card */}
      <View style={[ss.streakCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <StreakRing streak={streak} colors={colors} />
        <View style={ss.streakInfo}>
          <Text style={[ss.streakTitle, { color: colors.text }]}>
            {streak} {streak === 1 ? "día" : "días"} de racha
          </Text>
          <Text style={[ss.streakSub, { color: colors.textMuted }]}>
            {streak > 0
              ? completedToday
                ? "¡Racha activa! Ya leíste hoy 🎉"
                : "¡Racha activa! Lee hoy para mantenerla"
              : "Lee para mantener tu racha"}
          </Text>
        </View>
      </View>

      {/* Category Grid */}
      <View>
        <Text style={[ss.sectionLabel, { color: colors.textMuted }]}>Explorar temas</Text>
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
        <Text style={ss.btnText}>Ver todos →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Videos Tab ──────────────────────────────────────────────────────────────

function VideosTab({ colors }: { colors: any }) {
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 12 }}>
      {/* Description Card */}
      <View style={[ss.videoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[ss.videoIconWrap, { backgroundColor: colors.accent + "22" }]}>
          <Ionicons name="play-circle-outline" size={28} color={colors.accentLight} />
        </View>
        <Text style={[ss.videoTitle, { color: colors.text }]}>Videos de inversión</Text>
        <Text style={[ss.videoDesc, { color: colors.textMuted }]}>
          Aprende con videos cortos sobre inversiones, estrategias y análisis de mercado.
          Contenido curado especialmente para inversores hispanohablantes.
        </Text>
      </View>

      {/* Open Videos Button */}
      <TouchableOpacity
        onPress={() => router.push("/(tabs)/videos")}
        activeOpacity={0.8}
        style={[ss.btn, { backgroundColor: colors.accent }]}
      >
        <Ionicons name="play" size={16} color="#fff" />
        <Text style={ss.btnText}>Ver videos</Text>
      </TouchableOpacity>

      {/* Info Note */}
      <View style={[ss.noteCard, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
        <Ionicons name="phone-portrait-outline" size={18} color={colors.textMuted} />
        <Text style={[ss.noteText, { color: colors.textMuted }]}>
          Los videos están optimizados para la experiencia móvil con gestos nativos.
        </Text>
      </View>
    </ScrollView>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function AcademyScreen() {
  const { colors } = useTheme();
  const openSidebar = useAppStore((s) => s.openSidebar);
  const [activeTab, setActiveTab] = useState<TabId>("Aprendizaje");
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
          <Text style={[ss.headerSub, { color: colors.textMuted }]}>Aprende e invierte</Text>
          <Text style={[ss.headerTitle, { color: colors.text }]}>Academy</Text>
        </View>
      </View>

      {/* Sub-tab switcher */}
      <View style={[ss.tabBar, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.8}
            style={[
              ss.tabBtn,
              activeTab === tab && { backgroundColor: colors.accent },
            ]}
          >
            <Text
              style={[
                ss.tabBtnText,
                { color: activeTab === tab ? "#fff" : colors.textMuted },
              ]}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {activeTab === "Aprendizaje" && <AprendizajeTab colors={colors} isTour={isTour} />}
      {activeTab === "Videos" && <VideosTab colors={colors} />}

      {isTour && (
        <MobileTourBanner
          step={4}
          title="Empieza tu primera lección"
          description="Cada día hay una lección nueva. Completa 3 seguidas y arranca tu racha — tu streak aparece en el home."
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
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: "600",
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
  // Videos
  videoCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    gap: 12,
  },
  videoIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  videoTitle: {
    fontSize: 18,
    fontWeight: "800",
  },
  videoDesc: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  noteCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
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
