import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { progressApi, benchmarkApi } from "../../src/lib/api";
import PricingModal from "../../src/components/PricingModal";

interface ProgressSummary {
  days_using_nuvos?: number;
  days_since_first_investment?: number;
  total_operations?: number;
  capital_invested?: number;
  current_patrimonio?: number;
  cumulative_return_pct?: number;
  best_year?: { year: number; pct: number };
  worst_year?: { year: number; pct: number };
  consecutive_months_contributing?: number;
}

interface Milestone {
  title: string;
  description?: string;
  occurred_at: string;
  milestone_key: string;
}

interface DecisionThatHelped {
  key: string;
  title: string;
  description: string;
}

interface BenchmarkResult {
  metric: string;
  label: string;
  your_value: number;
  percentile: number;
  cohort_size: number;
}

interface Benchmark {
  cohort_label: string;
  results: BenchmarkResult[];
}

const fmtUSD = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function ProgressScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);

  const [showPricing, setShowPricing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ProgressSummary>({});
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [decisions, setDecisions] = useState<DecisionThatHelped[]>([]);
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);

  useEffect(() => {
    if (!isPremium) return;
    setLoading(true);
    Promise.all([
      progressApi.getSummary(),
      progressApi.getMilestones(),
      progressApi.getDecisionsThatHelped(),
    ])
      .then(([s, m, d]: any[]) => {
        setSummary(s.data.summary || {});
        setMilestones(m.data.milestones || []);
        setDecisions(d.data.decisions || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    benchmarkApi.getMine().then((r: any) => setBenchmark(r.data)).catch(() => {});
  }, [isPremium]);

  const metrics: { label: string; value: string }[] = [];
  if (summary.days_since_first_investment !== undefined) {
    metrics.push({ label: t("progress.metrics.sinceFirstInvestment"), value: `${summary.days_since_first_investment} ${t("common.daysShort")}` });
  }
  if (summary.days_using_nuvos !== undefined) {
    metrics.push({ label: t("progress.metrics.timeUsingNuvos"), value: `${summary.days_using_nuvos} ${t("common.daysShort")}` });
  }
  if (summary.total_operations !== undefined) {
    metrics.push({ label: t("progress.metrics.totalOperations"), value: `${summary.total_operations}` });
  }
  if (summary.capital_invested !== undefined) {
    metrics.push({ label: t("progress.metrics.capitalInvested"), value: fmtUSD(summary.capital_invested) });
  }
  if (summary.current_patrimonio !== undefined) {
    metrics.push({ label: t("progress.metrics.currentPatrimonio"), value: fmtUSD(summary.current_patrimonio) });
  }
  if (summary.cumulative_return_pct !== undefined) {
    const sign = summary.cumulative_return_pct >= 0 ? "+" : "";
    metrics.push({ label: t("progress.metrics.cumulativeReturn"), value: `${sign}${summary.cumulative_return_pct}%` });
  }
  if (summary.best_year) {
    metrics.push({ label: t("progress.metrics.bestYear", { year: summary.best_year.year }), value: `+${summary.best_year.pct}%` });
  }
  if (summary.worst_year) {
    const sign = summary.worst_year.pct >= 0 ? "+" : "";
    metrics.push({ label: t("progress.metrics.worstYear", { year: summary.worst_year.year }), value: `${sign}${summary.worst_year.pct}%` });
  }
  if (summary.consecutive_months_contributing !== undefined) {
    metrics.push({ label: t("progress.metrics.consecutiveMonths"), value: `${summary.consecutive_months_contributing}` });
  }

  const hasAnyData = metrics.length > 0 || milestones.length > 0 || decisions.length > 0;

  if (!isPremium) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ position: "absolute", top: 16, right: 16, width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgRaised }}
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={{ width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,168,94,0.1)", marginBottom: 16 }}>
          <Ionicons name="lock-closed" size={28} color={colors.accentLight} />
        </View>
        <Text style={{ fontSize: 17, fontWeight: "900", color: colors.text, marginBottom: 8, textAlign: "center" }}>
          {t("progress.paywall.title")}
        </Text>
        <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center", marginBottom: 20, maxWidth: 280 }}>
          {t("progress.paywall.description")}
        </Text>
        <TouchableOpacity
          onPress={() => setShowPricing(true)}
          style={{ backgroundColor: "#00d47e", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 28 }}
          activeOpacity={0.85}
        >
          <Text style={{ fontSize: 14, fontWeight: "900", color: "#000" }}>{t("progress.paywall.cta")}</Text>
        </TouchableOpacity>
        <PricingModal visible={showPricing} onClose={() => setShowPricing(false)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingTop: 12 }}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgRaised }}
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 20 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.accentLight} style={{ marginTop: 40 }} />
        ) : !hasAnyData ? (
          <View style={{ alignItems: "center", paddingVertical: 60 }}>
            <Ionicons name="trending-up-outline" size={36} color={colors.textDim} style={{ marginBottom: 10 }} />
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>{t("progress.empty.title")}</Text>
            <Text style={{ fontSize: 11, color: colors.textDim, textAlign: "center", marginTop: 4 }}>{t("progress.empty.subtitle")}</Text>
          </View>
        ) : (
          <>
            {metrics.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {metrics.map((m) => (
                  <View key={m.label} style={{ width: "47%", borderRadius: 14, borderWidth: 1, padding: 12, backgroundColor: colors.card, borderColor: colors.border }}>
                    <Text style={{ fontSize: 10, fontWeight: "700", color: colors.textMuted, marginBottom: 4 }}>{m.label}</Text>
                    <Text style={{ fontSize: 16, fontWeight: "900", color: colors.text }}>{m.value}</Text>
                  </View>
                ))}
              </View>
            )}

            {benchmark && benchmark.results.length > 0 && (
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Ionicons name="people" size={13} color="#3b82f6" />
                  <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textMuted }}>{t("progress.benchmark.sectionTitle")}</Text>
                </View>
                <View style={{ gap: 8 }}>
                  {benchmark.results.map((r) => (
                    <View key={r.metric} style={{ padding: 12, borderRadius: 14, borderWidth: 1, backgroundColor: "rgba(59,130,246,0.06)", borderColor: "rgba(59,130,246,0.2)" }}>
                      <Text style={{ fontSize: 13, color: colors.text }}>
                        <Text style={{ fontWeight: "900" }}>{t("progress.benchmark.beats", { percentile: r.percentile })}</Text>
                        {" "}{t("progress.benchmark.profileConnector")} <Text style={{ fontWeight: "800" }}>{benchmark.cohort_label}</Text> {t("progress.benchmark.inMetricSuffix", { metric: r.label.toLowerCase() })}
                      </Text>
                      <View style={{ height: 6, borderRadius: 3, marginTop: 10, backgroundColor: colors.border, overflow: "hidden" }}>
                        <View style={{ height: "100%", width: `${r.percentile}%`, borderRadius: 3, backgroundColor: "#3b82f6" }} />
                      </View>
                      <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 6 }}>
                        {t("progress.benchmark.anonymousNote", { count: r.cohort_size })}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {milestones.length > 0 && (
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Ionicons name="trophy" size={13} color="#f59e0b" />
                  <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textMuted }}>{t("progress.milestones.sectionTitle")}</Text>
                </View>
                <View style={{ gap: 8 }}>
                  {milestones.map((ms) => (
                    <View key={ms.milestone_key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, backgroundColor: "rgba(245,158,11,0.06)", borderColor: "rgba(245,158,11,0.2)" }}>
                      <Ionicons name="trophy" size={16} color="#f59e0b" style={{ marginTop: 1 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>{ms.title}</Text>
                        {!!ms.description && (
                          <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{ms.description}</Text>
                        )}
                        <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 4 }}>
                          {new Date(ms.occurred_at).toLocaleDateString("es-MX")}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {decisions.length > 0 && (
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Ionicons name="shield-checkmark" size={13} color="#22c55e" />
                  <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textMuted }}>{t("progress.decisions.sectionTitle")}</Text>
                </View>
                <View style={{ gap: 8 }}>
                  {decisions.map((d) => (
                    <View key={d.key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, backgroundColor: "rgba(34,197,94,0.06)", borderColor: "rgba(34,197,94,0.2)" }}>
                      <Ionicons name="shield-checkmark" size={16} color="#22c55e" style={{ marginTop: 1 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>{d.title}</Text>
                        <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{d.description}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
