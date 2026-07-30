"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  Loader2, Lock, Search, X, Info, RotateCcw, FileSpreadsheet, MessageCircle, AlertTriangle, Sparkles,
} from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PaywallModal from "@/components/PaywallModal";
import StockAvatar from "@/components/StockAvatar";
import {
  type RangeBounds, type YearlyDetailRow, type Checklist, type FairValueRangeData, type ConfidenceMeterData,
  type MarketExpectationsData, type ConsensusValuationData, type LiquidityGate, type DcfAssumptions,
  GeneratedAtNote, LiquidityWarning, ChecklistDisplay, ConfidenceMeter, FairValueRangeDisplay,
  MarketExpectationsPanel, InsightBox, FollowButton, AnalyzeButton,
} from "@/components/subvaluadas/shared";
import { calcularValorIntrinseco } from "@/lib/dcfCalculator";
import { screenerApi, watchlist } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";

export interface QuickAnalysisResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  change_pct: number | null;
  exchange: string | null;
  intrinsic_value_base: number | null;
  expected_value_per_share: number | null;
  margin_of_safety_pct: number | null;
  implied_growth_pct: number | null;
  composite_score: number | null;
  fair_value_range: FairValueRangeData | null;
  confidence_meter: ConfidenceMeterData | null;
  market_expectations: MarketExpectationsData | null;
  consensus_valuation: ConsensusValuationData | null;
  thesis_scores: Record<string, number> | null;
  summary: string;
  checklist: Checklist | null;
  liquidity_gate: LiquidityGate | null;
  generated_at: number;
  current_fcf: number | null;
  net_cash: number | null;
  shares_outstanding: number | null;
  dcf_assumptions: DcfAssumptions | null;
  yearly_detail: YearlyDetailRow[] | null;
  pv_of_fcf_sum: number | null;
  pv_of_terminal_value: number | null;
  enterprise_value: number | null;
  total_debt: number | null;
  cash: number | null;
}

// Scoped dark navy/gold palette — overrides the app's semantic tokens
// (--bg/--card/--raised/...) inside this wrapper so shared components
// (StockAvatar, ChecklistDisplay, etc.) automatically pick up the new look
// without any per-component styling, while the sidebar/nav outside this
// wrapper keeps the user's normal light/dark preference.
const VI_THEME: React.CSSProperties = {
  ["--bg" as string]: "#0A0F1A",
  ["--card" as string]: "#111A2B",
  ["--raised" as string]: "#16223A",
  ["--card-2" as string]: "#16223A",
  ["--border" as string]: "rgba(255,255,255,0.08)",
  ["--border-s" as string]: "#1C2B47",
  ["--text" as string]: "#EBEEF5",
  ["--sub" as string]: "#8C97AD",
  ["--muted" as string]: "#5C6883",
  ["--dim" as string]: "#5C6883",
  ["--accent" as string]: "#D4A24C",
  ["--accent-l" as string]: "#D4A24C",
  ["--accent-d" as string]: "#A9793A",
  ["--up" as string]: "#4FA695",
  ["--down" as string]: "#DD6E63",
  background: "#0A0F1A",
};

const GOLD = "#D4A24C";
const TEAL = "#4FA695";
const CORAL = "#DD6E63";
const DEFAULT_TICKER = "AAPL";

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

type Stoplight = "green" | "yellow" | "red";

function stoplightFor(value: number, range: RangeBounds | null): Stoplight {
  if (!range) return "yellow";
  const spread = range.high - range.low;
  if (value >= range.low && value <= range.high) return "green";
  if (value >= range.low - spread && value <= range.high + spread) return "yellow";
  return "red";
}

const STOPLIGHT_DOT: Record<Stoplight, string> = { green: "🟢", yellow: "🟡", red: "🔴" };
const STOPLIGHT_COLOR: Record<Stoplight, string> = { green: "#22c55e", yellow: "#f59e0b", red: "#ef4444" };

