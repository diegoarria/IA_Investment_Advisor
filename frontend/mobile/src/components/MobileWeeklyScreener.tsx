import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const s = styles();

  useEffect(() => {
    if (!isPremium) return;
    setLoading(true);
    screenerWeeklyApi.getWeekly(existingTickers)
      .then((res: any) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isPremium]);

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
        <Text style={[s.heroTitle, { color: colors.text }]}>Screener Semanal</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
          <Text style={[s.heroTagline, { color: TOOL_COLOR }]}>5 oportunidades personalizadas cada lunes</Text>
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
            <Text style={[s.loadingText, { color: colors.textMuted }]}>Buscando oportunidades...</Text>
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

        {!loading && !data && (
          <View style={s.emptyWrap}>
            <Text style={{ fontSize: 28 }}>🔍</Text>
            <Text style={[s.emptyText, { color: colors.textMuted }]}>No hay picks disponibles aún.</Text>
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
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 18, justifyContent: "center" },
  loadingText:{ fontSize: 13 },
  emptyWrap:  { alignItems: "center", paddingVertical: 20, gap: 8 },
  emptyText:  { fontSize: 13, textAlign: "center" },

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
});
