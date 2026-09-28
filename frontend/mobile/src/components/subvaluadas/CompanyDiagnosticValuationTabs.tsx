import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { fmtPrice, SCENARIO_COLOR, scoreColor } from "../../lib/types/companyDiagnostic";
import type { CompanyDiagnosticData } from "../../lib/types/companyDiagnostic";
import { ExplainableValue, RingGauge } from "./companyDiagnosticShared";
import { LinearGradient } from "expo-linear-gradient";
import { CompanyDiagnosticQualityPillar } from "./CompanyDiagnosticQualityPillar";
import { CompanyDiagnosticTrustPillar } from "./CompanyDiagnosticTrustPillar";
import { CompanyDiagnosticValuePillar } from "./CompanyDiagnosticValuePillar";
import { CompanyDiagnosticSimplicityPillar } from "./CompanyDiagnosticSimplicityPillar";
import { CompanyDiagnosticFairValueChart } from "./CompanyDiagnosticFairValueChart";

// Mobile mirror of web's CompanyDiagnosticValuationTabs.tsx — same real
// data/methodology, same tab structure (Valuación/Escenarios/Comparables/
// Historial + the 4 pillars as a second tab row), rebuilt with React
// Native primitives (View/Text/TouchableOpacity/ScrollView instead of
// <table>, ExplainableValue's Modal instead of web's hover popover).

type TabKey = "valuation" | "scenarios" | "comparables" | "history";
type PillarKey = "quality" | "trust" | "value" | "simplicity";

const _GOLD = "#D4A24C";

const _ADJUSTMENT_EXPLANATION_KEY: Record<string, string> = {
  growth: "adjGrowth",
  quality: "adjQuality",
  fcf_margin: "adjFcfMargin",
  leverage: "adjLeverage",
  dividend: "adjDividend",
  moat_management: "adjMoatManagement",
};

function Step({
  n, label, explainer, children, last, colors,
}: { n: number; label: string; explainer?: string; children: React.ReactNode; last?: boolean; colors: any }) {
  return (
    <View style={{ flexDirection: "row", gap: 14 }}>
      <View style={{ alignItems: "center", width: 34 }}>
        <LinearGradient colors={["#F5C76B", _GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 14, fontWeight: "900", color: "#0A0F1A" }}>{n}</Text>
        </LinearGradient>
        {!last && <LinearGradient colors={[`${_GOLD}66`, `${_GOLD}0d`]} style={{ width: 2, flex: 1, marginTop: 6, minHeight: 16, borderRadius: 1 }} />}
      </View>
      <View style={{ flex: 1, paddingBottom: 26 }}>
        <Text style={{ fontSize: 15.5, fontWeight: "900", color: colors.text, marginBottom: 4, marginTop: 6, letterSpacing: -0.2 }}>{label}</Text>
        {explainer && <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.textSub, marginBottom: 12 }}>{explainer}</Text>}
        {children}
      </View>
    </View>
  );
}

function StepCard({ children, colors }: { children: React.ReactNode; colors: any }) {
  return (
    <View style={{ borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: `${_GOLD}33` }}>
      <LinearGradient colors={[`${_GOLD}14`, colors.bgRaised]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 14 }}>
        {children}
      </LinearGradient>
    </View>
  );
}

