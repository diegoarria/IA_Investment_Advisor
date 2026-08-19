import React, { useState, type ReactNode } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ExplainableValue } from "./companyDiagnosticShared";
import { CompanyDiagnosticValuationThermometer } from "./CompanyDiagnosticValuationThermometer";
import { CompanyDiagnosticQualityPillar } from "./CompanyDiagnosticQualityPillar";
import { CompanyDiagnosticTrustPillar } from "./CompanyDiagnosticTrustPillar";
import { CompanyDiagnosticValuePillar } from "./CompanyDiagnosticValuePillar";
import { CompanyDiagnosticSimplicityPillar } from "./CompanyDiagnosticSimplicityPillar";
import { SelfCheckQuiz } from "./SelfCheckQuiz";
import { CompanyDiagnosticBacktestPanel } from "./CompanyDiagnosticBacktestPanel";
import { scoreColor, valuationStatus, VERDICT_COLOR, VERDICT_EMOJI, fmtPrice } from "../../lib/types/companyDiagnostic";
import type { CompanyDiagnosticData } from "../../lib/types/companyDiagnostic";

// Mobile mirror of web's CompanyDiagnosticCard.tsx — hero + 4 collapsible
// pillars, Tesis Final, guía de metodología, Self-Check y disclaimer legal.
// The caller (app/subvaluadas/index.tsx) renders "Actualizado hoy / Seguir
// / Analizar con Arthur" right after this, same as web's page.tsx does.

const NUMBER_PATTERN = /\$\d[\d.,]*(?:\s?(?:mil millones|millones|mil|MM|bn|B|M|K))?|\d[\d.,]*%/gi;

function renderWithBoldNumbers(text: string, colors: any): ReactNode {
  const parts = text.split(NUMBER_PATTERN);
  const matches = text.match(NUMBER_PATTERN) || [];
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part) out.push(<Text key={`t${i}`}>{part}</Text>);
    if (matches[i]) out.push(<Text key={`n${i}`} style={{ fontWeight: "800", color: colors.text }}>{matches[i]}</Text>);
  });
  return out;
}

function DiagSectionHeader({ title, subtitle, icon, colors }: { title: string; subtitle?: string; icon: ReactNode; colors: any }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 15, fontWeight: "800", color: colors.text }} numberOfLines={1}>{title}</Text>
        {subtitle && <Text style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 2 }} numberOfLines={2}>{subtitle}</Text>}
      </View>
      {icon}
    </View>
  );
}

