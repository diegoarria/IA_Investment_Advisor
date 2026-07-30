"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Info, RotateCcw, Lock, FileSpreadsheet, MessageCircle, X } from "lucide-react";
import { calcularValorIntrinseco } from "@/lib/dcfCalculator";

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
  totalDebtRaw: number | null;
  cashRaw: number | null;
  assumptions: DcfAssumptions | null;
  yearlyDetail: YearlyDetailRow[] | null;
  pvOfFcfSum: number | null;
  pvOfTerminalValue: number | null;
  enterpriseValue: number | null;
  isPremium: boolean;
  onUnlock: () => void;
  onAskMentor: (question: string) => void;
}

type Stoplight = "green" | "yellow" | "red";

function stoplightFor(value: number, range: RangeBounds | null): Stoplight {
  if (!range) return "yellow";
  const spread = range.high - range.low;
  if (value >= range.low && value <= range.high) return "green";
  const outerLow = range.low - spread;
  const outerHigh = range.high + spread;
  if (value >= outerLow && value <= outerHigh) return "yellow";
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

function Tooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full ml-1"
        style={{ color: "var(--muted)" }}
        aria-label="info"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span
          className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 rounded-lg p-2.5 text-[11px] leading-snug font-normal shadow-lg"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--sub)" }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

function AssumptionSlider({
  label, tooltip, valuePct, suggestedPct, min, max, step, range, disabled, onChange,
}: {
  label: string; tooltip: string; valuePct: number; suggestedPct: number;
  min: number; max: number; step: number; range: RangeBounds | null; disabled: boolean;
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation();
  const light = stoplightFor(valuePct, range);
  const suggestedMarkerPct = ((suggestedPct - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold flex items-center" style={{ color: "var(--sub)" }}>
          {label}
          <Tooltip text={tooltip} />
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[13px]">{STOPLIGHT_DOT[light]}</span>
          <span className="text-xs font-bold tabular-nums" style={{ color: "var(--text)" }}>{pct(valuePct)}</span>
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valuePct}
          disabled={disabled}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full accent-[var(--accent)]"
          style={{ opacity: disabled ? 0.4 : 1 }}
        />
        <div
          className="absolute top-1/2 w-0.5 h-2.5 -translate-y-1/2 pointer-events-none"
          style={{ left: `${suggestedMarkerPct}%`, background: "var(--accent-l)" }}
        />
      </div>
      <p className="text-[10px]" style={{ color: STOPLIGHT_COLOR[light] }}>{t(`subvaluadas.dcf.stoplight.${light}`)}</p>
    </div>
  );
}

function Level3Modal({
  ticker, price, fcf0, netCash, shares, g, r, gt, yearlyDetail, pvOfFcfSum, pvOfTerminalValue, enterpriseValue, totalDebtRaw, cashRaw, onClose,
}: {
  ticker: string; price: number | null; fcf0: number; netCash: number; shares: number;
  g: number; r: number; gt: number;
  yearlyDetail: YearlyDetailRow[] | null; pvOfFcfSum: number | null; pvOfTerminalValue: number | null; enterpriseValue: number | null;
  totalDebtRaw: number | null; cashRaw: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const equityValue = enterpriseValue !== null ? enterpriseValue + netCash * 1e6 : null;
  const perShare = equityValue !== null && shares > 0 ? equityValue / (shares * 1e6) : null;
  const mos = perShare !== null && price ? ((perShare - price) / price) * 100 : null;

  const handleExport = async () => {
    const XLSX = await import("xlsx");
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
      const projSheet = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, projSheet, "Proyeccion");
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

    XLSX.writeFile(wb, `${ticker}_dcf_nuvos.xlsx`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        className="rounded-2xl border max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-sm font-black" style={{ color: "var(--text)" }}>{t("subvaluadas.dcf.level3.title", { ticker })}</h3>
          <button onClick={onClose}><X className="w-4 h-4" style={{ color: "var(--muted)" }} /></button>
        </div>
        <div className="overflow-auto p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <StatBox label={t("subvaluadas.dcf.assumptions.growth")} value={pct(g)} />
            <StatBox label={t("subvaluadas.dcf.assumptions.wacc")} value={pct(r)} />
            <StatBox label={t("subvaluadas.dcf.assumptions.terminalGrowth")} value={pct(gt)} />
          </div>

          {yearlyDetail && yearlyDetail.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
                {t("subvaluadas.dcf.level3.yearlyTable.title")}
              </p>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr style={{ background: "var(--raised)" }}>
                      <th className="text-left px-2.5 py-1.5 font-bold" style={{ color: "var(--muted)" }}>{t("subvaluadas.dcf.level3.yearlyTable.year")}</th>
                      <th className="text-right px-2.5 py-1.5 font-bold" style={{ color: "var(--muted)" }}>{t("subvaluadas.dcf.level3.yearlyTable.fcf")}</th>
                      <th className="text-right px-2.5 py-1.5 font-bold" style={{ color: "var(--muted)" }}>{t("subvaluadas.dcf.level3.yearlyTable.discountFactor")}</th>
                      <th className="text-right px-2.5 py-1.5 font-bold" style={{ color: "var(--muted)" }}>{t("subvaluadas.dcf.level3.yearlyTable.presentValue")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlyDetail.map((row) => (
                      <tr key={row.year} className="border-t" style={{ borderColor: "var(--border)" }}>
                        <td className="px-2.5 py-1.5 font-bold" style={{ color: "var(--text)" }}>{row.year}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums" style={{ color: "var(--sub)" }}>{fmtMoney(row.fcf)}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums" style={{ color: "var(--sub)" }}>{row.discount_factor.toFixed(3)}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums font-bold" style={{ color: "var(--text)" }}>{fmtMoney(row.present_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
              {t("subvaluadas.dcf.level3.bridge.title")}
            </p>
            <div className="rounded-xl border p-3 space-y-1.5" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
              <BridgeRow label={t("subvaluadas.dcf.level3.bridge.pvFcf")} value={fmtMoney(pvOfFcfSum)} />
              <BridgeRow label={t("subvaluadas.dcf.level3.bridge.pvTerminal")} value={fmtMoney(pvOfTerminalValue)} />
              <BridgeRow label={t("subvaluadas.dcf.level3.bridge.enterpriseValue")} value={fmtMoney(enterpriseValue)} bold />
              <BridgeRow label={t("subvaluadas.dcf.level3.bridge.netCash")} value={fmtMoney(netCash * 1e6)} />
              <BridgeRow label={t("subvaluadas.dcf.level3.bridge.equityValue")} value={fmtMoney(equityValue)} bold />
              <BridgeRow label={t("subvaluadas.dcf.level3.bridge.shares")} value={`${shares.toFixed(1)}M`} />
              <div className="pt-1.5 mt-1 border-t" style={{ borderColor: "var(--border)" }}>
                <BridgeRow label={t("subvaluadas.dcf.level3.bridge.perShare")} value={perShare !== null ? `$${perShare.toFixed(2)}` : "N/D"} bold accent />
              </div>
              {mos !== null && (
                <p className="text-[11px] pt-1" style={{ color: mos >= 0 ? "#22c55e" : "#ef4444" }}>
                  {t("subvaluadas.dcf.liveResult.marginOfSafety")}: {mos >= 0 ? "+" : ""}{mos.toFixed(1)}%
                </p>
              )}
            </div>
          </div>

          <button
            onClick={handleExport}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border"
            style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--raised)" }}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            {t("subvaluadas.dcf.level3.export")}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-2.5" style={{ background: "var(--raised)" }}>
      <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{label}</p>
      <p className="text-sm font-black tabular-nums" style={{ color: "var(--text)" }}>{value}</p>
    </div>
  );
}

function BridgeRow({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px]" style={{ color: "var(--sub)" }}>{label}</span>
      <span
        className={`text-[11px] tabular-nums ${bold ? "font-bold" : ""}`}
        style={{ color: accent ? "var(--accent-l)" : "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}

export default function ValorIntrinseco({
  ticker, companyName, price, fcfRaw, netCashRaw, sharesRaw, totalDebtRaw, cashRaw,
  assumptions, yearlyDetail, pvOfFcfSum, pvOfTerminalValue, enterpriseValue,
  isPremium, onUnlock, onAskMentor,
}: ValorIntrinsecoProps) {
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

  const mentorQuestions = useMemo(() => {
    const name = companyName || ticker;
    return [
      { key: "why", text: t("subvaluadas.dcf.mentor.why", { ticker: name }) },
      { key: "risk", text: t("subvaluadas.dcf.mentor.risk", { ticker: name }) },
      { key: "sensitivity", text: t("subvaluadas.dcf.mentor.sensitivity", { ticker: name }) },
      { key: "change", text: t("subvaluadas.dcf.mentor.change", { ticker: name }) },
    ];
  }, [companyName, ticker, t]);

  if (!hasData) {
    return (
      <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
        <p className="text-[11px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.dcf.noData")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
      <button
        onClick={() => setLevel2Open((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5"
      >
        <span className="text-xs font-bold" style={{ color: "var(--text)" }}>{t("subvaluadas.dcf.level2Toggle")}</span>
        {level2Open ? <ChevronUp className="w-4 h-4" style={{ color: "var(--muted)" }} /> : <ChevronDown className="w-4 h-4" style={{ color: "var(--muted)" }} />}
      </button>

      {level2Open && (
        <div className="px-3 pb-3 space-y-4">
          {isFinancialSector ? (
            <p className="text-[11px]" style={{ color: "var(--sub)" }}>{t("subvaluadas.dcf.financialSectorNote")}</p>
          ) : (
            <div className="relative space-y-3.5 pt-1">
              <AssumptionSlider
                label={t("subvaluadas.dcf.assumptions.growth")}
                tooltip={t("subvaluadas.dcf.assumptions.tooltips.growth")}
                valuePct={g} suggestedPct={suggestedG} min={0} max={25} step={0.5}
                range={assumptions?.g_range ?? null} disabled={disabled} onChange={setG}
              />
              <AssumptionSlider
                label={t("subvaluadas.dcf.assumptions.wacc")}
                tooltip={t("subvaluadas.dcf.assumptions.tooltips.wacc")}
                valuePct={r} suggestedPct={suggestedR} min={4} max={18} step={0.25}
                range={assumptions?.r_range ?? null} disabled={disabled} onChange={setR}
              />
              <AssumptionSlider
                label={t("subvaluadas.dcf.assumptions.terminalGrowth")}
                tooltip={t("subvaluadas.dcf.assumptions.tooltips.terminalGrowth")}
                valuePct={gt} suggestedPct={suggestedGt} min={0} max={5} step={0.25}
                range={assumptions?.gt_range ?? null} disabled={disabled} onChange={setGt}
              />

              {!disabled && !isDefault && (
                <button onClick={resetToSuggested} className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: "var(--accent-l)" }}>
                  <RotateCcw className="w-3 h-3" />
                  {t("subvaluadas.dcf.reset")}
                </button>
              )}

              {liveResult && liveMos !== null ? (
                <div className="rounded-xl p-3" style={{ background: "var(--card)" }}>
                  <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("subvaluadas.dcf.liveResult.intrinsicValue")}</p>
                  <p className="text-xl font-black tabular-nums" style={{ color: "var(--text)" }}>${liveResult.valorPorAccion.toFixed(2)}</p>
                  <p className="text-[11px] font-bold" style={{ color: liveMos >= 0 ? "#22c55e" : "#ef4444" }}>
                    {t("subvaluadas.dcf.liveResult.marginOfSafety")}: {liveMos >= 0 ? "+" : ""}{liveMos.toFixed(1)}%
                  </p>
                </div>
              ) : (
                <p className="text-[11px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.dcf.liveResult.noSolution")}</p>
              )}

              {assumptions?.market_implied_growth_pct != null && (
                <p className="text-[11px]" style={{ color: "var(--dim)" }}>
                  {t("subvaluadas.dcf.marketImplied", { market: assumptions.market_implied_growth_pct.toFixed(1), nuvos: suggestedG.toFixed(1) })}
                </p>
              )}

              {disabled && (
                <button onClick={onUnlock} className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: "var(--accent-l)" }}>
                  <Lock className="w-3 h-3" />
                  {t("subvaluadas.premiumGate.cta")}
                </button>
              )}
            </div>
          )}

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>{t("subvaluadas.dcf.mentor.title")}</p>
            <div className="flex flex-wrap gap-1.5">
              {mentorQuestions.map((q) => (
                <button
                  key={q.key}
                  onClick={() => onAskMentor(q.text)}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-full border"
                  style={{ borderColor: "var(--border)", color: "var(--sub)", background: "var(--card)" }}
                >
                  <MessageCircle className="w-3 h-3" />
                  {q.text}
                </button>
              ))}
            </div>
          </div>

          {!isFinancialSector && (
            <button
              onClick={() => setLevel3Open(true)}
              className="text-[11px] font-bold underline underline-offset-2"
              style={{ color: "var(--muted)" }}
            >
              {t("subvaluadas.dcf.level3Toggle")}
            </button>
          )}
        </div>
      )}

      {level3Open && (
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
          totalDebtRaw={totalDebtRaw}
          cashRaw={cashRaw}
          onClose={() => setLevel3Open(false)}
        />
      )}
    </div>
  );
}
