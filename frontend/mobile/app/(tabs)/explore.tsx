import React, { useMemo, useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { useWeeklyOpportunities } from "../../src/lib/useWeeklyOpportunities";
import PaywallModal from "../../src/components/PaywallModal";
import MobileWeeklyScreener from "../../src/components/MobileWeeklyScreener";
import StockAvatar from "../../src/components/StockAvatar";
import type { WeeklyOpportunity } from "../../src/components/WeeklyOpportunityCard";

// Screener Semanal — the sidebar's "Screener" entry. Redesigned 2026-09-27
// (Diego: "muy fea, mejora esa vista por mucho — el header, la vista,
// todo"): this screen is now only the week's 5 real, DCF-backed picks
// (same tickers as the Sunday "Nuvos Radar detectó..." push), laid out as
// a proper page instead of a collapsed row on top of the old keyword
// search. That old search (ASCII score bars + "Comprar/Vender" badges) is
// gone — buy/sell labels contradict "Nuvos nunca prescribe"; company
// search lives in Oportunidades.

const TOOL = "#8b5cf6";
const GREEN = "#00d47e";

function money(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 })}`;
}

function PickCard({ pick, rank, colors }: { pick: WeeklyOpportunity; rank: number; colors: Colors }) {
  const { t } = useTranslation();
  const st = useMemo(() => cardStyles(colors), [colors]);
  const mos = pick.margin_of_safety_pct;
  const price = pick.price;
  const base = pick.intrinsic_value_base;
  // How far the current price sits below the base estimate — drawn as a bar
  // (price as a share of base value), the one number people read at a glance.
  const fill = price != null && base ? Math.max(0.06, Math.min(1, price / base)) : null;
  const bq = pick.thesis_scores?.business_quality;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => router.push(`/stock/${pick.ticker}` as any)}
      style={st.card}
    >
      <View style={st.topRow}>
        <View style={st.rank}><Text style={st.rankText}>{rank}</Text></View>
        <StockAvatar ticker={pick.ticker} size={42} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.ticker}>{pick.ticker}</Text>
          {!!pick.company_name && <Text style={st.name} numberOfLines={1}>{pick.company_name}</Text>}
        </View>
        {mos != null && (
          <View style={st.mosPill}>
            <Text style={st.mosValue}>+{mos.toFixed(0)}%</Text>
            <Text style={st.mosLabel}>{t("screenerWeekly.marginShort")}</Text>
          </View>
        )}
      </View>

      <View style={st.chips}>
        {!!pick.sector && <View style={st.chip}><Text style={st.chipText}>{pick.sector}</Text></View>}
        {bq != null && (
          <View style={st.chip}>
            <Ionicons name="shield-checkmark-outline" size={11} color={colors.textMuted} />
            <Text style={st.chipText}>{t("screenerWeekly.quality", { score: bq })}</Text>
          </View>
        )}
      </View>

      {fill != null && (
        <View style={st.valueBlock}>
          <View style={st.valueLabels}>
            <View>
              <Text style={st.smallLabel}>{t("screenerWeekly.priceNow")}</Text>
              <Text style={st.priceNow}>{money(price)}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={st.smallLabel}>{t("screenerWeekly.estimatedValue")}</Text>
              <Text style={st.baseValue}>{money(base)}</Text>
            </View>
          </View>
          <View style={st.track}>
            <View style={[st.trackFill, { width: `${fill * 100}%` }]} />
          </View>
        </View>
      )}

      {(pick.intrinsic_value_conservative != null || pick.intrinsic_value_optimistic != null) && (
        <View style={st.scenarios}>
          {([
            ["pessimistic", pick.intrinsic_value_conservative, "#f87171"],
            ["base", base, GREEN],
            ["optimistic", pick.intrinsic_value_optimistic, "#4ade80"],
          ] as const).map(([key, value, color]) => (
            <View key={key} style={[st.scenario, key === "base" && st.scenarioBase]}>
              <Text style={[st.scenarioLabel, { color }]} numberOfLines={1}>{t(`subvaluadas.scenarios.${key}`)}</Text>
              <Text style={[st.scenarioValue, key === "base" && { color: GREEN }]} numberOfLines={1} adjustsFontSizeToFit>{money(value)}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={st.footer}>
        <Text style={st.footerText}>{t("screenerWeekly.viewAnalysis")}</Text>
        <Ionicons name="chevron-forward" size={14} color={TOOL} />
      </View>
    </TouchableOpacity>
  );
}

export default function WeeklyScreenerScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const st = useMemo(() => screenStyles(colors), [colors]);
  const subStore = useSubscriptionStore();
  const isPremiumAccess = hasPremiumAccess(subStore);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const { data, loading, failed, serverFree, load } = useWeeklyOpportunities(isPremiumAccess);
  const isPremium = isPremiumAccess && !serverFree;
  const picks = (data?.results ?? []).slice(0, 5);

  const summary = useMemo(() => {
    const margins = picks.map((p) => p.margin_of_safety_pct).filter((m): m is number => m != null);
    return {
      avgMargin: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : null,
      sectors: new Set(picks.map((p) => p.sector).filter(Boolean)).size,
    };
  }, [picks]);

  const weekLabel = data?.generated_at
    ? new Date(data.generated_at).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long" })
    : null;

  return (
    <View style={st.container}>
      <ScrollView
        contentContainerStyle={st.content}
        refreshControl={isPremium ? <RefreshControl refreshing={loading && picks.length > 0} onRefresh={load} tintColor={TOOL} /> : undefined}
      >
        {/* Hero */}
        <View style={st.hero}>
          <View style={st.heroGlow} />
          <View style={st.heroIcon}>
            <Ionicons name="radio-outline" size={22} color="#fff" />
          </View>
          <Text style={st.heroEyebrow}>NUVOS RADAR</Text>
          <Text style={st.heroTitle}>{t("screenerWeekly.heroTitle")}</Text>
          <Text style={st.heroSubtitle}>{t("screenerWeekly.heroSubtitle")}</Text>
          <View style={st.heroMeta}>
            {weekLabel && (
              <View style={st.metaPill}>
                <Ionicons name="calendar-outline" size={12} color={TOOL} />
                <Text style={st.metaText}>{t("screenerWeekly.weekOf", { date: weekLabel })}</Text>
              </View>
            )}
            <View style={st.metaPill}>
              <Ionicons name="refresh-outline" size={12} color={TOOL} />
              <Text style={st.metaText}>{t("screenerWeekly.renews")}</Text>
            </View>
          </View>
        </View>

        {!isPremium ? (
          // Same locked preview + paywall the Portfolio card uses.
          <MobileWeeklyScreener isPremium={false} onUpgrade={() => setPaywallOpen(true)} />
        ) : picks.length === 0 ? (
          <View style={st.stateCard}>
            {loading || !failed ? (
              <>
                <ActivityIndicator color={TOOL} />
                <Text style={st.stateText}>{t("screenerWeekly.loading")}</Text>
              </>
            ) : (
              <>
                <Ionicons name="cloud-offline-outline" size={26} color={colors.textMuted} />
                <Text style={st.stateText}>{t("mobileWeeklyScreener.loadError")}</Text>
                <TouchableOpacity onPress={load} style={st.retryBtn}>
                  <Ionicons name="refresh" size={14} color="#fff" />
                  <Text style={st.retryText}>{t("mobileWeeklyScreener.retry")}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <>
            <View style={st.stats}>
              <View style={st.stat}>
                <Text style={st.statValue}>{picks.length}</Text>
                <Text style={st.statLabel}>{t("screenerWeekly.statCompanies")}</Text>
              </View>
              <View style={st.stat}>
                <Text style={[st.statValue, { color: GREEN }]}>
                  {summary.avgMargin != null ? `+${summary.avgMargin.toFixed(0)}%` : "—"}
                </Text>
                <Text style={st.statLabel}>{t("screenerWeekly.statAvgMargin")}</Text>
              </View>
              <View style={st.stat}>
                <Text style={st.statValue}>{summary.sectors || "—"}</Text>
                <Text style={st.statLabel}>{t("screenerWeekly.statSectors")}</Text>
              </View>
            </View>

            <Text style={st.sectionTitle}>{t("screenerWeekly.listTitle")}</Text>
            {picks.map((pick, i) => (
              <PickCard key={pick.ticker} pick={pick} rank={i + 1} colors={colors} />
            ))}

            <View style={st.disclaimer}>
              <Ionicons name="information-circle-outline" size={15} color={colors.textMuted} style={{ marginTop: 1 }} />
              <Text style={st.disclaimerText}>{t("mobileWeeklyScreener.defaultDisclaimer")}</Text>
            </View>
          </>
        )}
      </ScrollView>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("explore.paywallReason")} />
    </View>
  );
}

function screenStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 48, gap: 14 },

    hero: {
      borderRadius: 24, padding: 20, overflow: "hidden",
      backgroundColor: TOOL + "14", borderWidth: 1, borderColor: TOOL + "33",
    },
    heroGlow: { position: "absolute", width: 220, height: 220, borderRadius: 110, top: -110, right: -70, backgroundColor: TOOL + "22" },
    heroIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: TOOL, alignItems: "center", justifyContent: "center", marginBottom: 14 },
    heroEyebrow: { fontSize: 10, fontWeight: "900", letterSpacing: 1.4, color: TOOL, marginBottom: 4 },
    heroTitle: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5, color: c.text, lineHeight: 27 },
    heroSubtitle: { fontSize: 13, lineHeight: 19, color: c.textSub, marginTop: 6 },
    heroMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
    metaPill: {
      flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20,
      paddingHorizontal: 10, paddingVertical: 5, backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    },
    metaText: { fontSize: 11, fontWeight: "700", color: c.textSub },

    stats: { flexDirection: "row", gap: 10 },
    stat: {
      flex: 1, borderRadius: 16, paddingVertical: 12, alignItems: "center",
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    },
    statValue: { fontSize: 20, fontWeight: "900", color: c.text },
    statLabel: { fontSize: 10, fontWeight: "700", color: c.textMuted, marginTop: 2, textAlign: "center" },

    sectionTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 0.6, color: c.textMuted, textTransform: "uppercase", marginTop: 4 },

    stateCard: {
      borderRadius: 20, padding: 28, alignItems: "center", gap: 12,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    },
    stateText: { fontSize: 13, lineHeight: 19, color: c.textMuted, textAlign: "center" },
    retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: TOOL, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10 },
    retryText: { color: "#fff", fontWeight: "800", fontSize: 13 },

    disclaimer: { flexDirection: "row", gap: 8, paddingHorizontal: 4, marginTop: 4 },
    disclaimerText: { flex: 1, fontSize: 11, lineHeight: 16, color: c.textMuted },
  });
}

function cardStyles(c: Colors) {
  return StyleSheet.create({
    card: {
      borderRadius: 20, padding: 16, gap: 12,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    },
    topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    rank: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: TOOL + "22" },
    rankText: { fontSize: 11, fontWeight: "900", color: TOOL },
    ticker: { fontSize: 17, fontWeight: "900", color: c.text, letterSpacing: -0.3 },
    name: { fontSize: 12, color: c.textMuted, marginTop: 1 },
    mosPill: { alignItems: "center", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "rgba(34,197,94,0.14)" },
    mosValue: { fontSize: 15, fontWeight: "900", color: "#22c55e" },
    mosLabel: { fontSize: 9, fontWeight: "700", color: "#22c55e", opacity: 0.85 },

    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: c.bgRaised },
    chipText: { fontSize: 11, fontWeight: "600", color: c.textMuted },

    valueBlock: { gap: 8 },
    valueLabels: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
    smallLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4, color: c.textMuted, textTransform: "uppercase" },
    priceNow: { fontSize: 16, fontWeight: "900", color: c.text, marginTop: 2 },
    baseValue: { fontSize: 16, fontWeight: "900", color: GREEN, marginTop: 2 },
    track: { height: 8, borderRadius: 4, backgroundColor: GREEN + "22", overflow: "hidden" },
    trackFill: { height: "100%", borderRadius: 4, backgroundColor: c.textSub },

    scenarios: { flexDirection: "row", gap: 8 },
    scenario: { flex: 1, alignItems: "center", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 4, backgroundColor: c.bgRaised },
    scenarioBase: { backgroundColor: "rgba(0,168,94,0.1)", borderWidth: 1, borderColor: "rgba(0,168,94,0.3)" },
    scenarioLabel: { fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
    scenarioValue: { fontSize: 13, fontWeight: "800", color: c.text, marginTop: 2 },

    footer: {
      flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: 10,
    },
    footerText: { fontSize: 12, fontWeight: "800", color: TOOL },
  });
}