export function CompanyDiagnosticCard({ data, colors }: { data: CompanyDiagnosticData; colors: any }) {
  const { t } = useTranslation();
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const methodologyParagraphs = t("companyDiagnostic.methodology.paragraphs", { returnObjects: true }) as string[];
  const verdictStatus = valuationStatus(data.valuation.baseFairValue, data.valuation.currentPrice);

  return (
    <View>
      {/* Capa 1 — Hero */}
      <View style={{ borderRadius: 18, padding: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
              <Text style={{ fontSize: 23, fontWeight: "900", color: colors.text }}>{data.ticker}</Text>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSub, flexShrink: 1 }} numberOfLines={1}>{data.companyName}</Text>
            </View>
            <Text style={{ fontSize: 12.5, marginTop: 3, color: colors.textMuted }} numberOfLines={1}>{data.sector} · {data.exchange}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <ExplainableValue
              label={t("companyDiagnostic.explanations.scoreOverall.title")}
              summary={t("companyDiagnostic.explanations.scoreOverall.body")}
              colors={colors}
            >
              <Text style={{ fontSize: 34, fontWeight: "900", color: scoreColor(data.score) }}>{data.score}</Text>
              <Text style={{ fontSize: 14, fontWeight: "800", color: colors.textMuted }}>/100</Text>
            </ExplainableValue>
            <Text style={{ fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", color: scoreColor(data.score), marginTop: 3, textAlign: "right" }} numberOfLines={2}>
              {data.scoreLabel}
            </Text>
          </View>
        </View>

        <Text style={{ fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, marginBottom: 7 }}>
          {t("companyDiagnostic.badgesTitle")}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 15 }}>
          {data.badges.map((b) => (
            <View key={b} style={{ paddingHorizontal: 11, paddingVertical: 7, borderRadius: 11, backgroundColor: "#6366F11f", borderWidth: 1, borderColor: "#6366F1" }}>
              <Text style={{ fontSize: 12, fontWeight: "800", color: "#6366F1" }}>{b}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: "row", gap: 8, marginBottom: 15 }}>
          <View style={{ flex: 1, borderRadius: 12, padding: 11, backgroundColor: colors.bgRaised }}>
            <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }} numberOfLines={1}>{t("companyDiagnostic.kpi.currentPrice")}</Text>
            <Text style={{ fontSize: 19, fontWeight: "900", color: colors.text, marginTop: 3 }} numberOfLines={1} adjustsFontSizeToFit>{fmtPrice(data.valuation.currentPrice)}</Text>
          </View>
          <View style={{ flex: 1, borderRadius: 12, padding: 11, backgroundColor: colors.bgRaised }}>
            <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }} numberOfLines={1}>{t("companyDiagnostic.kpi.fairValue")}</Text>
            <Text style={{ fontSize: 19, fontWeight: "900", color: "#4FA695", marginTop: 3 }} numberOfLines={1} adjustsFontSizeToFit>{fmtPrice(data.valuation.baseFairValue)}</Text>
          </View>
        </View>

        <View style={{ borderRadius: 12, padding: 12, marginBottom: 15, backgroundColor: colors.bgRaised, borderLeftWidth: 3, borderLeftColor: colors.accent }}>
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.text, fontStyle: "italic" }}>&ldquo;{data.oneLinerPitch}&rdquo;</Text>
        </View>

        {verdictStatus && (
          <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 9, marginBottom: 11 }}>
            <Text style={{ fontSize: 19, fontWeight: "900", color: VERDICT_COLOR[verdictStatus.verdict], textAlign: "center" }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {VERDICT_EMOJI[verdictStatus.verdict]}{" "}
              {verdictStatus.verdict === "undervalued"
                ? t("companyDiagnostic.thermometer.undervalued")
                : verdictStatus.verdict === "overvalued"
                  ? t("companyDiagnostic.thermometer.overvalued")
                  : t("companyDiagnostic.thermometer.fair")}
              {" "}({verdictStatus.pct.toFixed(1)}%)
            </Text>
          </View>
        )}

        <CompanyDiagnosticValuationThermometer scenarios={data.valuation} colors={colors} />

        {(data.valuation.fcfAssumptions || data.valuation.waccDetails) && (
          <View style={{ marginTop: 8 }}>
            <TouchableOpacity onPress={() => setAssumptionsOpen((o) => !o)}>
              <Text style={{ fontSize: 11, color: colors.textMuted, textDecorationLine: "underline" }}>
                {t("companyDiagnostic.modelAssumptions.toggle")}
              </Text>
            </TouchableOpacity>
            {assumptionsOpen && (
              <View style={{ marginTop: 8, gap: 6 }}>
                {data.valuation.fcfAssumptions && (
                  <>
                    <Text style={{ fontSize: 11, color: colors.textSub }}>
                      {t("companyDiagnostic.modelAssumptions.fcfReported")}:{" "}
                      <Text style={{ fontWeight: "800", color: colors.text }}>
                        {data.valuation.fcfAssumptions.fcf_reported != null ? `$${(data.valuation.fcfAssumptions.fcf_reported / 1e6).toFixed(0)}M` : "—"}
                      </Text>
                      {" · "}{t("companyDiagnostic.modelAssumptions.fcfNormalized")}:{" "}
                      <Text style={{ fontWeight: "800", color: colors.accentLight }}>
                        {data.valuation.fcfAssumptions.fcf_normalized != null ? `$${(data.valuation.fcfAssumptions.fcf_normalized / 1e6).toFixed(0)}M` : "—"}
                      </Text>
                    </Text>
                    {data.valuation.fcfAssumptions.growth_capex_estimate != null && data.valuation.fcfAssumptions.growth_capex_estimate > 0 && (
                      <Text style={{ fontSize: 11, color: colors.textSub }}>
                        {t("companyDiagnostic.modelAssumptions.growthCapex")}:{" "}
                        <Text style={{ fontWeight: "800", color: colors.text }}>${(data.valuation.fcfAssumptions.growth_capex_estimate / 1e6).toFixed(0)}M</Text>
                      </Text>
                    )}
                  </>
                )}
                {data.valuation.waccDetails?.wacc_pct != null && (
                  <Text style={{ fontSize: 11, color: colors.textSub }}>
                    {t("companyDiagnostic.modelAssumptions.wacc")}:{" "}
                    <Text style={{ fontWeight: "800", color: colors.text }}>{data.valuation.waccDetails.wacc_pct.toFixed(1)}%</Text>
                  </Text>
                )}
                {data.valuation.fcfAssumptions?.methodology_note && (
                  <Text style={{ fontSize: 11, color: colors.textDim }}>{data.valuation.fcfAssumptions.methodology_note}</Text>
                )}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Capa 2 — 4 pilares */}
      <View style={{ marginTop: 14, gap: 12 }}>
        <CompanyDiagnosticQualityPillar
          score={data.pillarScores.quality}
          revenueBreakdown={data.revenueBreakdown}
          moatPoints={data.moatPoints}
          competitorComparison={data.competitorComparison}
          colors={colors}
        />
        <CompanyDiagnosticTrustPillar score={data.pillarScores.trust} financialHealth={data.financialHealth} roicAdjustedForBuybacks={data.roicAdjustedForBuybacks} colors={colors} />
        <CompanyDiagnosticValuePillar
          score={data.pillarScores.value}
          ticker={data.ticker}
          companyName={data.companyName}
          valuation={data.valuation}
          colors={colors}
        />
        <CompanyDiagnosticSimplicityPillar
          score={data.pillarScores.simplicity}
          noiseVsReality={data.noiseVsReality}
          actionPlan={data.actionPlan}
          colors={colors}
        />
      </View>

      {/* Tesis Final */}
      {data.investmentThesis && (
        <View style={{ marginTop: 14, borderRadius: 18, padding: 15, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent }}>
          <DiagSectionHeader
            title={t("companyDiagnostic.thesis.title")}
            subtitle={t("companyDiagnostic.thesis.subtitle")}
            icon={<Ionicons name="locate" size={17} color={colors.accentLight} />}
            colors={colors}
          />
          <Text style={{ fontSize: 14, lineHeight: 20.5, color: colors.textSub, marginTop: 6 }}>
            {renderWithBoldNumbers(data.investmentThesis, colors)}
          </Text>
        </View>
      )}

      {/* Guía de metodología */}
      <View style={{ marginTop: 14, borderRadius: 18, padding: 15, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
        <DiagSectionHeader
          title={t("companyDiagnostic.methodology.title")}
          subtitle={t("companyDiagnostic.methodology.subtitle")}
          icon={<Ionicons name="book" size={17} color={colors.textMuted} />}
          colors={colors}
        />
        <View style={{ marginTop: 6, gap: 8 }}>
          {methodologyParagraphs.map((p, i) => (
            <Text key={i} style={{ fontSize: 13, lineHeight: 19, color: colors.textSub }}>{p}</Text>
          ))}
        </View>
      </View>

      {/* "What $10,000 became" — ticker-independent, moved here from the
          bottom of app/subvaluadas/index.tsx (Diego, 2026-08-19): sits
          right above the Self-Check quiz as motivation/context before the
          user tests their own instinct. Mirrors web's CompanyDiagnosticCard. */}
      <CompanyDiagnosticBacktestPanel colors={colors} />

      {/* Self-Check */}
      <SelfCheckQuiz ticker={data.ticker} colors={colors} />

      {/* Disclaimer */}
      <Text style={{ fontSize: 11, lineHeight: 16, marginTop: 16, textAlign: "center", color: colors.textDim }}>
        {t("companyDiagnostic.disclaimer")}
      </Text>
    </View>
  );
}
