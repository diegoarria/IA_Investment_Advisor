import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme, type Colors } from "../lib/ThemeContext";
import { calcularValorIntrinseco, margenDeSeguridad } from "../lib/dcfCalculator";

// Duplicated from app/subvaluadas/index.tsx's own DcfAssumptions rather than
// importing a type from a route file (Expo Router treats every app/ file as
// a route — importing from one for a type-only re-export is fragile) —
// matches this repo's existing "no shared package" precedent, same as
// dcfCalculator.ts itself.
export interface DcfAssumptions {
  methodology: string;
  suggested_g: number | null;
  suggested_r: number | null;
  suggested_gt: number | null;
  historical_growth_pct: number | null;
  moat_adjustment_pct: number | null;
  avg_roic_pct: number | null;
  avg_roe_pct: number | null;
  market_implied_growth_pct: number | null;
  business_quality: number | null;
  predictability: number | null;
}

interface MobileDcfCalculatorProps {
  ticker: string;
  price: number | null;
  /** Raw dollars (not millions) — converted internally. When any of these
   * three is null, the ticker's data source doesn't have it and the whole
   * calculator doesn't render — this tool never asks the user to type in
   * a company's financials themselves. */
  fcfRaw: number | null;
  netCashRaw: number | null;
  sharesRaw: number | null;
  assumptions: DcfAssumptions | null;
  isPremium: boolean;
  onUnlock: () => void;
}

const G_MIN = 0.03, G_MAX = 0.15, G_STEP = 0.005, G_FALLBACK = 0.07;
const R_MIN = 0.07, R_MAX = 0.13, R_STEP = 0.005, R_FALLBACK = 0.09;
const GT_MIN = 0.01, GT_MAX = 0.04, GT_STEP = 0.005, GT_FALLBACK = 0.03;

const GRID_R_OFFSETS = [-0.02, -0.01, 0, 0.01, 0.02];
const GRID_G_OFFSETS = [-0.04, -0.02, 0, 0.02, 0.04];

