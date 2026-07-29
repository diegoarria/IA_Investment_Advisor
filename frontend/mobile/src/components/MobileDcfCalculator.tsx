import React, { useMemo, useState } from "react";
import { View, Text, TextInput } from "react-native";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme, type Colors } from "../lib/ThemeContext";
import { calcularValorIntrinseco, margenDeSeguridad } from "../lib/dcfCalculator";

interface MobileDcfCalculatorProps {
  ticker: string;
  price: number | null;
  /** Raw dollars (not millions) — converted internally. Null when the data source doesn't have it for this ticker. */
  fcfRaw: number | null;
  netCashRaw: number | null;
  sharesRaw: number | null;
  isPremium: boolean;
  onUnlock: () => void;
}

const G_MIN = 0.03, G_MAX = 0.15, G_STEP = 0.005, G_DEFAULT = 0.07;
const R_MIN = 0.07, R_MAX = 0.13, R_STEP = 0.005, R_DEFAULT = 0.09;
const GT_MIN = 0.01, GT_MAX = 0.04, GT_STEP = 0.005, GT_DEFAULT = 0.03;

const GRID_R_OFFSETS = [-0.02, -0.01, 0, 0.01, 0.02];
const GRID_G_OFFSETS = [-0.04, -0.02, 0, 0.02, 0.04];