function ValuationTab({ data, t, colors }: { data: CompanyDiagnosticData; t: (k: string, o?: Record<string, unknown>) => string; colors: any }) {
  const { classification, fairPeBreakdown, scenarioBreakdown, waccDetails, shadowDualTrack } = data.valuation;
  const hasShadowFcf = shadowDualTrack?.applicable && shadowDualTrack.fcfTrackValue != null;

  return (
    <View>
      {classification && (
        <Step n={1} label={t("companyDiagnostic.classification.step")} explainer={t("companyDiagnostic.classification.explainer")} colors={colors}>
          <StepCard colors={colors}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
              <Text style={{ fontSize: 16, fontWeight: "900", color: _GOLD }}>
                {t(`companyDiagnostic.classification.category.${classification.category}`, { defaultValue: classification.category })}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Text style={{ fontSize: 10, fontWeight: "800", color: colors.textMuted }}>{t("companyDiagnostic.classification.confidence")}</Text>
                <View style={{ width: 50, height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" }}>
                  <View style={{ width: `${classification.confidence}%`, height: "100%", backgroundColor: _GOLD }} />
                </View>
                <Text style={{ fontSize: 10, fontWeight: "800", color: colors.text }}>{Math.round(classification.confidence)}/100</Text>
              </View>
            </View>
            <View style={{ borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: colors.card }}>
              <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textSub }}>{classification.reason}</Text>
            </View>
            <View style={{ gap: 6 }}>
              {classification.factors.map((f, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: _GOLD, marginTop: 7 }} />
                  <Text style={{ flex: 1, fontSize: 12, lineHeight: 18, color: colors.textMuted }}>{f}</Text>
                </View>
              ))}
            </View>
          </StepCard>
        </Step>
      )}

      {waccDetails && (
        <Step n={2} label={t("companyDiagnostic.discountRate.step")} explainer={t("companyDiagnostic.discountRate.explainer")} colors={colors}>
          <StepCard colors={colors}>
            {waccDetails.method === "capm" && waccDetails.beta != null ? (
              <>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  {[
                    { key: "beta", label: t("companyDiagnostic.discountRate.beta"), value: waccDetails.beta.toFixed(2) },
                    waccDetails.risk_free_rate_pct != null && { key: "riskFree", label: t("companyDiagnostic.discountRate.riskFree"), value: `${waccDetails.risk_free_rate_pct.toFixed(1)}%` },
                    waccDetails.equity_risk_premium_pct != null && { key: "erp", label: t("companyDiagnostic.discountRate.erp"), value: `${waccDetails.equity_risk_premium_pct.toFixed(1)}%` },
                    waccDetails.cost_of_equity_pct != null && { key: "costOfEquity", label: t("companyDiagnostic.discountRate.costOfEquity"), value: `${waccDetails.cost_of_equity_pct.toFixed(1)}%` },
                    waccDetails.cost_of_debt_pct != null && { key: "costOfDebt", label: t("companyDiagnostic.discountRate.costOfDebt"), value: `${waccDetails.cost_of_debt_pct.toFixed(1)}%` },
                  ].filter(Boolean).map((item: any) => (
                    <View key={item.key} style={{ width: "47%", flexGrow: 1, borderRadius: 12, padding: 10, backgroundColor: colors.card }}>
                      <ExplainableValue label={t(`companyDiagnostic.explanations.${item.key}.title`)} summary={t(`companyDiagnostic.explanations.${item.key}.body`)} colors={colors}>
                        <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }}>{item.label}</Text>
                      </ExplainableValue>
                      <Text style={{ fontSize: 17, fontWeight: "900", color: colors.text, marginTop: 4, fontVariant: ["tabular-nums"] }}>{item.value}</Text>
                    </View>
                  ))}
                </View>
                {waccDetails.equity_weight_pct != null && waccDetails.debt_weight_pct != null && (
                  <>
                    <Text style={{ fontSize: 10, fontWeight: "800", color: colors.textMuted, marginBottom: 4 }}>{t("companyDiagnostic.discountRate.weights")}</Text>
                    <View style={{ flexDirection: "row", height: 7, borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
                      <View style={{ width: `${waccDetails.equity_weight_pct}%`, backgroundColor: _GOLD }} />
                      <View style={{ width: `${waccDetails.debt_weight_pct}%`, backgroundColor: colors.textDim }} />
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
                      <Text style={{ fontSize: 10, fontWeight: "800", color: _GOLD }}>{t("companyDiagnostic.discountRate.equityLabel", { pct: waccDetails.equity_weight_pct.toFixed(0) })}</Text>
                      <Text style={{ fontSize: 10, fontWeight: "800", color: colors.textMuted }}>{t("companyDiagnostic.discountRate.debtLabel", { pct: waccDetails.debt_weight_pct.toFixed(0) })}</Text>
                    </View>
                  </>
                )}
              </>
            ) : (
              <Text style={{ fontSize: 11, color: colors.textDim, marginBottom: 8 }}>{t("companyDiagnostic.discountRate.fallbackNote")}</Text>
            )}
            {waccDetails.wacc_pct != null && (
              <LinearGradient colors={[`${_GOLD}3d`, `${_GOLD}12`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: `${_GOLD}66` }}>
                <Text style={{ fontSize: 10.5, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase", color: colors.textSub }}>{t("companyDiagnostic.discountRate.finalWacc")}</Text>
                <Text style={{ fontSize: 30, fontWeight: "900", color: _GOLD, letterSpacing: -0.5, marginTop: 2 }}>{waccDetails.wacc_pct.toFixed(1)}%</Text>
              </LinearGradient>
            )}
          </StepCard>
        </Step>
      )}

      {fairPeBreakdown && (
        <Step n={3} label={t("companyDiagnostic.fairPeBreakdown.toggle")} explainer={t("companyDiagnostic.fairPeBreakdown.explainer")} colors={colors}>
          <StepCard colors={colors}>
            {fairPeBreakdown.adjustments.map((adj) => {
              const explKey = _ADJUSTMENT_EXPLANATION_KEY[adj.factor];
              const color = adj.points > 0 ? "#4FA695" : adj.points < 0 ? "#DD6E63" : colors.textDim;
              return (
                <View key={adj.factor} style={{ marginBottom: 10 }}>
                  {explKey && (
                    <ExplainableValue label={t(`companyDiagnostic.explanations.${explKey}.title`)} summary={t(`companyDiagnostic.explanations.${explKey}.body`)} colors={colors}>
                      <Text style={{ fontSize: 9.5, fontWeight: "900", textTransform: "uppercase", color }}>{t(`companyDiagnostic.explanations.${explKey}.title`)}</Text>
                    </ExplainableValue>
                  )}
                  <Text style={{ fontSize: 11, lineHeight: 15.5, color: colors.textSub, marginTop: 2 }}>{adj.reason}</Text>
                </View>
              );
            })}
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 2 }}>
              <Text style={{ fontSize: 10.5, color: colors.textDim }}>
                {t("companyDiagnostic.fairPeBreakdown.band")}: {fairPeBreakdown.band[0].toFixed(1)}x–{fairPeBreakdown.band[1].toFixed(1)}x
              </Text>
            </View>
          </StepCard>
        </Step>
      )}

      {fairPeBreakdown && scenarioBreakdown?.base?.eps != null && (
        <Step n={4} label={t("companyDiagnostic.fairPeBreakdown.fairValueFormula")} last={!hasShadowFcf} colors={colors}>
          <StepCard colors={colors}>
            <Text style={{ fontSize: 15, lineHeight: 22, color: colors.text }}>
              EPS <Text style={{ fontWeight: "900" }}>${scenarioBreakdown.base.eps.toFixed(2)}</Text>
              {" × "}{t("companyDiagnostic.fairPeBreakdown.finalPe")} <Text style={{ fontWeight: "900" }}>{fairPeBreakdown.fair_pe.toFixed(1)}x</Text>
              {" = "}
              <Text style={{ color: "#4FA695", fontWeight: "900", fontSize: 18 }}>{fmtPrice(scenarioBreakdown.base.eps * fairPeBreakdown.fair_pe)}</Text>
            </Text>
          </StepCard>
          {hasShadowFcf && (
            <Text style={{ fontSize: 10.5, lineHeight: 15, color: colors.textDim, marginTop: 6 }}>
              {t("companyDiagnostic.fairPeBreakdown.fairValueFormulaNote")}
            </Text>
          )}
        </Step>
      )}

      {hasShadowFcf && shadowDualTrack && shadowDualTrack.applicable && (
        <Step n={5} label={t("companyDiagnostic.shadowDualTrack.title")} last colors={colors}>
          <StepCard colors={colors}>
            <Text style={{ fontSize: 11, lineHeight: 16, color: colors.textSub, marginBottom: 10 }}>{t("companyDiagnostic.shadowDualTrack.subtitle")}</Text>
            <View style={{ borderRadius: 14, paddingVertical: 14, alignItems: "center", backgroundColor: colors.card, marginBottom: 10 }}>
              <Text style={{ fontSize: 10.5, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase", color: colors.textMuted }}>{t("companyDiagnostic.shadowDualTrack.fcfTrack")}</Text>
              <Text style={{ fontSize: 26, fontWeight: "900", color: _GOLD, marginTop: 2 }}>{fmtPrice(shadowDualTrack.fcfTrackValue)}</Text>
            </View>
            {shadowDualTrack.fcfTrackNote && <Text style={{ fontSize: 11, lineHeight: 15.5, color: colors.textDim }}>{shadowDualTrack.fcfTrackNote}</Text>}
          </StepCard>
        </Step>
      )}
    </View>
  );
}

