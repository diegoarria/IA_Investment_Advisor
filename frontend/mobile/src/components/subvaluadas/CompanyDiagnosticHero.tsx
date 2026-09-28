import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { GlowCard, RingGauge } from "./companyDiagnosticShared";
import { useTranslation } from "react-i18next";
import { valuationStatus, VERDICT_COLOR, VERDICT_EMOJI, SCENARIO_COLOR, fmtPrice } from "../../lib/types/companyDiagnostic";
import type { CompanyDiagnosticData } from "../../lib/types/companyDiagnostic";

// Mobile mirror of web's CompanyDiagnosticHero.tsx — see
// /Users/diegoarria/.claude/plans/dapper-scribbling-honey.md, Fase 3.
// Replaces the old hero (2 KPI boxes + italic pitch + verdict text +
// tick-mark gauge thermometer) with the simplified design validated in
// the Artifact: verdict pill, one sentence, 3 bars, 3 tappable scenarios,
// and one collapsed "¿por qué?" card with a light real summary (WACC +
// final fair P/E + the P/E waterfall) — no separate ValuationTabs screen
// exists on mobile yet, so the waterfall lives directly inside this
// card's expand body instead of linking out to one.
//
// The verdict/sentence/bars/scenarios above always compute from real
// baseFairValue/conservative/optimistic (P/E-only) — that never changes.
// But INSIDE the "por qué" card, Diego asked (2026-09-03) to reproduce
// the Artifact's exact order: the shadowDualTrack blend (earnings + FCF
// tracks, shadow-mode) renders right there, same as the Artifact, with
// its own label making clear it's a second, still-evaluating estimate —
// not a separate section below like the first pass had it.
//
// Gold (#D4A24C) is the Artifact's one real accent throughout this card
// — score, badges, every info link/toggle — not the app's own green
// brand accent, which the Artifact's hero never uses. Same real hex
// values already used elsewhere in this exact screen (SCENARIO_COLOR).

const _GOLD = "#D4A24C";

type ScenarioKey = "bear" | "base" | "bull";

