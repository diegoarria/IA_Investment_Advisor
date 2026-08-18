import React from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { SCENARIO_COLOR, fmtPrice } from "../../lib/types/companyDiagnostic";
import type { ValuationScenarios } from "../../lib/types/companyDiagnostic";

// Mirror of web's CompanyDiagnosticValuationThermometer.tsx — RN has no
// CSS linear-gradient, so the bar uses 3 flat segments instead of the
// bear -> base -> bull gradient.
//
// The 3 scenario labels used to float directly above the bar at their true
// numeric position, same as web — but when the current price sits far
// outside the conservative/base/optimistic range (a real, common case:
// AAPL trading at $305 against a $196-$250 fair-value range), those 3
// values compress into a tight cluster and their labels overlap into
// unreadable text (confirmed live by Diego on AAPL). Fixed by splitting
// the two concerns: the bar keeps small tick marks at the TRUE relative
// position (still useful at a glance), but the label+value for each
// scenario now renders in a fixed 3-column legend row below the bar,
// always evenly spaced in bear/base/bull order regardless of how close
// the real values are — this can never overlap. The current-price badge
// is the only element still floating above the bar; its anchor is clamped
// well inside the edges (`PRICE_MIN`/`PRICE_MAX`) so it can't clip off the
// screen the way it did when centered exactly on an outlier price.

const PRICE_MIN = 20;
const PRICE_MAX = 80;

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
  const pricePct = Math.min(PRICE_MAX, Math.max(PRICE_MIN, pctOf(currentPrice)));

  const markers: { key: string; label: string; value: number; color: string }[] = [
    { key: "conservative", label: t("companyDiagnostic.thermometer.conservative"), value: conservative, color: SCENARIO_COLOR.bear },
    { key: "baseFairValue", label: t("companyDiagnostic.thermometer.baseFairValue"), value: baseFairValue, color: SCENARIO_COLOR.base },
    { key: "optimistic", label: t("companyDiagnostic.thermometer.optimistic"), value: optimistic, color: SCENARIO_COLOR.bull },
  ];

  return (
    <View style={{ marginTop: 6 }}>
      <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: colors.textMuted, marginBottom: 30 }}>
        {t("companyDiagnostic.thermometer.title")}
      </Text>

      <View style={{ height: 9, borderRadius: 4.5, overflow: "visible" }}>
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row", borderRadius: 4.5, overflow: "hidden" }}>
          <View style={{ flex: 1, backgroundColor: SCENARIO_COLOR.bear }} />
          <View style={{ flex: 1, backgroundColor: SCENARIO_COLOR.base }} />
          <View style={{ flex: 1, backgroundColor: SCENARIO_COLOR.bull }} />
        </View>

        {markers.map((m) => (
          <View key={m.key} style={{ position: "absolute", top: -2, left: `${pctOf(m.value)}%`, width: 3, height: 13, borderRadius: 1.5, backgroundColor: colors.card, borderWidth: 1.5, borderColor: m.color, transform: [{ translateX: -1.5 }] }} />
        ))}

        <View style={{ position: "absolute", top: -30, left: `${pricePct}%`, width: 150, marginLeft: -75, alignItems: "center" }}>
          <View style={{ borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: colors.text }}>
            <Text style={{ fontSize: 11, fontWeight: "900", color: colors.card }} numberOfLines={1} adjustsFontSizeToFit>
              {t("companyDiagnostic.thermometer.priceToday")} {fmtPrice(currentPrice)}
            </Text>
          </View>
          <View style={{ width: 2, height: 10, backgroundColor: colors.text }} />
        </View>
      </View>

      <View style={{ flexDirection: "row", marginTop: 12, gap: 6 }}>
        {markers.map((m) => (
          <View key={m.key} style={{ flex: 1, minWidth: 0, alignItems: "center" }}>
            <Text style={{ fontSize: 10.5, fontWeight: "800", color: m.color, textAlign: "center" }} numberOfLines={1}>{m.label}</Text>
            <Text style={{ fontSize: 12.5, fontWeight: "900", color: colors.text, textAlign: "center", marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{fmtPrice(m.value)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
