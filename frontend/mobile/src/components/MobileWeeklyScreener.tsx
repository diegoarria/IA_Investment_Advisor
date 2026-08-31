import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { screenerWeeklyApi } from "../lib/api";

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
  existingTickers?: string[];
}

const TOOL_COLOR = "#8b5cf6";

export default function MobileWeeklyScreener({ isPremium, onUpgrade, existingTickers = [] }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const s = styles();

  const load = useCallback(() => {
    if (!isPremium) return;
    setLoading(true);
    screenerWeeklyApi.getWeekly(existingTickers)
      .then((res: any) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [isPremium]);

  useEffect(() => { load(); }, [load]);

  if (!isPremium) {
    // Diego, 2026-08-30: locked "blurred" preview (skeleton bars, not real
    // text — RN has no reliable text-blur filter) instead of a plain
    // locked card. The backend itself refuses to generate/send real
    // Screener Semanal data to a Free user (see screener.py's /weekly
    // route), so there's no real data here to protect — this is purely a
    // "there's something real here" visual cue. Whole card taps to the
    // paywall.
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={onUpgrade} style={[s.card, { backgroundColor: colors.card }]}>
        <View style={[s.hero, { backgroundColor: TOOL_COLOR + "18" }]}>
          <View style={[s.circle1, { backgroundColor: TOOL_COLOR + "15" }]} />
          <View style={[s.circle2, { backgroundColor: TOOL_COLOR + "0A" }]} />
          <View style={[s.iconOuter, { backgroundColor: TOOL_COLOR + "25", borderColor: TOOL_COLOR + "40" }]}>
            <View style={[s.iconInner, { backgroundColor: TOOL_COLOR }]}>
              <Ionicons name="search" size={26} color="white" />
            </View>
          </View>
          <Text style={[s.heroTitle, { color: colors.text }]}>{t("mobileWeeklyScreener.title")}</Text>
          <Text style={[s.heroTagline, { color: TOOL_COLOR }]}>{t("mobileWeeklyScreener.tagline")}</Text>
        </View>

        <View style={s.content}>
          <View style={[s.lockedPreview, { borderColor: colors.border }]}>
            <View style={{ opacity: 0.35 }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[s.pickRow, { borderTopColor: colors.border, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0 }]}>
                  <View style={[s.rankBox, { backgroundColor: TOOL_COLOR + "15" }]}>
                    <Text style={[s.rank, { color: TOOL_COLOR }]}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <View style={[s.skeletonBar, { width: 46, height: 12, backgroundColor: colors.textMuted }]} />
                      <View style={[s.skeletonBar, { width: 60, height: 12, backgroundColor: colors.border }]} />
                    </View>
                    <View style={[s.skeletonBar, { width: "80%", height: 9, backgroundColor: colors.border }]} />
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <View style={[s.skeletonBar, { width: 40, height: 12, backgroundColor: colors.textMuted }]} />
                    <View style={[s.skeletonBar, { width: 32, height: 9, backgroundColor: colors.border }]} />
                  </View>
                </View>
              ))}
            </View>
            <View style={s.lockOverlay}>
              <Ionicons name="lock-closed" size={18} color="#fff" />
              <Text style={s.lockText}>{t("mobileWeeklyScreener.unlockPreview")}</Text>
            </View>
          </View>

          <View style={[s.unlockBtn, { backgroundColor: TOOL_COLOR }]}>
            <Ionicons name="sparkles" size={15} color="#fff" />
            <Text style={s.unlockBtnText}>{t("mobileWeeklyScreener.unlockCta")}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[s.card, { backgroundColor: colors.card }]}>

      {/* ── Hero ── */}
      <View style={[s.hero, { backgroundColor: TOOL_COLOR + "18" }]}>
        <View style={[s.circle1, { backgroundColor: TOOL_COLOR + "15" }]} />
        <View style={[s.circle2, { backgroundColor: TOOL_COLOR + "0A" }]} />
        <View style={[s.iconOuter, { backgroundColor: TOOL_COLOR + "25", borderColor: TOOL_COLOR + "40" }]}>
          <View style={[s.iconInner, { backgroundColor: TOOL_COLOR }]}>
            {loading
              ? <ActivityIndicator color="white" size="small" />
              : <Ionicons name="search" size={26} color="white" />}
          </View>
        </View>
        <Text style={[s.heroTitle, { color: colors.text }]}>{t("mobileWeeklyScreener.title")}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
          <Text style={[s.heroTagline, { color: TOOL_COLOR }]}>{t("mobileWeeklyScreener.tagline")}</Text>
        </View>
        {data?.week_theme && (
          <View style={[s.themeBadge, { backgroundColor: TOOL_COLOR + "20", borderColor: TOOL_COLOR + "40" }]}>
            <Text style={[s.themeBadgeText, { color: TOOL_COLOR }]}>{data.week_theme}</Text>
          </View>
        )}
      </View>

      {/* ── Content ── */}
      <View style={s.content}>
        {loading && (
          <View style={s.loadingRow}>
            <ActivityIndicator size="small" color={TOOL_COLOR} />
            <Text style={[s.loadingText, { color: colors.textMuted }]}>{t("mobileWeeklyScreener.searching")}</Text>
          </View>
        )}

        {!loading && data?.picks?.map((pick: any, i: number) => (
          <View key={pick.ticker} style={[s.pickRow, { borderTopColor: colors.border }]}>
            <View style={[s.rankBox, { backgroundColor: TOOL_COLOR + "15" }]}>
              <Text style={[s.rank, { color: TOOL_COLOR }]}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[s.ticker, { color: colors.text }]}>{pick.ticker}</Text>
                {pick.sector && (
                  <View style={[s.sectorBadge, { backgroundColor: colors.bgRaised }]}>
                    <Text style={[s.sector, { color: colors.textMuted }]}>{pick.sector}</Text>
                  </View>
                )}
              </View>
              <Text style={[s.why, { color: colors.textSub }]} numberOfLines={2}>{pick.why}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[s.price, { color: colors.text }]}>${pick.price?.toFixed(2) ?? "—"}</Text>
              <Text style={[s.change, { color: (pick.change_pct ?? 0) >= 0 ? "#22c55e" : "#ef4444" }]}>
                {(pick.change_pct ?? 0) >= 0 ? "+" : ""}{pick.change_pct?.toFixed(1) ?? 0}%
              </Text>
            </View>
          </View>
        ))}

        {!loading && (!data || !data.picks || data.picks.length === 0) && (
          <View style={s.emptyWrap}>
            <Text style={{ fontSize: 28 }}>🔍</Text>
            <Text style={[s.emptyText, { color: colors.textMuted }]}>{t("mobileWeeklyScreener.noPicks")}</Text>
            <TouchableOpacity
              onPress={load}
              style={[s.retryBtn, { backgroundColor: TOOL_COLOR + "15" }]}
            >
              <Ionicons name="refresh" size={13} color={TOOL_COLOR} />
              <Text style={[s.retryText, { color: TOOL_COLOR }]}>{t("mobileWeeklyScreener.retry")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && data?.picks?.length > 0 && (
          <View style={[s.disclaimerRow, { borderTopColor: colors.border }]}>
            <Ionicons name="information-circle-outline" size={13} color={colors.textDim ?? colors.textMuted} style={{ marginTop: 1 }} />
            <Text style={[s.disclaimerText, { color: colors.textDim ?? colors.textMuted }]}>
              {data.disclaimer ?? t("mobileWeeklyScreener.defaultDisclaimer")}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = () => StyleSheet.create({
  card:       { borderRadius: 24, overflow: "hidden", marginBottom: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 6 },

  // Hero
  hero:        { paddingTop: 28, paddingBottom: 20, alignItems: "center", position: "relative", overflow: "hidden" },
  circle1:     { position: "absolute", width: 160, height: 160, borderRadius: 80, top: -50, right: -30 },
  circle2:     { position: "absolute", width: 100, height: 100, borderRadius: 50, bottom: -25, left: -15 },
  iconOuter:   { width: 80, height: 80, borderRadius: 24, borderWidth: 2, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  iconInner:   { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  heroTitle:   { fontSize: 20, fontWeight: "900", letterSpacing: -0.5, marginBottom: 2, textAlign: "center" },
  heroTagline: { fontSize: 12, fontWeight: "700", textAlign: "center", letterSpacing: 0.2 },
  themeBadge:  { marginTop: 10, borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4 },
  themeBadgeText: { fontSize: 11, fontWeight: "700" },

  // Content
  content:    { paddingHorizontal: 16, paddingBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: "800", marginTop: 12, marginBottom: 4 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 18, justifyContent: "center" },
  loadingText:{ fontSize: 13 },
  emptyWrap:  { alignItems: "center", paddingVertical: 20, gap: 8 },
  emptyText:  { fontSize: 13, textAlign: "center" },
  retryBtn:   { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, marginTop: 2 },
  retryText:  { fontSize: 11, fontWeight: "700" },

  // Locked preview (Free tier)
  lockedPreview: { position: "relative", borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", marginBottom: 14 },
  skeletonBar:   { borderRadius: 4 },
  lockOverlay:   { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.45)" },
  lockText:      { fontSize: 12, fontWeight: "800", color: "#fff", textAlign: "center", paddingHorizontal: 16 },
  unlockBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 13 },
  unlockBtnText: { fontSize: 14, fontWeight: "800", color: "#fff" },

  // Picks
  pickRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth },
  rankBox:    { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rank:       { fontSize: 12, fontWeight: "900" },
  ticker:     { fontSize: 14, fontWeight: "800" },
  sectorBadge:{ borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  sector:     { fontSize: 10, fontWeight: "600" },
  why:        { fontSize: 11, marginTop: 2, lineHeight: 15 },
  price:      { fontSize: 13, fontWeight: "700" },
  change:     { fontSize: 10, fontWeight: "700" },

  // Disclaimer
  disclaimerRow:  { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingTop: 12, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  disclaimerText: { fontSize: 10, lineHeight: 14, flex: 1 },
});