function pctLabel(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

// Coral (#DD6E63) -> gold (#D4A24C) -> teal (#4FA695), interpolated by
// value/price ratio — same formula as web's DcfCalculator.tsx, kept
// identical by inspection since there's no shared package for this repo.
function cellColor(ratio: number): string {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const mix = (c1: string, c2: string, t: number) => {
    const p1 = [parseInt(c1.slice(1, 3), 16), parseInt(c1.slice(3, 5), 16), parseInt(c1.slice(5, 7), 16)];
    const p2 = [parseInt(c2.slice(1, 3), 16), parseInt(c2.slice(3, 5), 16), parseInt(c2.slice(5, 7), 16)];
    const rgb = p1.map((c, i) => lerp(c, p2[i], t));
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  };
  if (ratio <= 1) {
    const t = clamp((ratio - 0.6) / 0.4, 0, 1);
    return mix("#DD6E63", "#D4A24C", t);
  }
  const t = clamp((ratio - 1) / 0.5, 0, 1);
  return mix("#D4A24C", "#4FA695", t);
}

export default function MobileDcfCalculator({ ticker, price, fcfRaw, netCashRaw, sharesRaw, isPremium, onUnlock }: MobileDcfCalculatorProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [fcf0, setFcf0] = useState<number | "">(fcfRaw != null ? Math.round(fcfRaw / 1e6) : "");
  const [netCash, setNetCash] = useState<number | "">(netCashRaw != null ? Math.round(netCashRaw / 1e6) : "");
  const [shares, setShares] = useState<number | "">(sharesRaw != null ? Math.round(sharesRaw / 1e6) : "");
  const [g, setG] = useState(G_DEFAULT);
  const [r, setR] = useState(R_DEFAULT);
  const [gt, setGt] = useState(GT_DEFAULT);

  const inputsReady = fcf0 !== "" && netCash !== "" && shares !== "" && price != null;

  const result = useMemo(() => {
    if (!inputsReady) return null;
    return calcularValorIntrinseco({ fcf0: Number(fcf0), g, r, gt, netCash: Number(netCash), shares: Number(shares) });
  }, [inputsReady, fcf0, g, r, gt, netCash, shares]);

  const mos = result && price != null ? margenDeSeguridad(result.valorPorAccion, price) : null;

  const sensitivity = useMemo(() => {
    if (!inputsReady) return null;
    return GRID_R_OFFSETS.map((dr) =>
      GRID_G_OFFSETS.map((dg) => {
        const res = calcularValorIntrinseco({ fcf0: Number(fcf0), g: g + dg, r: r + dr, gt, netCash: Number(netCash), shares: Number(shares) });
        return res?.valorPorAccion ?? null;
      })
    );
  }, [inputsReady, fcf0, netCash, shares, g, r, gt]);

  const disabled = !isPremium;

  return (
    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14, gap: 12 }}>
      <Text style={{ fontSize: 10.5, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", color: colors.textMuted }}>
        {t("dcfCalculator.title", { ticker })}
      </Text>

      {/* Chips de autocompletado */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <DataChip label={t("dcfCalculator.fcf")} value={fcf0} onChange={setFcf0} available={fcfRaw != null} colors={colors} />
        <DataChip label={t("dcfCalculator.netCash")} value={netCash} onChange={setNetCash} available={netCashRaw != null} colors={colors} />
        <DataChip label={t("dcfCalculator.shares")} value={shares} onChange={setShares} available={sharesRaw != null} colors={colors} />
        <View style={{ flexBasis: "47%", flexGrow: 1, borderRadius: 12, backgroundColor: colors.bgRaised, padding: 8 }}>
          <Text style={{ fontSize: 9, fontWeight: "700", textTransform: "uppercase", color: colors.textMuted }}>{t("dcfCalculator.currentPrice")}</Text>
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>{price != null ? `$${price}` : t("dcfCalculator.notAvailable")}</Text>
        </View>
      </View>

      {!inputsReady && (
        <Text style={{ fontSize: 11, color: colors.textDim }}>{t("dcfCalculator.missingDataHint")}</Text>
      )}

      {inputsReady && (
        <>
          {/* Sliders */}
          <View style={{ gap: 10 }}>
            <SliderRow label={t("dcfCalculator.growthLabel")} value={g} onChange={setG} min={G_MIN} max={G_MAX} step={G_STEP} disabled={disabled} formatted={pctLabel(g)} colors={colors} />
            <SliderRow label={t("dcfCalculator.discountLabel")} value={r} onChange={setR} min={R_MIN} max={R_MAX} step={R_STEP} disabled={disabled} formatted={pctLabel(r)} colors={colors} />
            <SliderRow label={t("dcfCalculator.terminalGrowthLabel")} value={gt} onChange={setGt} min={GT_MIN} max={GT_MAX} step={GT_STEP} disabled={disabled} formatted={pctLabel(gt)} colors={colors} />
          </View>

          {/* Resultado */}
          {result && mos != null ? (
            <View style={{ borderRadius: 12, backgroundColor: colors.bgRaised, padding: 12 }}>
              <Text style={{ fontSize: 10, fontWeight: "700", textTransform: "uppercase", color: colors.textMuted }}>{t("dcfCalculator.intrinsicValue")}</Text>
              <Text style={{ fontSize: 28, fontWeight: "900", color: colors.text }}>${result.valorPorAccion.toFixed(2)}</Text>
              {price != null && (
                <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 2 }}>{t("dcfCalculator.vsCurrentPrice", { price })}</Text>
              )}
              <View style={{ alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: mos >= 0 ? "rgba(0,184,109,0.12)" : "rgba(239,68,68,0.12)" }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: mos >= 0 ? colors.up : colors.down }}>
                  {mos >= 0
                    ? t("dcfCalculator.marginPositive", { pct: (mos * 100).toFixed(1) })
                    : t("dcfCalculator.marginNegative", { pct: (mos * 100).toFixed(1) })}
                </Text>
              </View>

              {price != null && (() => {
                const maxVal = Math.max(price, result.valorPorAccion) * 1.15;
                const pricePct = (price / maxVal) * 100;
                const viPct = (result.valorPorAccion / maxVal) * 100;
                return (
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, marginTop: 14 }}>
                    <View style={{ position: "absolute", top: -3, left: `${pricePct}%`, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.textSub, marginLeft: -6 }} />
                    <View style={{ position: "absolute", top: -3, left: `${viPct}%`, width: 12, height: 12, borderRadius: 6, backgroundColor: mos >= 0 ? colors.up : colors.down, marginLeft: -6 }} />
                  </View>
                );
              })()}
            </View>
          ) : (
            <Text style={{ fontSize: 11, color: colors.textDim }}>{t("dcfCalculator.noSolution")}</Text>
          )}

          {/* Mapa de sensibilidad */}
          <View>
            <Text style={{ fontSize: 10, fontWeight: "700", textTransform: "uppercase", color: colors.textMuted, marginBottom: 8 }}>
              {t("dcfCalculator.sensitivityTitle")}
            </Text>
            {sensitivity && (
              <View style={{ flexDirection: "row" }}>
                <View style={{ width: 34 }} />
                {GRID_G_OFFSETS.map((_, ci) => (
                  <View key={ci} style={{ flex: 1, alignItems: "center", marginBottom: 4 }}>
                    <Text style={{ fontSize: 8.5, fontWeight: "700", color: colors.textMuted }}>{pctLabel(g + GRID_G_OFFSETS[ci])}</Text>
                  </View>
                ))}
              </View>
            )}
            {sensitivity?.map((row, ri) => (
              <View key={ri} style={{ flexDirection: "row", marginBottom: 3 }}>
                <View style={{ width: 34, justifyContent: "center" }}>
                  <Text style={{ fontSize: 8.5, fontWeight: "700", color: colors.textMuted, textAlign: "right", paddingRight: 4 }}>
                    {pctLabel(r + GRID_R_OFFSETS[ri])}
                  </Text>
                </View>
                {row.map((val, ci) => {
                  const isCenter = ri === 2 && ci === 2;
                  const noSolution = val == null;
                  const ratio = val != null && price ? val / price : 1;
                  return (
                    <View
                      key={ci}
                      style={{
                        flex: 1, marginHorizontal: 1.5, borderRadius: 6, paddingVertical: 8,
                        alignItems: "center", justifyContent: "center",
                        backgroundColor: noSolution ? colors.bgRaised : cellColor(ratio),
                        borderWidth: isCenter ? 2 : 0, borderColor: colors.text,
                      }}
                    >
                      <Text style={{ fontSize: 9, fontWeight: "800", color: noSolution ? colors.textDim : "#0a1628" }}>
                        {noSolution ? "N/D" : `$${val!.toFixed(0)}`}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
            {disabled && (
              <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", gap: 8, padding: 12 }}>
                <Ionicons name="lock-closed" size={18} color="rgba(255,255,255,0.85)" />
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff", textAlign: "center" }}>{t("dcfCalculator.unlockTitle")}</Text>
                <View style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.accent }} onTouchEnd={onUnlock}>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: "#04140c" }}>{t("dcfCalculator.unlockCta")}</Text>
                </View>
              </View>
            )}
          </View>

          <Text style={{ fontSize: 10, lineHeight: 14, color: colors.textDim }}>{t("dcfCalculator.sensitivityNote")}</Text>
        </>
      )}

      {/* Disclaimer — siempre visible, nunca colapsable */}
      <View style={{ borderRadius: 10, backgroundColor: "rgba(245,158,11,0.08)", borderWidth: 1, borderColor: "rgba(245,158,11,0.25)", padding: 10 }}>
        <Text style={{ fontSize: 10, lineHeight: 14, color: "#f59e0b" }}>{t("dcfCalculator.disclaimer")}</Text>
      </View>
    </View>
  );
}

