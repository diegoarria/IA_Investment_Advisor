import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
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

  return (
    <View>
      {/* ── Score — ring gauge + label + badges. Ticker/name/sector are
          no longer repeated here: the company card right above this one
          (app/subvaluadas/index.tsx) already shows them (Nuvos Radar
          redesign, 2026-09-27). ── */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 18 }}>
        <ScoreRing score={data.score} colors={colors} />
        <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.6, color: _GOLD }} numberOfLines={2}>
            {data.scoreLabel}
          </Text>
          {data.badges.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {data.badges.map((b) => (
                <View key={b} style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: `${_GOLD}1f`, borderWidth: 1, borderColor: `${_GOLD}59` }}>
                  <Text style={{ fontSize: 11, fontWeight: "800", color: _GOLD }}>{b}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 18 }} />

      {/* ── Verdict ── */}
      {status && (
        <View style={{ alignItems: "center", marginBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: `${VERDICT_COLOR[status.verdict]}1f`, borderWidth: 1, borderColor: `${VERDICT_COLOR[status.verdict]}4d` }}>
            <Text style={{ fontSize: 13 }}>{VERDICT_EMOJI[status.verdict]}</Text>
            <Text style={{ fontSize: 14, fontWeight: "900", color: VERDICT_COLOR[status.verdict] }} numberOfLines={1} adjustsFontSizeToFit>
              {t(`companyDiagnostic.hero.verdict.${status.verdict}`, { pct: status.pct.toFixed(0) })}
            </Text>
          </View>
        </View>
      )}

      <Text style={{ fontSize: 14, lineHeight: 21, textAlign: "center", color: colors.textSub, marginBottom: 6, paddingHorizontal: 4 }}>
        {t("companyDiagnostic.hero.sentence", { price: fmtPrice(currentPrice), ticker: data.ticker, fairValue: fmtPrice(activeValue) })}{" "}
        {status && (
          <Text style={{ fontWeight: "800", color: VERDICT_COLOR[status.verdict] }}>
            {t(`companyDiagnostic.hero.verdict.${status.verdict}`, { pct: status.pct.toFixed(0) })}
          </Text>
        )}.
      </Text>
      <Text style={{ fontSize: 10.5, textAlign: "center", color: colors.textDim, marginBottom: 18 }}>
        {t("companyDiagnostic.hero.disclaimer")}
      </Text>

      {/* Diego, 2026-09-07 — mirrors web: a real, narrowly-scoped guard
          against "overvalued reads as bad company" for a genuinely high-
          quality business. Shown ONLY when real quality >=70 AND today's
          verdict is overvalued — never a generic disclaimer on every
          card. */}
      {status?.verdict === "overvalued" && data.pillarScores.quality >= 70 && (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 18, backgroundColor: `${_GOLD}14`, borderWidth: 1, borderColor: `${_GOLD}4d` }}>
          <Ionicons name="shield-outline" size={16} color={_GOLD} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.textSub }}>
            {t("companyDiagnostic.hero.qualityOvervaluedNote", { ticker: data.ticker, score: data.pillarScores.quality })}
          </Text>
        </View>
      )}

      {/* ── Comparison bars — label + value on one line, bar under it ── */}
      <View style={{ gap: 14, marginBottom: 18 }}>
        {bars.map((bar) => {
          const pct = Math.min(100, (bar.value / maxVal) * 100);
          return (
            <View key={bar.label}>
              <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: bar.color }} />
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.textSub }} numberOfLines={1}>{bar.label}</Text>
                </View>
                <Text style={{ fontSize: 15, fontWeight: "900", color: colors.text, fontVariant: ["tabular-nums"] }} numberOfLines={1}>
                  {fmtPrice(bar.value)}
                </Text>
              </View>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.bgRaised, overflow: "hidden" }}>
                <View style={{ height: "100%", width: `${pct}%`, borderRadius: 5, backgroundColor: bar.color }} />
              </View>
            </View>
          );
        })}
      </View>

      {/* ── Scenario — one segmented control ── */}
      <View style={{ flexDirection: "row", gap: 4, padding: 4, borderRadius: 16, backgroundColor: colors.bgRaised, marginBottom: 8 }}>
        {(["bear", "base", "bull"] as ScenarioKey[]).map((key) => {
          const active = scenario === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setScenario(key)}
              activeOpacity={0.8}
              style={{
                flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: "center",
                backgroundColor: active ? colors.card : "transparent",
                borderWidth: 1, borderColor: active ? `${SCENARIO_COLOR[key]}80` : "transparent",
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase", color: active ? SCENARIO_COLOR[key] : colors.textMuted }}>
                {t(`companyDiagnostic.hero.scenario.${key}`)}
              </Text>
              <Text style={{ fontSize: 14.5, fontWeight: "900", color: active ? colors.text : colors.textSub, marginTop: 3, fontVariant: ["tabular-nums"] }} numberOfLines={1} adjustsFontSizeToFit>
                {fmtPrice(scenarioValue[key])}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={{ fontSize: 10.5, textAlign: "center", color: colors.textDim, marginBottom: 18 }}>
        {t("companyDiagnostic.hero.scenarioHint")}
      </Text>

      {/* ── Why this value ── */}
      <View style={{ borderRadius: 16, padding: 16, backgroundColor: colors.bgRaised }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Ionicons name="help-circle-outline" size={16} color={_GOLD} />
          <Text style={{ fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase", color: colors.textMuted }}>
            {t("companyDiagnostic.hero.whyTitle")}
          </Text>
        </View>
        <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textSub }}>
          {t(
            data.valuation.shadowDualTrack?.applicable ? "companyDiagnostic.hero.whySummary" : "companyDiagnostic.hero.whySummarySingleTrack",
            { classification: classificationLabel },
          )}
        </Text>
        <TouchableOpacity onPress={() => setWhyOpen((v) => !v)} style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: "800", color: _GOLD }}>
            {whyOpen ? t("companyDiagnostic.hero.whyHide") : t("companyDiagnostic.hero.whyShow")}
          </Text>
          <Ionicons name={whyOpen ? "chevron-up" : "chevron-down"} size={13} color={_GOLD} />
        </TouchableOpacity>
        {whyOpen && (
          <View style={{ marginTop: 12, gap: 12 }}>
            {data.valuation.waccDetails?.wacc_pct != null && (
              <Text style={{ fontSize: 12.5, color: colors.textSub }}>
                {t("companyDiagnostic.modelAssumptions.wacc")}:{" "}
                <Text style={{ fontWeight: "800", color: colors.text }}>{data.valuation.waccDetails.wacc_pct.toFixed(1)}%</Text>
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
      </View>
    </View>
  );
}

// Circular score gauge (0-100). The number and its /100 are the same
// values the old plain-text header showed.
function ScoreRing({ score, colors }: { score: number; colors: any }) {
  const size = 84;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.bgRaised} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={_GOLD} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={{ flexDirection: "row", alignItems: "baseline" }}>
        <Text style={{ fontSize: 28, fontWeight: "900", color: colors.text, fontVariant: ["tabular-nums"] }}>{score}</Text>
        <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textMuted }}>/100</Text>
      </View>
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
