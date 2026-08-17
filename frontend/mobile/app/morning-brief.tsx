import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../src/lib/ThemeContext";
import { morningBriefFullApi } from "../src/lib/api";
import StockAvatar from "../src/components/StockAvatar";

interface TopMover { ticker: string; change_pct: number; impact_usd: number; }
interface NewsItem { ticker: string; headline: string; category: string | null; }
interface EventItem { time_et: string | null; label: string; impact: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW"; type: string; }
interface MorningBriefData {
  portfolio_value: number;
  change_usd: number | null;
  change_pct: number | null;
  sp500_change_pct: number | null;
  top_mover: TopMover | null;
  news: NewsItem[];
  events: EventItem[];
}

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const IMPACT_DOT: Record<string, string> = { VERY_HIGH: "🔴", HIGH: "🔴", MEDIUM: "🟡", LOW: "⚪" };

export default function MorningBriefScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [data, setData] = useState<MorningBriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    morningBriefFullApi.get()
      .then((res: { data: MorningBriefData }) => setData(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const isUp = (data?.change_usd ?? 0) >= 0;
  const sp500Up = (data?.sp500_change_pct ?? 0) >= 0;

  return (
    <SafeAreaView style={[st.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={st.content}>
        <Text style={[st.title, { color: colors.text }]}>🧠 {t("morningBrief.title")}</Text>

        {loading ? (
          <ActivityIndicator color={colors.accentLight} style={{ marginTop: 40 }} />
        ) : error || !data ? (
          <View style={[st.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>{t("morningBrief.empty")}</Text>
          </View>
        ) : (
          <>
            <View style={[st.valueCard, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
              <Text style={{ fontSize: 10, fontWeight: "800", letterSpacing: 0.5, color: colors.textMuted, marginBottom: 4 }}>
                {t("morningBrief.portfolioLabel").toUpperCase()}
              </Text>
              <Text style={{ fontSize: 26, fontWeight: "900", color: colors.text }}>{fmtUsd(data.portfolio_value)}</Text>
              {data.change_usd !== null && data.change_pct !== null && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <Ionicons name={isUp ? "trending-up" : "trending-down"} size={14} color={isUp ? "#00d47e" : "#ef4444"} />
                  <Text style={{ fontSize: 12, fontWeight: "800", color: isUp ? "#00d47e" : "#ef4444" }}>
                    {isUp ? "+" : ""}{fmtUsd(data.change_usd)} ({isUp ? "+" : ""}{data.change_pct}%)
                  </Text>
                </View>
              )}
              {data.sp500_change_pct !== null && (
                <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                  S&P 500: <Text style={{ color: sp500Up ? "#00d47e" : "#ef4444", fontWeight: "800" }}>{sp500Up ? "+" : ""}{data.sp500_change_pct}%</Text>
                </Text>
              )}
            </View>

            {data.top_mover && (
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text, marginBottom: 6 }}>🏆 {t("morningBrief.topMoverLabel")}</Text>
                <TouchableOpacity
                  onPress={() => router.push(`/stock/${data.top_mover!.ticker}` as any)}
                  style={[st.moverCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <StockAvatar ticker={data.top_mover.ticker} size={32} />
                  <View style={{ marginLeft: 10 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>{data.top_mover.ticker}</Text>
                    <Text style={{ fontSize: 11, color: data.top_mover.change_pct >= 0 ? "#00d47e" : "#ef4444" }}>
                      {data.top_mover.change_pct >= 0 ? "+" : ""}{data.top_mover.change_pct}% · {fmtUsd(data.top_mover.impact_usd)} {t("morningBrief.impactLabel")}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            {data.news.length > 0 && (
              <View style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <Ionicons name="newspaper-outline" size={14} color={colors.text} />
                  <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>{t("morningBrief.newsLabel")}</Text>
                </View>
                <View style={[st.list, { borderColor: colors.border }]}>
                  {data.news.map((n, i) => (
                    <View key={i} style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.card, borderTopWidth: i > 0 ? 1 : 0, borderColor: colors.border }}>
                      <Text style={{ fontSize: 10, fontWeight: "900", color: colors.accentLight, marginTop: 1 }}>{n.ticker}</Text>
                      <Text style={{ flex: 1, fontSize: 12, lineHeight: 16, color: colors.text }}>{n.headline}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {data.events.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <Ionicons name="time-outline" size={14} color={colors.text} />
                  <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>{t("morningBrief.watchTodayLabel")}</Text>
                </View>
                <View style={[st.list, { borderColor: colors.border }]}>
                  {data.events.map((e, i) => (
                    <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.card, borderTopWidth: i > 0 ? 1 : 0, borderColor: colors.border }}>
                      <Text style={{ fontSize: 13 }}>{IMPACT_DOT[e.impact] || "⚪"}</Text>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textMuted }}>{e.time_et || "—"}</Text>
                      <Text style={{ fontSize: 12, color: colors.text, flex: 1 }}>{e.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <TouchableOpacity
              onPress={() => router.navigate("/(tabs)/portfolio")}
              style={{ backgroundColor: "#00d47e", borderRadius: 16, paddingVertical: 14, alignItems: "center" }}
            >
              <Text style={{ color: "#000", fontWeight: "900", fontSize: 14 }}>{t("morningBrief.seeFullPortfolio")}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 16 },
  emptyCard: { borderRadius: 20, borderWidth: 1, padding: 32, alignItems: "center" },
  valueCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 14 },
  moverCard: { borderRadius: 16, borderWidth: 1, padding: 12, flexDirection: "row", alignItems: "center" },
  list: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
});
