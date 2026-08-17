import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { weeklyRitualsApi } from "../../src/lib/api";
import PaywallModal from "../../src/components/PaywallModal";

interface PortfolioReviewData {
  total_value: number;
  change_usd: number | null;
  change_pct: number | null;
  top_sector: string | null;
  insight: string | null;
  is_premium: boolean;
}

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function WeeklyRitualPortfolioReviewScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [data, setData] = useState<PortfolioReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  useEffect(() => {
    weeklyRitualsApi.getPortfolioReview()
      .then((res: { data: PortfolioReviewData }) => setData(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const isUp = (data?.change_usd ?? 0) >= 0;

  return (
    <SafeAreaView style={[st.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={st.content}>
        <Text style={[st.title, { color: colors.text }]}>📅 {t("weeklyRitual.portfolioReview.title")}</Text>

        {loading ? (
          <ActivityIndicator color={colors.accentLight} style={{ marginTop: 40 }} />
        ) : error || !data ? (
          <View style={[st.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>{t("weeklyRitual.portfolioReview.empty")}</Text>
          </View>
        ) : (
          <>
            {data.insight ? (
              <Text style={{ fontSize: 14, lineHeight: 20, color: colors.text, marginBottom: 14 }}>{data.insight}</Text>
            ) : !data.is_premium ? (
              <TouchableOpacity
                onPress={() => setPaywallOpen(true)}
                style={[st.premiumCta, { backgroundColor: colors.bgRaised, flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: 14 }]}
              >
                <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                <Text style={{ color: colors.textMuted, fontWeight: "800", fontSize: 13 }}>{t("weeklyRitual.portfolioReview.premiumCta")}</Text>
              </TouchableOpacity>
            ) : null}

            <View style={[st.valueCard, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
              <Text style={{ fontSize: 10, fontWeight: "800", letterSpacing: 0.5, color: colors.textMuted, marginBottom: 4 }}>
                {t("weeklyRitual.portfolioReview.totalValueLabel").toUpperCase()}
              </Text>
              <Text style={{ fontSize: 26, fontWeight: "900", color: colors.text }}>{fmtUsd(data.total_value)}</Text>
              {data.change_usd !== null && data.change_pct !== null && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <Ionicons name={isUp ? "trending-up" : "trending-down"} size={14} color={isUp ? "#00d47e" : "#ef4444"} />
                  <Text style={{ fontSize: 12, fontWeight: "800", color: isUp ? "#00d47e" : "#ef4444" }}>
                    {isUp ? "+" : ""}{fmtUsd(data.change_usd)} ({isUp ? "+" : ""}{data.change_pct}%)
                  </Text>
                  <Text style={{ fontSize: 10.5, color: colors.textMuted }}>{t("weeklyRitual.portfolioReview.vsLastWeek")}</Text>
                </View>
              )}
            </View>

            {data.top_sector && (
              <View style={[st.sectorCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="pie-chart-outline" size={18} color={colors.accentLight} />
                <View style={{ marginLeft: 10 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>{data.top_sector}</Text>
                  <Text style={{ fontSize: 10, color: colors.textMuted }}>{t("weeklyRitual.portfolioReview.topSectorLabel")}</Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              onPress={() => router.navigate("/(tabs)/portfolio")}
              style={{ backgroundColor: "#00d47e", borderRadius: 16, paddingVertical: 14, alignItems: "center", marginTop: 8 }}
            >
              <Text style={{ color: "#000", fontWeight: "900", fontSize: 14 }}>{t("weeklyRitual.portfolioReview.seeFullPortfolio")}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      {data && !data.is_premium && (
        <PaywallModal
          visible={paywallOpen}
          onClose={() => setPaywallOpen(false)}
          reason={t("weeklyRitual.portfolioReview.premiumReason")}
        />
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 16 },
  emptyCard: { borderRadius: 20, borderWidth: 1, padding: 32, alignItems: "center" },
  valueCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectorCard: { borderRadius: 16, borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "center", marginBottom: 16 },
  premiumCta: { paddingVertical: 12, borderRadius: 16 },
});