function ScenariosTab({ data, t, colors }: { data: CompanyDiagnosticData; t: (k: string) => string; colors: any }) {
  const sb = data.valuation.scenarioBreakdown;
  if (!sb) return null;
  const rows: { key: "bear" | "base" | "bull"; label: string }[] = [
    { key: "bear", label: t("companyDiagnostic.pillars.value.conservative") },
    { key: "base", label: t("companyDiagnostic.pillars.value.baseFairValue") },
    { key: "bull", label: t("companyDiagnostic.pillars.value.optimistic") },
  ];
  return (
    <View>
      <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textSub, marginBottom: 14 }}>{t("companyDiagnostic.scenariosTab.explainer")}</Text>
      <View style={{ gap: 10 }}>
        {rows.map(({ key, label }) => {
          const s = sb[key];
          const color = SCENARIO_COLOR[key];
          const isBase = key === "base";
          return (
            <View key={key} style={{ borderRadius: 18, overflow: "hidden", borderWidth: isBase ? 1.5 : 1, borderColor: isBase ? `${color}99` : `${color}40` }}>
              <LinearGradient colors={[`${color}${isBase ? "33" : "1a"}`, colors.bgRaised]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ width: 10, height: 36, borderRadius: 5, backgroundColor: color }} />
                  <View>
                    <Text style={{ fontSize: 12, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase", color }}>{label}</Text>
                    <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 3, fontVariant: ["tabular-nums"] }}>EPS ${s.eps?.toFixed(2) ?? "—"} × {s.fair_pe.toFixed(1)}x</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 22, fontWeight: "900", color: colors.text, letterSpacing: -0.5, fontVariant: ["tabular-nums"] }}>{fmtPrice(s.fair_value_per_share ?? 0)}</Text>
              </LinearGradient>
            </View>
          );
        })}
      </View>
      <Text style={{ fontSize: 10.5, lineHeight: 15, color: colors.textDim, marginTop: 10 }}>{t("companyDiagnostic.scenariosTab.noProbabilityNote")}</Text>
    </View>
  );
}

