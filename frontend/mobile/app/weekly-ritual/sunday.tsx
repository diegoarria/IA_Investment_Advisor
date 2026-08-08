import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { weeklyRitualsApi } from "../../src/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";
import StockAvatar from "../../src/components/StockAvatar";

interface PortfolioEvent { ticker: string; event_type: string; event_date: string; }
interface SundayPrepData { total_events: number; reporting_count: number; portfolio_events?: PortfolioEvent[]; }

const EVENT_LABEL: Record<string, string> = { earnings: "📊", ex_dividend: "📅", dividend: "💰" };

export default function WeeklyRitualSundayScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);

  const [data, setData] = useState<SundayPrepData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paywallOpen, setPaywallOpen] = useState(false);

  useEffect(() => {
    weeklyRitualsApi.getSundayPrep().then((res) => setData(res.data)).finally(() => setLoading(false));
  }, []);

  const grouped = (data?.portfolio_events || []).reduce<Record<string, PortfolioEvent[]>>((acc, e) => {
    (acc[e.ticker] ||= []).push(e);
    return acc;
  }, {});

  return (
    <SafeAreaView style={[st.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={st.content}>
        <Text style={[st.title, { color: colors.text }]}>🔭 {t("weeklyRitual.sunday.title")}</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>{t("weeklyRitual.sunday.subtitle")}</Text>

        {loading ? (
          <ActivityIndicator color={colors.accentLight} style={{ marginTop: 40 }} />
        ) : !data || data.total_events === 0 ? (
          <View style={[st.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>{t("weeklyRitual.sunday.empty")}</Text>
          </View>
        ) : (
          <>
            <View style={st.statsRow}>
              <View style={[st.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="calendar-outline" size={18} color={colors.accentLight} />
                <Text style={[st.statValue, { color: colors.text }]}>{data.total_events}</Text>
                <Text style={[st.statLabel, { color: colors.textMuted }]}>{t("weeklyRitual.sunday.eventsLabel")}</Text>
              </View>
              <View style={[st.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="bar-chart-outline" size={18} color={colors.accentLight} />
                <Text style={[st.statValue, { color: colors.text }]}>{data.reporting_count}</Text>
                <Text style={[st.statLabel, { color: colors.textMuted }]}>{t("weeklyRitual.sunday.reportingLabel")}</Text>
              </View>
            </View>

            {!isPremium ? (
              <TouchableOpacity onPress={() => setPaywallOpen(true)} style={[st.premiumCta, { backgroundColor: colors.bgRaised, flexDirection: "row", justifyContent: "center", gap: 6 }]}>
                <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                <Text style={{ color: colors.textMuted, fontWeight: "800", fontSize: 13 }}>{t("weeklyRitual.sunday.premiumCta")}</Text>
              </TouchableOpacity>
            ) : Object.keys(grouped).length > 0 ? (
              <View style={[st.list, { borderColor: colors.border }]}>
                {Object.entries(grouped).map(([ticker, events], i) => (
                  <TouchableOpacity
                    key={ticker}
                    onPress={() => router.push(`/subvaluadas?ticker=${ticker}` as any)}
                    style={[st.row, { backgroundColor: colors.card, borderTopWidth: i > 0 ? 1 : 0, borderColor: colors.border }]}
                  >
                    <StockAvatar ticker={ticker} size={32} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>{ticker}</Text>
                      <Text style={{ fontSize: 10.5, color: colors.textMuted }}>
                        {events.map((e) => `${EVENT_LABEL[e.event_type] || "•"} ${e.event_date}`).join("  ·  ")}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{t("weeklyRitual.sunday.noPortfolioEvents")}</Text>
            )}
          </>
        )}
      </ScrollView>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("weeklyRitual.sunday.paywallReason")} />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 2 },
  emptyCard: { borderRadius: 20, borderWidth: 1, padding: 32, alignItems: "center" },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  statCard: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 14 },
  statValue: { fontSize: 20, fontWeight: "900", marginTop: 6 },
  statLabel: { fontSize: 10, marginTop: 2 },
  premiumCta: { paddingVertical: 12, borderRadius: 16 },
  list: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
});
