import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, Modal, ScrollView } from "react-native";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { useTheme, type Colors } from "../lib/ThemeContext";
import { calcularValorIntrinseco } from "../lib/dcfCalculator";

export interface RangeBounds {
  low: number;
  high: number;
}

export interface DcfAssumptions {
  methodology: string;
  suggested_g: number | null;
  suggested_r: number | null;
  suggested_gt: number | null;
  g_range: RangeBounds | null;
  r_range: RangeBounds | null;
  gt_range: RangeBounds | null;
  historical_growth_pct: number | null;
  moat_adjustment_pct: number | null;
  avg_roic_pct: number | null;
  avg_roe_pct: number | null;
  market_implied_growth_pct: number | null;
  business_quality: number | null;
  predictability: number | null;
  financial_strength: number | null;
  growth_outlook: number | null;
  management_capital_allocation: number | null;
}

export interface YearlyDetailRow {
  year: number;
  fcf: number;
  discount_factor: number;
  present_value: number;
}

interface ValorIntrinsecoProps {
  ticker: string;
  companyName: string | null;
  price: number | null;
  fcfRaw: number | null;
  netCashRaw: number | null;
  sharesRaw: number | null;
  assumptions: DcfAssumptions | null;
  yearlyDetail: YearlyDetailRow[] | null;
  pvOfFcfSum: number | null;
  pvOfTerminalValue: number | null;
  enterpriseValue: number | null;
  isPremium: boolean;
  onUnlock: () => void;
}

type Stoplight = "green" | "yellow" | "red";

function stoplightFor(value: number, range: RangeBounds | null): Stoplight {
  if (!range) return "yellow";
  const spread = range.high - range.low;
  if (value >= range.low && value <= range.high) return "green";
  if (value >= range.low - spread && value <= range.high + spread) return "yellow";
  return "red";
}

