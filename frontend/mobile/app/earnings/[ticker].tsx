import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { earningsApi } from "../../src/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import PaywallModal from "../../src/components/PaywallModal";
import { EarningsAnalysisCard, type EarningsAnalysisResponse } from "../../src/components/EarningsAnalysisCard";

export default function EarningsTickerScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { ticker: tickerParam } = useLocalSearchParams<{ ticker: string }>();
  const ticker = (tickerParam || "").toString().toUpperCase();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const positions = usePortfolioStore((st) => st.positions);

  const [paywallOpen, setPaywallOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EarningsAnalysisResponse | null>(null);

  useEffect(() => {
    if (!isPremium || !ticker) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    const position = positions.find((p) => p.ticker === ticker);
    earningsApi.getAnalysis(ticker, position?.shares || 0, position?.avgPrice || 0, i18n.language)
      .then((res: any) => setResult(res.data))
      .catch((err: any) => setError(err?.response?.data?.detail || t("earnings.search.error")))
      .finally(() => setLoading(false));
  }, [isPremium, ticker, i18n.language]);

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.text }]}>{ticker}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {!isPremium ? (
          <View style={[s.paywallCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[s.paywallIcon, { backgroundColor: "rgba(0,168,94,0.1)" }]}>
              <Ionicons name="lock-closed" size={26} color={colors.accentLight} />
            </View>
            <Text style={[s.paywallTitle, { color: colors.text }]}>{t("earnings.premiumGate.title")}</Text>
            <Text style={[s.paywallDesc, { color: colors.textMuted }]}>{t("earnings.premiumGate.desc")}</Text>
            <TouchableOpacity onPress={() => setPaywallOpen(true)} style={s.paywallBtn}>
              <Text style={s.paywallBtnText}>{t("earnings.premiumGate.cta")}</Text>
            </TouchableOpacity>
          </View>
        ) : loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={colors.accentLight} />
          </View>
        ) : error ? (
          <Text style={{ fontSize: 12, color: "#ef4444" }}>{error}</Text>
        ) : result ? (
          <>
            <View style={[s.warningBox, { borderColor: "#ef4444", backgroundColor: "rgba(239,68,68,0.08)" }]}>
              <Text style={s.warningTitle}>{t("earnings.disclaimer.title")}</Text>
              <Text style={[s.warningSubtitle, { color: colors.textSub }]}>{t("earnings.disclaimer.subtitle")}</Text>
            </View>
            <EarningsAnalysisCard result={result} colors={colors} />
          </>
        ) : null}
      </ScrollView>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("earnings.premiumGate.paywallReason")} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 15, fontWeight: "800" },
  scroll: { padding: 16, paddingBottom: 40 },
  paywallCard: { borderWidth: 1, borderRadius: 20, padding: 28, alignItems: "center" },
  paywallIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  paywallTitle: { fontSize: 16, fontWeight: "900", marginBottom: 8 },
  paywallDesc: { fontSize: 13, textAlign: "center", lineHeight: 18, marginBottom: 18 },
  paywallBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, backgroundColor: "#00a85e" },
  paywallBtnText: { fontSize: 13, fontWeight: "900", color: "#fff" },
  warningBox: { borderWidth: 2, borderRadius: 16, padding: 14, marginBottom: 16, alignItems: "center" },
  warningTitle: { fontSize: 16, fontWeight: "900", color: "#ef4444", textAlign: "center" },
  warningSubtitle: { fontSize: 11, marginTop: 4, textAlign: "center" },
  center: { paddingVertical: 40, alignItems: "center" },
});