function ComparablesTab({ data, t, colors }: { data: CompanyDiagnosticData; t: (k: string) => string; colors: any }) {
  const { sectorComparison, competitorComparison } = data;
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textSub }}>{t("companyDiagnostic.diagTabs.comparablesExplainer")}</Text>

      {sectorComparison && (
        <View style={{ borderRadius: 18, padding: 16, backgroundColor: colors.bgRaised }}>
          <Text style={{ fontSize: 11.5, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase", color: _GOLD, marginBottom: 10 }}>
            {sectorComparison.sector} · {sectorComparison.peerCount} {t("companyDiagnostic.diagTabs.peers")}
          </Text>
          {sectorComparison.rows.map((r) => (
            <View key={r.metricName} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ flex: 1, fontSize: 13, color: colors.textSub }}>{r.metricName}</Text>
              <Text style={{ fontSize: 13.5, fontWeight: "900", color: colors.text, width: 76, textAlign: "right" }}>{r.companyValue}</Text>
              <Text style={{ fontSize: 13, color: colors.textMuted, width: 76, textAlign: "right" }}>{r.sectorValue}</Text>
            </View>
          ))}
          {sectorComparison.insight && <Text style={{ fontSize: 12.5, lineHeight: 18.5, color: colors.textSub, marginTop: 10 }}>{sectorComparison.insight}</Text>}
        </View>
      )}

      {competitorComparison && (
        <View style={{ borderRadius: 18, padding: 16, backgroundColor: colors.bgRaised }}>
          <Text style={{ fontSize: 11.5, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase", color: _GOLD, marginBottom: 10 }}>
            {data.ticker} vs. {competitorComparison.competitorName}
          </Text>
          {competitorComparison.rows.map((r) => (
            <View key={r.metricName} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ flex: 1, fontSize: 13, color: colors.textSub }}>{r.metricName}</Text>
              <Text style={{ fontSize: 13.5, fontWeight: "900", color: colors.text, width: 76, textAlign: "right" }}>{r.targetCompanyValue}</Text>
              <Text style={{ fontSize: 13, color: colors.textMuted, width: 76, textAlign: "right" }}>{r.competitorValue}</Text>
            </View>
          ))}
          {competitorComparison.conclusion && <Text style={{ fontSize: 12.5, lineHeight: 18.5, color: colors.textSub, marginTop: 10 }}>{competitorComparison.conclusion}</Text>}
        </View>
      )}

      {!sectorComparison && !competitorComparison && (
        <Text style={{ fontSize: 11, color: colors.textDim }}>{t("companyDiagnostic.diagTabs.noComparables")}</Text>
      )}
    </View>
  );
}