function colorForRatio(ratio: number): string {
  const coral = [221, 110, 99], gold = [212, 162, 76], teal = [79, 166, 149];
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  let c: number[];
  if (ratio <= 1.0) {
    const t = clamp((ratio - 0.6) / 0.4, 0, 1);
    c = coral.map((v, i) => Math.round(v + (gold[i] - v) * t));
  } else {
    const t = clamp((ratio - 1.0) / 0.5, 0, 1);
    c = gold.map((v, i) => Math.round(v + (teal[i] - v) * t));
  }
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function Tooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button type="button" onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)}
              className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full ml-1.5" style={{ color: "var(--muted)" }} aria-label="info">
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-60 rounded-lg p-2.5 text-[11px] leading-snug font-normal shadow-lg"
              style={{ background: "var(--card-2)", border: "1px solid var(--border)", color: "var(--sub)" }}>
          {text}
        </span>
      )}
    </span>
  );
}

const G_OFFSETS = [-4, -2, 0, 2, 4];
const R_OFFSETS = [-2, -1, 0, 1, 2];

function SensitivityHeatmap({ fcf0, netCash, shares, g, r, gt, price }: {
  fcf0: number; netCash: number; shares: number; g: number; r: number; gt: number; price: number;
}) {
  const { t } = useTranslation();
  const gVals = G_OFFSETS.map((o) => g + o);
  const rVals = R_OFFSETS.map((o) => r + o);

  return (
    <div className="card" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 24, marginTop: 20 }}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 500, color: "var(--text)", margin: "0 0 6px" }}>
            {t("subvaluadas.detail.heatmap.title")}
          </h2>
          <p className="text-[13px] max-w-[480px] leading-relaxed" style={{ color: "var(--sub)" }}>{t("subvaluadas.detail.heatmap.desc")}</p>
        </div>
        <div className="flex items-center gap-2.5 text-[11px]" style={{ color: "var(--muted)" }}>
          {t("subvaluadas.detail.heatmap.lower")}
          <div style={{ width: 110, height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${CORAL}, ${GOLD}, ${TEAL})` }} />
          {t("subvaluadas.detail.heatmap.higher")}
        </div>
      </div>

      <p className="text-center text-[11px] mb-2" style={{ color: "var(--muted)" }}>
        {t("subvaluadas.detail.heatmap.gAxis")}
      </p>
      <div className="grid" style={{ gridTemplateColumns: "60px 1fr" }}>
        <div className="flex items-end justify-center text-center pb-2 text-[10px] leading-tight" style={{ color: "var(--muted)" }}>
          {t("subvaluadas.detail.heatmap.rAxis")}
        </div>
        <div>
          <div className="grid mb-2" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
            {gVals.map((gv, i) => (
              <div key={i} className="text-center text-[11px]" style={{ color: "var(--muted)" }}>{pct(gv)}</div>
            ))}
          </div>
          <div className="flex">
            <div className="flex flex-col justify-between">
              {rVals.map((rv, i) => (
                <div key={i} className="flex items-center justify-center text-[11px]" style={{ height: 60, color: "var(--muted)" }}>{pct(rv)}</div>
              ))}
            </div>
            <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: "repeat(5,1fr)", gridTemplateRows: "repeat(5,60px)" }}>
              {rVals.map((rv, ri) => gVals.map((gv, gi) => {
                const val = calcularValorIntrinseco({ fcf0, g: gv / 100, r: rv / 100, gt: gt / 100, netCash, shares });
                const isCenter = ri === 2 && gi === 2;
                const noSolution = val === null;
                const ratio = val && price ? val.valorPorAccion / price : 1;
                return (
                  <div key={`${ri}-${gi}`}
                       className="relative rounded-lg flex items-center justify-center text-[13px] font-bold"
                       style={{
                         background: noSolution ? "var(--border-s)" : colorForRatio(ratio),
                         color: noSolution ? "var(--muted)" : "#0A0F1A",
                         outline: isCenter ? "2px solid var(--text)" : "none",
                         outlineOffset: -2,
                         }}>
                    {isCenter && <span className="absolute top-1 text-[8px] font-extrabold tracking-wide" style={{ color: "rgba(10,15,26,0.55)" }}>{t("subvaluadas.detail.heatmap.you")}</span>}
                    {noSolution ? "N/D" : `$${val!.valorPorAccion.toFixed(0)}`}
                  </div>
                );
              }))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2.5 mt-4 p-3 rounded-xl text-[12.5px] leading-relaxed" style={{ background: "var(--raised)", color: "var(--sub)" }}>
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: GOLD }} />
        {t("subvaluadas.detail.heatmap.note")}
      </div>
    </div>
  );
}

function FullModelModal({ ticker, price, fcf0, netCash, shares, g, r, gt, yearlyDetail, pvOfFcfSum, pvOfTerminalValue, enterpriseValue, onClose }: {
  ticker: string; price: number | null; fcf0: number; netCash: number; shares: number; g: number; r: number; gt: number;
  yearlyDetail: YearlyDetailRow[] | null; pvOfFcfSum: number | null; pvOfTerminalValue: number | null; enterpriseValue: number | null;
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
      [t("subvaluadas.detail.level3.inputs")],
      [t("subvaluadas.detail.controls.growth"), pct(g)],
      [t("subvaluadas.detail.controls.wacc"), pct(r)],
      [t("subvaluadas.detail.controls.terminalGrowth"), pct(gt)],
      ["FCF (TTM, M)", fcf0.toFixed(1)],
      [t("subvaluadas.detail.level3.netCash") + " (M)", netCash.toFixed(1)],
      [t("subvaluadas.detail.level3.shares") + " (M)", shares.toFixed(1)],
      [t("subvaluadas.stats.price"), price ?? "N/D"],
    ]);
    XLSX.utils.book_append_sheet(wb, inputsSheet, "Inputs");
    if (yearlyDetail && yearlyDetail.length > 0) {
      const rows = [
        [t("subvaluadas.detail.level3.year"), t("subvaluadas.detail.level3.fcf"), t("subvaluadas.detail.level3.discountFactor"), t("subvaluadas.detail.level3.presentValue")],
        ...yearlyDetail.map((row) => [row.year, row.fcf, row.discount_factor, row.present_value]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Proyeccion");
    }
    const bridgeSheet = XLSX.utils.aoa_to_sheet([
      [t("subvaluadas.detail.level3.pvFcf"), pvOfFcfSum ?? "N/D"],
      [t("subvaluadas.detail.level3.pvTerminal"), pvOfTerminalValue ?? "N/D"],
      [t("subvaluadas.detail.level3.enterpriseValue"), enterpriseValue ?? "N/D"],
      [t("subvaluadas.detail.level3.netCash"), netCash * 1e6],
      [t("subvaluadas.detail.level3.equityValue"), equityValue ?? "N/D"],
      [t("subvaluadas.detail.level3.shares"), shares * 1e6],
      [t("subvaluadas.detail.level3.perShare"), perShare ?? "N/D"],
    ]);
    XLSX.utils.book_append_sheet(wb, bridgeSheet, "Valuacion");
    XLSX.writeFile(wb, `${ticker}_dcf_nuvos.xlsx`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div className="rounded-2xl border max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
           style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 style={{ fontSize: 16, fontWeight: 500, color: "var(--text)" }}>
            {t("subvaluadas.detail.level3.title", { ticker })}
          </h3>
          <button onClick={onClose}><X className="w-4 h-4" style={{ color: "var(--muted)" }} /></button>
        </div>
        <div className="overflow-auto p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: t("subvaluadas.detail.controls.growth"), value: pct(g) },
              { label: t("subvaluadas.detail.controls.wacc"), value: pct(r) },
              { label: t("subvaluadas.detail.controls.terminalGrowth"), value: pct(gt) },
            ].map((s) => (
              <div key={s.label} className="rounded-xl p-2.5" style={{ background: "var(--raised)" }}>
                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{s.label}</p>
                <p className="text-sm font-black tabular-nums" style={{ color: "var(--text)" }}>{s.value}</p>
              </div>
            ))}
          </div>

          {yearlyDetail && yearlyDetail.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>{t("subvaluadas.detail.level3.yearlyTable")}</p>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr style={{ background: "var(--raised)" }}>
                      <th className="text-left px-2.5 py-1.5 font-bold" style={{ color: "var(--muted)" }}>{t("subvaluadas.detail.level3.year")}</th>
                      <th className="text-right px-2.5 py-1.5 font-bold" style={{ color: "var(--muted)" }}>{t("subvaluadas.detail.level3.fcf")}</th>
                      <th className="text-right px-2.5 py-1.5 font-bold" style={{ color: "var(--muted)" }}>{t("subvaluadas.detail.level3.discountFactor")}</th>
                      <th className="text-right px-2.5 py-1.5 font-bold" style={{ color: "var(--muted)" }}>{t("subvaluadas.detail.level3.presentValue")}</th>
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

          <div className="rounded-xl border p-3 space-y-1.5" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
            {[
              [t("subvaluadas.detail.level3.pvFcf"), fmtMoney(pvOfFcfSum), false],
              [t("subvaluadas.detail.level3.pvTerminal"), fmtMoney(pvOfTerminalValue), false],
              [t("subvaluadas.detail.level3.enterpriseValue"), fmtMoney(enterpriseValue), true],
              [t("subvaluadas.detail.level3.netCash"), fmtMoney(netCash * 1e6), false],
              [t("subvaluadas.detail.level3.equityValue"), fmtMoney(equityValue), true],
              [t("subvaluadas.detail.level3.shares"), `${shares.toFixed(1)}M`, false],
            ].map(([label, value, bold], i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[11px]" style={{ color: "var(--sub)" }}>{label as string}</span>
                <span className="text-[11px] tabular-nums" style={{ fontWeight: bold ? 700 : 400, color: "var(--text)" }}>{value as string}</span>
              </div>
            ))}
            <div className="pt-1.5 mt-1 border-t flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <span className="text-[11px] font-bold" style={{ color: "var(--sub)" }}>{t("subvaluadas.detail.level3.perShare")}</span>
              <span className="text-[11px] font-bold tabular-nums" style={{ color: GOLD }}>{perShare !== null ? `$${perShare.toFixed(2)}` : "N/D"}</span>
            </div>
            {mos !== null && (
              <p className="text-[11px] pt-1" style={{ color: mos >= 0 ? TEAL : CORAL }}>
                {t("subvaluadas.detail.marginOfSafety")}: {mos >= 0 ? "+" : ""}{mos.toFixed(1)}%
              </p>
            )}
          </div>

          <button onClick={handleExport} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border"
                  style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--raised)" }}>
            <FileSpreadsheet className="w-3.5 h-3.5" />
            {t("subvaluadas.detail.level3.export")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SubvaluadasPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState(DEFAULT_TICKER);
  const [data, setData] = useState<QuickAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watchlisted, setWatchlisted] = useState(false);
  const [level3Open, setLevel3Open] = useState(false);

  useEffect(() => {
    if (!isPremium) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    screenerApi.quickAnalysis(ticker, i18n.language)
      .then((res) => setData(res.data))
      .catch((err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(detail || t("subvaluadas.search.error"));
      })
      .finally(() => setLoading(false));
  }, [ticker, isPremium, i18n.language, t]);

  const handleSearch = () => {
    if (!query.trim() || !isPremium) return;
    setWatchlisted(false);
    setTicker(query.trim().toUpperCase());
  };

  const hasData = data?.current_fcf != null && data?.net_cash != null && data?.shares_outstanding != null && data?.price != null;
  const isFinancialSector = data?.dcf_assumptions?.methodology === "residual_income_justified_pb";

  const fcf0 = hasData ? data!.current_fcf! / 1e6 : 0;
  const netCash = hasData ? data!.net_cash! / 1e6 : 0;
  const shares = hasData ? data!.shares_outstanding! / 1e6 : 0;
  const horizon = data?.yearly_detail && data.yearly_detail.length > 0 ? data.yearly_detail.length : 10;

  const suggestedG = data?.dcf_assumptions?.suggested_g ?? 7;
  const suggestedR = data?.dcf_assumptions?.suggested_r ?? 9;
  const suggestedGt = data?.dcf_assumptions?.suggested_gt ?? 3;

  const [g, setG] = useState(suggestedG);
  const [r, setR] = useState(suggestedR);
  const [gt, setGt] = useState(suggestedGt);

  useEffect(() => { setG(suggestedG); setR(suggestedR); setGt(suggestedGt); }, [suggestedG, suggestedR, suggestedGt]);

  const isDefault = g === suggestedG && r === suggestedR && gt === suggestedGt;

  const liveResult = useMemo(() => {
    if (!hasData) return null;
    return calcularValorIntrinseco({ fcf0, g: g / 100, r: r / 100, gt: gt / 100, n: horizon, netCash, shares });
  }, [hasData, fcf0, g, r, gt, horizon, netCash, shares]);

  const price = data?.price ?? 0;
  const liveMos = liveResult && price ? ((liveResult.valorPorAccion - price) / price) * 100 : null;
  const barMax = Math.max(price, liveResult?.valorPorAccion ?? 0) * 1.15 || 1;

  const handleFollow = async () => {
    if (!data || watchlisted) return;
    try { await watchlist.add(data.ticker, data.company_name || undefined); setWatchlisted(true); } catch { /* idempotent */ }
  };
  const handleAnalyze = () => router.push(`/chat?msg=${encodeURIComponent(t("subvaluadas.analyze.prompt", { ticker }))}&autosend=1`);
  const askMentor = (question: string) => router.push(`/chat?msg=${encodeURIComponent(question)}&autosend=1`);

  const name = data?.company_name || ticker;
  const mentorQuestions = [
    { key: "why", text: t("subvaluadas.dcf.mentor.why", { ticker: name }) },
    { key: "risk", text: t("subvaluadas.dcf.mentor.risk", { ticker: name }) },
    { key: "sensitivity", text: t("subvaluadas.dcf.mentor.sensitivity", { ticker: name }) },
    { key: "change", text: t("subvaluadas.dcf.mentor.change", { ticker: name }) },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        {!isPremium ? (
          <div className="flex-1 overflow-y-auto scrollbar-thin p-6" style={{ background: "var(--bg)" }}>
            <div className="max-w-2xl mx-auto rounded-2xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(0,168,94,0.1)" }}>
                <Lock className="w-7 h-7" style={{ color: "var(--accent-l)" }} />
              </div>
              <h2 className="font-bold text-base mb-2" style={{ color: "var(--text)" }}>{t("subvaluadas.premiumGate.title")}</h2>
              <p className="text-sm mb-5 max-w-sm mx-auto" style={{ color: "var(--muted)" }}>{t("subvaluadas.premiumGate.desc")}</p>
              <button onClick={() => setPaywallOpen(true)} className="px-6 py-2.5 rounded-xl text-sm font-bold text-white"
                      style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                {t("subvaluadas.premiumGate.cta")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto scrollbar-thin" style={VI_THEME}>
            <div className="max-w-[1000px] mx-auto px-6 py-8 md:px-10">

              <div className="flex gap-2 mb-8">
                <div className="flex-1 flex items-center gap-2 rounded-xl border px-3"
                     style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <Search className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder={t("subvaluadas.search.placeholder")}
                    className="flex-1 py-2.5 text-sm bg-transparent outline-none"
                    style={{ color: "var(--text)" }}
                  />
                  {query && (
                    <button onClick={() => setQuery("")}>
                      <X className="w-4 h-4" style={{ color: "var(--muted)" }} />
                    </button>
                  )}
                </div>
                <button onClick={handleSearch} disabled={!query.trim()}
                        className="px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
                        style={{ background: GOLD, color: "#0A0F1A" }}>
                  {t("subvaluadas.search.button")}
                </button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin" style={{ color: GOLD }} /></div>
              ) : error || !data ? (
                <div className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>{error || t("subvaluadas.search.error")}</p>
                </div>
              ) : (
                <>
                  <div className="flex items-end justify-between gap-5 flex-wrap mb-7">
                    <div className="flex items-center gap-3.5">
                      <div style={{ width: 46, height: 46 }}><StockAvatar ticker={data.ticker} size="lg" /></div>
                      <div>
                        <div className="text-lg font-semibold tracking-tight" style={{ color: "var(--text)" }}>{data.company_name}</div>
                        <div className="text-[12.5px] mt-0.5" style={{ color: "var(--sub)" }}>
                          {data.sector}{data.exchange ? ` · ${data.exchange}` : ""}
                        </div>
                      </div>
                    </div>
                    {data.price !== null && (
                      <div className="text-right">
                        <div className="text-[22px] font-medium tabular-nums" style={{ color: "var(--text)" }}>${data.price.toFixed(2)}</div>
                        {data.change_pct !== null && (
                          <div className="text-[12.5px] tabular-nums" style={{ color: data.change_pct >= 0 ? TEAL : CORAL }}>
                            {data.change_pct >= 0 ? "+" : ""}{data.change_pct.toFixed(2)}% {t("subvaluadas.detail.today")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ===== Nivel 1 summary — everything already known about this company ===== */}
                  <div className="space-y-3 mb-8">
                    <GeneratedAtNote generatedAt={data.generated_at} />
                    {data.liquidity_gate && <LiquidityWarning gate={data.liquidity_gate} />}
                    <div className="flex flex-wrap gap-3 items-start">
                      {data.fair_value_range && <FairValueRangeDisplay range={data.fair_value_range} consensus={data.consensus_valuation} />}
                      {data.confidence_meter && <ConfidenceMeter data={data.confidence_meter} />}
                    </div>
                    {data.market_expectations && <MarketExpectationsPanel data={data.market_expectations} />}
                    {data.checklist && <ChecklistDisplay checklist={data.checklist} />}
                    <InsightBox>{data.summary}</InsightBox>
                  </div>

                  <h1 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.3px", color: "var(--text)", margin: "0 0 6px" }}>
                    {t("subvaluadas.detail.pageTitle.pre")} <em style={{ fontStyle: "italic", color: GOLD }}>{t("subvaluadas.detail.pageTitle.em")}</em>
                  </h1>
                  <p className="text-sm max-w-[620px] leading-relaxed mb-6" style={{ color: "var(--sub)" }}>{t("subvaluadas.detail.pageSubtitle")}</p>

                  {hasData && (
                    <div className="flex items-center gap-2.5 flex-wrap mb-6">
                      <span className="text-[11.5px] flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                        <Sparkles className="w-3 h-3" style={{ color: GOLD }} />
                        {t("subvaluadas.detail.autofillLabel")}
                      </span>
                      {[
                        [t("subvaluadas.detail.chips.fcf"), fmtMoney(data.current_fcf)],
                        [t("subvaluadas.detail.chips.netCash"), fmtMoney(data.net_cash)],
                        [t("subvaluadas.detail.chips.shares"), `${(data.shares_outstanding! / 1e6).toFixed(0)}M`],
                      ].map(([label, value]) => (
                        <span key={label} className="rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--sub)" }}>
                          {label} <b style={{ color: "var(--text)", fontWeight: 500 }}>{value}</b>
                        </span>
                      ))}
                    </div>
                  )}

                  {!hasData ? (
                    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                      <p className="text-[12px]" style={{ color: "var(--sub)" }}>{t("subvaluadas.dcf.noData")}</p>
                    </div>
                  ) : isFinancialSector ? (
                    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                      <p className="text-[12px]" style={{ color: "var(--sub)" }}>{t("subvaluadas.dcf.financialSectorNote")}</p>
                    </div>
                  ) : (
                    <>
                      {/* ===== HERO: sliders + output ===== */}
                      <div className="rounded-[14px] p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                        <div className="grid gap-0" style={{ gridTemplateColumns: "1fr 320px" }}>
                          <div className="pr-8 border-r" style={{ borderColor: "var(--border)" }}>
                            {[
                              { key: "growth", label: t("subvaluadas.detail.controls.growth"), sub: t("subvaluadas.detail.controls.growthSub"), tip: t("subvaluadas.dcf.assumptions.tooltips.growth"), value: g, set: setG, min: 0, max: 25, step: 0.5, range: data.dcf_assumptions?.g_range ?? null },
                              { key: "wacc", label: t("subvaluadas.detail.controls.wacc"), sub: t("subvaluadas.detail.controls.waccSub"), tip: t("subvaluadas.dcf.assumptions.tooltips.wacc"), value: r, set: setR, min: 4, max: 18, step: 0.25, range: data.dcf_assumptions?.r_range ?? null },
                              { key: "terminal", label: t("subvaluadas.detail.controls.terminalGrowth"), sub: t("subvaluadas.detail.controls.terminalGrowthSub"), tip: t("subvaluadas.dcf.assumptions.tooltips.terminalGrowth"), value: gt, set: setGt, min: 0, max: 5, step: 0.25, range: data.dcf_assumptions?.gt_range ?? null },
                            ].map((ctrl, i, arr) => {
                              const light = stoplightFor(ctrl.value, ctrl.range);
                              return (
                                <div key={ctrl.key} className={i < arr.length - 1 ? "mb-7" : ""}>
                                  <div className="flex justify-between items-baseline mb-2.5">
                                    <div>
                                      <div className="text-[13.5px] font-semibold flex items-center" style={{ color: "var(--text)" }}>
                                        {ctrl.label}
                                        <Tooltip text={ctrl.tip} />
                                      </div>
                                      <span className="block text-[11px] font-normal mt-0.5" style={{ color: "var(--muted)" }}>{ctrl.sub}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[13px]">{STOPLIGHT_DOT[light]}</span>
                                      <span className="text-base font-medium tabular-nums" style={{ color: GOLD }}>{pct(ctrl.value)}</span>
                                    </div>
                                  </div>
                                  <input type="range" min={ctrl.min} max={ctrl.max} step={ctrl.step} value={ctrl.value}
                                         onChange={(e) => ctrl.set(parseFloat(e.target.value))}
                                         className="vi-range w-full" />
                                  <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--muted)" }}>
                                    <span>{ctrl.min}%</span><span>{ctrl.max}%</span>
                                  </div>
                                  <p className="text-[10px] mt-1" style={{ color: STOPLIGHT_COLOR[light] }}>{t(`subvaluadas.dcf.stoplight.${light}`)}</p>
                                </div>
                              );
                            })}
                            {!isDefault && (
                              <button onClick={() => { setG(suggestedG); setR(suggestedR); setGt(suggestedGt); }}
                                      className="flex items-center gap-1.5 text-[11px] font-bold mt-1" style={{ color: GOLD }}>
                                <RotateCcw className="w-3 h-3" />
                                {t("subvaluadas.dcf.reset")}
                              </button>
                            )}
                          </div>

                          <div className="pl-8 flex flex-col gap-4">
                            <div>
                              <p className="text-[11.5px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("subvaluadas.detail.output.label")}</p>
                              {liveResult ? (
                                <>
                                  <p style={{ fontSize: 40, fontWeight: 500, letterSpacing: "-1px", lineHeight: 1, color: "var(--text)" }}>
                                    ${liveResult.valorPorAccion.toFixed(2)}
                                  </p>
                                  <p className="text-[12.5px] tabular-nums" style={{ color: "var(--sub)" }}>
                                    {t("subvaluadas.detail.output.vs", { price: price.toFixed(2) })}
                                  </p>
                                </>
                              ) : (
                                <p className="text-sm" style={{ color: "var(--muted)" }}>{t("subvaluadas.dcf.liveResult.noSolution")}</p>
                              )}
                            </div>

                            {liveMos !== null && (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-bold tabular-nums w-fit"
                                    style={{ background: liveMos >= 0 ? "rgba(79,166,149,0.14)" : "rgba(221,110,99,0.14)", color: liveMos >= 0 ? TEAL : CORAL }}>
                                {liveMos >= 0 ? "+" : ""}{liveMos.toFixed(1)}% {t("subvaluadas.detail.marginOfSafety")}
                              </span>
                            )}

                            {liveResult && (
                              <div className="relative h-2.5 rounded-md mt-1" style={{ background: "var(--border-s)" }}>
                                <div className="absolute inset-0 rounded-md opacity-35" style={{ background: `linear-gradient(90deg, ${CORAL}, ${GOLD}, ${TEAL})` }} />
                                <div className="absolute -top-1.5 w-0.5 h-5" style={{ left: `${Math.max(0, Math.min(100, (price / barMax) * 100))}%`, background: "var(--text)" }}>
                                  <span className="absolute -top-[19px] left-1/2 -translate-x-1/2 text-[9.5px] whitespace-nowrap" style={{ color: "var(--sub)" }}>{t("subvaluadas.detail.priceMarker")}</span>
                                </div>
                                <div className="absolute -top-1.5 w-0.5 h-5" style={{ left: `${Math.max(0, Math.min(100, (liveResult.valorPorAccion / barMax) * 100))}%`, background: GOLD }}>
                                  <span className="absolute -top-[19px] left-1/2 -translate-x-1/2 text-[9.5px] font-bold whitespace-nowrap" style={{ color: GOLD }}>{t("subvaluadas.detail.viMarker")}</span>
                                </div>
                              </div>
                            )}

                            {data.dcf_assumptions?.market_implied_growth_pct != null && (
                              <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
                                {t("subvaluadas.dcf.marketImplied", { market: data.dcf_assumptions.market_implied_growth_pct.toFixed(1), nuvos: suggestedG.toFixed(1) })}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <SensitivityHeatmap fcf0={fcf0} netCash={netCash} shares={shares} g={g} r={r} gt={gt} price={price} />

                      <div className="mt-5 flex flex-wrap gap-3 items-center">
                        <button onClick={() => setLevel3Open(true)} className="text-[12px] font-bold underline underline-offset-2" style={{ color: "var(--muted)" }}>
                          {t("subvaluadas.detail.level3Toggle")}
                        </button>
                      </div>

                      <div className="mt-6">
                        <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>{t("subvaluadas.dcf.mentor.title")}</p>
                        <div className="flex flex-wrap gap-2">
                          {mentorQuestions.map((q) => (
                            <button key={q.key} onClick={() => askMentor(q.text)}
                                    className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full border"
                                    style={{ borderColor: "var(--border)", color: "var(--sub)", background: "var(--card)" }}>
                              <MessageCircle className="w-3 h-3" />
                              {q.text}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <div className="flex gap-2 mt-6">
                    <FollowButton ticker={data.ticker} watchlisted={watchlisted} onFollow={handleFollow} />
                    <AnalyzeButton onAnalyze={handleAnalyze} />
                  </div>

                  <div className="flex items-start gap-2.5 mt-6 p-3.5 rounded-xl text-xs leading-relaxed" style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--muted)" }}>
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span><b style={{ color: "var(--sub)" }}>{t("subvaluadas.detail.disclaimer.bold")}</b> {t("subvaluadas.detail.disclaimer.text")}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("subvaluadas.premiumGate.paywallReason")} />

      {level3Open && data && (
        <FullModelModal
          ticker={data.ticker}
          price={data.price}
          fcf0={fcf0}
          netCash={netCash}
          shares={shares}
          g={g} r={r} gt={gt}
          yearlyDetail={data.yearly_detail}
          pvOfFcfSum={data.pv_of_fcf_sum}
          pvOfTerminalValue={data.pv_of_terminal_value}
          enterpriseValue={data.enterprise_value}
          onClose={() => setLevel3Open(false)}
        />
      )}

      <style jsx global>{`
        .vi-range { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 3px; background: var(--border-s); outline: none; }
        .vi-range::-webkit-slider-thumb { -webkit-appearance: none; width: 17px; height: 17px; border-radius: 50%; background: ${GOLD}; border: 3px solid #0A0F1A; box-shadow: 0 0 0 1px rgba(212,162,76,0.35); cursor: pointer; }
        .vi-range::-moz-range-thumb { width: 17px; height: 17px; border-radius: 50%; background: ${GOLD}; border: 3px solid #0A0F1A; cursor: pointer; }
      `}</style>
    </div>
  );
}
