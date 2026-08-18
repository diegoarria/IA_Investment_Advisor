import React from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { SCENARIO_COLOR, fmtPrice } from "../../lib/types/companyDiagnostic";
import type { ValuationScenarios } from "../../lib/types/companyDiagnostic";

// Mirror of web's CompanyDiagnosticValuationThermometer.tsx — RN has no
// CSS linear-gradient, so the bar uses 3 flat segments instead of the
// bear -> base -> bull gradient. Label anchors are clamped away from the
// 0%/100% edges (`LABEL_MIN`/`LABEL_MAX`) so a scenario sitting at the very
// end of the range never gets its price/name clipped off the edge of the
// screen — only the tick mark itself stays at the true, unclamped position.

const LABEL_MIN = 16;
const LABEL_MAX = 84;
const LABEL_WIDTH = 68;

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
  const clampLabel = (pct: number) => Math.min(LABEL_MAX, Math.max(LABEL_MIN, pct));

  const markers: { key: string; label: string; value: number; color: string }[] = [
    { key: "conservative", label: t("companyDiagnostic.thermometer.conservative"), value: conservative, color: SCENARIO_COLOR.bear },
    { key: "baseFairValue", label: t("companyDiagnostic.thermometer.baseFairValue"), value: baseFairValue, color: SCENARIO_COLOR.base },
    { key: "optimistic", label: t("companyDiagnostic.thermometer.optimistic"), value: optimistic, color: SCENARIO_COLOR.bull },
  ];

  return (
    <View style={{ marginTop: 6 }}>
      <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, marginBottom: 34 }}>
        {t("companyDiagnostic.thermometer.title")}
      </Text>

      <View style={{ height: 9, borderRadius: 4.5, overflow: "visible" }}>
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row", borderRadius: 4.5, overflow: "hidden" }}>
          <View style={{ flex: 1, backgroundColor: SCENARIO_COLOR.bear }} />
          <View style={{ flex: 1, backgroundColor: SCENARIO_COLOR.base }} />
          <View style={{ flex: 1, backgroundColor: SCENARIO_COLOR.bull }} />
        </View>

        {markers.map((m) => {
          const tickPct = pctOf(m.value);
          const labelPct = clampLabel(tickPct);
          return (
            <React.Fragment key={m.key}>
              <View style={{ position: "absolute", top: -2, left: `${tickPct}%`, width: 2, height: 13, borderRadius: 1, backgroundColor: "rgba(0,0,0,0.35)", transform: [{ translateX: -1 }] }} />
              <View style={{ position: "absolute", top: 22, left: `${labelPct}%`, width: LABEL_WIDTH, marginLeft: -LABEL_WIDTH / 2, alignItems: "center" }}>
                <Text style={{ fontSize: 10.5, fontWeight: "800", color: colors.textMuted, textAlign: "center" }} numberOfLines={1}>{m.label}</Text>
                <Text style={{ fontSize: 11.5, fontWeight: "900", color: colors.text, textAlign: "center" }} numberOfLines={1} adjustsFontSizeToFit>{fmtPrice(m.value)}</Text>
              </View>
            </React.Fragment>
          );
        })}

        <View style={{ position: "absolute", top: -34, left: `${clampLabel(pctOf(currentPrice))}%`, alignItems: "center", transform: [{ translateX: -1 }] }}>
          <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.text }}>
            <Text style={{ fontSize: 11, fontWeight: "900", color: colors.card }} numberOfLines={1}>
              {t("companyDiagnostic.thermometer.priceToday")} {fmtPrice(currentPrice)}
            </Text>
          </View>
          <View style={{ width: 2, height: 10, backgroundColor: colors.text }} />
        </View>
      </View>

      <View style={{ height: 46 }} />
    </View>
  );
}
