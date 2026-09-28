import React from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { ExpandableSection, DiagSectionScore, DiagIconDot } from "./companyDiagnosticShared";
import { SCENARIO_COLOR } from "../../lib/types/companyDiagnostic";
import type { CompanyDiagnosticData } from "../../lib/types/companyDiagnostic";

// Mirror of web's CompanyDiagnosticQualityPillar.tsx + CompanyDiagnosticCompetitorTable.tsx
// — RN has no responsive breakpoints, so the competitor "Duelo de Titanes"
// always renders as the web version's <640px stacked-card variant.

function SubCard({ icon, title, children, colors, tint }: { icon: React.ReactNode; title: string; children: React.ReactNode; colors: any; tint: string }) {
  return (
    <View style={{ borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: `${tint}33` }}>
      <LinearGradient colors={[`${tint}1a`, colors.bgRaised]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: `${tint}24` }}>
            {icon}
          </View>
          <Text style={{ fontSize: 15, fontWeight: "800", color: colors.text, flex: 1, letterSpacing: -0.2 }} numberOfLines={1}>{title}</Text>
        </View>
        {children}
      </LinearGradient>
    </View>
  );
}

const NUVOS_ADVANTAGE_COLOR = SCENARIO_COLOR.bull;

function CompetitorTable({ competitorComparison, colors }: { competitorComparison: NonNullable<CompanyDiagnosticData["competitorComparison"]>; colors: any }) {
  const { t } = useTranslation();
  const { competitorName, rows, conclusion } = competitorComparison;
  return (
    <View>
      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.textMuted, marginBottom: 10 }} numberOfLines={1}>
        {t("companyDiagnostic.pillars.quality.vs")} {competitorName}
      </Text>
      <View style={{ gap: 10 }}>
        {rows.map((row) => (
          <View key={row.metricName} style={{ borderRadius: 14, padding: 14, backgroundColor: colors.card }}>
            <Text style={{ fontSize: 12, fontWeight: "800", color: colors.textSub, marginBottom: 10 }} numberOfLines={1}>{row.metricName}</Text>
            <View style={{ flexDirection: "row", alignItems: "stretch", gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0, borderRadius: 12, padding: 10, backgroundColor: `${NUVOS_ADVANTAGE_COLOR}1f` }}>
                <Text style={{ fontSize: 9.5, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase", color: NUVOS_ADVANTAGE_COLOR }} numberOfLines={1}>Nuvos</Text>
                <Text style={{ fontSize: 16, fontWeight: "900", color: colors.text, marginTop: 3 }} numberOfLines={1} adjustsFontSizeToFit>{row.targetCompanyValue}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, borderRadius: 12, padding: 10, backgroundColor: colors.bgRaised, alignItems: "flex-end" }}>
                <Text style={{ fontSize: 9.5, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase", color: colors.textMuted }} numberOfLines={1}>{competitorName}</Text>
                <Text style={{ fontSize: 16, fontWeight: "800", color: colors.textSub, marginTop: 3 }} numberOfLines={1} adjustsFontSizeToFit>{row.competitorValue}</Text>
              </View>
            </View>
            <Text style={{ fontSize: 12, marginTop: 10, lineHeight: 17, color: colors.textMuted }}>{row.nuvosAdvantageNote}</Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 12, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: `${NUVOS_ADVANTAGE_COLOR}66` }}>
        <LinearGradient colors={[`${NUVOS_ADVANTAGE_COLOR}2e`, `${NUVOS_ADVANTAGE_COLOR}0a`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Ionicons name="ribbon" size={15} color={NUVOS_ADVANTAGE_COLOR} />
            <Text style={{ fontSize: 11.5, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase", color: NUVOS_ADVANTAGE_COLOR }}>
              {t("companyDiagnostic.pillars.quality.conclusionLabel")}
            </Text>
          </View>
          <Text style={{ fontSize: 14, lineHeight: 20.5, color: colors.text }}>{conclusion}</Text>
        </LinearGradient>
      </View>
    </View>
  );
}

export function CompanyDiagnosticQualityPillar({
  score, revenueBreakdown, moatPoints, competitorComparison, colors,
}: {
  score: number;
  revenueBreakdown: CompanyDiagnosticData["revenueBreakdown"];
  moatPoints: string[];
  competitorComparison: CompanyDiagnosticData["competitorComparison"];
  colors: any;
}) {
  const { t } = useTranslation();
  return (
    <ExpandableSection
      title={t("companyDiagnostic.pillars.quality.title")}
      icon={<Ionicons name="trophy" size={18} color="#eab308" />}
      defaultExpanded
      colors={colors}
      headline={
        <DiagSectionScore
          score={score}
          label={t("companyDiagnostic.explanations.scoreQuality.title")}
          explanation={t("companyDiagnostic.explanations.scoreQuality.body")}
          colors={colors}
        />
      }
    >
      <View style={{ gap: 14 }}>
        <SubCard tint={colors.accent} icon={<Ionicons name="pie-chart" size={16} color={colors.accentLight} />} title={t("companyDiagnostic.pillars.quality.revenueBreakdown")} colors={colors}>
          <View style={{ gap: 14 }}>
            {revenueBreakdown.map((r) => (
              <View key={r.category}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
                  <Text style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: "700", color: colors.text }} numberOfLines={1}>{r.category}</Text>
                  <Text style={{ fontSize: 15, fontWeight: "900", color: colors.text, fontVariant: ["tabular-nums"] }}>{r.percentage}%</Text>
                </View>
                <View style={{ height: 10, borderRadius: 5, backgroundColor: "rgba(127,127,127,0.16)", overflow: "hidden" }}>
                  <LinearGradient colors={["#F5C76B", colors.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${r.percentage}%`, height: "100%", borderRadius: 5 }} />
                </View>
              </View>
            ))}
          </View>
        </SubCard>

        <SubCard tint="#4FA695" icon={<Ionicons name="shield" size={16} color="#4FA695" />} title={t("companyDiagnostic.pillars.quality.moatTitle")} colors={colors}>
          <View style={{ gap: 10 }}>
            {moatPoints.map((point, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", borderRadius: 14, padding: 12, backgroundColor: colors.card }}>
                <View style={{ marginTop: 1 }}><DiagIconDot name="checkmark" color="#4FA695" size={22} /></View>
                <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 19.5, color: colors.text }}>{point}</Text>
              </View>
            ))}
          </View>
        </SubCard>

        {competitorComparison && (
          <SubCard tint="#DD6E63" icon={<Ionicons name="git-compare" size={16} color="#DD6E63" />} title={t("companyDiagnostic.pillars.quality.competitorTitle")} colors={colors}>
            <CompetitorTable competitorComparison={competitorComparison} colors={colors} />
          </SubCard>
        )}
      </View>
    </ExpandableSection>
  );
}
