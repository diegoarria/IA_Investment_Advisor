import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Dimensions, ActivityIndicator,
} from "react-native";
import Svg, { Rect, G, Text as SvgText, Line, Defs, LinearGradient, Stop } from "react-native-svg";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { marketApi } from "../../lib/api";
import type { Financials, FinancialPeriod, RichFinancials } from "../../hooks/useStockDetail";

const { width: SCREEN_W } = Dimensions.get("window");
const PAD = 16;
const CHART_W = SCREEN_W - PAD * 2;
const CHART_H   = 190;
const BOTTOM_H  = 24; // x-axis year labels
const TOP_PAD   = 28; // reserved so the tallest bar's value label never clips
const PLOT_H    = CHART_H - BOTTOM_H - TOP_PAD;
const BASE_Y    = CHART_H - BOTTOM_H;

const D = {
  bg:     "#0a0d12",
  card:   "#111318",
  raised: "#1a1d27",
  border: "#1f2330",
  text:   "#fff",
  sub:    "#9ca3af",
  muted:  "#6b7280",
  dim:    "#4b5563",
  green:  "#00d47e",
  red:    "#ef4444",
  amber:  "#f59e0b",
  purple: "#a855f7",
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtBig(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3)  return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

function yearLabel(period: string): string {
  return `'${period.slice(2, 4)}`;
}

function yoyChange(curr: number | null | undefined, prev: number | null | undefined): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────

function MiniBarChart({ periods, field, accent, activeIndex, onSelect }: {
  periods: FinancialPeriod[];
  field: keyof FinancialPeriod;
  accent: string;
  activeIndex: number;
  onSelect: (i: number) => void;
}) {
  const data = periods.slice(-5).map((p) => ({
    label: yearLabel(p.period),
    value: p[field] as number | null | undefined,
  }));
  const valid = data.filter((d) => d.value != null);
  if (valid.length < 2) return null;

  const maxAbs = Math.max(...valid.map((d) => Math.abs(d.value!)));
  const n = data.length;
  const gap = 10;
  const barW = (CHART_W - gap * (n - 1)) / n;
  const gradId = `barGrad_${String(field).replace(/\s/g, "")}`;

  // Faint horizontal guides at 1/3 and 2/3 of the plot height
  const guides = [0.33, 0.66].map((f) => BASE_Y - PLOT_H * f);

  return (
    <View>
      <Svg width={CHART_W} height={CHART_H}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={accent} stopOpacity="1" />
            <Stop offset="1" stopColor={accent} stopOpacity="0.55" />
          </LinearGradient>
        </Defs>

        {guides.map((gy, i) => (
          <Line key={i} x1={0} y1={gy} x2={CHART_W} y2={gy} stroke="#20242f" strokeWidth={1} />
        ))}
        <Line x1={0} y1={BASE_Y} x2={CHART_W} y2={BASE_Y} stroke="#2a3040" strokeWidth={1} />

        {data.map((d, i) => {
          const x = i * (barW + gap);
          const val = d.value ?? 0;
          const hasVal = d.value != null;
          const barH = maxAbs > 0 ? (Math.abs(val) / maxAbs) * PLOT_H : 0;
          const y = BASE_Y - barH;
          const isNeg = val < 0;
          const active = i === activeIndex;
          const fill = !hasVal ? "#20242f" : isNeg ? D.red : active ? `url(#${gradId})` : accent;
          const labelY = Math.max(y - 8, TOP_PAD - 12);
          return (
            <G key={i}>
              {/* Track — full-height faint column, also the tap target for this year */}
              <Rect x={x} y={TOP_PAD} width={barW} height={PLOT_H} rx={7}
                fill={active ? "#181e18" : "#12141a"}
                stroke={active ? accent + "55" : "transparent"} strokeWidth={active ? 1 : 0}
                onPress={() => hasVal && onSelect(i)} />
              {barH > 0 && (
                <Rect
                  x={x} y={y} width={barW} height={Math.max(barH, 3)}
                  rx={7}
                  fill={fill}
                  opacity={active || isNeg ? 1 : 0.55}
                />
              )}
              <SvgText x={x + barW / 2} y={CHART_H - 6} textAnchor="middle" fontSize={10.5} fill={active ? "#e5e8ee" : "#6b7280"} fontWeight={active ? "800" : "600"}>
                {d.label}
              </SvgText>
              {hasVal && (
                <SvgText
                  x={x + barW / 2} y={labelY} textAnchor="middle"
                  fontSize={active ? 11.5 : 10} fill={isNeg ? D.red : active ? "#fff" : "#9aa1b0"}
                  fontWeight={active ? "800" : "700"}
                >
                  {fmtBig(val)}
                </SvgText>
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

// ─── Metric Row ───────────────────────────────────────────────────────────────

function MetricRow({
  label, periods, field, isMargin = false, indent = false, selIndex,
}: {
  label: string;
  periods: FinancialPeriod[];
  field: keyof FinancialPeriod;
  isMargin?: boolean;
  indent?: boolean;
  selIndex: number;
}) {
  const last5  = periods.slice(-5);
  const idx    = Math.min(Math.max(selIndex, 0), last5.length - 1);
  const latest = last5[idx]?.[field] as number | null | undefined;
  const prev   = last5[idx - 1]?.[field] as number | null | undefined;
  if (latest == null && !isMargin) return null;

  const change = isMargin
    ? (latest != null && prev != null ? latest - prev : null)
    : yoyChange(latest, prev);
  const isUp = (change ?? 0) >= 0;
  const changeColor = isUp ? "#22c55e" : D.red;
  const valueColor = indent
    ? (latest != null && latest >= 0 ? "#22c55e" : D.red)
    : "#ffffff";

  return (
    <View style={[mr.row, indent && mr.indented]}>
      {indent && <View style={mr.indentBar} />}
      <Text style={[mr.label, { color: indent ? D.muted : "#dfe2e8", fontSize: indent ? 13.5 : 15 }]}>
        {label.replace(/^\s+/, "")}
      </Text>
      <View style={mr.right}>
        <Text style={[mr.value, { color: valueColor, fontSize: indent ? 14.5 : 17 }]}>
          {latest == null ? "—" : isMargin ? fmtPct(latest) : fmtBig(latest)}
        </Text>
        {change != null && (
          <View style={[mr.pill, { backgroundColor: changeColor + "22" }]}>
            <Text style={[mr.pillText, { color: changeColor }]}>
              {isUp ? "▲" : "▼"} {Math.abs(change).toFixed(1)}{isMargin ? "pp" : "%"}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const mr = StyleSheet.create({
  row:       { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1f2330", gap: 10 },
  indented:  { paddingLeft: 16 },
  indentBar: { width: 2, height: 18, borderRadius: 1, backgroundColor: "#2a3040", marginRight: 2 },
  label:     { flex: 1, fontWeight: "500" },
  right:     { flexDirection: "row", alignItems: "center", gap: 8 },
  value:     { fontWeight: "800" },
  pill:      { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  pillText:  { fontSize: 11.5, fontWeight: "700" },
});

// ─── AI Analysis ──────────────────────────────────────────────────────────────

function AIAnalysis({ ticker }: { ticker: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    setLoading(true);
    marketApi.getIncomeAnalysis(ticker)
      .then((r) => setText(r.data?.analysis ?? ""))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticker]);

  return (
    <View style={ai.card}>
      <View style={ai.header}>
        <View style={ai.iconBox}>
          <Text style={{ fontSize: 11 }}>✦</Text>
        </View>
        <Text style={ai.title}>{t("stockFinancials.aiAnalysisTitle")}</Text>
      </View>
      {loading
        ? <ActivityIndicator size="small" color={D.purple} style={{ marginTop: 4 }} />
        : text
          ? <Text style={ai.body}>{text}</Text>
          : <Text style={[ai.body, { opacity: 0.45 }]}>{t("stockFinancials.aiAnalysisLoading")}</Text>
      }
    </View>
  );
}

const ai = StyleSheet.create({
  card:    { marginTop: 16, borderRadius: 18, borderWidth: 1, borderColor: "rgba(168,85,247,0.25)", padding: 16, backgroundColor: "rgba(168,85,247,0.05)" },
  header:  { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  iconBox: { width: 24, height: 24, borderRadius: 7, backgroundColor: "rgba(168,85,247,0.15)", alignItems: "center", justifyContent: "center" },
  title:   { fontSize: 10, fontFamily: "DMSans_800ExtraBold", letterSpacing: 0.8, textTransform: "uppercase", color: D.purple },
  body:    { fontSize: 13, fontFamily: "DMSans_400Regular", lineHeight: 21, color: D.sub },
});

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ title }: { title: string }) {
  return (
    <Text style={sl.text}>{title}</Text>
  );
}

const sl = StyleSheet.create({
  text: { fontSize: 10.5, fontFamily: "DMSans_800ExtraBold", letterSpacing: 0.8, textTransform: "uppercase", color: D.green, paddingHorizontal: PAD, paddingTop: 18, paddingBottom: 8 },
});

// ─── Selected-year indicator ──────────────────────────────────────────────────

function usePeriodSelection(periods: FinancialPeriod[]) {
  const last5 = periods.slice(-5);
  const defaultIdx = Math.max(last5.length - 1, 0);
  const [selIdx, setSelIdx] = useState(defaultIdx);
  const key = periods.map((p) => p.period).join("|");
  const prevKey = useRef(key);
  if (prevKey.current !== key) {
    prevKey.current = key;
    // Periods changed (ticker switch, annual/quarterly toggle) — snap back to latest
    if (selIdx !== defaultIdx) setSelIdx(defaultIdx);
  }
  const selectedPeriod = last5[selIdx]?.period;
  const isLatest = selIdx === defaultIdx;
  return { selIdx, setSelIdx, selectedPeriod, isLatest, defaultIdx };
}

function YearIndicator({ periodLabel, isLatest, onReset }: { periodLabel?: string; isLatest: boolean; onReset: () => void }) {
  const { t } = useTranslation();
  if (isLatest || !periodLabel) return null;
  const year = periodLabel.slice(0, 4);
  return (
    <TouchableOpacity onPress={onReset} activeOpacity={0.7} style={yi.wrap}>
      <Text style={yi.text}>{t("stockFinancials.viewingYear", { year })}</Text>
      <Text style={yi.reset}>{t("stockFinancials.backToLatest")}</Text>
    </TouchableOpacity>
  );
}

const yi = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: PAD, marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: "rgba(0,212,126,0.08)", borderWidth: 1, borderColor: "rgba(0,212,126,0.25)" },
  text: { fontSize: 11.5, fontFamily: "DMSans_700Bold", color: D.green },
  reset: { fontSize: 11, fontFamily: "DMSans_600SemiBold", color: D.muted },
});

// ─── Tab content ──────────────────────────────────────────────────────────────

function IncomeTab({ periods, ticker }: { periods: FinancialPeriod[]; ticker?: string }) {
  const { t } = useTranslation();
  const { selIdx, setSelIdx, selectedPeriod, isLatest, defaultIdx } = usePeriodSelection(periods);
  return (
    <View>
      <SectionLabel title={t("stockFinancials.income.totalRevenueSection")} />
      <View style={{ paddingHorizontal: PAD }}>
        <MiniBarChart periods={periods} field="Total Revenue" accent={D.green} activeIndex={selIdx} onSelect={setSelIdx} />
      </View>
      <YearIndicator periodLabel={selectedPeriod} isLatest={isLatest} onReset={() => setSelIdx(defaultIdx)} />
      <View style={{ paddingHorizontal: PAD, paddingTop: 6 }}>
        <MetricRow label={t("stockFinancials.income.totalRevenue")}    periods={periods} field="Total Revenue" selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.income.costOfRevenue")}   periods={periods} field="Cost Of Revenue" selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.income.grossProfit")}     periods={periods} field="Gross Profit" selIndex={selIdx} />
        <MetricRow label={"  " + t("stockFinancials.income.grossMargin")}      periods={periods} field="Gross Margin %" isMargin indent selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.income.operatingExpenses")} periods={periods} field="Operating Expenses" selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.income.operatingIncome")}  periods={periods} field="Operating Income" selIndex={selIdx} />
        <MetricRow label={"  " + t("stockFinancials.income.operatingMargin")}  periods={periods} field="Operating Margin %" isMargin indent selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.income.ebitda")}              periods={periods} field="EBITDA" selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.income.netIncome")}       periods={periods} field="Net Income" selIndex={selIdx} />
        <MetricRow label={"  " + t("stockFinancials.income.netMargin")}       periods={periods} field="Net Margin %" isMargin indent selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.income.dilutedEps")}         periods={periods} field="Diluted EPS" selIndex={selIdx} />
      </View>
      {ticker && <AIAnalysis ticker={ticker} />}
      <View style={{ height: 16 }} />
    </View>
  );
}

function BalanceTab({ periods }: { periods: FinancialPeriod[] }) {
  const { t } = useTranslation();
  const { selIdx, setSelIdx, selectedPeriod, isLatest, defaultIdx } = usePeriodSelection(periods);
  return (
    <View>
      <SectionLabel title={t("stockFinancials.balance.totalAssetsSection")} />
      <View style={{ paddingHorizontal: PAD }}>
        <MiniBarChart periods={periods} field="Total Assets" accent="#3b82f6" activeIndex={selIdx} onSelect={setSelIdx} />
      </View>
      <YearIndicator periodLabel={selectedPeriod} isLatest={isLatest} onReset={() => setSelIdx(defaultIdx)} />
      <View style={{ paddingHorizontal: PAD, paddingTop: 6 }}>
        <MetricRow label={t("stockFinancials.balance.totalAssets")}    periods={periods} field="Total Assets" selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.balance.currentAssets")} periods={periods} field="Current Assets" selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.balance.totalLiabilities")}    periods={periods} field="Total Liabilities Net Minority Interest" selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.balance.stockholdersEquity")}    periods={periods} field="Stockholders Equity" selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.balance.totalDebt")}        periods={periods} field="Total Debt" selIndex={selIdx} />
      </View>
      <View style={{ height: 16 }} />
    </View>
  );
}

