"use client";

import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { calcularValorIntrinseco, margenDeSeguridad } from "@/lib/dcfCalculator";

interface DcfCalculatorProps {
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

// Coral (#DD6E63) -> dourado/gold (#D4A24C) -> teal (#4FA695), interpolated by
// value/price ratio. These three hex values are the only place this feature
// intentionally deviates from the app's --accent green — a diverging
// coral/teal read (below/above fair value) doesn't map onto a single-hue
// brand accent, so it borrows the app's semantic --up/--down pair instead.
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
    const t = clamp((ratio - 0.6) / 0.4, 0, 1); // 0.6x..1.0x -> coral..gold
    return mix("#DD6E63", "#D4A24C", t);
  }
  const t = clamp((ratio - 1) / 0.5, 0, 1); // 1.0x..1.5x -> gold..teal
  return mix("#D4A24C", "#4FA695", t);
}

export default function DcfCalculator({ ticker, price, fcfRaw, netCashRaw, sharesRaw, isPremium, onUnlock }: DcfCalculatorProps) {
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
        const rr = r + dr;
        const gg = g + dg;
        const res = calcularValorIntrinseco({ fcf0: Number(fcf0), g: gg, r: rr, gt, netCash: Number(netCash), shares: Number(shares) });
        return { value: res?.valorPorAccion ?? null, rr, gg };
      })
    );
  }, [inputsReady, fcf0, netCash, shares, g, r, gt]);

  const disabled = !isPremium;

  return (
    <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        {t("dcfCalculator.title", { ticker })}
      </p>

      {/* ── Chips de autocompletado ── */}
      <div className="grid grid-cols-2 gap-2">
        <DataChip label={t("dcfCalculator.fcf")} value={fcf0} onChange={setFcf0} available={fcfRaw != null} />
        <DataChip label={t("dcfCalculator.netCash")} value={netCash} onChange={setNetCash} available={netCashRaw != null} />
        <DataChip label={t("dcfCalculator.shares")} value={shares} onChange={setShares} available={sharesRaw != null} />
        <div className="rounded-xl px-2.5 py-1.5" style={{ background: "var(--raised)" }}>
          <p className="text-[9px] font-bold uppercase tracking-wide truncate" style={{ color: "var(--muted)" }}>{t("dcfCalculator.currentPrice")}</p>
          <p className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{price != null ? `$${price}` : t("dcfCalculator.notAvailable")}</p>
        </div>
      </div>

      {!inputsReady && (
        <p className="text-[11px]" style={{ color: "var(--dim)" }}>{t("dcfCalculator.missingDataHint")}</p>
      )}

      {inputsReady && (
        <>
          {/* ── Sliders ── */}
          <div className="space-y-3">
            <SliderRow label={t("dcfCalculator.growthLabel")} value={g} onChange={setG} min={G_MIN} max={G_MAX} step={G_STEP} disabled={disabled} formatted={pctLabel(g)} />
            <SliderRow label={t("dcfCalculator.discountLabel")} value={r} onChange={setR} min={R_MIN} max={R_MAX} step={R_STEP} disabled={disabled} formatted={pctLabel(r)} />
            <SliderRow label={t("dcfCalculator.terminalGrowthLabel")} value={gt} onChange={setGt} min={GT_MIN} max={GT_MAX} step={GT_STEP} disabled={disabled} formatted={pctLabel(gt)} />
          </div>

          {/* ── Resultado ── */}
          {result && mos != null ? (
            <div className="rounded-xl p-3" style={{ background: "var(--raised)" }}>
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("dcfCalculator.intrinsicValue")}</p>
              <p className="text-3xl font-black" style={{ color: "var(--text)" }}>${result.valorPorAccion.toFixed(2)}</p>
              {price != null && (
                <p className="text-xs mt-0.5" style={{ color: "var(--sub)" }}>{t("dcfCalculator.vsCurrentPrice", { price })}</p>
              )}
              <span
                className="inline-block mt-2 text-xs font-bold px-2.5 py-1 rounded-full"
                style={{
                  background: mos >= 0 ? "rgba(0,184,109,0.12)" : "rgba(239,68,68,0.12)",
                  color: mos >= 0 ? "var(--up)" : "var(--down)",
                }}
              >
                {mos >= 0
                  ? t("dcfCalculator.marginPositive", { pct: (mos * 100).toFixed(1) })
                  : t("dcfCalculator.marginNegative", { pct: (mos * 100).toFixed(1) })}
              </span>

              {/* Barra comparativa */}
              {price != null && (() => {
                const maxVal = Math.max(price, result.valorPorAccion) * 1.15;
                const pricePct = (price / maxVal) * 100;
                const viPct = (result.valorPorAccion / maxVal) * 100;
                return (
                  <div className="relative h-2 rounded-full mt-4" style={{ background: "var(--border)" }}>
                    <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" style={{ left: `calc(${pricePct}% - 4px)`, background: "var(--sub)" }} title={t("dcfCalculator.currentPrice")} />
                    <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" style={{ left: `calc(${viPct}% - 4px)`, background: mos >= 0 ? "var(--up)" : "var(--down)" }} title={t("dcfCalculator.intrinsicValue")} />
                  </div>
                );
              })()}
            </div>
          ) : (
            <p className="text-[11px]" style={{ color: "var(--dim)" }}>{t("dcfCalculator.noSolution")}</p>
          )}

          {/* ── Mapa de sensibilidad ── */}
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>{t("dcfCalculator.sensitivityTitle")}</p>
            {sensitivity && (
              <div className="grid grid-cols-6 gap-1 text-center">
                <div />
                {GRID_G_OFFSETS.map((dg, i) => (
                  <div key={i} className="text-[9px] font-semibold pb-1" style={{ color: "var(--muted)" }}>{pctLabel(g + dg)}</div>
                ))}
                {sensitivity.map((row, ri) => (
                  <Fragment key={ri}>
                    <div className="text-[9px] font-semibold flex items-center justify-end pr-1" style={{ color: "var(--muted)" }}>
                      {pctLabel(r + GRID_R_OFFSETS[ri])}
                    </div>
                    {row.map((cell, ci) => {
                      const isCenter = ri === 2 && ci === 2;
                      const noSolution = cell.value == null;
                      const ratio = cell.value != null && price ? cell.value / price : null;
                      return (
                        <div
                          key={`${ri}-${ci}`}
                          className="rounded-md py-1.5 text-[10px] font-bold flex items-center justify-center relative"
                          style={{
                            background: noSolution ? "var(--raised)" : cellColor(ratio ?? 1),
                            color: noSolution ? "var(--dim)" : "#0a1628",
                            outline: isCenter ? "2px solid var(--text)" : undefined,
                            outlineOffset: isCenter ? "-2px" : undefined,
                          }}
                        >
                          {noSolution ? "N/D" : `$${cell.value!.toFixed(0)}`}
                          {isCenter && (
                            <span className="absolute -top-1.5 -right-1 text-[7px] font-black px-1 rounded-full" style={{ background: "var(--text)", color: "var(--card)" }}>
                              {t("dcfCalculator.you")}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            )}
            {disabled && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl"
                   style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}>
                <Lock className="w-5 h-5 text-white/80" />
                <p className="text-xs font-bold text-white text-center px-4">{t("dcfCalculator.unlockTitle")}</p>
                <button onClick={onUnlock} className="px-4 py-1.5 rounded-full text-xs font-bold" style={{ background: "var(--accent)", color: "#04140c" }}>
                  {t("dcfCalculator.unlockCta")}
                </button>
              </div>
            )}
          </div>

          <p className="text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>
            {t("dcfCalculator.sensitivityNote")}
          </p>
        </>
      )}

      {/* ── Disclaimer — siempre visible, nunca colapsable ── */}
      <div className="rounded-xl p-2.5" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
        <p className="text-[10px] leading-relaxed" style={{ color: "#f59e0b" }}>{t("dcfCalculator.disclaimer")}</p>
      </div>
    </div>
  );
}

function DataChip({ label, value, onChange, available }: { label: string; value: number | ""; onChange: (v: number | "") => void; available: boolean }) {
  const { t } = useTranslation();
  if (available) {
    return (
      <div className="rounded-xl px-2.5 py-1.5" style={{ background: "var(--raised)" }}>
        <p className="text-[9px] font-bold uppercase tracking-wide truncate" style={{ color: "var(--muted)" }}>{label}</p>
        <p className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{value !== "" ? `$${value}M` : "—"}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl px-2.5 py-1.5" style={{ background: "var(--raised)", border: "1px dashed var(--border)" }}>
      <p className="text-[9px] font-bold uppercase tracking-wide truncate" style={{ color: "var(--muted)" }}>{label}</p>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        placeholder={t("dcfCalculator.enterManually") ?? undefined}
        className="w-full bg-transparent text-xs font-bold outline-none"
        style={{ color: "var(--text)" }}
      />
    </div>
  );
}

function SliderRow({ label, value, onChange, min, max, step, disabled, formatted }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; disabled: boolean; formatted: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold" style={{ color: "var(--sub)" }}>{label}</span>
        <span className="text-[11px] font-bold" style={{ color: "var(--text)" }}>{formatted}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
        style={{ opacity: disabled ? 0.4 : 1 }}
      />
    </div>
  );
}