const _BUCKET_COLOR: Record<"cheap" | "normal" | "expensive", string> = { cheap: "#4FA695", normal: _GOLD, expensive: "#DD6E63" };

function HistoryTab({ data, t, colors }: { data: CompanyDiagnosticData; t: (k: string, o?: Record<string, unknown>) => string; colors: any }) {
  const ctx = data.valuation.priceHistoryContext;
  if (!ctx) return null;
  const { percentileCheaperThan, daysUsed, todayBucket, buckets } = ctx;
  const bucketOrder: ("cheap" | "normal" | "expensive")[] = ["cheap", "normal", "expensive"];
  const markerPct = Math.min(96, Math.max(4, 100 - percentileCheaperThan));

  return (
    <View>
      <Text style={{ fontSize: 18, lineHeight: 24, fontWeight: "900", color: colors.text, marginBottom: 6, letterSpacing: -0.3 }}>
        {t(`companyDiagnostic.priceHistoryTab.headline.${todayBucket}`, { ticker: data.ticker })}
      </Text>
      <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textSub, marginBottom: 16 }}>
        {t(`companyDiagnostic.priceHistoryTab.subheadline.${todayBucket}`, { pct: Math.round(percentileCheaperThan), days: daysUsed })}
      </Text>

      <View style={{ marginTop: 20, marginBottom: 8 }}>
        <LinearGradient
          colors={[_BUCKET_COLOR.cheap, colors.textDim, _BUCKET_COLOR.expensive]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ height: 12, borderRadius: 6 }}
        />
        <View style={{ position: "absolute", top: -22, left: `${markerPct}%`, transform: [{ translateX: -18 }], alignItems: "center" }}>
          <View style={{ borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: colors.text }}>
            <Text style={{ fontSize: 9, fontWeight: "900", textTransform: "uppercase", color: colors.bg ?? "#0a0f1a" }}>{t("companyDiagnostic.priceHistory.today")}</Text>
          </View>
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 18 }}>
        <Text style={{ fontSize: 10.5, fontWeight: "800", color: _BUCKET_COLOR.cheap }}>{t("companyDiagnostic.priceHistoryTab.bucket.cheap")}</Text>
        <Text style={{ fontSize: 10.5, fontWeight: "800", color: colors.textMuted }}>{t("companyDiagnostic.priceHistoryTab.bucket.normal")}</Text>
        <Text style={{ fontSize: 10.5, fontWeight: "800", color: _BUCKET_COLOR.expensive }}>{t("companyDiagnostic.priceHistoryTab.bucket.expensive")}</Text>
      </View>

      {data.valuation.fairValueChart && (
        <View style={{ marginBottom: 18 }}>
          <CompanyDiagnosticFairValueChart data={data} colors={colors} />
        </View>
      )}

      <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, marginBottom: 8 }}>
        {t("companyDiagnostic.priceHistoryTab.whatHappened")}
      </Text>
      <View style={{ gap: 8 }}>
        {bucketOrder.map((key) => {
          const b = buckets[key];
          const isToday = key === todayBucket;
          return (
            <View
              key={key}
              style={{
                borderRadius: 16, padding: 14,
                backgroundColor: isToday ? `${_BUCKET_COLOR[key]}1f` : colors.bgRaised,
                borderWidth: 1, borderColor: isToday ? `${_BUCKET_COLOR[key]}99` : "transparent",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: _BUCKET_COLOR[key] }}>
                  {t(`companyDiagnostic.priceHistoryTab.bucket.${key}`)}
                </Text>
                {isToday && (
                  <View style={{ borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1.5, backgroundColor: `${_BUCKET_COLOR[key]}22` }}>
                    <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", color: _BUCKET_COLOR[key] }}>{t("companyDiagnostic.priceHistory.today")}</Text>
                  </View>
                )}
              </View>
              {b ? (
                <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textSub, marginTop: 4 }}>
                  {t("companyDiagnostic.priceHistoryTab.timesHigher", { n: b.timesHigherLater, total: b.daysCount })}
                  {" · "}{t("companyDiagnostic.priceHistoryTab.typicalReturn")}:{" "}
                  <Text style={{ fontWeight: "800", color: b.medianReturnPct >= 0 ? "#4FA695" : "#DD6E63" }}>
                    {b.medianReturnPct >= 0 ? "+" : ""}{b.medianReturnPct.toFixed(1)}%
                  </Text>
                </Text>
              ) : (
                <Text style={{ fontSize: 11, color: colors.textDim }}>{t("companyDiagnostic.priceHistoryTab.insufficientData")}</Text>
              )}
            </View>
          );
        })}
      </View>
      <Text style={{ fontSize: 10.5, lineHeight: 15, color: colors.textDim, marginTop: 10 }}>
        {t("companyDiagnostic.priceHistoryTab.disclaimer", { days: daysUsed })}
      </Text>
    </View>
  );
}

