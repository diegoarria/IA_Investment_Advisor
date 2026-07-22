import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import StockAvatar from "./StockAvatar";

export interface EarningsSegment {
  name: string;
  metric: string;
  value: string;
  note: string | null;
}

export interface GuidanceChange {
  status: "raised" | "lowered" | "maintained" | "unknown";
  old_range: string | null;
  new_range: string | null;
  note: string | null;
}

export interface EarningsAnalysisData {
  headline: string;
  positives: string[];
  negatives: string[];
  segments: EarningsSegment[];
  guidance_change: GuidanceChange | null;
  why_stock_moved: string;
  thesis_impact: string;
  rating_out_of_10: number | null;
  rating_reasoning: string;
  portfolio_note: string | null;
}

export interface EarningsData {
  symbol: string;
  name: string;
  current_price: number | null;
  eps_actual: number | null;
  eps_estimate: number | null;
  revenue_actual: number | null;
  revenue_estimate: number | null;
  fiscal_label: string;
}

export interface EarningsAnalysisResponse {
  symbol: string;
  structured_analysis: EarningsAnalysisData;
  earnings_data: EarningsData;
}

export interface RecentReporter {
  ticker: string;
  event_date: string | null;
  eps_estimate: number | null;
  eps_actual: number | null;
  revenue_estimate: number | null;
  revenue_actual: number | null;
}

