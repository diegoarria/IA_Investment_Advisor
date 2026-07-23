import React, { useState, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { earningsApi } from "../../src/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import { useWatchlistStore } from "../../src/lib/watchlistStore";
import PaywallModal from "../../src/components/PaywallModal";
import StockAvatar from "../../src/components/StockAvatar";
import { BeatMissBadge, fmtMoney, type RecentReporter } from "../../src/components/EarningsAnalysisCard";

export default function EarningsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const positions = usePortfolioStore((st) => st.positions);
  const watchlistItems = useWatchlistStore((st) => st.items);

  const [reporters, setReporters] = useState<RecentReporter[]>([]);
  const [loadingReporters, setLoadingReporters] = useState(false);

  const symbols = useMemo(() => {
    const port = positions.map((p) => p.ticker);
    const watch = watchlistItems.map((w) => w.ticker);
    return Array.from(new Set([...port, ...watch])).filter(Boolean);
  }, [positions, watchlistItems]);

  useEffect(() => {
    if (!isPremium || symbols.length === 0) { setReporters([]); return; }
    setLoadingReporters(true);
    earningsApi.getRecentReporters(symbols)
      .then((res: any) => setReporters(res.data?.reporters || []))
      .catch(() => setReporters([]))
      .finally(() => setLoadingReporters(false));
  }, [isPremium, symbols.join(",")]);

  const openTicker = (ticker: string) => {
    if (!ticker.trim()) return;
    router.push(`/earnings/${ticker.trim().toUpperCase()}` as any);
  };

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.text }]}>{t("earnings.title")}</Text>
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
        ) : (
          <>
            <Text style={[s.sectionLabel, { color: colors.text }]}>{t("earnings.recentReporters.label")}</Text>
            {loadingReporters ? (
              <View style={s.center}>
                <ActivityIndicator size="large" color={colors.accentLight} />
              </View>
            ) : reporters.length === 0 ? (
              <View style={[s.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>{t("earnings.recentReporters.empty")}</Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {reporters.map((r) => (
                  <TouchableOpacity key={r.ticker} onPress={() => openTicker(r.ticker)}
                                    style={[s.reporterRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <StockAvatar ticker={r.ticker} size={36} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ fontSize: 12, fontWeight: "800", color: colors.text }}>{r.ticker}</Text>
                      <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 3 }}>{r.event_date}</Text>
                      <Text style={{ fontSize: 10, color: colors.textSub }}>
                        EPS: <Text style={{ fontWeight: "800" }}>${r.eps_actual ?? "N/D"}</Text> vs ${r.eps_estimate ?? "N/D"} est.
                      </Text>
                      <Text style={{ fontSize: 10, color: colors.textSub }}>
                        Ingresos: <Text style={{ fontWeight: "800" }}>{fmtMoney(r.revenue_actual)}</Text> vs {fmtMoney(r.revenue_estimate)} est.
                      </Text>
                    </View>
                    <View style={{ gap: 4, alignItems: "flex-end" }}>
                      <BeatMissBadge actual={r.eps_actual} estimate={r.eps_estimate} colors={colors} />
                      <BeatMissBadge actual={r.revenue_actual} estimate={r.revenue_estimate} colors={colors} />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
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
  sectionLabel: { fontSize: 13, fontWeight: "800", marginBottom: 8 },
  center: { paddingVertical: 40, alignItems: "center" },
  emptyCard: { borderWidth: 1, borderRadius: 16, padding: 24 },
  reporterRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14, padding: 10 },
});
