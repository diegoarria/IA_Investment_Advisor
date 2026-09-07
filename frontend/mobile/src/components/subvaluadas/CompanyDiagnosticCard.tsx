import React, { useState, type ReactNode } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { CompanyDiagnosticHero } from "./CompanyDiagnosticHero";
import { CompanyDiagnosticFairValueChart } from "./CompanyDiagnosticFairValueChart";
import { CompanyDiagnosticQualityPillar } from "./CompanyDiagnosticQualityPillar";
import { CompanyDiagnosticTrustPillar } from "./CompanyDiagnosticTrustPillar";
import { CompanyDiagnosticValuePillar } from "./CompanyDiagnosticValuePillar";
import { CompanyDiagnosticSimplicityPillar } from "./CompanyDiagnosticSimplicityPillar";
import { SelfCheckQuiz } from "./SelfCheckQuiz";
import { CompanyDiagnosticBacktestPanel } from "./CompanyDiagnosticBacktestPanel";
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

  return (
    <View>
      {/* Capa 1 — Hero (simplificado, ver CompanyDiagnosticHero.tsx) */}
      <View style={{ borderRadius: 18, padding: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
        <CompanyDiagnosticHero data={data} colors={colors} />

        {data.sectorModelNote && (
          <View style={{ borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 15, backgroundColor: "rgba(212,162,76,0.08)", borderWidth: 1, borderColor: "rgba(212,162,76,0.2)" }}>
            <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", color: colors.accentLight, marginBottom: 3 }}>
              {t("companyDiagnostic.sectorModelNoteTitle")}
            </Text>
            <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.textSub }}>{data.sectorModelNote.detalle}</Text>
          </View>
        )}

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

      {/* Precio real vs. valor razonable — mismo dato/diseño que la web
          (CompanyDiagnosticValuationTabs.tsx), con cursor arrastrable. */}
      <CompanyDiagnosticFairValueChart data={data} colors={colors} />

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
