import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { graphApi } from "../lib/api";
import InvestmentGraphTimeline, { type GraphEvent } from "./InvestmentGraphTimeline";

const TOOL_COLOR = "#38bdf8";

interface Metrics {
  total_theses: number;
  opinion_reversals: number;
  analyzed_never_bought: number;
  avg_deliberation_days: number | null;
  longest_conviction_ticker: string | null;
  longest_conviction_days: number | null;
  thesis_accuracy_pct: number | null;
  thesis_accuracy_sample_size: number;
}

function MetricCell({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={[s.metricCell, { backgroundColor: colors.bgRaised }]}>
      <Text style={[s.metricLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[s.metricValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
}

export default function MobileInvestmentGraph({ isPremium, onUpgrade }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [events, setEvents] = useState<GraphEvent[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isPremium) return;
    setLoading(true);
    Promise.all([graphApi.getGlobalTimeline(50), graphApi.getMetrics()])
      .then(([tl, m]: any[]) => {
        setEvents(tl.data?.timeline ?? []);
        setMetrics(m.data ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isPremium]);

  if (!isPremium) {
    return (
      <TouchableOpacity onPress={onUpgrade} activeOpacity={0.93} style={[s.card, { backgroundColor: colors.card, padding: 16 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={[s.headerIconBox, { backgroundColor: TOOL_COLOR + "18" }]}>
            <Ionicons name="book-outline" size={18} color={TOOL_COLOR} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: colors.text }]}>{t("investmentGraph.sectionTitle")}</Text>
            <Text style={[s.sub, { color: colors.textMuted }]}>{t("investmentGraph.emptyCompany")}</Text>
          </View>
          <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: TOOL_COLOR + "50" }]}>
      <View style={s.accentBar} />
      <View style={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={[s.headerIconBox, { backgroundColor: TOOL_COLOR + "18" }]}>
            <Ionicons name="book-outline" size={18} color={TOOL_COLOR} />
          </View>
          <Text style={[s.title, { color: colors.text }]}>{t("investmentGraph.sectionTitle")}</Text>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 20, alignItems: "center" }}>
            <ActivityIndicator color={TOOL_COLOR} />
          </View>
        ) : (
          <>
            {metrics && (
              <View style={s.metricsGrid}>
                <MetricCell colors={colors} label={t("investmentGraph.metrics.totalTheses")} value={String(metrics.total_theses)} />
                <MetricCell colors={colors} label={t("investmentGraph.metrics.opinionReversals")} value={String(metrics.opinion_reversals)} />
                <MetricCell colors={colors} label={t("investmentGraph.metrics.analyzedNeverBought")} value={String(metrics.analyzed_never_bought)} />
                <MetricCell colors={colors} label={t("investmentGraph.metrics.avgDeliberationDays")} value={metrics.avg_deliberation_days != null ? `${metrics.avg_deliberation_days}d` : "—"} />
                <MetricCell colors={colors} label={t("investmentGraph.metrics.longestConviction")} value={metrics.longest_conviction_ticker ?? "—"} />
                <MetricCell colors={colors} label={t("investmentGraph.metrics.thesisAccuracy")} value={metrics.thesis_accuracy_pct != null ? `${metrics.thesis_accuracy_pct}%` : "—"} />
              </View>
            )}
            <InvestmentGraphTimeline events={events} showTicker />
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card:        { borderRadius: 20, overflow: "hidden", borderWidth: 1, shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 4 },
  accentBar:   { height: 4, backgroundColor: TOOL_COLOR },
  headerIconBox: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title:       { fontSize: 14, fontWeight: "800" },
  sub:         { fontSize: 11, marginTop: 1 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metricCell:  { width: "31%", borderRadius: 10, padding: 10 },
  metricLabel: { fontSize: 9, fontWeight: "700", textTransform: "uppercase", marginBottom: 4 },
  metricValue: { fontSize: 15, fontWeight: "800" },
});
