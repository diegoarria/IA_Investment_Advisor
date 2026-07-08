import React, { useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, Modal, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { useAppStore, maturityLabel } from "../lib/profileStore";
import { useLearnStore } from "../lib/learnStore";
import { useChatStore } from "../lib/chatStore";
import { usePortfolioStore } from "../lib/portfolioStore";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function ProgressModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { maturityScore, maturityHistory, profile } = useAppStore();
  const { streak, totalCompleted } = useLearnStore();
  const sessions = useChatStore((s) => s.sessions);
  const positions = usePortfolioStore((s) => s.positions);

  const ml = maturityLabel(maturityScore);

  // Build maturity graph from history (last 10 data points)
  const graphPoints = useMemo(() => {
    if (!maturityHistory.length) return [{ score: 0, label: t("progressModal.start") }];
    const pts = maturityHistory.slice(-10).map((e, i) => ({
      score: e.newScore,
      label: i === 0 ? t("progressModal.start") : `+${e.delta > 0 ? "+" : ""}${e.delta}`,
    }));
    return [{ score: 0, label: t("progressModal.start") }, ...pts];
  }, [maturityHistory, t]);

  const maxScore = Math.max(...graphPoints.map((p) => p.score), 10);

  // Total messages sent
  const totalMessages = useMemo(() =>
    sessions.reduce((acc, s) => acc + s.messages.filter((m) => m.role === "user").length, 0),
    [sessions]
  );

  const stats = [
    { icon: "flame-outline",           color: "#f59e0b", label: t("progressModal.activeStreak"),  value: t("progressModal.daysUnit", { count: streak }) },
    { icon: "book-outline",             color: "#22c55e", label: t("progressModal.topicsLearned"), value: `${totalCompleted}` },
    { icon: "chatbubble-ellipses-outline", color: "#0ea5e9", label: t("progressModal.aiQueries"), value: `${totalMessages}` },
    { icon: "bar-chart-outline",        color: "#8b5cf6", label: t("progressModal.positions"),    value: `${positions.length}` },
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.container, { backgroundColor: colors.bg }]}>
        {/* Header */}
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.text }]}>{t("progressModal.title")}</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Current maturity score hero */}
          <View style={[s.heroCard, { backgroundColor: ml.color + "12", borderColor: ml.color + "35" }]}>
            <View style={s.heroLeft}>
              <Text style={[s.heroLabel, { color: ml.color + "99" }]}>{t("progressModal.investorMaturity")}</Text>
              <View style={s.heroNumRow}>
                <Text style={[s.heroNum, { color: ml.color }]}>{maturityScore}</Text>
                <Text style={[s.heroDenom, { color: ml.color + "60" }]}>/100</Text>
              </View>
              <View style={[s.heroBadge, { backgroundColor: ml.color + "20", borderColor: ml.color + "50" }]}>
                <Text style={[s.heroBadgeText, { color: ml.color }]}>{ml.label.toUpperCase()}</Text>
              </View>
            </View>
            <View style={[s.heroIcon, { backgroundColor: ml.color + "15" }]}>
              <Ionicons name="analytics-outline" size={36} color={ml.color} />
            </View>
          </View>

          {/* Maturity graph */}
          <Text style={[s.sectionTitle, { color: colors.textDim }]}>{t("progressModal.maturityEvolution")}</Text>
          <View style={[s.graphCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {maturityHistory.length === 0 ? (
              <View style={s.emptyGraph}>
                <Ionicons name="trending-up-outline" size={32} color={colors.textDim} />
                <Text style={[s.emptyGraphText, { color: colors.textDim }]}>
                  {t("progressModal.emptyGraph")}
                </Text>
              </View>
            ) : (
              <>
                <View style={s.graphArea}>
                  {graphPoints.map((pt, i) => {
                    const height = Math.max((pt.score / maxScore) * 120, 4);
                    const isLast = i === graphPoints.length - 1;
                    return (
                      <View key={i} style={s.barWrap}>
                        {isLast && (
                          <Text style={[s.barValue, { color: ml.color }]}>{pt.score}</Text>
                        )}
                        <View
                          style={[
                            s.bar,
                            {
                              height,
                              backgroundColor: isLast ? ml.color : colors.border,
                              opacity: isLast ? 1 : 0.5 + (i / graphPoints.length) * 0.5,
                            },
                          ]}
                        />
                      </View>
                    );
                  })}
                </View>
                <View style={[s.graphBaseline, { backgroundColor: colors.border }]} />
                <Text style={[s.graphCaption, { color: colors.textDim }]}>
                  {t("progressModal.signalsRecorded", { count: maturityHistory.length })}
                </Text>
              </>
            )}
          </View>

          {/* Stats grid */}
          <Text style={[s.sectionTitle, { color: colors.textDim }]}>{t("progressModal.statistics")}</Text>
          <View style={s.statsGrid}>
            {stats.map((stat) => (
              <View key={stat.label} style={[s.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[s.statIcon, { backgroundColor: stat.color + "15" }]}>
                  <Ionicons name={stat.icon as any} size={20} color={stat.color} />
                </View>
                <Text style={[s.statValue, { color: colors.text }]}>{stat.value}</Text>
                <Text style={[s.statLabel, { color: colors.textMuted }]}>{stat.label}</Text>
              </View>
            ))}
          </View>

          {/* Recent maturity signals */}
          {maturityHistory.length > 0 && (
            <>
              <Text style={[s.sectionTitle, { color: colors.textDim }]}>{t("progressModal.latestSignalsDetected")}</Text>
              <View style={[s.signalsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {maturityHistory.slice(-6).reverse().map((ev, i) => (
                  <View
                    key={i}
                    style={[s.signalRow, i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
                  >
                    <View style={[s.signalDot, { backgroundColor: ev.delta >= 0 ? "#22c55e" : "#ef4444" }]} />
                    <Text style={[s.signalText, { color: colors.textSub }]} numberOfLines={1}>
                      {ev.signals.map((sig) => sig.replace(/_/g, " ")).join(", ")}
                    </Text>
                    <Text style={[s.signalDelta, { color: ev.delta >= 0 ? "#22c55e" : "#ef4444" }]}>
                      {ev.delta >= 0 ? "+" : ""}{ev.delta}
                    </Text>
                    <Text style={[s.signalScore, { color: colors.textDim }]}>{ev.newScore}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Progress to next level */}
          <View style={[s.nextLevelCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.nextLevelTitle, { color: colors.text }]}>{t("progressModal.nextLevel")}</Text>
            {maturityScore < 30 && (
              <ProgressBar current={maturityScore} max={30} color="#f97316" label={t("progressModal.beginner")} colors={colors} t={t} />
            )}
            {maturityScore >= 30 && maturityScore < 50 && (
              <ProgressBar current={maturityScore - 30} max={20} color="#f59e0b" label={t("progressModal.developing")} colors={colors} t={t} />
            )}
            {maturityScore >= 50 && maturityScore < 65 && (
              <ProgressBar current={maturityScore - 50} max={15} color="#22c55e" label={t("progressModal.mature")} colors={colors} t={t} />
            )}
            {maturityScore >= 65 && maturityScore < 80 && (
              <ProgressBar current={maturityScore - 65} max={15} color="#16a34a" label={t("progressModal.expert")} colors={colors} t={t} />
            )}
            {maturityScore >= 80 && (
              <Text style={{ color: "#16a34a", fontWeight: "700", fontSize: 14, marginTop: 4 }}>
                {t("progressModal.expertBanner")}
              </Text>
            )}
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function ProgressBar({
  current, max, color, label, colors, t,
}: { current: number; max: number; color: string; label: string; colors: any; t: (key: string, opts?: any) => string }) {
  const pct = Math.min(current / max, 1);
  return (
    <View style={{ marginTop: 8, gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t("progressModal.towards", { label })}</Text>
        <Text style={{ color, fontSize: 12, fontWeight: "700" }}>{Math.round(pct * 100)}%</Text>
      </View>
      <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: "hidden" }}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: color, width: `${pct * 100}%` as any }} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, fontWeight: "700" },
  content: { padding: 16, gap: 8 },
  sectionTitle: { fontSize: 9, fontWeight: "800", letterSpacing: 1.5, marginTop: 12, marginBottom: 4, marginLeft: 2 },

  heroCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 18, borderWidth: 1, padding: 18 },
  heroLeft: { gap: 6 },
  heroLabel: { fontSize: 8, fontWeight: "900", letterSpacing: 1.5 },
  heroNumRow: { flexDirection: "row", alignItems: "baseline", gap: 3 },
  heroNum: { fontSize: 56, fontWeight: "900", letterSpacing: -2, lineHeight: 60 },
  heroDenom: { fontSize: 16, fontWeight: "700" },
  heroBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  heroBadgeText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  heroIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },

  graphCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
  emptyGraph: { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyGraphText: { fontSize: 12, textAlign: "center", lineHeight: 18, maxWidth: 220 },
  graphArea: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: 140, paddingBottom: 4 },
  barWrap: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 4 },
  bar: { width: "100%", borderRadius: 4, minHeight: 4 },
  barValue: { fontSize: 10, fontWeight: "800" },
  graphBaseline: { height: 1, marginTop: 4, marginBottom: 6 },
  graphCaption: { fontSize: 10, textAlign: "center" },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: {
    width: "47%", borderRadius: 14, borderWidth: 1,
    padding: 14, alignItems: "center", gap: 6,
  },
  statIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  statLabel: { fontSize: 10, fontWeight: "600", textAlign: "center" },

  signalsCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  signalRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  signalDot: { width: 7, height: 7, borderRadius: 4 },
  signalText: { flex: 1, fontSize: 12 },
  signalDelta: { fontSize: 12, fontWeight: "700" },
  signalScore: { fontSize: 11, width: 26, textAlign: "right" },

  nextLevelCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 4 },
  nextLevelTitle: { fontSize: 14, fontWeight: "700" },
});
