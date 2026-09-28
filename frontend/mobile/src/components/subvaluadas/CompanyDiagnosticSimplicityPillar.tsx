import React from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { ExpandableSection, DiagSectionScore, DiagRaisedBlock, DiagEyebrow, DiagIconDot } from "./companyDiagnosticShared";
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
        <View style={{ gap: 10 }}>
          {([
            { key: "marketSaw", color: "#ef4444", icon: "megaphone-outline", text: noiseVsReality.marketSaw },
            { key: "nuvosReality", color: "#22c55e", icon: "checkmark-done", text: noiseVsReality.nuvosReality },
          ] as const).map((b) => (
            <View key={b.key} style={{ borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: `${b.color}55` }}>
              <LinearGradient colors={[`${b.color}26`, `${b.color}08`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <DiagIconDot name={b.icon} color={b.color} size={30} />
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase", color: b.color }}>
                    {t(`companyDiagnostic.pillars.simplicity.${b.key}`)}
                  </Text>
                </View>
                <Text style={{ fontSize: 14.5, lineHeight: 21.5, color: colors.text }}>{b.text}</Text>
              </LinearGradient>
            </View>
          ))}
        </View>
      )}

      {actionPlan && (
        <View>
          <DiagEyebrow colors={colors}>{t("companyDiagnostic.pillars.simplicity.actionPlanTitle")}</DiagEyebrow>
          <DiagRaisedBlock colors={colors} tint="#f59e0b">
            {([
              { icon: "person-circle-outline", label: t("companyDiagnostic.pillars.simplicity.profile"), value: actionPlan.profile },
              { icon: "navigate-circle-outline", label: t("companyDiagnostic.pillars.simplicity.strategy"), value: actionPlan.strategy },
            ] as const).map((row, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start", paddingTop: i ? 14 : 0, marginTop: i ? 14 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                <DiagIconDot name={row.icon} color="#f59e0b" size={34} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.textMuted }}>{row.label}</Text>
                  <Text style={{ fontSize: 15.5, lineHeight: 21, fontWeight: "800", color: colors.text, marginTop: 2 }}>{row.value}</Text>
                </View>
              </View>
            ))}
          </DiagRaisedBlock>
        </View>
      )}
    </ExpandableSection>
  );
}
