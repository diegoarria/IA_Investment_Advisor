import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { ExpandableSection, DiagRaisedBlock, ExplainableValue, DiagSectionScore, DiagEyebrow } from "./companyDiagnosticShared";
import { CompanyDiagnosticBuyZonePanel } from "./CompanyDiagnosticBuyZonePanel";
import { valuationStatus, VERDICT_COLOR, VERDICT_EMOJI, fmtPrice } from "../../lib/types/companyDiagnostic";
import type { CompanyDiagnosticData } from "../../lib/types/companyDiagnostic";

// Mirror of web's CompanyDiagnosticValuePillar.tsx.

type ScenarioKey = "conservative" | "baseFairValue" | "optimistic";

export function CompanyDiagnosticValuePillar({
  score, ticker, companyName, valuation, colors,
}: {
  score: number;
  ticker: string;
  companyName: string;
  valuation: CompanyDiagnosticData["valuation"];
  colors: any;
}) {
  const { t } = useTranslation();
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>("baseFairValue");

  const fmtMultiple = (v: number | null) => (v != null ? `${v.toFixed(1)}x` : t("companyDiagnostic.pillars.value.notAvailable"));
  const multiples: { explKey: string; value: string }[] = [
    { explKey: "peCurrent", value: fmtMultiple(valuation.peCurrent) },
    { explKey: "peForward", value: fmtMultiple(valuation.peForward) },
    { explKey: "peNormalized", value: fmtMultiple(valuation.peNormalized) },
    { explKey: "peHistorical", value: fmtMultiple(valuation.peHistoricalAvg) },
    { explKey: "evFcf", value: fmtMultiple(valuation.evFcf) },
  ];

  const scenarios: { key: ScenarioKey; label: string; value: number; color: string }[] = [
    { key: "conservative", label: t("companyDiagnostic.pillars.value.conservative"), value: valuation.conservative, color: "#DD6E63" },
    { key: "baseFairValue", label: t("companyDiagnostic.pillars.value.baseFairValue"), value: valuation.baseFairValue, color: "#D4A24C" },
    { key: "optimistic", label: t("companyDiagnostic.pillars.value.optimistic"), value: valuation.optimistic, color: "#4FA695" },
  ];

  const selectedValue = scenarios.find((s) => s.key === selectedScenario)!.value;
  const status = valuationStatus(selectedValue, valuation.currentPrice);

  return (
    <View>
      <ExpandableSection
        title={t("companyDiagnostic.pillars.value.title")}
        icon={<Ionicons name="diamond" size={18} color="#4FA695" />}
        defaultExpanded
        colors={colors}
        headline={
          <DiagSectionScore
            score={score}
            label={t("companyDiagnostic.explanations.scoreValue.title")}
            explanation={t("companyDiagnostic.explanations.scoreValue.body")}
            colors={colors}
          />
        }
      >
        <View>
          <DiagEyebrow colors={colors}>{t("companyDiagnostic.pillars.value.multiplesTitle")}</DiagEyebrow>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {multiples.map((m) => (
              <DiagRaisedBlock key={m.explKey} colors={colors} tint="#4FA695" style={{ width: "48%", flexGrow: 1 }}>
                <ExplainableValue
                  label={t(`companyDiagnostic.explanations.${m.explKey}.title`)}
                  summary={t(`companyDiagnostic.explanations.${m.explKey}.body`)}
                  colors={colors}
                >
                  <Text style={{ fontSize: 10.5, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase", color: colors.textMuted }} numberOfLines={1}>
                    {t(`companyDiagnostic.pillars.value.${m.explKey}`)}
                  </Text>
                </ExplainableValue>
                <Text style={{ fontSize: 22, fontWeight: "900", color: colors.text, marginTop: 8, letterSpacing: -0.5, fontVariant: ["tabular-nums"] }} numberOfLines={1} adjustsFontSizeToFit>{m.value}</Text>
              </DiagRaisedBlock>
            ))}
          </View>
        </View>

        <View>
          <DiagEyebrow colors={colors}>{t("companyDiagnostic.pillars.value.modelsTitle")}</DiagEyebrow>
          <View style={{ flexDirection: "row", gap: 6, padding: 5, borderRadius: 18, backgroundColor: colors.bgRaised }}>
            {scenarios.map((sc) => {
              const isSelected = sc.key === selectedScenario;
              return (
                <TouchableOpacity key={sc.key} onPress={() => setSelectedScenario(sc.key)} activeOpacity={0.85} style={{ flex: 1, minWidth: 0, borderRadius: 14, overflow: "hidden" }}>
                  <LinearGradient
                    colors={isSelected ? [sc.color, `${sc.color}b3`] : ["transparent", "transparent"]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={{ paddingVertical: 11, paddingHorizontal: 4, alignItems: "center" }}
                  >
                    <Text style={{ fontSize: 9.5, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase", color: isSelected ? "#0A0F1A" : sc.color, textAlign: "center" }} numberOfLines={2}>{sc.label}</Text>
                    <Text style={{ fontSize: 15.5, fontWeight: "900", color: isSelected ? "#0A0F1A" : colors.text, marginTop: 4, fontVariant: ["tabular-nums"] }} numberOfLines={1} adjustsFontSizeToFit>{fmtPrice(sc.value)}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ marginTop: 12, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: status ? `${VERDICT_COLOR[status.verdict]}55` : colors.border }}>
            <LinearGradient
              colors={status ? [`${VERDICT_COLOR[status.verdict]}2b`, `${VERDICT_COLOR[status.verdict]}08`] : [colors.bgRaised, colors.bgRaised]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14 }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <ExplainableValue
                  label={t("companyDiagnostic.explanations.marginOfSafety.title")}
                  summary={t("companyDiagnostic.explanations.marginOfSafety.body")}
                  colors={colors}
                >
                  <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.textSub }} numberOfLines={1}>{t("companyDiagnostic.pillars.value.marginOfSafety")}</Text>
                </ExplainableValue>
              </View>
              {status && (
                <Text style={{ fontSize: 24, fontWeight: "900", color: VERDICT_COLOR[status.verdict], letterSpacing: -0.5, fontVariant: ["tabular-nums"] }} numberOfLines={1}>
                  {VERDICT_EMOJI[status.verdict]} {status.pct.toFixed(1)}%
                </Text>
              )}
            </LinearGradient>
          </View>
        </View>
      </ExpandableSection>

      <CompanyDiagnosticBuyZonePanel
        key={selectedScenario}
        ticker={ticker}
        companyName={companyName}
        price={valuation.currentPrice}
        intrinsicValue={selectedValue}
        defaultMarginPct={status?.verdict === "undervalued" ? Math.round(status.pct) : undefined}
        colors={colors}
      />
    </View>
  );
}
