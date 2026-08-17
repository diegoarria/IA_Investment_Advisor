import React from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { SCENARIO_COLOR, fmtPrice } from "../../lib/types/companyDiagnostic";
import type { ValuationScenarios } from "../../lib/types/companyDiagnostic";

// Mirror of web's CompanyDiagnosticValuationThermometer.tsx — RN has no
// CSS linear-gradient, so the bar uses a flat mid-tone instead of the bear
// -> base -> bull gradient; the 3 scenario ticks + current-price marker
// keep the same color language.

const BAR_WIDTH_PCT = 100;

export function CompanyDiagnosticValuationThermometer({ scenarios, colors }: { scenarios: ValuationScenarios; colors: any }) {
  const { t } = useTranslation();
  const { conservative, baseFairValue, optimistic, currentPrice } = scenarios;

  const rawMin = Math.min(conservative, baseFairValue, optimistic, currentPrice);
  const rawMax = Math.max(conservative, baseFairValue, optimistic, currentPrice);
  const pad = (rawMax - rawMin) * 0.12 || rawMax * 0.1 || 1;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const span = max - min || 1;
  const pctOf = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100));

  const markers: { key: string; label: string; value: number; color: string }[] = [
    { key: "conservative", label: t("companyDiagnostic.thermometer.conservative"), value: conservative, color: SCENARIO_COLOR.bear },
    { key: "baseFairValue", label: t("companyDiagnostic.thermometer.baseFairValue"), value: baseFairValue, color: SCENARIO_COLOR.base },
    { key: "optimistic", label: t("companyDiagnostic.thermometer.optimistic"), value: optimistic, color: SCENARIO_COLOR.bull },
  ];

  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, marginBottom: 34 }}>
        {t("companyDiagnostic.thermometer.title")}
      </Text>

      <View style={{ height: 10, borderRadius: 5, backgroundColor: SCENARIO_COLOR.base, overflow: "visible" }}>
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row", borderRadius: 5, overflow: "hidden" }}>
          <View style={{ flex: 1, backgroundColor: SCENARIO_COLOR.bear }} />
          <View style={{ flex: 1, backgroundColor: SCENARIO_COLOR.base }} />
          <View style={{ flex: 1, backgroundColor: SCENARIO_COLOR.bull }} />
        </View>

        {markers.map((m) => (
          <View key={m.key} style={{ position: "absolute", top: -2, alignItems: "center", left: `${pctOf(m.value)}%`, transform: [{ translateX: -1 }] }}>
            <View style={{ width: 2, height: 14, borderRadius: 1, backgroundColor: "rgba(0,0,0,0.35)" }} />
            <Text style={{ fontSize: 10, fontWeight: "800", color: colors.textMuted, marginTop: 24, position: "absolute", width: 70, left: -34, textAlign: "center" }}>{m.label}</Text>
            <Text style={{ fontSize: 10.5, fontWeight: "900", color: colors.text, marginTop: 38, position: "absolute", width: 70, left: -34, textAlign: "center" }}>{fmtPrice(m.value)}</Text>
          </View>
        ))}

        <View style={{ position: "absolute", top: -34, alignItems: "center", left: `${pctOf(currentPrice)}%`, transform: [{ translateX: -1 }] }}>
          <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.text }}>
            <Text style={{ fontSize: 10.5, fontWeight: "900", color: colors.card }}>
              {t("companyDiagnostic.thermometer.priceToday")} {fmtPrice(currentPrice)}
            </Text>
          </View>
          <View style={{ width: 2, height: 12, backgroundColor: colors.text }} />
        </View>
      </View>

      <View style={{ height: 46 }} />
    </View>
  );
}