function DataChip({ label, value, onChange, available, colors }: {
  label: string; value: number | ""; onChange: (v: number | "") => void; available: boolean; colors: Colors;
}) {
  const { t } = useTranslation();
  if (available) {
    return (
      <View style={{ flexBasis: "47%", flexGrow: 1, borderRadius: 12, backgroundColor: colors.bgRaised, padding: 8 }}>
        <Text style={{ fontSize: 9, fontWeight: "700", textTransform: "uppercase", color: colors.textMuted }}>{label}</Text>
        <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>{value !== "" ? `$${value}M` : "—"}</Text>
      </View>
    );
  }
  return (
    <View style={{ flexBasis: "47%", flexGrow: 1, borderRadius: 12, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", padding: 8 }}>
      <Text style={{ fontSize: 9, fontWeight: "700", textTransform: "uppercase", color: colors.textMuted }}>{label}</Text>
      <TextInput
        value={value === "" ? "" : String(value)}
        onChangeText={(txt) => onChange(txt === "" ? "" : Number(txt.replace(/[^0-9.-]/g, "")))}
        keyboardType="numeric"
        placeholder={t("dcfCalculator.enterManually") ?? undefined}
        placeholderTextColor={colors.textMuted}
        style={{ fontSize: 12, fontWeight: "700", color: colors.text, padding: 0 }}
      />
    </View>
  );
}

function SliderRow({ label, value, onChange, min, max, step, disabled, formatted, colors }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; disabled: boolean; formatted: string; colors: Colors;
}) {
  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
        <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.textSub }}>{label}</Text>
        <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.text }}>{formatted}</Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.accent}
        style={{ opacity: disabled ? 0.4 : 1, height: 32 }}
      />
    </View>
  );
}
