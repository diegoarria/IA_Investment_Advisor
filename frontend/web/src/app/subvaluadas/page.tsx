"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  Loader2, Lock, Search, X, Info, RotateCcw, FileSpreadsheet, MessageCircle, AlertTriangle, Sparkles, Bookmark, Check,
  Shield, Target,
} from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PaywallModal from "@/components/PaywallModal";
import StockAvatar from "@/components/StockAvatar";
import ExplainButton from "@/components/ExplainButton";
import {
  type RangeBounds, type YearlyDetailRow, type Checklist, type FairValueRangeData, type ConfidenceMeterData,
  type MarketExpectationsData, type ConsensusValuationData, type LiquidityGate, type DcfAssumptions,
  type NifDashboardData, type NifRow, type ThesisDraftData,
  type ScenariosData, type ProbabilityWeights, type SensitivityMatrixData,
  type ReverseDcfSanityCheckData, type ExpectationsInvestingData, type FairValueEngineData,
  type GrowthEngineData, type NuvosFairValueData,
  GeneratedAtNote, LiquidityWarning, ChecklistDisplay,
  MarketExpectationsPanel, InsightBox, FollowButton, AnalyzeButton,
  NifOverallScoreBanner, NifPillarCard, NifDashboardSkeleton,
  NifScoreEngineCard, NifMoatDeepDiveBlock, NifManagementDeepDiveCard,
  NifCatalystsCard, NifDeteriorationCard,
  ScenarioWeightingPanel, ReverseDcfPanel, GrowthEnginePreviewPanel, FairValueScenariosPanel,
} from "@/components/subvaluadas/shared";
import { ExecutiveSummaryPanel } from "@/components/subvaluadas/ExecutiveSummaryPanel";
import dynamic from "next/dynamic";
import type { CompanyTimelineEvent } from "@/lib/companyTimeline";
import type { ThesisVersion } from "@/lib/thesisHistory";
import { buildManualVsAiComparison } from "@/lib/manualVsAi";
import { DetailLevelToggle } from "@/components/ui";
import { isSectionVisible } from "@/lib/detailLevel";
import { calcularValorIntrinseco, margenDeSeguridad } from "@/lib/dcfCalculator";
import { screenerApi, savedValuationsApi, watchlist, explain as explainApi, researchEngineApi } from "@/lib/api";
import { useSubscriptionStore, useThemeStore, useDetailLevelStore, usePersonalizationStore } from "@/lib/store";
import { selectDefaultDiscountRatePct, resolveDashboardSectionOrder, DEFAULT_DASHBOARD_SECTION_ORDER } from "@/lib/personalization";

// Fase 4, Incremento 13 (Cierre, Parte M) — every panel below is already
// gated by isPremium/isSectionVisible (never rendered on initial load for
// a free user or below the relevant Nivel de Detalle), so splitting them
// into their own chunks never risks layout shift — only ExecutiveSummaryPanel
// above (always visible) stays a static import.
const PeerComparisonChart = dynamic(() => import("@/components/subvaluadas/PeerComparisonChart").then((m) => m.PeerComparisonChart));
const CompanyTimeline = dynamic(() => import("@/components/subvaluadas/CompanyTimeline").then((m) => m.CompanyTimeline));
const ThesisHistoryPanel = dynamic(() => import("@/components/subvaluadas/ThesisHistoryPanel").then((m) => m.ThesisHistoryPanel));
const InvestmentChecklistPanel = dynamic(() => import("@/components/subvaluadas/InvestmentChecklistPanel").then((m) => m.InvestmentChecklistPanel));
const ManualVsAiPanel = dynamic(() => import("@/components/subvaluadas/ManualVsAiPanel").then((m) => m.ManualVsAiPanel));

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
  // Fase 1, Incremento 4 — see /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
  // All optional/nullable: absent for financial-sector companies and REITs,
  // which don't run the standard FCF-DCF (see `sector_model_note`).
  scenarios: ScenariosData | null;
  probability_weights: ProbabilityWeights | null;
  sensitivity_matrix: SensitivityMatrixData | null;
  reverse_dcf_sanity_check: ReverseDcfSanityCheckData | null;
  expectations_investing: ExpectationsInvestingData | null;
  sector_model_note: { sector_type: string; detalle: string } | null;
  fair_value_engine: FairValueEngineData | null;
  // Fase 1.5, Incremento 8/9 — Growth Engine shadow-mode preview, gated to
  // Nivel de Detalle "Profesional" (see GrowthEnginePreviewPanel in
  // shared.tsx). Never the growth number the rest of this screen actually
  // uses — that stays legacy until the production flip (Incremento 7).
  growth_engine: GrowthEngineData | null;
  // Nuvos AI Fair Value Engine redesign, Incremento 6/9 — one engine,
  // three named scenarios (Bear/Base/Bull), shadow mode (see
  // FairValueScenariosPanel in shared.tsx). Never the number the rest of
  // this screen uses until the flip (Incremento 11).
  nuvos_fair_value: NuvosFairValueData | null;
}

