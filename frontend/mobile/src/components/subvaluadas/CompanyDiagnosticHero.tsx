import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
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
  const wallStreet = data.valuation.analystTarget?.target_mean ?? null;

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
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
            <Text style={{ fontSize: 23, fontWeight: "900", color: colors.text }}>{data.ticker}</Text>
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSub, flexShrink: 1 }} numberOfLines={1}>{data.companyName}</Text>
          </View>
          <Text style={{ fontSize: 12.5, marginTop: 3, color: colors.textMuted }} numberOfLines={1}>{data.sector} · {data.exchange}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <Text style={{ fontSize: 34, fontWeight: "900", color: _GOLD }}>{data.score}</Text>
            <Text style={{ fontSize: 14, fontWeight: "800", color: colors.textMuted }}>/100</Text>
          </View>
          <Text style={{ fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", color: _GOLD, marginTop: 3, textAlign: "right" }} numberOfLines={2}>
            {data.scoreLabel}
          </Text>
        </View>
      </View>

      {data.badges.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 15 }}>
          {data.badges.map((b) => (
            <View key={b} style={{ paddingHorizontal: 11, paddingVertical: 7, borderRadius: 11, backgroundColor: `${_GOLD}24`, borderWidth: 1, borderColor: _GOLD }}>
              <Text style={{ fontSize: 12, fontWeight: "800", color: _GOLD }}>{b}</Text>
            </View>
          ))}
        </View>
      )}

      {status && (
        <View style={{ alignItems: "center", marginBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: `${VERDICT_COLOR[status.verdict]}29` }}>
            <Text style={{ fontSize: 14 }}>{VERDICT_EMOJI[status.verdict]}</Text>
            <Text style={{ fontSize: 13, fontWeight: "900", color: VERDICT_COLOR[status.verdict] }} numberOfLines={1} adjustsFontSizeToFit>
              {t(`companyDiagnostic.hero.verdict.${status.verdict}`, { pct: status.pct.toFixed(0) })}
            </Text>
          </View>
        </View>
      )}

      <Text style={{ fontSize: 13.5, lineHeight: 19, textAlign: "center", color: colors.textSub, marginBottom: 3 }}>
        {t("companyDiagnostic.hero.sentence", { price: fmtPrice(currentPrice), ticker: data.ticker, fairValue: fmtPrice(activeValue) })}{" "}
        {status && (
          <Text style={{ fontWeight: "800", color: VERDICT_COLOR[status.verdict] }}>
            {t(`companyDiagnostic.hero.verdict.${status.verdict}`, { pct: status.pct.toFixed(0) })}
          </Text>
        )}.
      </Text>
      <Text style={{ fontSize: 10.5, textAlign: "center", color: colors.textDim, marginBottom: 15 }}>
        {t("companyDiagnostic.hero.disclaimer")}
      </Text>

      <View style={{ gap: 8, marginBottom: 14 }}>
        {bars.map((bar) => {
          const pct = Math.min(100, (bar.value / maxVal) * 100);
          return (
            <View key={bar.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 11, fontWeight: "800", color: bar.color, width: 78 }} numberOfLines={1}>{bar.label}</Text>
              <View style={{ flex: 1, height: 24, borderRadius: 6, backgroundColor: colors.bgRaised, overflow: "hidden" }}>
                <View style={{ height: "100%", width: `${pct}%`, borderRadius: 6, backgroundColor: bar.color }} />
              </View>
              <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, width: 74, textAlign: "right" }} numberOfLines={1} adjustsFontSizeToFit>
                {fmtPrice(bar.value)}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: "row", gap: 7, marginBottom: 5 }}>
        {(["bear", "base", "bull"] as ScenarioKey[]).map((key) => (
          <TouchableOpacity
            key={key}
            onPress={() => setScenario(key)}
            style={{
              flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: "center",
              borderWidth: 1, borderColor: scenario === key ? SCENARIO_COLOR[key] : colors.border,
              backgroundColor: scenario === key ? `${SCENARIO_COLOR[key]}24` : "transparent",
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", color: SCENARIO_COLOR[key] }}>
              {t(`companyDiagnostic.hero.scenario.${key}`)}
            </Text>
            <Text style={{ fontSize: 13.5, fontWeight: "900", color: colors.text, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
              {fmtPrice(scenarioValue[key])}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={{ fontSize: 10, textAlign: "center", color: colors.textDim, marginBottom: 15 }}>
        {t("companyDiagnostic.hero.scenarioHint")}
      </Text>

      <View style={{ borderRadius: 16, padding: 14, backgroundColor: colors.cardElevated ?? colors.bgRaised }}>
        <Text style={{ fontSize: 10.5, fontWeight: "900", textTransform: "uppercase", color: colors.textMuted, marginBottom: 6 }}>
          {t("companyDiagnostic.hero.whyTitle")}
        </Text>
        <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.textSub }}>
          {t(
            data.valuation.shadowDualTrack?.applicable ? "companyDiagnostic.hero.whySummary" : "companyDiagnostic.hero.whySummarySingleTrack",
            { classification: classificationLabel },
          )}
        </Text>
        <TouchableOpacity onPress={() => setWhyOpen((v) => !v)} style={{ marginTop: 10 }}>
          <Text style={{ fontSize: 11, fontWeight: "800", color: _GOLD }}>
            {whyOpen ? t("companyDiagnostic.hero.whyHide") : t("companyDiagnostic.hero.whyShow")}
          </Text>
        </TouchableOpacity>
        {whyOpen && (
          <View style={{ marginTop: 10, gap: 10 }}>
            {data.valuation.waccDetails?.wacc_pct != null && (
              <Text style={{ fontSize: 12, color: colors.textSub }}>
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