export function fmtMoney(v: number | null): string {
  if (v === null || v === undefined) return "N/D";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(2)}`;
}

export function BeatMissBadge({ actual, estimate, colors }: { actual: number | null; estimate: number | null; colors: any }) {
  const { t } = useTranslation();
  if (actual === null || estimate === null) return null;
  const beat = actual >= estimate;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: beat ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.12)", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Ionicons name={beat ? "trending-up" : "trending-down"} size={11} color={beat ? "#22c55e" : "#ef4444"} />
      <Text style={{ fontSize: 10, fontWeight: "800", color: beat ? "#22c55e" : "#ef4444" }}>{beat ? t("earnings.beat") : t("earnings.miss")}</Text>
    </View>
  );
}

export function RatingBadge({ rating, colors }: { rating: number | null; colors: any }) {
  if (rating === null) return null;
  const color = rating >= 8 ? "#22c55e" : rating >= 6 ? "#eab308" : rating >= 4 ? "#f59e0b" : "#ef4444";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.bgRaised, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 }}>
      <Ionicons name="sparkles" size={14} color={color} />
      <Text style={{ fontSize: 16, fontWeight: "900", color }}>{rating.toFixed(1)}</Text>
      <Text style={{ fontSize: 10, fontWeight: "800", color: colors.textMuted }}>/10</Text>
    </View>
  );
}

export function GuidanceCallout({ g, colors }: { g: GuidanceChange | null; colors: any }) {
  const { t } = useTranslation();
  if (!g || g.status === "unknown") return null;
  const color = g.status === "raised" ? "#22c55e" : g.status === "lowered" ? "#ef4444" : colors.textMuted;
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised, borderRadius: 12, padding: 10 }}>
      <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, color: colors.textMuted, marginBottom: 2 }}>{t("earnings.sections.guidance")}</Text>
      <Text style={{ fontSize: 13, fontWeight: "800", color }}>{t(`earnings.guidance.${g.status}`)}</Text>
      {(g.old_range || g.new_range) && (
        <View style={{ flexDirection: "row", gap: 6, marginTop: 2 }}>
          {g.old_range && <Text style={{ fontSize: 11, color: colors.textSub, textDecorationLine: "line-through" }}>{g.old_range}</Text>}
          {g.new_range && <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textSub }}>{g.new_range}</Text>}
        </View>
      )}
      {g.note && <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>{g.note}</Text>}
    </View>
  );
}

export function SegmentsList({ segments, colors }: { segments: EarningsSegment[]; colors: any }) {
  const { t } = useTranslation();
  if (segments.length === 0) {
    return <Text style={{ fontSize: 11, fontStyle: "italic", color: colors.textMuted }}>{t("earnings.segments.none")}</Text>;
  }
  return (
    <View style={{ gap: 6 }}>
      {segments.map((s, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.bgRaised, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }} numberOfLines={1}>{s.name}</Text>
            {s.note && <Text style={{ fontSize: 9, color: colors.textMuted }} numberOfLines={1}>{s.note}</Text>}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 11, fontWeight: "900", color: colors.accentLight }}>{s.value}</Text>
            <Text style={{ fontSize: 9, color: colors.textDim }}>{s.metric}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function EarningsAnalysisCard({ result, colors }: { result: EarningsAnalysisResponse; colors: any }) {
  const { t } = useTranslation();
  const { structured_analysis: a, earnings_data: d } = result;
  return (
    <View style={[cs.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={cs.cardHeader}>
        <StockAvatar ticker={d.symbol} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }} numberOfLines={1}>{d.name} ({d.symbol})</Text>
          <Text style={{ fontSize: 11, color: colors.textMuted }}>{d.fiscal_label}</Text>
        </View>
        <RatingBadge rating={a.rating_out_of_10} colors={colors} />
      </View>

      <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text, lineHeight: 19 }}>{a.headline}</Text>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, backgroundColor: colors.bgRaised, borderRadius: 10, padding: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }}>EPS</Text>
            <BeatMissBadge actual={d.eps_actual} estimate={d.eps_estimate} colors={colors} />
          </View>
          <Text style={{ fontSize: 12, fontWeight: "900", color: colors.text, marginTop: 2 }}>
            ${d.eps_actual ?? "N/D"} <Text style={{ fontWeight: "400", color: colors.textMuted }}>vs ${d.eps_estimate ?? "N/D"}</Text>
          </Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.bgRaised, borderRadius: 10, padding: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }}>Revenue</Text>
            <BeatMissBadge actual={d.revenue_actual} estimate={d.revenue_estimate} colors={colors} />
          </View>
          <Text style={{ fontSize: 12, fontWeight: "900", color: colors.text, marginTop: 2 }}>
            {fmtMoney(d.revenue_actual)} <Text style={{ fontWeight: "400", color: colors.textMuted }}>vs {fmtMoney(d.revenue_estimate)}</Text>
          </Text>
        </View>
      </View>

      {a.positives.length > 0 && (
        <View style={{ backgroundColor: "rgba(34,197,94,0.06)", borderWidth: 1, borderColor: "rgba(34,197,94,0.18)", borderRadius: 12, padding: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Ionicons name="thumbs-up" size={13} color="#22c55e" />
            <Text style={{ fontSize: 11, fontWeight: "800", color: "#22c55e" }}>{t("earnings.sections.positives")}</Text>
          </View>
          {a.positives.map((p, i) => <Text key={i} style={{ fontSize: 12, color: colors.textSub, marginBottom: 2 }}>• {p}</Text>)}
        </View>
      )}

      {a.negatives.length > 0 && (
        <View style={{ backgroundColor: "rgba(239,68,68,0.06)", borderWidth: 1, borderColor: "rgba(239,68,68,0.18)", borderRadius: 12, padding: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Ionicons name="thumbs-down" size={13} color="#ef4444" />
            <Text style={{ fontSize: 11, fontWeight: "800", color: "#ef4444" }}>{t("earnings.sections.negatives")}</Text>
          </View>
          {a.negatives.map((n, i) => <Text key={i} style={{ fontSize: 12, color: colors.textSub, marginBottom: 2 }}>• {n}</Text>)}
        </View>
      )}

      <View>
        <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, color: colors.textMuted, marginBottom: 6 }}>{t("earnings.sections.segments")}</Text>
        <SegmentsList segments={a.segments} colors={colors} />
      </View>

      <GuidanceCallout g={a.guidance_change} colors={colors} />

      {!!a.why_stock_moved && (
        <View>
          <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, color: colors.textMuted, marginBottom: 2 }}>{t("earnings.sections.whyMoved")}</Text>
          <Text style={{ fontSize: 12, color: colors.textSub }}>{a.why_stock_moved}</Text>
        </View>
      )}

      {!!a.thesis_impact && (
        <View style={{ flexDirection: "row", gap: 8, backgroundColor: "rgba(0,168,94,0.06)", borderWidth: 1, borderColor: "rgba(0,168,94,0.18)", borderRadius: 12, padding: 10 }}>
          <Ionicons name="locate" size={13} color={colors.accentLight} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", color: colors.accentLight, marginBottom: 2 }}>{t("earnings.sections.thesisImpact")}</Text>
            <Text style={{ fontSize: 12, color: colors.textSub }}>{a.thesis_impact}</Text>
          </View>
        </View>
      )}

      {!!a.portfolio_note && <Text style={{ fontSize: 12, fontStyle: "italic", color: colors.textMuted }}>{a.portfolio_note}</Text>}

      {a.rating_out_of_10 !== null && !!a.rating_reasoning && (
        <Text style={{ fontSize: 11, color: colors.textDim }}>
          <Text style={{ fontWeight: "800", color: colors.textMuted }}>{t("earnings.sections.ratingReasoning")}: </Text>
          {a.rating_reasoning}
        </Text>
      )}
    </View>
  );
}

const cs = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
});