const STOPLIGHT_COLOR: Record<Stoplight, string> = { green: "#22c55e", yellow: "#f59e0b", red: "#ef4444" };
const STOPLIGHT_DOT: Record<Stoplight, string> = { green: "🟢", yellow: "🟡", red: "🔴" };

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "N/D";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(2)}`;
}

export default function ValorIntrinseco({
  ticker, companyName, price, fcfRaw, netCashRaw, sharesRaw, assumptions,
  yearlyDetail, pvOfFcfSum, pvOfTerminalValue, enterpriseValue, isPremium, onUnlock,
}: ValorIntrinsecoProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [level2Open, setLevel2Open] = useState(false);
  const [level3Open, setLevel3Open] = useState(false);

  const hasData = fcfRaw != null && netCashRaw != null && sharesRaw != null && price != null;
  const isFinancialSector = assumptions?.methodology === "residual_income_justified_pb";

  const fcf0 = hasData ? fcfRaw / 1e6 : 0;
  const netCash = hasData ? netCashRaw / 1e6 : 0;
  const shares = hasData ? sharesRaw / 1e6 : 0;
  const horizon = yearlyDetail && yearlyDetail.length > 0 ? yearlyDetail.length : 10;

  const suggestedG = assumptions?.suggested_g ?? 7;
  const suggestedR = assumptions?.suggested_r ?? 9;
  const suggestedGt = assumptions?.suggested_gt ?? 3;

  const [g, setG] = useState(suggestedG);
  const [r, setR] = useState(suggestedR);
  const [gt, setGt] = useState(suggestedGt);

  const isDefault = g === suggestedG && r === suggestedR && gt === suggestedGt;

  const liveResult = useMemo(() => {
    if (!hasData) return null;
    return calcularValorIntrinseco({ fcf0, g: g / 100, r: r / 100, gt: gt / 100, n: horizon, netCash, shares });
  }, [hasData, fcf0, g, r, gt, horizon, netCash, shares]);

  const liveMos = liveResult && price ? ((liveResult.valorPorAccion - price) / price) * 100 : null;
  const disabled = !isPremium;

  const resetToSuggested = () => { setG(suggestedG); setR(suggestedR); setGt(suggestedGt); };

  const askMentor = (question: string) => {
    router.push(`/chat?msg=${encodeURIComponent(question)}&autosend=1` as any);
  };

  const name = companyName || ticker;
  const mentorQuestions = [
    { key: "why", text: t("subvaluadas.dcf.mentor.why", { ticker: name }) },
    { key: "risk", text: t("subvaluadas.dcf.mentor.risk", { ticker: name }) },
    { key: "sensitivity", text: t("subvaluadas.dcf.mentor.sensitivity", { ticker: name }) },
    { key: "change", text: t("subvaluadas.dcf.mentor.change", { ticker: name }) },
  ];

  if (!hasData) {
    return (
      <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised, padding: 12 }}>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{t("subvaluadas.dcf.noData")}</Text>
      </View>
    );
  }

  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised }}>
      <TouchableOpacity
        onPress={() => setLevel2Open((o) => !o)}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 }}
      >
        <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>{t("subvaluadas.dcf.level2Toggle")}</Text>
        <Ionicons name={level2Open ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {level2Open && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 14 }}>
          {isFinancialSector ? (
            <Text style={{ fontSize: 11, lineHeight: 15, color: colors.textSub }}>{t("subvaluadas.dcf.financialSectorNote")}</Text>
          ) : (
            <>
              <AssumptionSlider
                label={t("subvaluadas.dcf.assumptions.growth")}
                tooltip={t("subvaluadas.dcf.assumptions.tooltips.growth")}
                valuePct={g} suggestedPct={suggestedG} min={0} max={25} step={0.5}
                range={assumptions?.g_range ?? null} disabled={disabled} onChange={setG} colors={colors}
              />
              <AssumptionSlider
                label={t("subvaluadas.dcf.assumptions.wacc")}
                tooltip={t("subvaluadas.dcf.assumptions.tooltips.wacc")}
                valuePct={r} suggestedPct={suggestedR} min={4} max={18} step={0.25}
                range={assumptions?.r_range ?? null} disabled={disabled} onChange={setR} colors={colors}
              />
              <AssumptionSlider
                label={t("subvaluadas.dcf.assumptions.terminalGrowth")}
                tooltip={t("subvaluadas.dcf.assumptions.tooltips.terminalGrowth")}
                valuePct={gt} suggestedPct={suggestedGt} min={0} max={5} step={0.25}
                range={assumptions?.gt_range ?? null} disabled={disabled} onChange={setGt} colors={colors}
              />

              {!disabled && !isDefault && (
                <TouchableOpacity onPress={resetToSuggested} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="refresh" size={12} color={colors.accentLight} />
                  <Text style={{ fontSize: 11, fontWeight: "700", color: colors.accentLight }}>{t("subvaluadas.dcf.reset")}</Text>
                </TouchableOpacity>
              )}

              {liveResult && liveMos !== null ? (
                <View style={{ borderRadius: 10, backgroundColor: colors.card, padding: 10 }}>
                  <Text style={{ fontSize: 9, fontWeight: "700", textTransform: "uppercase", color: colors.textMuted }}>
                    {t("subvaluadas.dcf.liveResult.intrinsicValue")}
                  </Text>
                  <Text style={{ fontSize: 20, fontWeight: "900", color: colors.text }}>${liveResult.valorPorAccion.toFixed(2)}</Text>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: liveMos >= 0 ? colors.up : colors.down }}>
                    {t("subvaluadas.dcf.liveResult.marginOfSafety")}: {liveMos >= 0 ? "+" : ""}{liveMos.toFixed(1)}%
                  </Text>
                </View>
              ) : (
                <Text style={{ fontSize: 11, color: colors.textMuted }}>{t("subvaluadas.dcf.liveResult.noSolution")}</Text>
              )}

              {assumptions?.market_implied_growth_pct != null && (
                <Text style={{ fontSize: 11, lineHeight: 15, color: colors.textDim }}>
                  {t("subvaluadas.dcf.marketImplied", { market: assumptions.market_implied_growth_pct.toFixed(1), nuvos: suggestedG.toFixed(1) })}
                </Text>
              )}

              {disabled && (
                <TouchableOpacity onPress={onUnlock} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="lock-closed" size={12} color={colors.accentLight} />
                  <Text style={{ fontSize: 11, fontWeight: "700", color: colors.accentLight }}>{t("subvaluadas.premiumGate.cta")}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          <View>
            <Text style={{ fontSize: 10, fontWeight: "700", textTransform: "uppercase", color: colors.textMuted, marginBottom: 6 }}>
              {t("subvaluadas.dcf.mentor.title")}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {mentorQuestions.map((q) => (
                <TouchableOpacity
                  key={q.key}
                  onPress={() => askMentor(q.text)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={11} color={colors.textSub} />
                  <Text style={{ fontSize: 10, fontWeight: "600", color: colors.textSub }}>{q.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {!isFinancialSector && (
            <TouchableOpacity onPress={() => setLevel3Open(true)}>
              <Text style={{ fontSize: 11, fontWeight: "700", textDecorationLine: "underline", color: colors.textMuted }}>
                {t("subvaluadas.dcf.level3Toggle")}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Modal visible={level3Open} animationType="slide" transparent onRequestClose={() => setLevel3Open(false)}>
        <Level3Modal
          ticker={ticker}
          price={price}
          fcf0={fcf0}
          netCash={netCash}
          shares={shares}
          g={g} r={r} gt={gt}
          yearlyDetail={yearlyDetail}
          pvOfFcfSum={pvOfFcfSum}
          pvOfTerminalValue={pvOfTerminalValue}
          enterpriseValue={enterpriseValue}
          colors={colors}
          onClose={() => setLevel3Open(false)}
        />
      </Modal>
    </View>
  );
}

function AssumptionSlider({
  label, tooltip, valuePct, suggestedPct, min, max, step, range, disabled, onChange, colors,
}: {
  label: string; tooltip: string; valuePct: number; suggestedPct: number;
  min: number; max: number; step: number; range: RangeBounds | null; disabled: boolean;
  onChange: (v: number) => void; colors: Colors;
}) {
  const { t } = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);
  const light = stoplightFor(valuePct, range);
  const suggestedMarkerPct = ((suggestedPct - min) / (max - min)) * 100;
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
        <TouchableOpacity onPress={() => setShowTooltip((s) => !s)} style={{ flexDirection: "row", alignItems: "center", gap: 4, flex: 1 }}>
          <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.textSub }}>{label}</Text>
          <Ionicons name="information-circle-outline" size={13} color={colors.textMuted} />
        </TouchableOpacity>
        <Text style={{ fontSize: 13 }}>{STOPLIGHT_DOT[light]}</Text>
        <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.text, marginLeft: 6 }}>{pct(valuePct)}</Text>
      </View>
      {showTooltip && (
        <Text style={{ fontSize: 10.5, lineHeight: 14, color: colors.textDim, marginBottom: 6 }}>{tooltip}</Text>
      )}
      <View>
        <Slider
          minimumValue={min}
          maximumValue={max}
          step={step}
          value={valuePct}
          disabled={disabled}
          onValueChange={onChange}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.accent}
          style={{ opacity: disabled ? 0.4 : 1, height: 32 }}
        />
        <View pointerEvents="none" style={{ position: "absolute", top: 13, left: `${suggestedMarkerPct}%`, width: 2, height: 10, backgroundColor: colors.accentLight }} />
      </View>
      <Text style={{ fontSize: 10, color: STOPLIGHT_COLOR[light] }}>{t(`subvaluadas.dcf.stoplight.${light}`)}</Text>
    </View>
  );
}

function BridgeRow({ label, value, bold, accent, colors }: { label: string; value: string; bold?: boolean; accent?: boolean; colors: Colors }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ fontSize: 11, color: colors.textSub }}>{label}</Text>
      <Text style={{ fontSize: 11, fontWeight: bold ? "700" : "400", color: accent ? colors.accentLight : colors.text }}>{value}</Text>
    </View>
  );
}

function Level3Modal({
  ticker, price, fcf0, netCash, shares, g, r, gt, yearlyDetail, pvOfFcfSum, pvOfTerminalValue, enterpriseValue, colors, onClose,
}: {
  ticker: string; price: number | null; fcf0: number; netCash: number; shares: number;
  g: number; r: number; gt: number;
  yearlyDetail: YearlyDetailRow[] | null; pvOfFcfSum: number | null; pvOfTerminalValue: number | null; enterpriseValue: number | null;
  colors: Colors; onClose: () => void;
}) {
  const { t } = useTranslation();
  const equityValue = enterpriseValue !== null ? enterpriseValue + netCash * 1e6 : null;
  const perShare = equityValue !== null && shares > 0 ? equityValue / (shares * 1e6) : null;
  const mos = perShare !== null && price ? ((perShare - price) / price) * 100 : null;

  const handleExport = async () => {
    const [XLSX, FileSystem, Sharing] = await Promise.all([
      import("xlsx"),
      import("expo-file-system/legacy"),
      import("expo-sharing"),
    ]);
    const wb = XLSX.utils.book_new();

    const inputsSheet = XLSX.utils.aoa_to_sheet([
      [t("subvaluadas.dcf.level3.inputs")],
      [t("subvaluadas.dcf.assumptions.growth"), pct(g)],
      [t("subvaluadas.dcf.assumptions.wacc"), pct(r)],
      [t("subvaluadas.dcf.assumptions.terminalGrowth"), pct(gt)],
      ["FCF (TTM, M)", fcf0.toFixed(1)],
      [t("subvaluadas.dcf.level3.bridge.netCash") + " (M)", netCash.toFixed(1)],
      [t("subvaluadas.dcf.level3.bridge.shares") + " (M)", shares.toFixed(1)],
      [t("subvaluadas.stats.price"), price ?? "N/D"],
    ]);
    XLSX.utils.book_append_sheet(wb, inputsSheet, "Inputs");

    if (yearlyDetail && yearlyDetail.length > 0) {
      const rows = [
        [
          t("subvaluadas.dcf.level3.yearlyTable.year"),
          t("subvaluadas.dcf.level3.yearlyTable.fcf"),
          t("subvaluadas.dcf.level3.yearlyTable.discountFactor"),
          t("subvaluadas.dcf.level3.yearlyTable.presentValue"),
        ],
        ...yearlyDetail.map((row) => [row.year, row.fcf, row.discount_factor, row.present_value]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Proyeccion");
    }

    const bridgeSheet = XLSX.utils.aoa_to_sheet([
      [t("subvaluadas.dcf.level3.bridge.pvFcf"), pvOfFcfSum ?? "N/D"],
      [t("subvaluadas.dcf.level3.bridge.pvTerminal"), pvOfTerminalValue ?? "N/D"],
      [t("subvaluadas.dcf.level3.bridge.enterpriseValue"), enterpriseValue ?? "N/D"],
      [t("subvaluadas.dcf.level3.bridge.netCash"), netCash * 1e6],
      [t("subvaluadas.dcf.level3.bridge.equityValue"), equityValue ?? "N/D"],
      [t("subvaluadas.dcf.level3.bridge.shares"), shares * 1e6],
      [t("subvaluadas.dcf.level3.bridge.perShare"), perShare ?? "N/D"],
    ]);
    XLSX.utils.book_append_sheet(wb, bridgeSheet, "Valuacion");

    const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    const path = (FileSystem.cacheDirectory ?? "") + `${ticker}_dcf_nuvos.xlsx`;
    await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" }}>
      <View style={{ maxHeight: "85%", borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: colors.card }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text }}>{t("subvaluadas.dcf.level3.title", { ticker })}</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[
              { label: t("subvaluadas.dcf.assumptions.growth"), value: pct(g) },
              { label: t("subvaluadas.dcf.assumptions.wacc"), value: pct(r) },
              { label: t("subvaluadas.dcf.assumptions.terminalGrowth"), value: pct(gt) },
            ].map((stat) => (
              <View key={stat.label} style={{ flex: 1, borderRadius: 10, backgroundColor: colors.bgRaised, padding: 8 }}>
                <Text style={{ fontSize: 9, fontWeight: "700", textTransform: "uppercase", color: colors.textMuted }}>{stat.label}</Text>
                <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text }}>{stat.value}</Text>
              </View>
            ))}
          </View>

          {yearlyDetail && yearlyDetail.length > 0 && (
            <View>
              <Text style={{ fontSize: 11, fontWeight: "700", textTransform: "uppercase", color: colors.textMuted, marginBottom: 6 }}>
                {t("subvaluadas.dcf.level3.yearlyTable.title")}
              </Text>
              <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                <View style={{ flexDirection: "row", backgroundColor: colors.bgRaised, paddingVertical: 6, paddingHorizontal: 8 }}>
                  <Text style={{ flex: 1, fontSize: 10, fontWeight: "700", color: colors.textMuted }}>{t("subvaluadas.dcf.level3.yearlyTable.year")}</Text>
                  <Text style={{ flex: 2, fontSize: 10, fontWeight: "700", color: colors.textMuted, textAlign: "right" }}>{t("subvaluadas.dcf.level3.yearlyTable.fcf")}</Text>
                  <Text style={{ flex: 2, fontSize: 10, fontWeight: "700", color: colors.textMuted, textAlign: "right" }}>{t("subvaluadas.dcf.level3.yearlyTable.presentValue")}</Text>
                </View>
                {yearlyDetail.map((row) => (
                  <View key={row.year} style={{ flexDirection: "row", paddingVertical: 6, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={{ flex: 1, fontSize: 10.5, fontWeight: "700", color: colors.text }}>{row.year}</Text>
                    <Text style={{ flex: 2, fontSize: 10.5, color: colors.textSub, textAlign: "right" }}>{fmtMoney(row.fcf)}</Text>
                    <Text style={{ flex: 2, fontSize: 10.5, fontWeight: "700", color: colors.text, textAlign: "right" }}>{fmtMoney(row.present_value)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View>
            <Text style={{ fontSize: 11, fontWeight: "700", textTransform: "uppercase", color: colors.textMuted, marginBottom: 6 }}>
              {t("subvaluadas.dcf.level3.bridge.title")}
            </Text>
            <View style={{ borderRadius: 10, backgroundColor: colors.bgRaised, padding: 10, gap: 6 }}>
              <BridgeRow label={t("subvaluadas.dcf.level3.bridge.pvFcf")} value={fmtMoney(pvOfFcfSum)} colors={colors} />
              <BridgeRow label={t("subvaluadas.dcf.level3.bridge.pvTerminal")} value={fmtMoney(pvOfTerminalValue)} colors={colors} />
              <BridgeRow label={t("subvaluadas.dcf.level3.bridge.enterpriseValue")} value={fmtMoney(enterpriseValue)} bold colors={colors} />
              <BridgeRow label={t("subvaluadas.dcf.level3.bridge.netCash")} value={fmtMoney(netCash * 1e6)} colors={colors} />
              <BridgeRow label={t("subvaluadas.dcf.level3.bridge.equityValue")} value={fmtMoney(equityValue)} bold colors={colors} />
              <BridgeRow label={t("subvaluadas.dcf.level3.bridge.shares")} value={`${shares.toFixed(1)}M`} colors={colors} />
              <View style={{ paddingTop: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
                <BridgeRow label={t("subvaluadas.dcf.level3.bridge.perShare")} value={perShare !== null ? `$${perShare.toFixed(2)}` : "N/D"} bold accent colors={colors} />
              </View>
              {mos !== null && (
                <Text style={{ fontSize: 11, color: mos >= 0 ? colors.up : colors.down }}>
                  {t("subvaluadas.dcf.liveResult.marginOfSafety")}: {mos >= 0 ? "+" : ""}{mos.toFixed(1)}%
                </Text>
              )}
            </View>
          </View>

          <TouchableOpacity
            onPress={handleExport}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised }}
          >
            <Ionicons name="document-text-outline" size={15} color={colors.text} />
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>{t("subvaluadas.dcf.level3.export")}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </View>
  );
}
