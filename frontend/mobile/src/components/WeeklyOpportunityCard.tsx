import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import StockAvatar from "./StockAvatar";

// Diego, 2026-09-24: "mejores el diseño x10000, agregues logos de las
// empresas, nombres, tickers, escenarios pesimistas, base y optimista."
// Shared by the Screener tab and MobileWeeklyScreener (the card on Home)
// so both surfaces of "el único" Screener Semanal render the exact same
// real numbers, the exact same way.
export interface WeeklyOpportunity {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  intrinsic_value_base: number | null;
  intrinsic_value_conservative: number | null;
  intrinsic_value_optimistic: number | null;
  margin_of_safety_pct: number | null;
  thesis_scores: Record<string, number> | null;
}

function fmt(v: number | null | undefined): string {
  return v != null ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—";
}

export default function WeeklyOpportunityCard({ pick, rank }: { pick: WeeklyOpportunity; rank: number }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const mos = pick.margin_of_safety_pct;
  const bq = pick.thesis_scores?.business_quality;
  const hasScenarios = pick.intrinsic_value_conservative != null || pick.intrinsic_value_optimistic != null;

  return (
    <View style={[s.card, { borderTopColor: colors.border }]}>
      {/* Header: logo, ticker/name, margin of safety */}
      <View style={s.headerRow}>
        <Text style={[s.rank, { color: colors.textDim ?? colors.textMuted }]}>{rank}</Text>
        <StockAvatar ticker={pick.ticker} size={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.tickerRow}>
            <Text style={[s.ticker, { color: colors.text }]}>{pick.ticker}</Text>
            {pick.company_name && (
              <Text style={[s.name, { color: colors.textMuted }]} numberOfLines={1}>{pick.company_name}</Text>
            )}
          </View>
          <View style={s.tickerRow}>
            {pick.sector && (
              <View style={[s.sectorBadge, { backgroundColor: colors.bgRaised }]}>
                <Text style={[s.sectorText, { color: colors.textMuted }]}>{pick.sector}</Text>
              </View>
            )}
            {bq != null && (
              <Text style={[s.bqText, { color: colors.textSub }]}>Business Quality {bq}/100</Text>
            )}
          </View>
        </View>
        {mos != null && (
          <View style={s.mosBadge}>
            <Text style={s.mosText}>+{mos.toFixed(1)}%</Text>
          </View>
        )}
      </View>

      {/* Current price + 3 scenarios */}
      <View style={s.bottomRow}>
        <View>
          <Text style={[s.label, { color: colors.textDim ?? colors.textMuted }]}>{t("weeklyOpportunityCard.priceNow")}</Text>
          <Text style={[s.priceValue, { color: colors.text }]}>{fmt(pick.price)}</Text>
        </View>
        {hasScenarios ? (
          <View style={s.scenarios}>
            <View style={[s.scenarioBox, { backgroundColor: colors.bgRaised }]}>
              <Text style={s.scenarioLabelBear}>{t("subvaluadas.scenarios.pessimistic")}</Text>
              <Text style={[s.scenarioValue, { color: colors.text }]}>{fmt(pick.intrinsic_value_conservative)}</Text>
            </View>
            <View style={[s.scenarioBox, s.scenarioBoxBase]}>
              <Text style={s.scenarioLabelBase}>{t("subvaluadas.scenarios.base")}</Text>
              <Text style={[s.scenarioValue, s.scenarioValueBase]}>{fmt(pick.intrinsic_value_base)}</Text>
            </View>
            <View style={[s.scenarioBox, { backgroundColor: colors.bgRaised }]}>
              <Text style={s.scenarioLabelBull}>{t("subvaluadas.scenarios.optimistic")}</Text>
              <Text style={[s.scenarioValue, { color: colors.text }]}>{fmt(pick.intrinsic_value_optimistic)}</Text>
            </View>
          </View>
        ) : (
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[s.label, { color: colors.textDim ?? colors.textMuted }]}>{t("weeklyOpportunityCard.intrinsicValue")}</Text>
            <Text style={[s.priceValue, { color: colors.accentLight }]}>{fmt(pick.intrinsic_value_base)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: StyleSheet.hairlineWidth },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rank: { fontSize: 10, fontWeight: "900", width: 14, textAlign: "center" },
  tickerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  ticker: { fontSize: 14, fontWeight: "900" },
  name: { fontSize: 11, flexShrink: 1 },
  sectorBadge: { borderRadius: 20, paddingHorizontal: 6, paddingVertical: 1 },
  sectorText: { fontSize: 9, fontWeight: "600" },
  bqText: { fontSize: 9, fontWeight: "600" },
  mosBadge: { backgroundColor: "rgba(34,197,94,0.16)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  mosText: { fontSize: 12, fontWeight: "900", color: "#22c55e" },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, gap: 8 },
  label: { fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  priceValue: { fontSize: 13, fontWeight: "800", marginTop: 1 },
  scenarios: { flex: 1, flexDirection: "row", gap: 6, maxWidth: "72%" },
  scenarioBox: { flex: 1, borderRadius: 10, paddingVertical: 6, alignItems: "center" },
  scenarioBoxBase: { backgroundColor: "rgba(0,168,94,0.1)", borderWidth: 1, borderColor: "rgba(0,168,94,0.3)" },
  scenarioLabelBear: { fontSize: 7, fontWeight: "800", color: "#f87171", textTransform: "uppercase" },
  scenarioLabelBase: { fontSize: 7, fontWeight: "800", color: "#00d47e", textTransform: "uppercase" },
  scenarioLabelBull: { fontSize: 7, fontWeight: "800", color: "#4ade80", textTransform: "uppercase" },
  scenarioValue: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  scenarioValueBase: { color: "#00d47e", fontWeight: "900" },
});