// Gold/teal/coral is this screen's fixed brand identity (Valor Intrínseco),
// kept constant in both themes. The neutrals (--bg/--card/--raised/...),
// however, only get a custom "navy" override in dark mode — in light mode
// they're deliberately left unset so they fall through to the app's own
// [data-theme="light"] tokens (globals.css), which already give the right
// white/near-white palette. Scoped to this wrapper only — the sidebar/nav
// outside it always follows the user's normal light/dark preference.
function useViTheme(): React.CSSProperties {
  const { theme } = useThemeStore();
  return useMemo(() => ({
    ["--accent" as string]: GOLD,
    ["--accent-l" as string]: GOLD,
    ["--accent-d" as string]: "#A9793A",
    ["--up" as string]: TEAL,
    ["--down" as string]: CORAL,
    background: "var(--bg)",
    ...(theme === "dark" ? {
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
    } : {}),
  }), [theme]);
}

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

// Fase 1, Incremento 4: this used to recompute its own 5x5 grid client-side
// with `calcularValorIntrinseco` (a simpler constant-growth model than the
// backend's real fading-growth DCF), re-centered live on whatever the g/r/gt
// sliders were at that moment. It now renders the REAL matrix the backend
// already computes (`dcf.sensitivity_matrix` — 3 WACC rows x 4 growth
// columns, every cell a real driver-based DCF run) — fixed to the base
// scenario's assumptions rather than following the sliders live, since
// there's now exactly one DCF implementation instead of two that could
// silently drift apart.
function SensitivityHeatmap({ matrix, price }: { matrix: SensitivityMatrixData; price: number }) {
  const { t } = useTranslation();
  const gVals = matrix.growth_cols_pct;
  const rVals = matrix.wacc_rows_pct;
  const centerRi = Math.floor(rVals.length / 2);
  const centerGi = Math.floor(gVals.length / 2);

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
          <div className="grid mb-2" style={{ gridTemplateColumns: `repeat(${gVals.length},1fr)` }}>
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
            <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${gVals.length},1fr)`, gridTemplateRows: `repeat(${rVals.length},60px)` }}>
              {rVals.map((rv, ri) => gVals.map((gv, gi) => {
                const val = matrix.values[ri][gi];
                const isCenter = ri === centerRi && gi === centerGi;
                const noSolution = val === null;
                const ratio = val !== null && price ? val / price : 1;
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
                    {noSolution ? "N/D" : `$${val!.toFixed(0)}`}
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

// Turns a NIF pillar's raw data/nuvos_estimate dicts into the labeled rows
// NifPillarCard renders — kept here (not inside the generic shared card)
// since only the page knows each pillar's specific field names/units,
// matching how every other shared display component in this file takes
// already-formatted data rather than a raw API dict.
// Fase 4, Incremento 4 — small module-level helper (PeerComparisonChart's
// companyMetrics extraction needs the same "is this really a number"
// guard buildNifRows already uses internally, just outside that function's
// scope).
const numOrNull = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

function buildNifRows(pillarKey: string, d: Record<string, unknown>, isFinancialSector: boolean, t: (k: string, o?: Record<string, unknown>) => string): NifRow[] {
  const num = numOrNull;
  const label = (key: string) => t(`subvaluadas.nif.fields.${key}`);
  const rows: NifRow[] = [];
  const push = (key: string, value: string | null) => { if (value !== null) rows.push({ label: label(key), value }); };

  if (pillarKey === "business_quality_data") {
    push("roicPct", num(d.roic_pct) !== null ? pct(num(d.roic_pct)!) : null);
    push("operatingMarginPct", num(d.operating_margin_pct) !== null ? pct(num(d.operating_margin_pct)!) : null);
    push("netMarginPct", num(d.net_margin_pct) !== null ? pct(num(d.net_margin_pct)!) : null);
    push("fcfMarginPct", num(d.fcf_margin_pct) !== null ? pct(num(d.fcf_margin_pct)!) : null);
    push("revenueCagrPct", num(d.revenue_cagr_pct) !== null ? pct(num(d.revenue_cagr_pct)!) : null);
  } else if (pillarKey === "business_quality_estimate") {
    push("roicScore", num(d.roic_score)?.toString() ?? null);
    push("marginScore", num(d.operating_margin_score)?.toString() ?? null);
    push("growthScore", num(d.growth_score)?.toString() ?? null);
  } else if (pillarKey === "financial_strength_data") {
    push("totalDebt", fmtMoney(num(d.total_debt)));
    push("cash", fmtMoney(num(d.cash)));
    push("netCash", fmtMoney(num(d.net_cash)));
  } else if (pillarKey === "financial_strength_estimate") {
    push("interestCoverageScore", num(d.interest_coverage_score)?.toString() ?? null);
    push("debtScore", num(d.net_debt_to_cash_score)?.toString() ?? null);
  } else if (pillarKey === "management_quality_data") {
    push("buybackRatePct", num(d.buyback_rate_pct) !== null ? pct(num(d.buyback_rate_pct)!) : null);
    push("payoutRatioPct", num(d.payout_ratio_pct) !== null ? pct(num(d.payout_ratio_pct)!) : null);
    const t12 = d.insider_trailing_12mo as { distinct_buyers?: number; distinct_sellers?: number } | null | undefined;
    if (t12) {
      push("insiderBuyers", String(t12.distinct_buyers ?? 0));
      push("insiderSellers", String(t12.distinct_sellers ?? 0));
    }
    push("insiderSentiment", num(d.insider_sentiment_avg_mspr) !== null ? num(d.insider_sentiment_avg_mspr)!.toFixed(0) : null);
  } else if (pillarKey === "valuation_data") {
    push("currentPrice", num(d.current_price) !== null ? `$${num(d.current_price)!.toFixed(2)}` : null);
    if (!isFinancialSector) {
      push("peRatio", num(d.pe_ratio)?.toFixed(1) ?? null);
      push("evEbitda", num(d.ev_ebitda)?.toFixed(1) ?? null);
      push("pegRatio", num(d.peg_ratio)?.toFixed(2) ?? null);
    }
  } else if (pillarKey === "valuation_estimate") {
    const fvr = d.fair_value_range as { low?: number; high?: number } | null | undefined;
    if (fvr && num(fvr.low) !== null && num(fvr.high) !== null) {
      push("fairValueRange", `$${num(fvr.low)!.toFixed(0)} - $${num(fvr.high)!.toFixed(0)}`);
    }
    push("marginOfSafetyPct", num(d.margin_of_safety_pct) !== null ? pct(num(d.margin_of_safety_pct)!) : null);
    push("expectedValue", num(d.expected_value_per_share) !== null ? `$${num(d.expected_value_per_share)!.toFixed(2)}` : null);
  }
  return rows;
}

export default function SubvaluadasPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center" style={{ background: "var(--bg)" }}><Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} /></div>}>
      <SubvaluadasPageInner />
    </Suspense>
  );
}

function SubvaluadasPageInner() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;
  const viTheme = useViTheme();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  // Marks the home checklist's "view 1 opportunity" step done — landing here
  // at all counts, since this screen's whole purpose is showing an opportunity.
  useEffect(() => { localStorage.setItem("nuvos_opportunity_viewed", "1"); }, []);

  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState(() => (searchParams.get("ticker") || DEFAULT_TICKER).toUpperCase());
  const [data, setData] = useState<QuickAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [watchlisted, setWatchlisted] = useState(false);
  const [level3Open, setLevel3Open] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Free users get 1 search/week (enforced server-side) — don't burn that on
  // the default AAPL auto-load; only fetch once they've actually searched,
  // or if the URL itself names a ticker (a shared link is an explicit ask).
  const [searchTriggered, setSearchTriggered] = useState(() => !!searchParams.get("ticker"));

  useEffect(() => {
    if (!isPremium && !searchTriggered) { setLoading(false); return; }
    let cancelled = false;
    const cacheKey = `vi_quick_analysis:${ticker}:${i18n.language}`;
    setLimitHit(false);

    // Stale-while-revalidate: paint instantly from the last cached payload
    // for this ticker+lang (localStorage) while a fresh copy loads in the
    // background — the screen's default ticker must never sit on a spinner
    // when we already know the answer from a previous visit.
    let hadCache = false;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setData(JSON.parse(cached));
        setError(null);
        setLoading(false);
        hadCache = true;
      }
    } catch { /* localStorage unavailable (Safari private mode, etc.) — fall through to network */ }

    if (!hadCache) { setLoading(true); setError(null); }

    // This screen must always open with a real result, not a spinner stuck
    // on a transient network hiccup or a slow provider timeout — retry a
    // couple of times with backoff before surfacing an error. A definite
    // answer from the server (bad ticker, out of free searches) is never retried.
    const attempt = async (n: number): Promise<void> => {
      try {
        const res = await screenerApi.quickAnalysis(ticker, i18n.language);
        if (cancelled) return;
        setData(res.data);
        setError(null);
        try { localStorage.setItem(cacheKey, JSON.stringify(res.data)); } catch { /* ignore */ }
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        const isDefinitive = status !== undefined && status !== 503;
        if (!isDefinitive && n < 2) {
          await new Promise((r) => setTimeout(r, 800 * (n + 1)));
          return cancelled ? undefined : attempt(n + 1);
        }
        if (cancelled || hadCache) return; // already showing the cached result — don't rip it away
        const rawDetail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
        if (status === 429) {
          setLimitHit(true);
          setError((rawDetail as { message?: string })?.message || t("subvaluadas.freeGate.limitDesc"));
          return;
        }
        setError(typeof rawDetail === "string" ? rawDetail : t("subvaluadas.search.error"));
      }
    };

    attempt(0).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, isPremium, searchTriggered, i18n.language, t]);

  // Nuvos Investment Framework (NIF) dashboard — fired in parallel with the
  // quick-analysis call above, as its own independent request/cache/failure
  // domain (see backend/app/api/routes/screener.py's nif_dashboard route
  // docstring for why). A NIF failure must never affect the existing
  // Calculadora de Valor Intrínseco below it — it degrades to hiding the
  // section, nothing else on the page is touched. Premium-only in this
  // first phase, so it fetches whenever isPremium is true, same as
  // quick-analysis already does for Premium users regardless of
  // searchTriggered (only free users wait for an explicit search).
  const [nifData, setNifData] = useState<NifDashboardData | null>(null);
  const [nifLoading, setNifLoading] = useState(true);
  const [nifError, setNifError] = useState(false);

  useEffect(() => {
    if (!isPremium) { setNifLoading(false); return; }
    let cancelled = false;
    setNifLoading(true);
    setNifError(false);
    screenerApi.nifDashboard(ticker, i18n.language)
      .then((res) => { if (!cancelled) { setNifData(res.data); setNifError(false); } })
      .catch(() => { if (!cancelled) { setNifData(null); setNifError(true); } })
      .finally(() => { if (!cancelled) setNifLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, isPremium, i18n.language]);

  // Fase 3's shared research draft — a separate, cheap read (never triggers
  // recomputation) from the Thesis Engine. Independent load/error state,
  // same "never block anything else" philosophy as nifData above. A 404
  // (no draft generated yet for this ticker) is a normal, expected state,
  // not an error to surface.
  const [thesisDraft, setThesisDraft] = useState<ThesisDraftData | null>(null);
  const [thesisLoading, setThesisLoading] = useState(true);

  useEffect(() => {
    if (!isPremium) { setThesisLoading(false); return; }
    let cancelled = false;
    setThesisLoading(true);
    researchEngineApi.getThesisDraft(ticker)
      .then((res) => { if (!cancelled) setThesisDraft(res.data); })
      .catch(() => { if (!cancelled) setThesisDraft(null); })
      .finally(() => { if (!cancelled) setThesisLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, isPremium]);

  // Fase 4, Incremento 11 (Investment Journal, Parte K) — whether the user
  // already has their OWN adopted thesis for this ticker (distinct from
  // Nuvos's shared draft above). Drives the "Adoptar como mi tesis" CTA.
  const [myThesis, setMyThesis] = useState<{ ticker: string; version: number } | null>(null);
  const [adoptingThesis, setAdoptingThesis] = useState(false);

  const fetchMyThesis = useCallback(() => {
    if (!isPremium) return;
    researchEngineApi.getMyThesis(ticker)
      .then((res) => setMyThesis(res.data))
      .catch(() => setMyThesis(null));
  }, [ticker, isPremium]);

  useEffect(() => { fetchMyThesis(); }, [fetchMyThesis]);

  const handleAdoptThesis = async () => {
    setAdoptingThesis(true);
    try {
      await researchEngineApi.forkThesis(ticker);
      fetchMyThesis();
      const historyRes = await researchEngineApi.getThesisHistory(ticker);
      setThesisHistory(historyRes.data?.versions ?? []);
    } catch {
      // real failure — myThesis stays null, the CTA simply remains visible to retry
    } finally {
      setAdoptingThesis(false);
    }
  };

  // Fase 4, Incremento 5 — company timeline (Fase 3's Change Detection
  // Engine output). Independent load state, same "never block anything
  // else" philosophy as nifData/thesisDraft above.
  const [timelineEvents, setTimelineEvents] = useState<CompanyTimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);

  useEffect(() => {
    if (!isPremium) { setTimelineLoading(false); return; }
    let cancelled = false;
    setTimelineLoading(true);
    researchEngineApi.getTimeline(ticker)
      .then((res) => { if (!cancelled) setTimelineEvents(res.data?.timeline ?? []); })
      .catch(() => { if (!cancelled) setTimelineEvents([]); })
      .finally(() => { if (!cancelled) setTimelineLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, isPremium]);

  // Fase 4, Incremento 6 — the user's own real thesis version history
  // (Fase 3's user_investment_theses, never overwritten — see
  // src/lib/thesisHistory.ts). Independent load state.
  const [thesisHistory, setThesisHistory] = useState<ThesisVersion[]>([]);
  const [thesisHistoryLoading, setThesisHistoryLoading] = useState(true);

  useEffect(() => {
    if (!isPremium) { setThesisHistoryLoading(false); return; }
    let cancelled = false;
    setThesisHistoryLoading(true);
    researchEngineApi.getThesisHistory(ticker)
      .then((res) => { if (!cancelled) setThesisHistory(res.data?.versions ?? []); })
      .catch(() => { if (!cancelled) setThesisHistory([]); })
      .finally(() => { if (!cancelled) setThesisHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, isPremium]);

  const { detailLevel, setDetailLevel } = useDetailLevelStore();
  const { requiredReturnPct, preferredDiscountRateMethod, minMarginOfSafetyPct, dashboardSectionOrder } = usePersonalizationStore();

  // Hotfix (post-Incremento 12): /subvaluadas is statically prerendered, so
  // the server always renders the DEFAULT section order (no localStorage on
  // the server). zustand's persist middleware rehydrates synchronously from
  // localStorage on the client BEFORE the first paint, so a user with a
  // saved custom order got a different array order client-side than what
  // the server sent — React can tolerate a hydration diff in most
  // attributes, but reordering keyed siblings crashes hydration outright
  // (Uncaught Error: Minified React error #418, cascading into a second
  // TypeError). Force the default order until after mount, then swap to
  // the real persisted order — same fix shape as any SSR-page + localStorage
  // state combination, applied narrowly here since only this value affects
  // sibling ORDER (not just visibility/style, which hydrate safely).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const effectiveSectionOrder = mounted ? dashboardSectionOrder : DEFAULT_DASHBOARD_SECTION_ORDER;

  const handleSearch = () => {
    if (!query.trim()) return;
    setWatchlisted(false);
    setSaveState("idle");
    setSearchTriggered(true);
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

  // Fase 4, Incremento 12 (Personalización, Parte L) — the manual
  // calculator's DEFAULT discount rate, per the user's own
  // retorno-requerido preference (mirrors dcf_engine.select_discount_rate's
  // exact selection rule — never a new computation). Nuvos's own real WACC
  // suggestion (suggestedR) is untouched everywhere else (the "reset to
  // Nuvos" button, ManualVsAiPanel's comparison, the saved-valuation
  // suggested_wacc_pct) — this only changes what the slider starts at.
  const effectiveSuggestedR = selectDefaultDiscountRatePct(suggestedR, requiredReturnPct, preferredDiscountRateMethod);

  const [g, setG] = useState(suggestedG);
  const [r, setR] = useState(effectiveSuggestedR);
  const [gt, setGt] = useState(suggestedGt);

  useEffect(() => { setG(suggestedG); setR(effectiveSuggestedR); setGt(suggestedGt); }, [suggestedG, effectiveSuggestedR, suggestedGt]);
  useEffect(() => { setSaveState("idle"); }, [g, r, gt, ticker]);

  const isDefault = g === suggestedG && r === effectiveSuggestedR && gt === suggestedGt;

  const liveResult = useMemo(() => {
    if (!hasData) return null;
    return calcularValorIntrinseco({ fcf0, g: g / 100, r: r / 100, gt: gt / 100, n: horizon, netCash, shares });
  }, [hasData, fcf0, g, r, gt, horizon, netCash, shares]);

  const price = data?.price ?? 0;
  // Fase 1.5, Incremento 15 — was an inline /price duplicate of the same
  // formula margenDeSeguridad() already implements; calling it directly
  // both dedups the formula and picks up its Incremento 14 fix (denominator
  // is the intrinsic value, matching the single backend convention).
  const liveMosFraction = liveResult && price ? margenDeSeguridad(liveResult.valorPorAccion, price) : null;
  const liveMos = liveMosFraction !== null ? liveMosFraction * 100 : null;

  // Mentor feedback on the slider the user just moved — fires automatically
  // (debounced, no button tap) whenever an assumption drifts from the
  // suggested default, text-only (no TTS — this would fire far too often to
  // synthesize audio every time).
  const [mentorTip, setMentorTip] = useState<string | null>(null);
  const [mentorTipLoading, setMentorTipLoading] = useState(false);
  useEffect(() => {
    if (isDefault || !hasData) { setMentorTip(null); return; }
    const handle = setTimeout(async () => {
      setMentorTipLoading(true);
      try {
        const res = await explainApi.explain("oportunidades_slider_feedback", {
          ticker: data?.ticker,
          wacc_pct: r,
          growth_pct: g,
          terminal_growth_pct: gt,
          suggested_wacc_pct: suggestedR,
          suggested_growth_pct: suggestedG,
          suggested_terminal_growth_pct: suggestedGt,
          wacc_range: data?.dcf_assumptions?.r_range ?? null,
          growth_range: data?.dcf_assumptions?.g_range ?? null,
          terminal_growth_range: data?.dcf_assumptions?.gt_range ?? null,
          intrinsic_value_per_share: liveResult?.valorPorAccion ?? null,
          price,
        }, i18n.language, true);
        setMentorTip(res.data?.text || null);
      } catch {
        setMentorTip(null);
      } finally {
        setMentorTipLoading(false);
      }
    }, 900);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, r, gt]);
  const barMax = Math.max(price, liveResult?.valorPorAccion ?? 0) * 1.15 || 1;

  const handleFollow = async () => {
    if (!data || watchlisted) return;
    try { await watchlist.add(data.ticker, data.company_name || undefined); setWatchlisted(true); } catch { /* idempotent */ }
  };
  const handleAnalyze = () => router.push(`/chat?msg=${encodeURIComponent(t("subvaluadas.analyze.prompt", { ticker }))}&autosend=1`);
  const askMentor = (question: string) => router.push(`/chat?msg=${encodeURIComponent(question)}&autosend=1`);

  const handleSaveValuation = async () => {
    if (!data) return;
    setSaveState("saving");
    try {
      await savedValuationsApi.save(data.ticker, g, r, gt);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

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

        <div className="flex-1 overflow-y-auto scrollbar-thin" style={viTheme}>
            <div className="max-w-[1000px] mx-auto px-6 py-8 md:px-10">

              {!isPremium && (
                <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl px-4 py-2.5 mb-4"
                     style={{ background: "rgba(212,162,76,0.08)", border: "1px solid rgba(212,162,76,0.25)" }}>
                  <span className="text-[12.5px]" style={{ color: "var(--sub)" }}>{t("subvaluadas.freeGate.banner")}</span>
                  <button onClick={() => setPaywallOpen(true)} className="text-[12px] font-bold shrink-0" style={{ color: GOLD }}>
                    {t("subvaluadas.freeGate.bannerCta")}
                  </button>
                </div>
              )}

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

              {!isPremium && !searchTriggered && !data ? (
                <div className="max-w-xl mx-auto rounded-2xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(212,162,76,0.12)" }}>
                    <Search className="w-7 h-7" style={{ color: GOLD }} />
                  </div>
                  <h2 className="font-bold text-base mb-2" style={{ color: "var(--text)" }}>{t("subvaluadas.freeGate.title")}</h2>
                  <p className="text-sm mb-5 max-w-sm mx-auto" style={{ color: "var(--muted)" }}>{t("subvaluadas.freeGate.desc")}</p>
                  <button onClick={() => setPaywallOpen(true)} className="px-6 py-2.5 rounded-xl text-sm font-bold" style={{ background: GOLD, color: "#0A0F1A" }}>
                    {t("subvaluadas.freeGate.cta")}
                  </button>
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin" style={{ color: GOLD }} /></div>
              ) : limitHit ? (
                <div className="max-w-xl mx-auto rounded-2xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(212,162,76,0.12)" }}>
                    <Lock className="w-7 h-7" style={{ color: GOLD }} />
                  </div>
                  <h2 className="font-bold text-base mb-2" style={{ color: "var(--text)" }}>{t("subvaluadas.freeGate.limitTitle")}</h2>
                  <p className="text-sm mb-5 max-w-sm mx-auto" style={{ color: "var(--muted)" }}>{error || t("subvaluadas.freeGate.limitDesc")}</p>
                  <button onClick={() => setPaywallOpen(true)} className="px-6 py-2.5 rounded-xl text-sm font-bold" style={{ background: GOLD, color: "#0A0F1A" }}>
                    {t("subvaluadas.freeGate.cta")}
                  </button>
                </div>
              ) : error || !data ? (
                <div className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>{error || t("subvaluadas.search.error")}</p>
                </div>
              ) : (
                <>
                  <div className="flex items-end justify-between gap-5 flex-wrap mb-5">
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

                  {/* ===== Fase 4 — Nivel de Detalle: cambiable en cualquier momento,
                       controla qué secciones se muestran debajo (src/lib/detailLevel.ts). ===== */}
                  <div className="flex justify-end mb-5">
                    <DetailLevelToggle value={detailLevel} onChange={setDetailLevel} />
                  </div>

                  {/* ===== Fase 4 — Dashboard Principal: resumen ejecutivo, siempre visible
                       (nivel Principiante), construido con datos que esta página ya trae. ===== */}
                  <ExecutiveSummaryPanel
                    price={data.price}
                    intrinsicValue={data.expected_value_per_share ?? data.intrinsic_value_base}
                    fairValueRange={data.fair_value_range}
                    consensusValuation={data.consensus_valuation}
                    marginOfSafetyPct={data.margin_of_safety_pct}
                    qualityScore={nifData?.pillars?.business_quality?.score ?? null}
                    qualityNuvosEstimate={nifData?.pillars?.business_quality?.nuvos_estimate ?? null}
                    convictionScore={nifData?.conviction?.score ?? null}
                    convictionFactors={nifData?.conviction?.factors ?? null}
                    confidenceMeter={data.confidence_meter}
                    thesisDraft={thesisDraft}
                    thesisLoading={isPremium && thesisLoading}
                    deterioration={nifData?.deterioration ?? null}
                  />

                  {/* ===== Fase 4, Incremento 12 (Personalización, Parte L) — these 4
                       blocks (checklist/nif/timeline/thesis_history) render in the
                       user's own chosen order (src/lib/personalization.ts), default
                       order unchanged from Incrementos 5/6/8. Each block keeps its own
                       gating condition exactly as before — reordering never changes
                       WHETHER something shows, only the sequence. ===== */}
                  {resolveDashboardSectionOrder(effectiveSectionOrder).map((sectionKey) => {
                    if (sectionKey === "checklist") {
                      return isPremium ? (
                        <InvestmentChecklistPanel
                          key="checklist"
                          ticker={data.ticker}
                          marginOfSafetyPct={data.margin_of_safety_pct}
                          minMarginOfSafetyPct={minMarginOfSafetyPct}
                        />
                      ) : null;
                    }
                    if (sectionKey === "nif") {
                      return (
                        <div key="nif">
                          {isPremium && isSectionVisible(detailLevel, "moat_score") && (
                            nifLoading ? (
                              <NifDashboardSkeleton />
                            ) : nifData && !nifError ? (() => {
                              // Hotfix: nif_dashboard is cached for up to 90 days
                              // (screener.py's _NIF_DASHBOARD_CACHE_TTL) — a payload
                              // cached before some field existed, or any other real-
                              // world schema drift, can legitimately arrive missing a
                              // key the type used to (wrongly) declare as required.
                              // Every nested read below is defensive because of that,
                              // not because these are ever intentionally omitted.
                              const bq = nifData.pillars?.business_quality ?? null;
                              const fs = nifData.pillars?.financial_strength ?? null;
                              const mq = nifData.pillars?.management_quality ?? null;
                              const val = nifData.pillars?.valuation ?? null;
                              return (
                              <div className="mb-8">
                                <NifOverallScoreBanner overall={nifData.overall_nif_score} />
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <NifPillarCard
                                    titleKey="business_quality"
                                    score={bq?.score ?? null}
                                    dataRows={buildNifRows("business_quality_data", bq?.data ?? {}, isFinancialSector, t)}
                                    estimateRows={buildNifRows("business_quality_estimate", bq?.nuvos_estimate ?? {}, isFinancialSector, t)}
                                    explanation={bq?.explanation ?? null}
                                  />
                                  <NifPillarCard
                                    titleKey="financial_strength"
                                    score={fs?.score ?? null}
                                    dataRows={buildNifRows("financial_strength_data", fs?.data ?? {}, isFinancialSector, t)}
                                    estimateRows={buildNifRows("financial_strength_estimate", fs?.nuvos_estimate ?? {}, isFinancialSector, t)}
                                    explanation={fs?.explanation ?? null}
                                  />
                                  <NifPillarCard
                                    titleKey="management_quality"
                                    score={mq?.score ?? null}
                                    dataRows={buildNifRows("management_quality_data", mq?.data ?? {}, isFinancialSector, t)}
                                    estimateRows={buildNifRows("management_quality_estimate", mq?.nuvos_estimate ?? {}, isFinancialSector, t)}
                                    explanation={mq?.explanation ?? null}
                                  />
                                  <NifPillarCard
                                    titleKey="valuation"
                                    score={val?.score ?? null}
                                    dataRows={buildNifRows("valuation_data", val?.data ?? {}, isFinancialSector, t)}
                                    estimateRows={buildNifRows("valuation_estimate", val?.nuvos_estimate ?? {}, isFinancialSector, t)}
                                    explanation={val?.explanation ?? null}
                                  />
                                </div>

                                {/* ===== Fase 2 — Motores de Calidad: Moat, Conviction, Management
                                     deep dive, Catalysts, Peer Comparison, Deterioration. Deliberately
                                     SIBLINGS of the 4-pillar grid above, never blended into
                                     overall_nif_score — see shared.tsx's section header comment. ===== */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                                  <NifScoreEngineCard
                                    titleKey="moat"
                                    icon={<Shield className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />}
                                    score={nifData.moat?.score ?? null}
                                    factors={nifData.moat?.factors ?? []}
                                    footer={nifData.moat?.deep_dive ? <NifMoatDeepDiveBlock deepDive={nifData.moat.deep_dive} /> : null}
                                  />
                                  <NifScoreEngineCard
                                    titleKey="conviction"
                                    icon={<Target className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />}
                                    score={nifData.conviction?.score ?? null}
                                    factors={nifData.conviction?.factors ?? []}
                                  />
                                  <NifManagementDeepDiveCard deepDive={mq?.deep_dive} />
                                  <NifCatalystsCard data={nifData.catalysts} />
                                  <NifDeteriorationCard data={nifData.deterioration} />
                                </div>

                                {/* ===== Fase 4, Incremento 4 — Comparaciones (Parte D): visualización de
                                     barras contra peers reales, reemplaza el NifPeerComparisonCard (lista
                                     simple) con algo explícitamente visual. ===== */}
                                <PeerComparisonChart
                                  ticker={data.ticker}
                                  companyMetrics={{
                                    quality_score: bq?.score ?? null,
                                    roic_pct: numOrNull((bq?.data as Record<string, unknown>)?.roic_pct),
                                    operating_margin_pct: numOrNull((bq?.data as Record<string, unknown>)?.operating_margin_pct),
                                    revenue_cagr_pct: numOrNull((bq?.data as Record<string, unknown>)?.revenue_cagr_pct),
                                  }}
                                  peerComparison={nifData.peer_comparison}
                                />
                              </div>
                              );
                            })() : null
                          )}
                        </div>
                      );
                    }
                    if (sectionKey === "timeline") {
                      return isPremium && isSectionVisible(detailLevel, "timeline") ? (
                        <CompanyTimeline key="timeline" events={timelineEvents} loading={timelineLoading} />
                      ) : null;
                    }
                    // thesis_history
                    return isPremium && isSectionVisible(detailLevel, "dcf_full") ? (
                      <div key="thesis_history">
                        {!thesisLoading && thesisDraft && !myThesis && (
                          <div className="flex items-center justify-between gap-3 rounded-xl border p-3.5 mb-3"
                               style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                            <p className="text-[12px]" style={{ color: "var(--sub)" }}>
                              {t("subvaluadas.investmentJournal.adoptPrompt")}
                            </p>
                            <button
                              type="button"
                              onClick={handleAdoptThesis}
                              disabled={adoptingThesis}
                              className="shrink-0 text-[11.5px] font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"
                              style={{ background: "var(--accent-l)", color: "#0a0a0a" }}
                            >
                              {adoptingThesis ? t("subvaluadas.investmentJournal.adopting") : t("subvaluadas.investmentJournal.adoptCta")}
                            </button>
                          </div>
                        )}
                        <ThesisHistoryPanel versions={thesisHistory} loading={thesisHistoryLoading} />
                      </div>
                    ) : null;
                  })}

                  {/* ===== Nivel 1 summary — GeneratedAtNote/LiquidityWarning/InsightBox stay
                       visible at every Nivel de Detalle (safety info + the plain-language
                       AI summary belong at Principiante); FairValueRangeDisplay/ConfidenceMeter
                       are folded into ExecutiveSummaryPanel above (Fase 4, Incremento 2;
                       FairValueRangeDisplay actually wired in at Fase 1.5, Incremento 11) to
                       avoid showing the same numbers twice. FinalResultPanel (dead code, no
                       references) was deleted in the same increment. ===== */}
                  <div className="space-y-3 mb-8">
                    <GeneratedAtNote generatedAt={data.generated_at} />
                    {data.liquidity_gate && <LiquidityWarning gate={data.liquidity_gate} />}
                    {isSectionVisible(detailLevel, "dcf_full") && data.market_expectations && (
                      <MarketExpectationsPanel data={data.market_expectations} />
                    )}
                    {isSectionVisible(detailLevel, "roic_fcf_growth") && data.checklist && (
                      <ChecklistDisplay checklist={data.checklist} />
                    )}
                    <InsightBox>{data.summary}</InsightBox>
                  </div>

                  {/* ===== Calculadora de Valor Intrínseco (DCF manual + sensibilidad +
                       escenarios + reverse DCF) — Fase 4 Parte B: nivel Avanzado+. Ya existía
                       tal cual; solo se le agrega la puerta de nivel de detalle. ===== */}
                  {isSectionVisible(detailLevel, "dcf_full") && (
                  <>
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
                            <div className="flex items-center gap-4 mt-1 flex-wrap">
                              {!isDefault && (
                                <button onClick={() => { setG(suggestedG); setR(suggestedR); setGt(suggestedGt); }}
                                        className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: GOLD }}>
                                  <RotateCcw className="w-3 h-3" />
                                  {t("subvaluadas.dcf.reset")}
                                </button>
                              )}
                              <button onClick={handleSaveValuation} disabled={saveState === "saving" || saveState === "saved"}
                                      className="flex items-center gap-1.5 text-[11px] font-bold disabled:opacity-70"
                                      style={{ color: saveState === "saved" ? TEAL : "var(--sub)" }}>
                                {saveState === "saving" ? <Loader2 className="w-3 h-3 animate-spin" /> : saveState === "saved" ? <Check className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
                                {saveState === "saved" ? t("subvaluadas.detail.saveCta.saved") : t("subvaluadas.detail.saveCta.default")}
                              </button>
                              {saveState === "error" && (
                                <span className="text-[11px]" style={{ color: CORAL }}>{t("subvaluadas.detail.saveCta.error")}</span>
                              )}
                            </div>

                            {(mentorTipLoading || mentorTip) && (
                              <div className="flex items-start gap-2 mt-3 p-3 rounded-xl text-[12px] leading-relaxed"
                                   style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--sub)" }}>
                                <span className="shrink-0">🎓</span>
                                {mentorTipLoading ? (
                                  <span style={{ color: "var(--muted)" }}>{t("subvaluadas.dcf.mentorTip.loading")}</span>
                                ) : (
                                  <span>{mentorTip}</span>
                                )}
                              </div>
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

                      {/* ===== Fase 4, Incremento 7 — Manual vs. IA (Parte G): compara los
                           supuestos que el usuario acaba de mover contra los de Nuvos, sin
                           veredicto de cuál es correcto. ===== */}
                      <div className="mt-5">
                        <ManualVsAiPanel
                          comparison={buildManualVsAiComparison(
                            [
                              { key: "growth", userValuePct: g, nuvosValuePct: suggestedG },
                              { key: "wacc", userValuePct: r, nuvosValuePct: suggestedR },
                              { key: "terminalGrowth", userValuePct: gt, nuvosValuePct: suggestedGt },
                            ],
                            liveResult?.valorPorAccion ?? null, data.expected_value_per_share ?? data.intrinsic_value_base,
                          )}
                        />
                      </div>

                      {data.sensitivity_matrix && price !== null && (
                        <SensitivityHeatmap matrix={data.sensitivity_matrix} price={price} />
                      )}

                      {/* ===== Nuvos AI Fair Value Engine redesign, Incremento 9 —
                           una sola máquina, tres escenarios (Bear/Base/Bull), aditivo
                           y gateado a "avanzado" (mismo nivel que el resto del bloque
                           DCF). Nunca reemplaza el ScenarioWeightingPanel de abajo
                           hasta el flip (Incremento 11). ===== */}
                      {isSectionVisible(detailLevel, "scenarios") && data.nuvos_fair_value && (
                        <div className="mt-5">
                          <FairValueScenariosPanel data={data.nuvos_fair_value} price={price} />
                        </div>
                      )}

                      {data.scenarios && data.probability_weights && (
                        <div className="mt-5">
                          <ScenarioWeightingPanel scenarios={data.scenarios} defaultWeights={data.probability_weights} />
                        </div>
                      )}

                      {(data.reverse_dcf_sanity_check || data.expectations_investing) && (
                        <div className="mt-5">
                          <ReverseDcfPanel
                            sanityCheck={data.reverse_dcf_sanity_check}
                            expectationsInvesting={data.expectations_investing}
                          />
                        </div>
                      )}

                      {/* ===== Fase 1.5, Incremento 9 — vista previa del Growth
                           Engine nuevo (modo sombra), gateada a Profesional per
                           decisión explícita de Diego. ===== */}
                      {isSectionVisible(detailLevel, "factors_detail") && data.growth_engine && (
                        <div className="mt-5">
                          <GrowthEnginePreviewPanel data={data.growth_engine} />
                        </div>
                      )}

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
      </div>

      <ExplainButton
        screen={data ? "oportunidades_resultado" : "oportunidades_intro"}
        context={
          data
            ? {
                ticker: data.ticker,
                company_name: data.company_name,
                price: data.price,
                fair_value_low: data.fair_value_range?.low ?? null,
                fair_value_high: data.fair_value_range?.high ?? null,
                margin_of_safety_pct: liveMos,
                intrinsic_value_per_share: liveResult?.valorPorAccion ?? null,
                wacc_pct: r,
                growth_pct: g,
                terminal_growth_pct: gt,
                summary: data.summary,
              }
            : {
                screen_purpose:
                  "This screen shows whether a stock is cheap or expensive by comparing its " +
                  "current price to its real value, estimated from the company's expected " +
                  "future cash flows (a method called DCF — discounted cash flow). It helps " +
                  "the user decide whether now looks like a good time to buy, letting them " +
                  "adjust their own assumptions for growth and risk (WACC).",
              }
        }
      />

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
