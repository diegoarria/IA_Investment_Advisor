import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Dimensions, ActivityIndicator,
} from "react-native";
import Svg, { Rect, G, Text as SvgText, Line } from "react-native-svg";
import { marketApi } from "../../lib/api";
import type { Financials, FinancialPeriod, RichFinancials } from "../../hooks/useStockDetail";

const { width: SCREEN_W } = Dimensions.get("window");
const PAD = 16;
const CHART_W = SCREEN_W - PAD * 2;
const CHART_H = 150;
const LABEL_H = 18;
const DRAW_H  = CHART_H - LABEL_H;

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

function MiniBarChart({ periods, field, accent }: {
  periods: FinancialPeriod[];
  field: keyof FinancialPeriod;
  accent: string;
}) {
  const data = periods.slice(-5).map((p) => ({
    label: yearLabel(p.period),
    value: p[field] as number | null | undefined,
  }));
  const valid = data.filter((d) => d.value != null);
  if (valid.length < 2) return null;

  const maxAbs = Math.max(...valid.map((d) => Math.abs(d.value!)));
  const n = data.length;
  const gap = 8;
  const barW = (CHART_W - gap * (n - 1)) / n;

  return (
    <Svg width={CHART_W} height={CHART_H}>
      <Line x1={0} y1={DRAW_H} x2={CHART_W} y2={DRAW_H} stroke="#2a3040" strokeWidth={1} />
      {data.map((d, i) => {
        const x = i * (barW + gap);
        const val = d.value ?? 0;
        const barH = maxAbs > 0 ? (Math.abs(val) / maxAbs) * (DRAW_H - 8) : 0;
        const y = DRAW_H - barH;
        const color = val < 0 ? D.red : accent;
        const isLast = i === n - 1;
        return (
          <G key={i}>
            {barH > 0 && (
              <Rect
                x={x} y={y} width={barW} height={barH}
                rx={4}
                fill={color}
                opacity={isLast ? 1 : 0.6}
              />
            )}
            <SvgText x={x + barW / 2} y={CHART_H - 2} textAnchor="middle" fontSize={10} fill={isLast ? "#c4c9d4" : "#7a8494"} fontWeight="600">
              {d.label}
            </SvgText>
            {barH > 14 && (
              <SvgText x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={8} fill={color} fontWeight="700">
                {fmtBig(val)}
              </SvgText>
            )}
          </G>
        );
      })}
    </Svg>
  );
}

// ─── Metric Row ───────────────────────────────────────────────────────────────