export function CompanyDiagnosticHero({ data, colors }: { data: CompanyDiagnosticData; colors: any }) {
  const { t } = useTranslation();
  const [scenario, setScenario] = useState<ScenarioKey>("base");
  const [whyOpen, setWhyOpen] = useState(false);

  const { conservative, baseFairValue, optimistic, currentPrice } = data.valuation;
  const scenarioValue: Record<ScenarioKey, number> = { bear: conservative, base: baseFairValue, bull: optimistic };
  const activeValue = scenarioValue[scenario];
  // Diego, 2026-09-07 — mirrors web: the Wall Street bar tracks the same
  // bear/base/bull toggle instead of always showing the flat analyst
  // mean — target_low for Bajista, target_mean (falling back to
  // target_median) for Base, target_high for Alcista.
  const analystTarget = data.valuation.analystTarget;
  const wallStreetByScenario: Record<ScenarioKey, number | null> = {
    bear: analystTarget?.target_low ?? null,
    base: analystTarget?.target_mean ?? analystTarget?.target_median ?? null,
    bull: analystTarget?.target_high ?? null,
  };
  const wallStreet = wallStreetByScenario[scenario];

  const status = valuationStatus(activeValue, currentPrice);
  const maxVal = Math.max(activeValue, currentPrice, wallStreet ?? 0) || 1;

  const bars: { label: string; value: number; color: string }[] = [
    { label: t("companyDiagnostic.hero.fairValueBar"), value: activeValue, color: SCENARIO_COLOR[scenario] },
    { label: t("companyDiagnostic.hero.priceTodayBar"), value: currentPrice, color: colors.textDim },
  ];
  if (wallStreet != null) {
    bars.push({ label: t("companyDiagnostic.hero.wallStreetBar"), value: wallStreet, color: colors.textSub });
  }

  const classificationLabel = data.valuation.classification?.category
    ? t(`companyDiagnostic.classification.category.${data.valuation.classification.category}`, {
        defaultValue: data.valuation.classification.category,
      })
    : t("companyDiagnostic.hero.whySummaryFallback");
  const fairPeBreakdown = data.valuation.fairPeBreakdown;

  const vColor = status ? VERDICT_COLOR[status.verdict] : _GOLD;
  const vIcon: keyof typeof Ionicons.glyphMap =
    status?.verdict === "undervalued" ? "trending-up" : status?.verdict === "overvalued" ? "trending-down" : "remove";

  return (
    <View style={{ gap: 16 }}>
      {/* ── 1. Verdict — the one answer this screen exists for, first and
          biggest, tinted by the verdict itself. The bars and the scenario
          switch live here because they're what move the verdict
          (Nuvos Radar redesign v2, 2026-09-27). ── */}
      <GlowCard colors={colors} tint={vColor} strong>
        {status && (
          <View style={{ alignItems: "center", marginBottom: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: `${vColor}2e` }}>
                <Ionicons name={vIcon} size={22} color={vColor} />
              </View>
              {status.verdict !== "fair" && (
                <Text style={{ fontSize: 54, lineHeight: 60, fontWeight: "900", color: vColor, letterSpacing: -2, fontVariant: ["tabular-nums"] }}>
                  {status.pct.toFixed(0)}%
                </Text>
              )}
            </View>
            <View style={{ marginTop: 10, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: `${vColor}24` }}>
              <Text style={{ fontSize: 13.5, fontWeight: "900", color: vColor, letterSpacing: 0.2 }} numberOfLines={1} adjustsFontSizeToFit>
                {VERDICT_EMOJI[status.verdict]} {t(`companyDiagnostic.hero.verdict.${status.verdict}`, { pct: status.pct.toFixed(0) })}
              </Text>
            </View>
          </View>
        )}

        <Text style={{ fontSize: 15, lineHeight: 22, textAlign: "center", color: colors.text, marginBottom: 6 }}>
          {t("companyDiagnostic.hero.sentence", { price: fmtPrice(currentPrice), ticker: data.ticker, fairValue: fmtPrice(activeValue) })}{" "}
          {status && (
            <Text style={{ fontWeight: "900", color: vColor }}>
              {t(`companyDiagnostic.hero.verdict.${status.verdict}`, { pct: status.pct.toFixed(0) })}
            </Text>
          )}.
        </Text>
        <Text style={{ fontSize: 10.5, textAlign: "center", color: colors.textMuted, marginBottom: 20 }}>
          {t("companyDiagnostic.hero.disclaimer")}
        </Text>

        {/* Comparison bars — gradient fills */}
        <View style={{ gap: 14, marginBottom: 20 }}>
          {bars.map((bar) => {
            const pct = Math.max(4, Math.min(100, (bar.value / maxVal) * 100));
            return (
              <View key={bar.label}>
                <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.textSub }} numberOfLines={1}>{bar.label}</Text>
                  <Text style={{ fontSize: 17, fontWeight: "900", color: colors.text, fontVariant: ["tabular-nums"] }} numberOfLines={1}>
                    {fmtPrice(bar.value)}
                  </Text>
                </View>
                <View style={{ height: 12, borderRadius: 6, backgroundColor: "rgba(127,127,127,0.14)", overflow: "hidden" }}>
                  <LinearGradient
                    colors={[`${bar.color}99`, bar.color]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={{ height: "100%", width: `${pct}%`, borderRadius: 6 }}
                  />
                </View>
              </View>
            );
          })}
        </View>

        {/* Scenario switch — segmented, the active one filled with its color */}
        <View style={{ flexDirection: "row", gap: 6, padding: 5, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.22)" }}>
          {(["bear", "base", "bull"] as ScenarioKey[]).map((key) => {
            const active = scenario === key;
            const sc = SCENARIO_COLOR[key];
            return (
              <TouchableOpacity key={key} onPress={() => setScenario(key)} activeOpacity={0.85} style={{ flex: 1, borderRadius: 14, overflow: "hidden" }}>
                <LinearGradient
                  colors={active ? [sc, `${sc}b3`] : ["transparent", "transparent"]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{ paddingVertical: 11, alignItems: "center" }}
                >
                  <Text style={{ fontSize: 10, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase", color: active ? "#0A0F1A" : sc }}>
                    {t(`companyDiagnostic.hero.scenario.${key}`)}
                  </Text>
                  <Text style={{ fontSize: 15, fontWeight: "900", color: active ? "#0A0F1A" : colors.text, marginTop: 3, fontVariant: ["tabular-nums"] }} numberOfLines={1} adjustsFontSizeToFit>
                    {fmtPrice(scenarioValue[key])}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={{ fontSize: 11, textAlign: "center", color: colors.textMuted, marginTop: 10 }}>
          {t("companyDiagnostic.hero.scenarioHint")}
        </Text>
      </GlowCard>

      {/* ── 2. Nuvos score — big gradient ring ── */}
      <GlowCard colors={colors} tint={_GOLD}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
          <View>
            <View style={{ position: "absolute", top: 10, left: 10, right: 10, bottom: 10, borderRadius: 60, backgroundColor: `${_GOLD}22` }} />
            <RingGauge score={data.score} size={116} stroke={11} track="rgba(127,127,127,0.18)">
              <Text style={{ fontSize: 36, lineHeight: 40, fontWeight: "900", color: colors.text, fontVariant: ["tabular-nums"] }}>{data.score}</Text>
              <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textMuted, marginTop: -2 }}>/100</Text>
            </RingGauge>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
            <Text style={{ fontSize: 15, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.6, lineHeight: 20, color: _GOLD }} numberOfLines={3}>
              {data.scoreLabel}
            </Text>
            {data.badges.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {data.badges.map((b) => (
                  <View key={b} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: `${_GOLD}1f`, borderWidth: 1, borderColor: `${_GOLD}55` }}>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: _GOLD }}>{b}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Diego, 2026-09-07 — mirrors web: shown ONLY when real quality
            >=70 AND today's verdict is overvalued — never a generic
            disclaimer on every card. */}
        {status?.verdict === "overvalued" && data.pillarScores.quality >= 70 && (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 16, padding: 14, marginTop: 18, backgroundColor: "rgba(0,0,0,0.18)" }}>
            <Ionicons name="shield-checkmark" size={17} color={_GOLD} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.textSub }}>
              {t("companyDiagnostic.hero.qualityOvervaluedNote", { ticker: data.ticker, score: data.pillarScores.quality })}
            </Text>
          </View>
        )}
      </GlowCard>

      {/* ── 3. Why this number ── */}
      <GlowCard colors={colors}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: `${_GOLD}1f` }}>
            <Ionicons name="bulb" size={19} color={_GOLD} />
          </View>
          <Text style={{ flex: 1, fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.2 }}>
            {t("companyDiagnostic.hero.whyTitle")}
          </Text>
        </View>
        <Text style={{ fontSize: 13.5, lineHeight: 20, color: colors.textSub }}>
          {t(
            data.valuation.shadowDualTrack?.applicable ? "companyDiagnostic.hero.whySummary" : "companyDiagnostic.hero.whySummarySingleTrack",
            { classification: classificationLabel },
          )}
        </Text>
        <TouchableOpacity
          onPress={() => setWhyOpen((v) => !v)}
          activeOpacity={0.8}
          style={{ marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 14, borderWidth: 1, borderColor: `${_GOLD}55`, backgroundColor: `${_GOLD}12` }}
        >
          <Text style={{ fontSize: 13, fontWeight: "800", color: _GOLD }}>
            {whyOpen ? t("companyDiagnostic.hero.whyHide") : t("companyDiagnostic.hero.whyShow")}
          </Text>
          <Ionicons name={whyOpen ? "chevron-up" : "chevron-down"} size={14} color={_GOLD} />
        </TouchableOpacity>
        {whyOpen && (
          <View style={{ marginTop: 14, gap: 14 }}>
            {data.valuation.waccDetails?.wacc_pct != null && (
              <Text style={{ fontSize: 13, color: colors.textSub }}>
                {t("companyDiagnostic.modelAssumptions.wacc")}:{" "}
                <Text style={{ fontWeight: "900", color: colors.text }}>{data.valuation.waccDetails.wacc_pct.toFixed(1)}%</Text>
              </Text>
            )}
            {fairPeBreakdown?.base_multiple != null && (
              <MobilePEWaterfall breakdown={fairPeBreakdown} colors={colors} t={t} />
            )}
            {data.valuation.shadowDualTrack?.applicable && (
              <MobileShadowBlend shadowDualTrack={data.valuation.shadowDualTrack} colors={colors} t={t} />
            )}
          </View>
        )}
      </GlowCard>
    </View>
  );
}

