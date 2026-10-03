import React, { useState, useEffect, useMemo } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme, type Colors } from "../../src/lib/ThemeContext";
import { earningsApi } from "../../src/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import PaywallModal from "../../src/components/PaywallModal";
import StockAvatar from "../../src/components/StockAvatar";
import { EarningsAnalysisCard, EARNINGS_COLOR, type EarningsAnalysisResponse } from "../../src/components/EarningsAnalysisCard";

export default function EarningsTickerScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const st = useMemo(() => styles(colors), [colors]);
  const { ticker: tickerParam } = useLocalSearchParams<{ ticker: string }>();
  const ticker = (tickerParam || "").toString().toUpperCase();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const positions = usePortfolioStore((s) => s.positions);

  const [paywallOpen, setPaywallOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EarningsAnalysisResponse | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isPremium || !ticker) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    // Sum shares (and weight-average cost) across every lot for this ticker
    // — same as the web: it can appear more than once (several buys). Using
    // only the first lot understated the user's real position.
    const lots = positions.filter((p) => p.ticker === ticker);
    const totalShares = lots.reduce((sum, p) => sum + p.shares, 0);
    const avgPrice = totalShares > 0 ? lots.reduce((sum, p) => sum + p.avgPrice * p.shares, 0) / totalShares : 0;
    earningsApi.getAnalysis(ticker, totalShares, avgPrice, i18n.language)
      .then((res: any) => setResult(res.data))
      .catch((err: any) => setError(err?.response?.data?.detail || t("earnings.search.error")))
      .finally(() => setLoading(false));
  }, [isPremium, ticker, i18n.language, reloadKey]);

  return (
    <SafeAreaView style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>{t("earnings.title")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={st.content}>
        {!isPremium ? (
          <View style={st.stateCard}>
            <View style={st.lockIcon}>
              <Ionicons name="lock-closed" size={26} color={EARNINGS_COLOR} />
            </View>
            <Text style={st.lockTitle}>{t("earnings.premiumGate.title")}</Text>
            <Text style={st.stateText}>{t("earnings.premiumGate.desc")}</Text>
            <TouchableOpacity onPress={() => setPaywallOpen(true)} style={st.ctaBtn}>
              <Text style={st.ctaText}>{t("earnings.premiumGate.cta")}</Text>
            </TouchableOpacity>
          </View>
        ) : loading ? (
          <View style={st.loadingHero}>
            <View style={st.heroGlow} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <StockAvatar ticker={ticker} size={42} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 20, fontWeight: "900", color: colors.text }}>{ticker}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
                  <ActivityIndicator size="small" color={EARNINGS_COLOR} />
                  <Text style={{ flex: 1, fontSize: 13, color: colors.textSub }}>{t("earnings.loading")}</Text>
                </View>
              </View>
            </View>
          </View>
        ) : error ? (
          <View style={st.stateCard}>
            <Ionicons name="warning-outline" size={24} color="#f59e0b" />
            <Text style={st.stateText}>{error}</Text>
            <TouchableOpacity onPress={() => setReloadKey((k) => k + 1)} style={st.retryBtn}>
              <Ionicons name="refresh" size={14} color="#fff" />
              <Text style={st.ctaText}>{t("earnings.retry")}</Text>
            </TouchableOpacity>
          </View>
        ) : result ? (
          <EarningsAnalysisCard result={result} colors={colors} />
        ) : null}
      </ScrollView>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("earnings.premiumGate.paywallReason")} />
    </SafeAreaView>
  );
}

function styles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
    backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 15, fontWeight: "800", color: c.text },
    content: { padding: 16, paddingBottom: 48 },
    loadingHero: {
      borderRadius: 24, padding: 18, overflow: "hidden",
      backgroundColor: EARNINGS_COLOR + "14", borderWidth: 1, borderColor: EARNINGS_COLOR + "33",
    },
    heroGlow: { position: "absolute", width: 220, height: 220, borderRadius: 110, top: -110, right: -70, backgroundColor: EARNINGS_COLOR + "22" },
    stateCard: { borderRadius: 20, padding: 28, alignItems: "center", gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    stateText: { fontSize: 13, lineHeight: 19, color: c.textMuted, textAlign: "center" },
    lockIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: EARNINGS_COLOR + "1A" },
    lockTitle: { fontSize: 17, fontWeight: "900", color: c.text },
    ctaBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, backgroundColor: "#00a85e" },
    ctaText: { fontSize: 13, fontWeight: "800", color: "#fff" },
    retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: EARNINGS_COLOR, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10 },
  });
}
