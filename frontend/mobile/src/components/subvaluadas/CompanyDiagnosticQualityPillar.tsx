import React from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ExpandableSection, DiagRaisedBlock, DiagSectionScore } from "./companyDiagnosticShared";
import { SCENARIO_COLOR } from "../../lib/types/companyDiagnostic";
import type { CompanyDiagnosticData } from "../../lib/types/companyDiagnostic";

// Mirror of web's CompanyDiagnosticQualityPillar.tsx + CompanyDiagnosticCompetitorTable.tsx
// — RN has no responsive breakpoints, so the competitor "Duelo de Titanes"
// always renders as the web version's <640px stacked-card variant.

function SubCard({ icon, title, children, colors }: { icon: React.ReactNode; title: string; children: React.ReactNode; colors: any }) {
  return (
    <View style={{ borderRadius: 14, padding: 12, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {icon}
        <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const NUVOS_ADVANTAGE_COLOR = SCENARIO_COLOR.bull;

function CompetitorTable({ competitorComparison, colors }: { competitorComparison: NonNullable<CompanyDiagnosticData["competitorComparison"]>; colors: any }) {
  const { t } = useTranslation();
  const { competitorName, rows, conclusion } = competitorComparison;
  return (
    <View>
      <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.textMuted, marginBottom: 8 }}>
        {t("companyDiagnostic.pillars.quality.vs")} {competitorName}
      </Text>
      <View style={{ gap: 8 }}>
        {rows.map((row) => (
          <DiagRaisedBlock key={row.metricName} colors={{ bgRaised: colors.card }}>
            <Text style={{ fontSize: 11.5, fontWeight: "800", color: colors.textMuted, marginBottom: 6 }}>{row.metricName}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <View>
                <Text style={{ fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", color: NUVOS_ADVANTAGE_COLOR }}>Nuvos</Text>
                <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text }}>{row.targetCompanyValue}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }}>{competitorName}</Text>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.textSub }}>{row.competitorValue}</Text>
              </View>
            </View>
            <Text style={{ fontSize: 11, marginTop: 6, lineHeight: 15, color: colors.textDim }}>{row.nuvosAdvantageNote}</Text>
          </DiagRaisedBlock>
        ))}
      </View>
      <View style={{ marginTop: 10, borderRadius: 12, padding: 10, backgroundColor: `${NUVOS_ADVANTAGE_COLOR}1a`, borderWidth: 1, borderColor: NUVOS_ADVANTAGE_COLOR }}>
        <Text style={{ fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", color: NUVOS_ADVANTAGE_COLOR, marginBottom: 4 }}>
          {t("companyDiagnostic.pillars.quality.conclusionLabel")}
        </Text>
        <Text style={{ fontSize: 12.5, lineHeight: 17, color: colors.text }}>{conclusion}</Text>
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
        <SubCard icon={<Ionicons name="pie-chart" size={16} color={colors.accentLight} />} title={t("companyDiagnostic.pillars.quality.revenueBreakdown")} colors={colors}>
          <View style={{ gap: 10 }}>
            {revenueBreakdown.map((r) => (
              <View key={r.category}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.text }}>{r.category}</Text>
                  <Text style={{ fontSize: 12.5, fontWeight: "900", color: colors.text }}>{r.percentage}%</Text>
                </View>
                <View style={{ height: 7, borderRadius: 4, backgroundColor: colors.border }}>
                  <View style={{ width: `${r.percentage}%`, height: 7, borderRadius: 4, backgroundColor: colors.accent }} />
                </View>
              </View>
            ))}
          </View>
        </SubCard>

        <SubCard icon={<Ionicons name="shield" size={16} color="#4FA695" />} title={t("companyDiagnostic.pillars.quality.moatTitle")} colors={colors}>
          <View style={{ gap: 8 }}>
            {moatPoints.map((point, i) => (
              <View key={i} style={{ borderRadius: 10, padding: 10, backgroundColor: colors.card }}>
                <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.text }}>{point}</Text>
              </View>
            ))}
          </View>
        </SubCard>

        {competitorComparison && (
          <SubCard icon={<Ionicons name="git-compare" size={16} color="#DD6E63" />} title={t("companyDiagnostic.pillars.quality.competitorTitle")} colors={colors}>
            <CompetitorTable competitorComparison={competitorComparison} colors={colors} />
          </SubCard>
        )}
      </View>
    </ExpandableSection>
  );
}
