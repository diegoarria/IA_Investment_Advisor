import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { fmtPrice, SCENARIO_COLOR } from "../../lib/types/companyDiagnostic";
import type { CompanyDiagnosticData } from "../../lib/types/companyDiagnostic";
import { ExplainableValue } from "./companyDiagnosticShared";
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
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ alignItems: "center", width: 30 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: `${_GOLD}2e`, borderWidth: 2, borderColor: _GOLD }}>
          <Text style={{ fontSize: 12, fontWeight: "900", color: _GOLD }}>{n}</Text>
        </View>
        {!last && <View style={{ width: 2, flex: 1, marginTop: 6, backgroundColor: colors.border, minHeight: 16 }} />}
      </View>
      <View style={{ flex: 1, paddingBottom: 22 }}>
        <Text style={{ fontSize: 13.5, fontWeight: "900", color: colors.text, marginBottom: 3 }}>{label}</Text>
        {explainer && <Text style={{ fontSize: 11.5, lineHeight: 16.5, color: colors.textSub, marginBottom: 10 }}>{explainer}</Text>}
        {children}
      </View>
    </View>
  );
}

function StepCard({ children, colors }: { children: React.ReactNode; colors: any }) {
  return (
    <View style={{ borderRadius: 12, padding: 12, backgroundColor: "rgba(255,255,255,0.035)", borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: _GOLD }}>
      {children}
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
              <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text }}>
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
            <View style={{ borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, marginBottom: 8, backgroundColor: colors.bgRaised, borderLeftWidth: 3, borderLeftColor: _GOLD }}>
              <Text style={{ fontSize: 11.5, lineHeight: 16.5, color: colors.textSub }}>{classification.reason}</Text>
            </View>
            {classification.factors.map((f, i) => (
              <Text key={i} style={{ fontSize: 10.5, lineHeight: 15, color: colors.textDim }}>• {f}</Text>
            ))}
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
                    <View key={item.key} style={{ width: "47%", borderRadius: 8, padding: 8, backgroundColor: colors.card }}>
                      <ExplainableValue label={t(`companyDiagnostic.explanations.${item.key}.title`)} summary={t(`companyDiagnostic.explanations.${item.key}.body`)} colors={colors}>
                        <Text style={{ fontSize: 9, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }}>{item.label}</Text>
                      </ExplainableValue>
                      <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, marginTop: 2 }}>{item.value}</Text>
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
              <View style={{ borderRadius: 10, paddingVertical: 12, alignItems: "center", backgroundColor: `${_GOLD}14`, borderWidth: 1, borderColor: `${_GOLD}40` }}>
                <Text style={{ fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }}>{t("companyDiagnostic.discountRate.finalWacc")}</Text>
                <Text style={{ fontSize: 20, fontWeight: "900", color: _GOLD }}>{waccDetails.wacc_pct.toFixed(1)}%</Text>
              </View>
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
            <Text style={{ fontSize: 13, color: colors.text }}>
              EPS <Text style={{ fontWeight: "900" }}>${scenarioBreakdown.base.eps.toFixed(2)}</Text>
              {" × "}{t("companyDiagnostic.fairPeBreakdown.finalPe")} <Text style={{ fontWeight: "900" }}>{fairPeBreakdown.fair_pe.toFixed(1)}x</Text>
              {" = "}
              <Text style={{ color: "#4FA695", fontWeight: "900" }}>{fmtPrice(scenarioBreakdown.base.eps * fairPeBreakdown.fair_pe)}</Text>
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
            <View style={{ borderRadius: 10, paddingVertical: 12, alignItems: "center", backgroundColor: colors.bgRaised, marginBottom: 8 }}>
              <Text style={{ fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }}>{t("companyDiagnostic.shadowDualTrack.fcfTrack")}</Text>
              <Text style={{ fontSize: 20, fontWeight: "900", color: _GOLD }}>{fmtPrice(shadowDualTrack.fcfTrackValue)}</Text>
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
      <Text style={{ fontSize: 11.5, lineHeight: 16.5, color: colors.textSub, marginBottom: 12 }}>{t("companyDiagnostic.scenariosTab.explainer")}</Text>
      <View style={{ gap: 10 }}>
        {rows.map(({ key, label }) => {
          const s = sb[key];
          const color = SCENARIO_COLOR[key];
          const isBase = key === "base";
          return (
            <View
              key={key}
              style={{
                borderRadius: 10, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                backgroundColor: isBase ? `${color}1a` : "rgba(255,255,255,0.035)",
                borderWidth: 1, borderColor: isBase ? `${color}70` : colors.border, borderLeftWidth: 3, borderLeftColor: color,
              }}
            >
              <View>
                <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color }}>{label}</Text>
                <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>EPS ${s.eps?.toFixed(2) ?? "—"} × {s.fair_pe.toFixed(1)}x</Text>
              </View>
              <Text style={{ fontSize: 17, fontWeight: "900", color: colors.text }}>{fmtPrice(s.fair_value_per_share ?? 0)}</Text>
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
      <Text style={{ fontSize: 11.5, lineHeight: 16.5, color: colors.textSub }}>{t("companyDiagnostic.diagTabs.comparablesExplainer")}</Text>

      {sectorComparison && (
        <View style={{ borderRadius: 10, padding: 12, backgroundColor: "rgba(255,255,255,0.035)", borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, marginBottom: 8 }}>
            {sectorComparison.sector} · {sectorComparison.peerCount} {t("companyDiagnostic.diagTabs.peers")}
          </Text>
          {sectorComparison.rows.map((r) => (
            <View key={r.metricName} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ flex: 1, fontSize: 11, color: colors.textSub }}>{r.metricName}</Text>
              <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text, width: 70, textAlign: "right" }}>{r.companyValue}</Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, width: 70, textAlign: "right" }}>{r.sectorValue}</Text>
            </View>
          ))}
          {sectorComparison.insight && <Text style={{ fontSize: 11, lineHeight: 16, color: colors.textSub, marginTop: 8 }}>{sectorComparison.insight}</Text>}
        </View>
      )}

      {competitorComparison && (
        <View style={{ borderRadius: 10, padding: 12, backgroundColor: "rgba(255,255,255,0.035)", borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, marginBottom: 8 }}>
            {data.ticker} vs. {competitorComparison.competitorName}
          </Text>
          {competitorComparison.rows.map((r) => (
            <View key={r.metricName} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ flex: 1, fontSize: 11, color: colors.textSub }}>{r.metricName}</Text>
              <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text, width: 70, textAlign: "right" }}>{r.targetCompanyValue}</Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, width: 70, textAlign: "right" }}>{r.competitorValue}</Text>
            </View>
          ))}
          {competitorComparison.conclusion && <Text style={{ fontSize: 11, lineHeight: 16, color: colors.textSub, marginTop: 8 }}>{competitorComparison.conclusion}</Text>}
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
      <Text style={{ fontSize: 14, fontWeight: "900", color: colors.text, marginBottom: 4 }}>
        {t(`companyDiagnostic.priceHistoryTab.headline.${todayBucket}`, { ticker: data.ticker })}
      </Text>
      <Text style={{ fontSize: 11.5, lineHeight: 16.5, color: colors.textSub, marginBottom: 16 }}>
        {t(`companyDiagnostic.priceHistoryTab.subheadline.${todayBucket}`, { pct: Math.round(percentileCheaperThan), days: daysUsed })}
      </Text>

      <View style={{ marginTop: 20, marginBottom: 8 }}>
        <View style={{ height: 7, borderRadius: 4, flexDirection: "row", overflow: "hidden" }}>
          <View style={{ flex: 1, backgroundColor: _BUCKET_COLOR.cheap }} />
          <View style={{ flex: 1, backgroundColor: colors.textDim }} />
          <View style={{ flex: 1, backgroundColor: _BUCKET_COLOR.expensive }} />
        </View>
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
                borderRadius: 10, padding: 11,
                backgroundColor: isToday ? `${_BUCKET_COLOR[key]}1a` : "rgba(255,255,255,0.035)",
                borderWidth: 1, borderColor: isToday ? _BUCKET_COLOR[key] : colors.border,
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
                <Text style={{ fontSize: 11.5, color: colors.textSub }}>
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

  function TabStrip<K extends TabKey | PillarKey>({ items }: { items: { key: K; label: string; available?: boolean; icon?: keyof typeof Ionicons.glyphMap }[] }) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: colors.bgRaised }} contentContainerStyle={{ padding: 4, gap: 4 }}>
        {items.map((tb) => {
          const isAvailable = tb.available ?? true;
          const active = tab === tb.key;
          return (
            <TouchableOpacity
              key={tb.key}
              disabled={!isAvailable}
              onPress={() => setTab(tb.key)}
              style={{
                flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                backgroundColor: active ? `${_GOLD}22` : "transparent",
                borderWidth: 1, borderColor: active ? `${_GOLD}66` : "transparent",
                opacity: isAvailable ? 1 : 0.4,
              }}
            >
              {tb.icon && <Ionicons name={tb.icon} size={12} color={!isAvailable ? colors.textDim : active ? _GOLD : colors.textMuted} />}
              <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: !isAvailable ? colors.textDim : active ? _GOLD : colors.textMuted }}>
                {tb.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <View style={{ marginTop: 16, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4, backgroundColor: colors.bgRaised }}>
        {t("companyDiagnostic.diagTabs.whyGroupLabel")}
      </Text>
      <TabStrip items={whyTabs} />
      <Text style={{ fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4, backgroundColor: colors.bgRaised }}>
        {t("companyDiagnostic.diagTabs.pillarsGroupLabel")}
      </Text>
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TabStrip items={pillarTabs} />
      </View>

      <View style={{ padding: 14, backgroundColor: colors.card }}>
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
