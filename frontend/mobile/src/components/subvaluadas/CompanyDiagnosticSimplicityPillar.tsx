import React from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ExpandableSection, DiagSectionScore } from "./companyDiagnosticShared";
import type { CompanyDiagnosticData } from "../../lib/types/companyDiagnostic";

// Mirror of web's CompanyDiagnosticSimplicityPillar.tsx.

export function CompanyDiagnosticSimplicityPillar({
  score, noiseVsReality, actionPlan, colors,
}: {
  score: number;
  noiseVsReality: CompanyDiagnosticData["noiseVsReality"];
  actionPlan: CompanyDiagnosticData["actionPlan"];
  colors: any;
}) {
  const { t } = useTranslation();

  return (
    <ExpandableSection
      title={t("companyDiagnostic.pillars.simplicity.title")}
      icon={<Ionicons name="bulb" size={18} color="#f59e0b" />}
      defaultExpanded
      colors={colors}
      headline={
        <DiagSectionScore
          score={score}
          label={t("companyDiagnostic.explanations.scoreSimplicity.title")}
          explanation={t("companyDiagnostic.explanations.scoreSimplicity.body")}
          colors={colors}
        />
      }
    >
      {noiseVsReality && (
        <View style={{ gap: 8 }}>
          <View style={{ borderRadius: 12, padding: 12, backgroundColor: "#ef44441a", borderWidth: 1, borderColor: "#ef4444" }}>
            <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: "#ef4444", marginBottom: 5 }}>
              🔴 {t("companyDiagnostic.pillars.simplicity.marketSaw")}
            </Text>
            <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.text }}>{noiseVsReality.marketSaw}</Text>
          </View>
          <View style={{ borderRadius: 12, padding: 12, backgroundColor: "#22c55e1a", borderWidth: 1, borderColor: "#22c55e" }}>
            <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: "#22c55e", marginBottom: 5 }}>
              🟢 {t("companyDiagnostic.pillars.simplicity.nuvosReality")}
            </Text>
            <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.text }}>{noiseVsReality.nuvosReality}</Text>
          </View>
        </View>
      )}

      {actionPlan && (
        <View>
          <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, marginBottom: 8 }}>
            {t("companyDiagnostic.pillars.simplicity.actionPlanTitle")}
          </Text>
          <View style={{ borderRadius: 12, padding: 12, backgroundColor: colors.bgRaised }}>
            <Text style={{ fontSize: 10.5, color: colors.textMuted }}>{t("companyDiagnostic.pillars.simplicity.profile")}</Text>
            <Text style={{ fontSize: 13.5, fontWeight: "800", color: colors.text, marginBottom: 8 }}>{actionPlan.profile}</Text>
            <Text style={{ fontSize: 10.5, color: colors.textMuted }}>{t("companyDiagnostic.pillars.simplicity.strategy")}</Text>
            <Text style={{ fontSize: 13.5, fontWeight: "800", color: colors.text }}>{actionPlan.strategy}</Text>
          </View>
        </View>
      )}
    </ExpandableSection>
  );
}
