import React from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ExpandableSection, DiagRaisedBlock, ExplainableValue, DiagSectionScore } from "./companyDiagnosticShared";
import type { CompanyDiagnosticData } from "../../lib/types/companyDiagnostic";

// Mirror of web's CompanyDiagnosticTrustPillar.tsx.

export function CompanyDiagnosticTrustPillar({
  score, financialHealth, roicAdjustedForBuybacks, colors,
}: {
  score: number;
  financialHealth: CompanyDiagnosticData["financialHealth"];
  roicAdjustedForBuybacks?: boolean;
  colors: any;
}) {
  const { t } = useTranslation();

  const rows: { explKey: string; value: string }[] = [
    { explKey: "longTermDebt", value: financialHealth.longTermDebt },
    { explKey: "netCash", value: financialHealth.netCash },
    { explKey: "roic", value: financialHealth.roic },
    { explKey: "operatingMargin", value: financialHealth.operatingMargin },
    { explKey: "netMargin", value: financialHealth.netMargin },
    { explKey: "operatingCashFlow", value: financialHealth.operatingCashFlow },
  ];

  return (
    <ExpandableSection
      title={t("companyDiagnostic.pillars.trust.title")}
      icon={<Ionicons name="shield-checkmark" size={18} color="#6366F1" />}
      defaultExpanded
      colors={colors}
      headline={
        <DiagSectionScore
          score={score}
          label={t("companyDiagnostic.explanations.scoreTrust.title")}
          explanation={t("companyDiagnostic.explanations.scoreTrust.body")}
          colors={colors}
        />
      }
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {rows.map((row) => {
          const label = t(`companyDiagnostic.pillars.trust.${row.explKey}`);
          return (
            <DiagRaisedBlock key={row.explKey} colors={colors} tint="#6366F1" style={{ width: "48%", flexGrow: 1 }}>
              <ExplainableValue
                label={t(`companyDiagnostic.explanations.${row.explKey}.title`)}
                summary={t(`companyDiagnostic.explanations.${row.explKey}.body`)}
                colors={colors}
              >
                <Text style={{ fontSize: 10.5, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase", color: colors.textMuted }} numberOfLines={1}>{label}</Text>
              </ExplainableValue>
              <Text style={{ fontSize: 19, fontWeight: "900", color: colors.text, marginTop: 8, letterSpacing: -0.3, fontVariant: ["tabular-nums"] }} numberOfLines={2} adjustsFontSizeToFit>{row.value}</Text>
              {row.explKey === "roic" && roicAdjustedForBuybacks && (
                <Text style={{ fontSize: 10, lineHeight: 14, color: colors.textMuted, marginTop: 6 }}>
                  {t("companyDiagnostic.pillars.trust.roicAdjustedNote")}
                </Text>
              )}
            </DiagRaisedBlock>
          );
        })}
      </View>
    </ExpandableSection>
  );
}