function MetricRow({
  label, periods, field, isMargin = false, indent = false,
}: {
  label: string;
  periods: FinancialPeriod[];
  field: keyof FinancialPeriod;
  isMargin?: boolean;
  indent?: boolean;
}) {
  const last5  = periods.slice(-5);
  const latest = last5[last5.length - 1]?.[field] as number | null | undefined;
  const prev   = last5[last5.length - 2]?.[field] as number | null | undefined;
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
      <Text style={[mr.label, { color: indent ? D.muted : "#c4c9d4", fontSize: indent ? 12 : 13 }]}>
        {label.replace(/^\s+/, "")}
      </Text>
      <View style={mr.right}>
        <Text style={[mr.value, { color: valueColor, fontSize: indent ? 12 : 14 }]}>
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
  row:       { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1f2330", gap: 10 },
  indented:  { paddingLeft: 16 },
  indentBar: { width: 2, height: 16, borderRadius: 1, backgroundColor: "#2a3040", marginRight: 2 },
  label:     { flex: 1, fontWeight: "500" },
  right:     { flexDirection: "row", alignItems: "center", gap: 8 },
  value:     { fontWeight: "700" },
  pill:      { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  pillText:  { fontSize: 10, fontWeight: "700" },
});

// ─── AI Analysis ──────────────────────────────────────────────────────────────

function AIAnalysis({ ticker }: { ticker: string }) {
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
        <Text style={ai.title}>Análisis IA</Text>
      </View>
      {loading
        ? <ActivityIndicator size="small" color={D.purple} style={{ marginTop: 4 }} />
        : text
          ? <Text style={ai.body}>{text}</Text>
          : <Text style={[ai.body, { opacity: 0.45 }]}>Sin análisis disponible</Text>
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
  text: { fontSize: 9, fontFamily: "DMSans_800ExtraBold", letterSpacing: 0.8, textTransform: "uppercase", color: D.green, paddingHorizontal: PAD, paddingTop: 18, paddingBottom: 8 },
});

// ─── Tab content ──────────────────────────────────────────────────────────────

function IncomeTab({ periods, ticker }: { periods: FinancialPeriod[]; ticker?: string }) {
  return (
    <View>
      <SectionLabel title="Ingresos Totales" />
      <View style={{ paddingHorizontal: PAD }}>
        <MiniBarChart periods={periods} field="Total Revenue" accent={D.green} />
      </View>
      <View style={{ paddingHorizontal: PAD, paddingTop: 6 }}>
        <MetricRow label="Ingresos Totales"    periods={periods} field="Total Revenue" />
        <MetricRow label="Costo de Ventas"     periods={periods} field="Cost Of Revenue" />
        <MetricRow label="Utilidad Bruta"      periods={periods} field="Gross Profit" />
        <MetricRow label="  Margen Bruto"      periods={periods} field="Gross Margin %" isMargin indent />
        <MetricRow label="Gastos Operativos"   periods={periods} field="Operating Expenses" />
        <MetricRow label="Utilidad Operativa"  periods={periods} field="Operating Income" />
        <MetricRow label="  Margen Operativo"  periods={periods} field="Operating Margin %" isMargin indent />
        <MetricRow label="EBITDA"              periods={periods} field="EBITDA" />
        <MetricRow label="Utilidad Neta"       periods={periods} field="Net Income" />
        <MetricRow label="  Margen Neto"       periods={periods} field="Net Margin %" isMargin indent />
        <MetricRow label="EPS Diluido"         periods={periods} field="Diluted EPS" />
      </View>
      {ticker && <AIAnalysis ticker={ticker} />}
      <View style={{ height: 16 }} />
    </View>
  );
}

function BalanceTab({ periods }: { periods: FinancialPeriod[] }) {
  return (
    <View>
      <SectionLabel title="Activos Totales" />
      <View style={{ paddingHorizontal: PAD }}>
        <MiniBarChart periods={periods} field="Total Assets" accent="#3b82f6" />
      </View>
      <View style={{ paddingHorizontal: PAD, paddingTop: 6 }}>
        <MetricRow label="Activos Totales"    periods={periods} field="Total Assets" />
        <MetricRow label="Activos Corrientes" periods={periods} field="Current Assets" />
        <MetricRow label="Pasivos Totales"    periods={periods} field="Total Liabilities Net Minority Interest" />
        <MetricRow label="Patrimonio Neto"    periods={periods} field="Stockholders Equity" />
        <MetricRow label="Deuda Total"        periods={periods} field="Total Debt" />
      </View>
      <View style={{ height: 16 }} />
    </View>
  );
}

function CashFlowTab({ periods }: { periods: FinancialPeriod[] }) {
  return (
    <View>
      <SectionLabel title="Flujo Operativo" />
      <View style={{ paddingHorizontal: PAD }}>
        <MiniBarChart periods={periods} field="Operating Cash Flow" accent={D.amber} />
      </View>
      <View style={{ paddingHorizontal: PAD, paddingTop: 6 }}>
        <MetricRow label="Flujo Operativo"     periods={periods} field="Operating Cash Flow" />
        <MetricRow label="Flujo de Caja Libre" periods={periods} field="Free Cash Flow" />
        <MetricRow label="CapEx"               periods={periods} field="Capital Expenditure" />
      </View>
      <View style={{ height: 16 }} />
    </View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type SubTab = "income" | "balance" | "cashflow";
type Period = "annual" | "quarterly";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "income",   label: "Estado de Resultados" },
  { key: "balance",  label: "Balance General" },
  { key: "cashflow", label: "Flujo de Caja" },
];

function providerLabel(p?: string): string {
  if (p === "fiscal_ai") return "Fiscal.ai";
  if (p === "fmp")       return "Financial Modeling Prep";
  return "Yahoo Finance";
}

interface Props {
  financials: Financials;
  richFin?: RichFinancials;
  ticker?: string;
}

export default function StockFinancials({ financials, richFin, ticker }: Props) {
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
        <Text style={{ color: D.muted, fontSize: 13 }}>Sin estados financieros</Text>
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
                {p === "annual" ? "Anual" : "Trimestral"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.source}>{providerLabel(richFin?.provider ?? financials.source)}</Text>
      </View>

      {/* ── Sub-tabs ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: PAD, gap: 8, paddingBottom: 14 }}
      >
        {SUB_TABS.map((t) => {
          const active = t.key === subTab;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setSubTab(t.key)}
              style={[s.pill, active && s.pillActive]}
              activeOpacity={0.7}
            >
              <Text style={[s.pillText, { color: active ? D.green : D.muted }]}>
                {t.label}
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