function CashFlowTab({ periods }: { periods: FinancialPeriod[] }) {
  const { t } = useTranslation();
  const { selIdx, setSelIdx, selectedPeriod, isLatest, defaultIdx } = usePeriodSelection(periods);
  return (
    <View>
      <SectionLabel title={t("stockFinancials.cashflow.operatingSection")} />
      <View style={{ paddingHorizontal: PAD }}>
        <MiniBarChart periods={periods} field="Operating Cash Flow" accent={D.amber} activeIndex={selIdx} onSelect={setSelIdx} />
      </View>
      <YearIndicator periodLabel={selectedPeriod} isLatest={isLatest} onReset={() => setSelIdx(defaultIdx)} />
      <View style={{ paddingHorizontal: PAD, paddingTop: 6 }}>
        <MetricRow label={t("stockFinancials.cashflow.operatingCashFlow")}     periods={periods} field="Operating Cash Flow" selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.cashflow.freeCashFlow")} periods={periods} field="Free Cash Flow" selIndex={selIdx} />
        <MetricRow label={t("stockFinancials.cashflow.capex")}               periods={periods} field="Capital Expenditure" selIndex={selIdx} />
      </View>
      <View style={{ height: 16 }} />
    </View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type SubTab = "income" | "balance" | "cashflow";
type Period = "annual" | "quarterly";

function getSubTabs(t: TFunction): { key: SubTab; label: string }[] {
  return [
    { key: "income",   label: t("stockFinancials.tabs.income") },
    { key: "balance",  label: t("stockFinancials.tabs.balance") },
    { key: "cashflow", label: t("stockFinancials.tabs.cashflow") },
  ];
}

function providerLabel(p: string | undefined, t: TFunction): string {
  if (p === "fiscal_ai") return t("stockFinancials.provider.fiscalAi");
  if (p === "fmp")       return t("stockFinancials.provider.fmp");
  return t("stockFinancials.provider.yahoo");
}

interface Props {
  financials: Financials;
  richFin?: RichFinancials;
  ticker?: string;
}

export default function StockFinancials({ financials, richFin, ticker }: Props) {
  const { t } = useTranslation();
  const SUB_TABS = getSubTabs(t);
  const [subTab, setSubTab] = useState<SubTab>("income");
  const [period, setPeriod] = useState<Period>("annual");

  const income = useMemo(() => {
    const rich = richFin?.incomeStatement?.[period] ?? [];
    const basic = financials.income?.annual ?? [];
    return rich.length > 0 ? rich : basic;
  }, [richFin, financials, period]);

  const balance = useMemo(() => {
    const rich = richFin?.balanceSheet?.[period] ?? [];
    const basic = financials.balance?.annual ?? [];
    return rich.length > 0 ? rich : basic;
  }, [richFin, financials, period]);

  const cashflow = useMemo(() => {
    const rich = richFin?.cashFlow?.[period] ?? [];
    const basic = financials.cashflow?.annual ?? [];
    return rich.length > 0 ? rich : basic;
  }, [richFin, financials, period]);

  const hasData = income.length > 0 || balance.length > 0 || cashflow.length > 0;

  if (!hasData) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 56 }}>
        <Text style={{ color: D.muted, fontSize: 13 }}>{t("stockFinancials.noStatements")}</Text>
      </View>
    );
  }

  return (
    <View style={{ paddingTop: 16 }}>

      {/* ── Controls ── */}
      <View style={s.controls}>
        <View style={s.periodToggle}>
          {(["annual", "quarterly"] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => setPeriod(p)}
              style={[s.periodBtn, period === p && s.periodBtnActive]}
              activeOpacity={0.7}
            >
              <Text style={[s.periodText, { color: period === p ? D.green : D.muted }]}>
                {p === "annual" ? t("stockFinancials.period.annual") : t("stockFinancials.period.quarterly")}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.source}>{providerLabel(richFin?.provider ?? financials.source, t)}</Text>
      </View>

      {/* ── Sub-tabs ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: PAD, gap: 8, paddingBottom: 14 }}
      >
        {SUB_TABS.map((tab) => {
          const active = tab.key === subTab;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setSubTab(tab.key)}
              style={[s.pill, active && s.pillActive]}
              activeOpacity={0.7}
            >
              <Text style={[s.pillText, { color: active ? D.green : D.muted }]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Content ── */}
      {subTab === "income"   && <IncomeTab   periods={income}   ticker={ticker} />}
      {subTab === "balance"  && <BalanceTab  periods={balance} />}
      {subTab === "cashflow" && <CashFlowTab periods={cashflow} />}
    </View>
  );
}

const s = StyleSheet.create({
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: PAD,
    paddingBottom: 14,
    gap: 8,
  },
  periodToggle: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: D.border,
    overflow: "hidden",
    backgroundColor: D.card,
  },
  periodBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  periodBtnActive: {
    backgroundColor: "rgba(0,212,126,0.1)",
  },
  periodText: {
    fontSize: 12,
    fontFamily: "DMSans_700Bold",
  },
  source: {
    fontSize: 9,
    fontFamily: "DMSans_500Medium",
    color: D.dim,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: D.border,
    backgroundColor: D.card,
  },
  pillActive: {
    backgroundColor: "rgba(0,212,126,0.1)",
    borderColor: "rgba(0,212,126,0.3)",
  },
  pillText: {
    fontSize: 12,
    fontFamily: "DMSans_700Bold",
  },
});
