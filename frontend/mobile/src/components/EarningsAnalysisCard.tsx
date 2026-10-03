import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import Svg, { Circle } from "react-native-svg";
import StockAvatar from "./StockAvatar";

// Earnings' own accent — mirror of the web's EARNINGS_COLOR (same "one color
// per tool" convention as Nuvos Radar).
export const EARNINGS_COLOR = "#0ea5e9";
const UP = "#22c55e";
const DOWN = "#ef4444";

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
  fiscal_quarter: number | null;
  fiscal_year: number | null;
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
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(2)}`;
}

export function fmtEps(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "N/D";
  return `$${Number(v).toFixed(2)}`;
}

/** % the actual came in above (+) or below (−) the estimate. */
export function surprisePct(actual: number | null, estimate: number | null): number | null {
  if (actual === null || estimate === null || actual === undefined || estimate === undefined) return null;
  if (!estimate) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

export function fmtReportDate(iso: string | null, lang: string): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "en" ? "en-US" : "es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export function BeatMissBadge({ actual, estimate, colors: _colors }: { actual: number | null; estimate: number | null; colors?: any }) {
  const { t } = useTranslation();
  if (actual === null || estimate === null || actual === undefined || estimate === undefined) return null;
  const beat = actual >= estimate;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: beat ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.12)", borderRadius: 12, paddingHorizontal: 7, paddingVertical: 2 }}>
      <Ionicons name={beat ? "trending-up" : "trending-down"} size={11} color={beat ? UP : DOWN} />
      <Text style={{ fontSize: 10, fontWeight: "800", color: beat ? UP : DOWN }}>{beat ? t("earnings.beat") : t("earnings.miss")}</Text>
    </View>
  );
}

function ratingTone(n: number) {
  return n >= 8 ? { color: UP, key: "strong" } : n >= 6 ? { color: "#84cc16", key: "good" } : n >= 4 ? { color: "#f59e0b", key: "mixed" } : { color: DOWN, key: "weak" };
}

/** Normalized rating or null — never trust the payload's type before doing math on it. */
function ratingValue(rating: number | null): number | null {
  const n = typeof rating === "number" ? rating : Number(rating);
  if (rating === null || rating === undefined || Number.isNaN(n)) return null;
  return Math.max(0, Math.min(10, n));
}

export function RatingBadge({ rating, colors }: { rating: number | null; colors: any }) {
  const { t } = useTranslation();
  const n = ratingValue(rating);
  if (n === null) return null;
  const tone = ratingTone(n);
  const R = 28, C = 2 * Math.PI * R;
  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ width: 70, height: 70 }}>
        <Svg width={70} height={70} viewBox="0 0 70 70">
          <Circle cx={35} cy={35} r={R} fill="none" stroke={colors.bgRaised} strokeWidth={6} />
          <Circle cx={35} cy={35} r={R} fill="none" stroke={tone.color} strokeWidth={6} strokeLinecap="round"
                  strokeDasharray={`${(n / 10) * C} ${C}`} rotation={-90} origin="35, 35" />
        </Svg>
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
          <Text style={{ fontSize: 20, fontWeight: "900", color: colors.text }}>{n.toFixed(1)}</Text>
          <Text style={{ fontSize: 9, fontWeight: "700", color: colors.textMuted, marginTop: -2 }}>/10</Text>
        </View>
      </View>
      <Text style={{ fontSize: 10, fontWeight: "900", color: tone.color, marginTop: 4, letterSpacing: 0.6, textTransform: "uppercase" }}>
        {t(`earnings.rating.${tone.key}`)}
      </Text>
    </View>
  );
}

/** One key number from the report: actual vs estimate, with the surprise. */
export function MetricTile({ label, actual, estimate, format, colors, compact }: {
  label: string; actual: number | null; estimate: number | null; format: (v: number | null) => string; colors: any; compact?: boolean;
}) {
  const { t } = useTranslation();
  const s = surprisePct(actual, estimate);
  const beat = s !== null && s >= 0;
  const max = Math.max(Math.abs(actual ?? 0), Math.abs(estimate ?? 0)) || 1;
  return (
    <View style={{
      flex: 1, borderRadius: compact ? 12 : 16, padding: compact ? 10 : 14,
      backgroundColor: compact ? colors.bgRaised : colors.card, borderWidth: compact ? 0 : 1, borderColor: colors.border,
    }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
        <Text style={{ flex: 1, fontSize: 9, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase", color: colors.textMuted }} numberOfLines={1}>{label}</Text>
        <BeatMissBadge actual={actual} estimate={estimate} />
      </View>
      <Text style={{ fontSize: compact ? 16 : 22, fontWeight: "900", color: colors.text, marginTop: compact ? 4 : 8, letterSpacing: -0.4 }} numberOfLines={1} adjustsFontSizeToFit>
        {format(actual)}
      </Text>
      <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }} numberOfLines={1}>
        {t("earnings.metrics.estimate", { value: format(estimate) })}
        {s !== null && <Text style={{ fontWeight: "800", color: beat ? UP : DOWN }}>{`  ${s >= 0 ? "+" : ""}${s.toFixed(1)}%`}</Text>}
      </Text>
      {!compact && actual !== null && estimate !== null && (
        <View style={{ marginTop: 10, gap: 6 }}>
          {[
            { k: "actual", v: actual, c: beat ? UP : DOWN },
            { k: "estimate", v: estimate, c: colors.textDim },
          ].map((row) => (
            <View key={row.k} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ width: 52, fontSize: 9, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }}>{t(`earnings.metrics.${row.k}Short`)}</Text>
              <View style={{ flex: 1, height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: colors.bgRaised }}>
                <View style={{ height: 6, borderRadius: 3, width: `${Math.max(4, (Math.abs(row.v) / max) * 100)}%`, backgroundColor: row.c }} />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function SectionLabel({ icon, label, color, colors }: { icon: keyof typeof Ionicons.glyphMap; label: string; color?: string; colors: any }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 }}>
      <Ionicons name={icon} size={15} color={color ?? EARNINGS_COLOR} />
      <Text style={{ fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase", color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

export function GuidanceCallout({ g, colors }: { g: GuidanceChange | null; colors: any }) {
  const { t } = useTranslation();
  if (!g || g.status === "unknown") return null;
  const color = g.status === "raised" ? UP : g.status === "lowered" ? DOWN : colors.textSub;
  const icon = g.status === "raised" ? "trending-up" : g.status === "lowered" ? "trending-down" : "compass-outline";
  return (
    <View style={[cs.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <SectionLabel icon="compass-outline" label={t("earnings.sections.guidance")} colors={colors} />
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center",
                       backgroundColor: g.status === "raised" ? "rgba(34,197,94,0.12)" : g.status === "lowered" ? "rgba(239,68,68,0.12)" : colors.bgRaised }}>
          <Ionicons name={icon as any} size={19} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "800", color }}>{t(`earnings.guidance.${g.status}`)}</Text>
          {(g.old_range || g.new_range) && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 3 }}>
              {g.old_range && <Text style={{ fontSize: 13, color: colors.textMuted, textDecorationLine: "line-through" }}>{g.old_range}</Text>}
              {g.new_range && <Text style={{ fontSize: 13, fontWeight: "800", color: colors.textSub }}>{g.new_range}</Text>}
            </View>
          )}
          {g.note && <Text style={[cs.body, { color: colors.textSub, marginTop: 5 }]}>{g.note}</Text>}
        </View>
      </View>
    </View>
  );
}

export function SegmentsList({ segments, colors }: { segments: EarningsSegment[]; colors: any }) {
  const { t } = useTranslation();
  if (segments.length === 0) {
    return <Text style={{ fontSize: 13, color: colors.textMuted }}>{t("earnings.segments.none")}</Text>;
  }
  return (
    <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
      {segments.map((s, i) => (
        <View key={i} style={{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10,
          paddingHorizontal: 12, paddingVertical: 10,
          backgroundColor: i % 2 ? colors.bgRaised : "transparent",
          borderTopWidth: i ? 1 : 0, borderTopColor: colors.border,
        }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }} numberOfLines={1}>{s.name}</Text>
            {s.note && <Text style={{ fontSize: 11, lineHeight: 15, color: colors.textMuted, marginTop: 2 }}>{s.note}</Text>}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 14, fontWeight: "900", color: colors.text }}>{s.value}</Text>
            <Text style={{ fontSize: 10, fontWeight: "600", color: colors.textMuted }}>{s.metric}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function PointList({ items, tone, colors }: { items: string[]; tone: "up" | "down"; colors: any }) {
  return (
    <View style={{ gap: 9 }}>
      {items.map((p, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 9, alignItems: "flex-start" }}>
          <Ionicons name={tone === "up" ? "checkmark-circle" : "close-circle"} size={16} color={tone === "up" ? UP : DOWN} style={{ marginTop: 1 }} />
          <Text style={[cs.body, { flex: 1, color: colors.textSub }]}>{p}</Text>
        </View>
      ))}
    </View>
  );
}

export function EarningsAnalysisCard({ result, colors }: { result: EarningsAnalysisResponse; colors: any }) {
  const { t } = useTranslation();
  const { structured_analysis: rawAnalysis, earnings_data: d } = result;
  // Defense in depth — the backend sanitizes these to arrays, but a render
  // must never trust an external API payload's shape enough to call
  // `.map()`/`.length` on it unchecked.
  const a = {
    ...rawAnalysis,
    positives: Array.isArray(rawAnalysis.positives) ? rawAnalysis.positives : [],
    negatives: Array.isArray(rawAnalysis.negatives) ? rawAnalysis.negatives : [],
    segments: Array.isArray(rawAnalysis.segments) ? rawAnalysis.segments : [],
  };
  const rating = ratingValue(a.rating_out_of_10);

  return (
    <View style={{ gap: 12 }}>
      {/* Hero */}
      <View style={[cs.hero]}>
        <View style={cs.heroGlow} />
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={cs.eyebrow}>{t("earnings.hero.eyebrow")}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <StockAvatar ticker={d.symbol} size={42} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 20, fontWeight: "900", letterSpacing: -0.5, color: colors.text }} numberOfLines={2}>{d.name || d.symbol}</Text>
                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.textMuted, marginTop: 1 }}>{d.symbol}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
              {!!d.fiscal_label && (
                <View style={[cs.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[cs.pillText, { color: colors.textSub }]}>{d.fiscal_label}</Text>
                </View>
              )}
              {d.current_price !== null && d.current_price !== undefined && (
                <View style={[cs.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[cs.pillText, { color: colors.textSub }]}>{t("earnings.hero.price", { value: fmtEps(d.current_price) })}</Text>
                </View>
              )}
            </View>
          </View>
          {rating !== null && <RatingBadge rating={rating} colors={colors} />}
        </View>
        {!!a.headline && (
          <Text style={{ fontSize: 15, fontWeight: "600", lineHeight: 22, color: colors.text, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: EARNINGS_COLOR + "33" }}>
            {a.headline}
          </Text>
        )}
      </View>

      {/* Key numbers */}
      <Text style={[cs.sectionTitle, { color: colors.textMuted }]}>{t("earnings.sections.keyNumbers")}</Text>
      <View style={{ gap: 10 }}>
        <MetricTile label={t("earnings.metrics.eps")} actual={d.eps_actual} estimate={d.eps_estimate} format={fmtEps} colors={colors} />
        <MetricTile label={t("earnings.metrics.revenue")} actual={d.revenue_actual} estimate={d.revenue_estimate} format={fmtMoney} colors={colors} />
      </View>

      {a.positives.length > 0 && (
        <View style={[cs.card, { backgroundColor: colors.card, borderColor: colors.border, borderTopWidth: 3, borderTopColor: UP }]}>
          <SectionLabel icon="trending-up" label={t("earnings.sections.positives")} color={UP} colors={colors} />
          <PointList items={a.positives} tone="up" colors={colors} />
        </View>
      )}
      {a.negatives.length > 0 && (
        <View style={[cs.card, { backgroundColor: colors.card, borderColor: colors.border, borderTopWidth: 3, borderTopColor: DOWN }]}>
          <SectionLabel icon="trending-down" label={t("earnings.sections.negatives")} color={DOWN} colors={colors} />
          <PointList items={a.negatives} tone="down" colors={colors} />
        </View>
      )}

      <GuidanceCallout g={a.guidance_change} colors={colors} />

      <View style={[cs.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <SectionLabel icon="layers-outline" label={t("earnings.sections.segments")} colors={colors} />
        <SegmentsList segments={a.segments} colors={colors} />
      </View>

      {!!a.why_stock_moved && (
        <View style={[cs.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SectionLabel icon="pulse-outline" label={t("earnings.sections.whyMoved")} colors={colors} />
          <Text style={[cs.body, { color: colors.textSub }]}>{a.why_stock_moved}</Text>
        </View>
      )}

      {!!a.thesis_impact && (
        <View style={[cs.card, { backgroundColor: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.25)" }]}>
          <SectionLabel icon="locate-outline" label={t("earnings.sections.thesisImpact")} color={colors.accentLight} colors={colors} />
          <Text style={[cs.body, { color: colors.textSub }]}>{a.thesis_impact}</Text>
        </View>
      )}

      {!!a.portfolio_note && (
        <View style={[cs.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SectionLabel icon="briefcase-outline" label={t("earnings.sections.portfolioNote")} colors={colors} />
          <Text style={[cs.body, { color: colors.textSub }]}>{a.portfolio_note}</Text>
        </View>
      )}

      {rating !== null && !!a.rating_reasoning && (
        <View style={[cs.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SectionLabel icon="sparkles" label={t("earnings.sections.ratingReasoning")} color={ratingTone(rating).color} colors={colors} />
          <Text style={[cs.body, { color: colors.textSub }]}>{a.rating_reasoning}</Text>
        </View>
      )}

      <EarningsDisclaimer colors={colors} />
    </View>
  );
}

export function EarningsDisclaimer({ colors }: { colors: any }) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 4, marginTop: 4 }}>
      <Ionicons name="information-circle-outline" size={15} color={colors.textMuted} />
      <Text style={{ flex: 1, fontSize: 11, lineHeight: 16, color: colors.textMuted }}>{t("earnings.disclaimer")}</Text>
    </View>
  );
}

const cs = StyleSheet.create({
  hero: {
    borderRadius: 24, padding: 18, overflow: "hidden",
    backgroundColor: EARNINGS_COLOR + "14", borderWidth: 1, borderColor: EARNINGS_COLOR + "33",
  },
  heroGlow: { position: "absolute", width: 220, height: 220, borderRadius: 110, top: -110, right: -70, backgroundColor: EARNINGS_COLOR + "22" },
  eyebrow: { fontSize: 10, fontWeight: "900", letterSpacing: 1.4, color: EARNINGS_COLOR, marginBottom: 10 },
  pill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  pillText: { fontSize: 11, fontWeight: "700" },
  sectionTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 4 },
  card: { borderRadius: 18, padding: 16, borderWidth: 1 },
  body: { fontSize: 14, lineHeight: 21 },
});
