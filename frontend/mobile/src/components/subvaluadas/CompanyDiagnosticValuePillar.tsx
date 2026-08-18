import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ExpandableSection, DiagRaisedBlock, ExplainableValue, DiagSectionScore } from "./companyDiagnosticShared";
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
          <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, marginBottom: 8 }}>
            {t("companyDiagnostic.pillars.value.multiplesTitle")}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {multiples.map((m) => (
              <DiagRaisedBlock key={m.explKey} colors={colors} style={{ width: "47%" }}>
                <ExplainableValue
                  label={t(`companyDiagnostic.explanations.${m.explKey}.title`)}
                  summary={t(`companyDiagnostic.explanations.${m.explKey}.body`)}
                  colors={colors}
                >
                  <Text style={{ fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted }} numberOfLines={1}>
                    {t(`companyDiagnostic.pillars.value.${m.explKey}`)}
                  </Text>
                </ExplainableValue>
                <Text style={{ fontSize: 15.5, fontWeight: "900", color: colors.text, marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit>{m.value}</Text>
              </DiagRaisedBlock>
            ))}
          </View>
        </View>

        <View>
          <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, marginBottom: 8, marginTop: 5 }}>
            {t("companyDiagnostic.pillars.value.modelsTitle")}
          </Text>
          <View style={{ flexDirection: "row", gap: 7 }}>
            {scenarios.map((s) => {
              const isSelected = s.key === selectedScenario;
              return (
                <TouchableOpacity
                  key={s.key}
                  onPress={() => setSelectedScenario(s.key)}
                  style={{
                    flex: 1, minWidth: 0, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 4, alignItems: "center",
                    backgroundColor: `${s.color}${isSelected ? "33" : "1f"}`,
                    borderWidth: isSelected ? 2 : 1, borderColor: s.color,
                  }}
                >
                  <Text style={{ fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", color: s.color, textAlign: "center" }} numberOfLines={2}>{s.label}</Text>
                  <Text style={{ fontSize: 14.5, fontWeight: "900", color: colors.text, marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit>{fmtPrice(s.value)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 11 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <ExplainableValue
                label={t("companyDiagnostic.explanations.marginOfSafety.title")}
                summary={t("companyDiagnostic.explanations.marginOfSafety.body")}
                colors={colors}
              >
                <Text style={{ fontSize: 13, color: colors.textMuted }} numberOfLines={1}>{t("companyDiagnostic.pillars.value.marginOfSafety")}</Text>
              </ExplainableValue>
            </View>
            {status && (
              <Text style={{ fontSize: 15.5, fontWeight: "900", color: VERDICT_COLOR[status.verdict] }} numberOfLines={1}>
                {VERDICT_EMOJI[status.verdict]} {status.pct.toFixed(1)}%
              </Text>
            )}
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
