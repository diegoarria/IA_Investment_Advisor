import React, { useState, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme, type Colors } from "../../src/lib/ThemeContext";
import { earningsApi } from "../../src/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import { useWatchlistStore } from "../../src/lib/watchlistStore";
import PaywallModal from "../../src/components/PaywallModal";
import StockAvatar from "../../src/components/StockAvatar";
import {
  MetricTile, EarningsDisclaimer, fmtMoney, fmtEps, fmtReportDate, EARNINGS_COLOR, type RecentReporter,
} from "../../src/components/EarningsAnalysisCard";

const UP = "#22c55e";

function ReporterCard({ r, owned, onPress, colors }: { r: RecentReporter; owned: boolean; onPress: () => void; colors: Colors }) {
  const { t, i18n } = useTranslation();
  const st = useMemo(() => styles(colors), [colors]);
  const date = fmtReportDate(r.event_date, i18n.language);
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={st.card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <StockAvatar ticker={r.ticker} size={40} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={st.ticker}>{r.ticker}</Text>
            {owned && (
              <View style={st.ownedPill}>
                <Ionicons name="briefcase-outline" size={10} color={colors.accentLight} />
                <Text style={[st.ownedText, { color: colors.accentLight }]}>{t("earnings.list.owned")}</Text>
              </View>
            )}
          </View>
          {date && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
              <Ionicons name="calendar-outline" size={11} color={colors.textMuted} />
              <Text style={st.date}>{t("earnings.list.reportedOn", { date })}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <MetricTile compact label={t("earnings.metrics.eps")} actual={r.eps_actual} estimate={r.eps_estimate} format={fmtEps} colors={colors} />
        <MetricTile compact label={t("earnings.metrics.revenue")} actual={r.revenue_actual} estimate={r.revenue_estimate} format={fmtMoney} colors={colors} />
      </View>
      <View style={st.footer}>
        <Text style={st.footerText}>{t("earnings.list.viewAnalysis")}</Text>
        <Ionicons name="chevron-forward" size={14} color={EARNINGS_COLOR} />
      </View>
    </TouchableOpacity>
  );
}

export default function EarningsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const st = useMemo(() => styles(colors), [colors]);
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const positions = usePortfolioStore((s) => s.positions);
  const watchlistItems = useWatchlistStore((s) => s.items);

  const [reporters, setReporters] = useState<RecentReporter[]>([]);
  const [loadingReporters, setLoadingReporters] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const ownedSet = useMemo(() => new Set(positions.map((p) => p.ticker)), [positions]);
  const symbols = useMemo(() => {
    const port = positions.map((p) => p.ticker);
    const watch = watchlistItems.map((w) => w.ticker);
    return Array.from(new Set([...port, ...watch])).filter(Boolean);
  }, [positions, watchlistItems]);

  useEffect(() => {
    if (!isPremium || symbols.length === 0) { setReporters([]); return; }
    setLoadingReporters(true);
    setLoadFailed(false);
    earningsApi.getRecentReporters(symbols)
      .then((res: any) => setReporters(res.data?.reporters || []))
      .catch(() => setLoadFailed(true))
      .finally(() => setLoadingReporters(false));
  }, [isPremium, symbols.join(","), reloadKey]);

  const openTicker = (ticker: string) => {
    if (!ticker.trim()) return;
    router.push(`/earnings/${ticker.trim().toUpperCase()}` as any);
  };

  // Owned positions first, then most recent report.
  const sorted = useMemo(() => [...reporters].sort((a, b) => {
    const ao = ownedSet.has(a.ticker) ? 0 : 1, bo = ownedSet.has(b.ticker) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (b.event_date ?? "").localeCompare(a.event_date ?? "");
  }), [reporters, ownedSet]);

  const stats = useMemo(() => {
    const epsKnown = reporters.filter((r) => r.eps_actual !== null && r.eps_estimate !== null);
    const revKnown = reporters.filter((r) => r.revenue_actual !== null && r.revenue_estimate !== null);
    return {
      count: reporters.length,
      epsBeat: epsKnown.filter((r) => (r.eps_actual as number) >= (r.eps_estimate as number)).length,
      epsKnown: epsKnown.length,
      revBeat: revKnown.filter((r) => (r.revenue_actual as number) >= (r.revenue_estimate as number)).length,
      revKnown: revKnown.length,
    };
  }, [reporters]);

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
        {/* Hero */}
        <View style={st.hero}>
          <View style={st.heroGlow} />
          <View style={st.heroIcon}>
            <Ionicons name="bar-chart-outline" size={22} color="#fff" />
          </View>
          <Text style={st.heroEyebrow}>{t("earnings.hero.eyebrow")}</Text>
          <Text style={st.heroTitle}>{t("earnings.title")}</Text>
          <Text style={st.heroSubtitle}>{t("earnings.hero.subtitle")}</Text>
          {isPremium && symbols.length > 0 && (
            <View style={st.heroMeta}>
              <View style={st.metaPill}>
                <Ionicons name="briefcase-outline" size={12} color={EARNINGS_COLOR} />
                <Text style={st.metaText}>{t("earnings.hero.tracking", { count: symbols.length })}</Text>
              </View>
            </View>
          )}
        </View>

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
        ) : symbols.length === 0 ? (
          <View style={st.stateCard}>
            <Text style={st.stateText}>{t("earnings.list.noSymbols")}</Text>
          </View>
        ) : loadingReporters ? (
          <View style={st.stateCard}>
            <ActivityIndicator color={EARNINGS_COLOR} />
          </View>
        ) : loadFailed ? (
          <View style={st.stateCard}>
            <Ionicons name="cloud-offline-outline" size={24} color={colors.textMuted} />
            <Text style={st.stateText}>{t("earnings.list.loadError")}</Text>
            <TouchableOpacity onPress={() => setReloadKey((k) => k + 1)} style={st.retryBtn}>
              <Ionicons name="refresh" size={14} color="#fff" />
              <Text style={st.ctaText}>{t("earnings.retry")}</Text>
            </TouchableOpacity>
          </View>
        ) : reporters.length === 0 ? (
          <View style={st.stateCard}>
            <Text style={st.stateText}>{t("earnings.recentReporters.empty")}</Text>
          </View>
        ) : (
          <>
            <View style={st.stats}>
              {[
                { value: String(stats.count), label: t("earnings.stats.reported"), color: colors.text },
                { value: stats.epsKnown ? `${stats.epsBeat}/${stats.epsKnown}` : "—", label: t("earnings.stats.beatEps"), color: stats.epsKnown && stats.epsBeat >= stats.epsKnown / 2 ? UP : colors.text },
                { value: stats.revKnown ? `${stats.revBeat}/${stats.revKnown}` : "—", label: t("earnings.stats.beatRevenue"), color: stats.revKnown && stats.revBeat >= stats.revKnown / 2 ? UP : colors.text },
              ].map((s) => (
                <View key={s.label} style={st.stat}>
                  <Text style={[st.statValue, { color: s.color }]}>{s.value}</Text>
                  <Text style={st.statLabel}>{s.label}</Text>
                </View>
              ))}
            </View>

            <Text style={st.sectionTitle}>{t("earnings.recentReporters.label")}</Text>
            {sorted.map((r) => (
              <ReporterCard key={r.ticker} r={r} owned={ownedSet.has(r.ticker)} onPress={() => openTicker(r.ticker)} colors={colors} />
            ))}
          </>
        )}

        <EarningsDisclaimer colors={colors} />
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
    content: { padding: 16, paddingBottom: 48, gap: 14 },

    hero: {
      borderRadius: 24, padding: 20, overflow: "hidden",
      backgroundColor: EARNINGS_COLOR + "14", borderWidth: 1, borderColor: EARNINGS_COLOR + "33",
    },
    heroGlow: { position: "absolute", width: 220, height: 220, borderRadius: 110, top: -110, right: -70, backgroundColor: EARNINGS_COLOR + "22" },
    heroIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: EARNINGS_COLOR, alignItems: "center", justifyContent: "center", marginBottom: 14 },
    heroEyebrow: { fontSize: 10, fontWeight: "900", letterSpacing: 1.4, color: EARNINGS_COLOR, marginBottom: 4 },
    heroTitle: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5, color: c.text, lineHeight: 27 },
    heroSubtitle: { fontSize: 13, lineHeight: 19, color: c.textSub, marginTop: 6 },
    heroMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
    metaPill: {
      flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20,
      paddingHorizontal: 10, paddingVertical: 5, backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    },
    metaText: { fontSize: 11, fontWeight: "700", color: c.textSub },

    stats: { flexDirection: "row", gap: 10 },
    stat: { flex: 1, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 4, alignItems: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    statValue: { fontSize: 20, fontWeight: "900", color: c.text },
    statLabel: { fontSize: 10, fontWeight: "700", color: c.textMuted, marginTop: 2, textAlign: "center" },

    sectionTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 0.6, color: c.textMuted, textTransform: "uppercase", marginTop: 4 },

    card: { borderRadius: 20, padding: 14, gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    ticker: { fontSize: 17, fontWeight: "900", color: c.text, letterSpacing: -0.3 },
    date: { fontSize: 12, color: c.textMuted },
    ownedPill: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: "rgba(0,168,94,0.12)" },
    ownedText: { fontSize: 10, fontWeight: "700" },
    footer: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border },
    footerText: { fontSize: 12, fontWeight: "800", color: EARNINGS_COLOR },

    stateCard: { borderRadius: 20, padding: 28, alignItems: "center", gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    stateText: { fontSize: 13, lineHeight: 19, color: c.textMuted, textAlign: "center" },
    lockIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: EARNINGS_COLOR + "1A" },
    lockTitle: { fontSize: 17, fontWeight: "900", color: c.text },
    ctaBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, backgroundColor: "#00a85e" },
    ctaText: { fontSize: 13, fontWeight: "800", color: "#fff" },
    retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: EARNINGS_COLOR, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10 },
  });
}