export function CompanyDiagnosticValuationTabs({ data, colors }: { data: CompanyDiagnosticData; colors: any }) {
  const { t } = useTranslation();
  const { valuation, sectorComparison, competitorComparison } = data;
  const [tab, setTab] = useState<TabKey | PillarKey>("valuation");

  const hasFairPe = !!valuation.fairPeBreakdown;
  const hasScenarios = !!valuation.scenarioBreakdown;
  const hasComparables = !!sectorComparison || !!competitorComparison;
  const hasHistory = !!valuation.priceHistoryContext;

  const whyTabs: { key: TabKey; label: string; available: boolean }[] = [
    { key: "valuation", label: t("companyDiagnostic.diagTabs.valuation"), available: hasFairPe || !!valuation.classification },
    { key: "scenarios", label: t("companyDiagnostic.diagTabs.scenarios"), available: hasScenarios },
    { key: "comparables", label: t("companyDiagnostic.diagTabs.comparables"), available: hasComparables },
    { key: "history", label: t("companyDiagnostic.diagTabs.history"), available: hasHistory },
  ];
  const pillarTabs: { key: PillarKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "quality", label: t("companyDiagnostic.pillars.quality.title"), icon: "trophy-outline" },
    { key: "trust", label: t("companyDiagnostic.pillars.trust.title"), icon: "shield-outline" },
    { key: "value", label: t("companyDiagnostic.pillars.value.title"), icon: "scale-outline" },
    { key: "simplicity", label: t("companyDiagnostic.pillars.simplicity.title"), icon: "sparkles-outline" },
  ];

  if (!whyTabs.some((tb) => tb.available)) return null;

  const pillarColor: Record<PillarKey, string> = { quality: "#eab308", trust: "#6366F1", value: "#4FA695", simplicity: "#f59e0b" };

  const GroupLabel = ({ children }: { children: string }) => (
    <Text style={{ fontSize: 10.5, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase", color: colors.textMuted, marginBottom: 10 }}>
      {children}
    </Text>
  );

  return (
    <View style={{ marginTop: 16, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
      <LinearGradient colors={["rgba(255,255,255,0.05)", "rgba(255,255,255,0)"]} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 220 }} />
      {/* Group 1 — why this valuation: pill chips (Nuvos Radar redesign, 2026-09-27) */}
      <View style={{ paddingTop: 16, paddingHorizontal: 16 }}>
        <GroupLabel>{t("companyDiagnostic.diagTabs.whyGroupLabel")}</GroupLabel>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {whyTabs.map((tb) => {
          const active = tab === tb.key;
          return (
            <TouchableOpacity
              key={tb.key}
              disabled={!tb.available}
              onPress={() => setTab(tb.key)}
              activeOpacity={0.8}
              style={{ borderRadius: 999, overflow: "hidden", opacity: tb.available ? 1 : 0.4 }}
            >
              <LinearGradient
                colors={active ? ["#F5C76B", _GOLD] : [colors.bgRaised, colors.bgRaised]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ paddingHorizontal: 16, paddingVertical: 10 }}
              >
                <Text style={{ fontSize: 12.5, fontWeight: "800", color: active ? "#0A0F1A" : colors.textSub }}>{tb.label}</Text>
              </LinearGradient>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Group 2 — the 4 pillars as a 2×2 grid, each with its real score */}
      <View style={{ padding: 16, paddingBottom: 16 }}>
        <GroupLabel>{t("companyDiagnostic.diagTabs.pillarsGroupLabel")}</GroupLabel>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {pillarTabs.map((tb) => {
            const active = tab === tb.key;
            const score = data.pillarScores[tb.key];
            const pc = pillarColor[tb.key];
            return (
              <TouchableOpacity
                key={tb.key}
                onPress={() => setTab(tb.key)}
                activeOpacity={0.85}
                style={{ width: "48.5%", flexGrow: 1, borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: active ? `${pc}99` : colors.border }}
              >
                <LinearGradient
                  colors={active ? [`${pc}38`, `${pc}0d`] : [`${pc}12`, colors.bgRaised]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}
                >
                  <RingGauge score={score ?? 0} size={50} stroke={5} from={pc} to={`${pc}aa`} track="rgba(127,127,127,0.18)">
                    <Text style={{ fontSize: 15, fontWeight: "900", color: colors.text, fontVariant: ["tabular-nums"] }}>{score ?? "—"}</Text>
                  </RingGauge>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    {tb.icon && <Ionicons name={tb.icon} size={14} color={pc} />}
                    <Text style={{ fontSize: 13, fontWeight: "800", color: active ? colors.text : colors.textSub }} numberOfLines={2}>{tb.label}</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: colors.border }} />

      <View style={{ padding: 16 }}>
        {tab === "valuation" && <ValuationTab data={data} t={t} colors={colors} />}
        {tab === "scenarios" && <ScenariosTab data={data} t={t} colors={colors} />}
        {tab === "comparables" && <ComparablesTab data={data} t={t} colors={colors} />}
        {tab === "history" && <HistoryTab data={data} t={t} colors={colors} />}
        {tab === "quality" && (
          <CompanyDiagnosticQualityPillar
            score={data.pillarScores.quality}
            revenueBreakdown={data.revenueBreakdown}
            moatPoints={data.moatPoints}
            competitorComparison={data.competitorComparison}
            colors={colors}
          />
        )}
        {tab === "trust" && (
          <CompanyDiagnosticTrustPillar
            score={data.pillarScores.trust}
            financialHealth={data.financialHealth}
            roicAdjustedForBuybacks={data.roicAdjustedForBuybacks}
            colors={colors}
          />
        )}
        {tab === "value" && (
          <CompanyDiagnosticValuePillar
            score={data.pillarScores.value}
            ticker={data.ticker}
            companyName={data.companyName}
            valuation={data.valuation}
            colors={colors}
          />
        )}
        {tab === "simplicity" && (
          <CompanyDiagnosticSimplicityPillar
            score={data.pillarScores.simplicity}
            noiseVsReality={data.noiseVsReality}
            actionPlan={data.actionPlan}
            colors={colors}
          />
        )}
      </View>
    </View>
  );
}