// Same "blend2" layout as the Artifact — Por ganancias + Por flujo de
// caja = Combinado — embedded inside the "por qué" card's expand body,
// same spot as the Artifact, per Diego's explicit request (2026-09-03).
function MobileShadowBlend({
  shadowDualTrack, colors, t,
}: {
  shadowDualTrack: Extract<NonNullable<CompanyDiagnosticData["valuation"]["shadowDualTrack"]>, { applicable: true }>;
  colors: any;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  return (
    <View style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text style={{ fontSize: 9.5, fontWeight: "900", textTransform: "uppercase", color: colors.textMuted, marginBottom: 6 }}>
        {t("companyDiagnostic.shadowDualTrack.title")}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <View style={{ flex: 1, minWidth: 90, borderRadius: 10, padding: 8, backgroundColor: colors.bgRaised }}>
          <Text style={{ fontSize: 9, fontWeight: "800", color: colors.textMuted }}>
            {t("companyDiagnostic.shadowDualTrack.earningsTrack")}
            {shadowDualTrack.earningsTrackWeightPct != null ? ` ${t("companyDiagnostic.shadowDualTrack.weight", { pct: shadowDualTrack.earningsTrackWeightPct })}` : ""}
          </Text>
          <Text style={{ fontSize: 14, fontWeight: "900", color: "#4FA695" }}>{fmtPrice(shadowDualTrack.earningsTrackValue)}</Text>
        </View>
        <Text style={{ fontSize: 15, fontWeight: "800", color: colors.textDim }}>+</Text>
        <View style={{ flex: 1, minWidth: 90, borderRadius: 10, padding: 8, backgroundColor: colors.bgRaised }}>
          <Text style={{ fontSize: 9, fontWeight: "800", color: colors.textMuted }}>
            {t("companyDiagnostic.shadowDualTrack.fcfTrack")}
            {shadowDualTrack.fcfTrackWeightPct != null ? ` ${t("companyDiagnostic.shadowDualTrack.weight", { pct: shadowDualTrack.fcfTrackWeightPct })}` : ""}
          </Text>
          <Text style={{ fontSize: 14, fontWeight: "900", color: _GOLD }}>
            {shadowDualTrack.fcfTrackValue != null ? fmtPrice(shadowDualTrack.fcfTrackValue) : "—"}
          </Text>
        </View>
        <Text style={{ fontSize: 15, fontWeight: "800", color: colors.textDim }}>=</Text>
        <View style={{ borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, alignItems: "center", backgroundColor: `${_GOLD}24`, borderWidth: 1.5, borderColor: _GOLD }}>
          <Text style={{ fontSize: 8.5, fontWeight: "900", textTransform: "uppercase", color: _GOLD }}>
            {t("companyDiagnostic.shadowDualTrack.blended")}
          </Text>
          <Text style={{ fontSize: 15.5, fontWeight: "900", color: _GOLD }}>{fmtPrice(shadowDualTrack.blendedFairValue)}</Text>
        </View>
      </View>
      <Text style={{ fontSize: 9.5, lineHeight: 13, color: colors.textDim, marginTop: 6 }}>
        {t("companyDiagnostic.shadowDualTrack.subtitle")}
      </Text>
    </View>
  );
}

// Inline (no separate file) since mobile has no ValuationTabs screen to
// house this in yet — see the module docstring above.
function MobilePEWaterfall({
  breakdown, colors, t,
}: {
  breakdown: NonNullable<CompanyDiagnosticData["valuation"]["fairPeBreakdown"]>;
  colors: any;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  const base = breakdown.base_multiple;
  if (base == null) return null;
  const segments: { value: number; kind: "base" | "pos" | "neg"; reason: string }[] = [
    { value: base, kind: "base", reason: `${base.toFixed(1)}x` },
    ...breakdown.adjustments.map((adj) => ({
      value: adj.points, kind: (adj.points >= 0 ? ("pos" as const) : ("neg" as const)), reason: adj.reason,
    })),
  ];
  const totalSpan = segments.reduce((sum, s) => sum + Math.abs(s.value), 0) || 1;

  return (
    <View>
      <View style={{ flexDirection: "row", height: 26, borderRadius: 7, overflow: "hidden", backgroundColor: colors.bgRaised }}>
        {segments.map((s, i) => (
          <View
            key={i}
            style={{
              width: `${(Math.abs(s.value) / totalSpan) * 100}%`,
              backgroundColor: s.kind === "base" ? colors.textMuted : s.kind === "pos" ? "#4FA695" : "#DD6E63",
              borderRightWidth: i < segments.length - 1 ? 1.5 : 0,
              borderRightColor: colors.bgRaised,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Text style={{ fontSize: 9, fontWeight: "800", color: colors.textDim }}>{base.toFixed(1)}x {t("companyDiagnostic.fairPeBreakdown.baseLabel")}</Text>
        <Text style={{ fontSize: 9, fontWeight: "800", color: colors.textDim }}>{t("companyDiagnostic.fairPeBreakdown.adjustmentsLabel")}</Text>
      </View>
      <Text style={{ fontSize: 14, fontWeight: "900", color: "#4FA695", textAlign: "right", marginTop: 4 }}>
        {breakdown.fair_pe.toFixed(1)}x
      </Text>
    </View>
  );
}