function pctLabel(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function clampToRange(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
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

export default function MobileDcfCalculator({ ticker, price, fcfRaw, netCashRaw, sharesRaw, assumptions, isPremium, onUnlock }: MobileDcfCalculatorProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  // Every input comes from Nuvos's own real valuation engine — no manual
  // entry, no placeholder. Hooks below must still run unconditionally on
  // every render (Rules of Hooks), so the "missing data" bailout happens
  // in the return at the bottom, not here.
  const hasData = fcfRaw != null && netCashRaw != null && sharesRaw != null && price != null;

  const fcf0 = hasData ? fcfRaw / 1e6 : 0;
  const netCash = hasData ? netCashRaw / 1e6 : 0;
  const shares = hasData ? sharesRaw / 1e6 : 0;

  const suggestedG = assumptions?.suggested_g != null ? clampToRange(assumptions.suggested_g / 100, G_MIN, G_MAX) : G_FALLBACK;
  const suggestedR = assumptions?.suggested_r != null ? clampToRange(assumptions.suggested_r / 100, R_MIN, R_MAX) : R_FALLBACK;
  const suggestedGt = assumptions?.suggested_gt != null ? clampToRange(assumptions.suggested_gt / 100, GT_MIN, GT_MAX) : GT_FALLBACK;

  const [g, setG] = useState(suggestedG);
  const [r, setR] = useState(suggestedR);
  const [gt, setGt] = useState(suggestedGt);

  const result = useMemo(
    () => calcularValorIntrinseco({ fcf0, g, r, gt, netCash, shares }),
    [fcf0, g, r, gt, netCash, shares]
  );

  const mos = result && price != null ? margenDeSeguridad(result.valorPorAccion, price) : null;

  const sensitivity = useMemo(() => {
    return GRID_R_OFFSETS.map((dr) =>
      GRID_G_OFFSETS.map((dg) => {
        const res = calcularValorIntrinseco({ fcf0, g: g + dg, r: r + dr, gt, netCash, shares });
        return res?.valorPorAccion ?? null;
      })
    );
  }, [fcf0, netCash, shares, g, r, gt]);

  const disabled = !isPremium;

  if (!hasData) return null;

  return (
    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14, gap: 12 }}>
      <Text style={{ fontSize: 10.5, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", color: colors.textMuted }}>
        {t("dcfCalculator.title", { ticker })}
      </Text>

      {assumptions && <GuidancePanel assumptions={assumptions} suggestedG={suggestedG} suggestedR={suggestedR} suggestedGt={suggestedGt} colors={colors} />}

      {/* Sliders */}
      <View style={{ gap: 10 }}>
        <SliderRow label={t("dcfCalculator.growthLabel")} value={g} onChange={setG} min={G_MIN} max={G_MAX} step={G_STEP} disabled={disabled} formatted={pctLabel(g)} suggested={suggestedG} colors={colors} />
        <SliderRow label={t("dcfCalculator.discountLabel")} value={r} onChange={setR} min={R_MIN} max={R_MAX} step={R_STEP} disabled={disabled} formatted={pctLabel(r)} suggested={suggestedR} colors={colors} />
        <SliderRow label={t("dcfCalculator.terminalGrowthLabel")} value={gt} onChange={setGt} min={GT_MIN} max={GT_MAX} step={GT_STEP} disabled={disabled} formatted={pctLabel(gt)} suggested={suggestedGt} colors={colors} />
        {!disabled && (g !== suggestedG || r !== suggestedR || gt !== suggestedGt) && (
          <TouchableOpacity onPress={() => { setG(suggestedG); setR(suggestedR); setGt(suggestedGt); }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.accentLight }}>{t("dcfCalculator.resetToSuggested")}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Resultado */}
      {result && mos != null ? (
        <View style={{ borderRadius: 12, backgroundColor: colors.bgRaised, padding: 12 }}>
          <Text style={{ fontSize: 10, fontWeight: "700", textTransform: "uppercase", color: colors.textMuted }}>{t("dcfCalculator.intrinsicValue")}</Text>
          <Text style={{ fontSize: 28, fontWeight: "900", color: colors.text }}>${result.valorPorAccion.toFixed(2)}</Text>
          <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 2 }}>{t("dcfCalculator.vsCurrentPrice", { price })}</Text>
          <View style={{ alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: mos >= 0 ? "rgba(0,184,109,0.12)" : "rgba(239,68,68,0.12)" }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: mos >= 0 ? colors.up : colors.down }}>
              {mos >= 0
                ? t("dcfCalculator.marginPositive", { pct: (mos * 100).toFixed(1) })
                : t("dcfCalculator.marginNegative", { pct: (mos * 100).toFixed(1) })}
            </Text>
          </View>

          {(() => {
            const maxVal = Math.max(price!, result.valorPorAccion) * 1.15;
            const pricePct = (price! / maxVal) * 100;
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
        <View style={{ flexDirection: "row" }}>
          <View style={{ width: 34 }} />
          {GRID_G_OFFSETS.map((_, ci) => (
            <View key={ci} style={{ flex: 1, alignItems: "center", marginBottom: 4 }}>
              <Text style={{ fontSize: 8.5, fontWeight: "700", color: colors.textMuted }}>{pctLabel(g + GRID_G_OFFSETS[ci])}</Text>
            </View>
          ))}
        </View>
        {sensitivity.map((row, ri) => (
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

      {/* Disclaimer — siempre visible, nunca colapsable */}
      <View style={{ borderRadius: 10, backgroundColor: "rgba(245,158,11,0.08)", borderWidth: 1, borderColor: "rgba(245,158,11,0.25)", padding: 10 }}>
        <Text style={{ fontSize: 10, lineHeight: 14, color: "#f59e0b" }}>{t("dcfCalculator.disclaimer")}</Text>
      </View>
    </View>
  );
}

function GuidancePanel({ assumptions, suggestedG, suggestedR, suggestedGt, colors }: {
  assumptions: DcfAssumptions; suggestedG: number; suggestedR: number; suggestedGt: number; colors: Colors;
}) {
  const { t } = useTranslation();
  const isFinancial = assumptions.methodology === "residual_income_justified_pb";
  const lineStyle = { fontSize: 11, lineHeight: 15, color: colors.textSub };

  return (
    <View style={{ borderRadius: 12, backgroundColor: "rgba(0,168,94,0.05)", borderWidth: 1, borderColor: "rgba(0,168,94,0.18)", padding: 10, gap: 5 }}>
      <Text style={{ fontSize: 10, fontWeight: "700", textTransform: "uppercase", color: colors.accentLight }}>{t("dcfCalculator.guidanceTitle")}</Text>

      {isFinancial ? (
        <>
          <Text style={lineStyle}>{t("dcfCalculator.guidance.financialIntro")}</Text>
          {assumptions.avg_roe_pct != null && (
            <Text style={lineStyle}>
              {t("dcfCalculator.guidance.financialRoe", { roe: assumptions.avg_roe_pct.toFixed(1), r: pctLabel(suggestedR) })}
            </Text>
          )}
          <Text style={lineStyle}>{t("dcfCalculator.guidance.suggestedGt", { gt: pctLabel(suggestedGt) })}</Text>
        </>
      ) : (
        <>
          {assumptions.historical_growth_pct != null && assumptions.moat_adjustment_pct != null ? (
            <Text style={lineStyle}>
              {t("dcfCalculator.guidance.growthBuildup", {
                historical: assumptions.historical_growth_pct.toFixed(1),
                sign: assumptions.moat_adjustment_pct >= 0 ? "+" : "",
                adjustment: assumptions.moat_adjustment_pct.toFixed(1),
                g: pctLabel(suggestedG),
              })}
            </Text>
          ) : (
            <Text style={lineStyle}>{t("dcfCalculator.guidance.suggestedGOnly", { g: pctLabel(suggestedG) })}</Text>
          )}
          <Text style={lineStyle}>{t("dcfCalculator.guidance.suggestedR", { r: pctLabel(suggestedR) })}</Text>
          {assumptions.market_implied_growth_pct != null && (
            <Text style={lineStyle}>{t("dcfCalculator.guidance.marketImplied", { pct: assumptions.market_implied_growth_pct.toFixed(1) })}</Text>
          )}
        </>
      )}

      {(assumptions.business_quality != null || assumptions.predictability != null) && (
        <Text style={{ fontSize: 11, lineHeight: 15, color: colors.textDim }}>
          {assumptions.business_quality != null ? t("dcfCalculator.guidance.businessQuality", { score: assumptions.business_quality }) : ""}
          {assumptions.business_quality != null && assumptions.predictability != null ? " · " : ""}
          {assumptions.predictability != null ? t("dcfCalculator.guidance.predictability", { score: assumptions.predictability }) : ""}
        </Text>
      )}
    </View>
  );
}

function SliderRow({ label, value, onChange, min, max, step, disabled, formatted, suggested, colors }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; disabled: boolean; formatted: string; suggested: number; colors: Colors;
}) {
  const suggestedPct = ((suggested - min) / (max - min)) * 100;
  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
        <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.textSub }}>{label}</Text>
        <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.text }}>{formatted}</Text>
      </View>
      <View>
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
        <View pointerEvents="none" style={{ position: "absolute", top: 13, left: `${suggestedPct}%`, width: 2, height: 10, backgroundColor: colors.accentLight }} />
      </View>
    </View>
  );
}
