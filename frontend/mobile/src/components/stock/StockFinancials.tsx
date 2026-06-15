import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import Svg, { Rect, G, Text as SvgText, Line } from "react-native-svg";
import { useTheme } from "../../lib/ThemeContext";
import { marketApi } from "../../lib/api";
import type { Financials, FinancialPeriod, RichFinancials } from "../../hooks/useStockDetail";

const { width: SCREEN_W } = Dimensions.get("window");
const PAD = 16;
const CHART_W = SCREEN_W - PAD * 2;
const CHART_H = 160;
const LABEL_H = 18;
const DRAW_H  = CHART_H - LABEL_H;

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
  const y = period.slice(0, 4);
  return `'${y.slice(2)}`;
}

function yoyChange(curr: number | null | undefined, prev: number | null | undefined): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ─── Mini Bar Chart ───────────────────────────────────────────────────────────

function MiniBarChart({ periods, field, accent, muted }: {
  periods: FinancialPeriod[];
  field: keyof FinancialPeriod;
  accent: string;
  muted: string;
}) {
  const data = periods.slice(-5).map((p) => ({
    label: yearLabel(p.period),
    value: p[field] as number | null | undefined,
  }));
  const valid = data.filter((d) => d.value != null);
  if (valid.length < 2) return null;

  const maxAbs = Math.max(...valid.map((d) => Math.abs(d.value!)));
  const n = data.length;
  const gap = 6;
  const barW = (CHART_W - gap * (n - 1)) / n;

  return (
    <Svg width={CHART_W} height={CHART_H}>
      <Line x1={0} y1={DRAW_H} x2={CHART_W} y2={DRAW_H} stroke={muted} strokeWidth={0.5} opacity={0.4} />
      {data.map((d, i) => {
        const x = i * (barW + gap);
        const val = d.value ?? 0;
        const barH = maxAbs > 0 ? (Math.abs(val) / maxAbs) * (DRAW_H - 4) : 0;
        const y = DRAW_H - barH;
        const color = val < 0 ? "#ef4444" : accent;
        return (
          <G key={i}>
            {barH > 0 && <Rect x={x} y={y} width={barW} height={barH} rx={3} fill={color} opacity={0.85} />}
            <SvgText x={x + barW / 2} y={CHART_H - 2} textAnchor="middle" fontSize={9} fill={muted} fontWeight="600">
              {d.label}
            </SvgText>
            {barH > 14 && (
              <SvgText x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={8} fill={color} fontWeight="700">
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
  label, periods, field, isMargin = false, indent = false, colors,
}: {
  label: string;
  periods: FinancialPeriod[];
  field: keyof FinancialPeriod;
  isMargin?: boolean;
  indent?: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const last5 = periods.slice(-5);
  const latest = last5[last5.length - 1]?.[field] as number | null | undefined;
  const prev   = last5[last5.length - 2]?.[field] as number | null | undefined;
  if (latest == null && !isMargin) return null;

  const change = isMargin
    ? (latest != null && prev != null ? latest - prev : null)
    : yoyChange(latest, prev);
  const isUp = (change ?? 0) >= 0;
  const changeColor = isUp ? colors.up : colors.down;

  return (
    <View style={[
      mrow.row,
      { borderTopColor: colors.border },
      indent && { paddingLeft: 20, backgroundColor: "rgba(0,0,0,0.015)" },
    ]}>
      <Text style={[mrow.label, { color: indent ? colors.textMuted : colors.text, fontSize: indent ? 12 : 13 }]}>
        {label}
      </Text>
      <View style={mrow.right}>
        <Text style={[mrow.value, { color: indent ? (latest != null && latest >= 0 ? colors.up : colors.down) : colors.text, fontSize: indent ? 12 : 13 }]}>
          {latest == null ? "—" : isMargin ? fmtPct(latest) : fmtBig(latest)}
        </Text>
        {change != null && (
          <View style={[mrow.pill, { backgroundColor: changeColor + "18" }]}>
            <Text style={[mrow.pillText, { color: changeColor }]}>
              {isUp ? "▲" : "▼"} {Math.abs(change).toFixed(1)}{isMargin ? "pp" : "%"}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const mrow = StyleSheet.create({
  row:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  label:    { flex: 1, fontWeight: "500" },
  right:    { flexDirection: "row", alignItems: "center", gap: 6 },
  value:    { fontWeight: "700" },
  pill:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  pillText: { fontSize: 10, fontWeight: "700" },
});

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionLabel({ title, colors }: { title: string; colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <Text style={[sl.text, { color: colors.textMuted }]}>{title}</Text>
  );
}
const sl = StyleSheet.create({
  text: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", paddingHorizontal: PAD, paddingTop: 14, paddingBottom: 6 },
});

// ─── AI Analysis ──────────────────────────────────────────────────────────────

function AIAnalysis({ ticker, colors }: { ticker: string; colors: ReturnType<typeof useTheme>["colors"] }) {
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
    <View style={[ai.card, { borderColor: colors.border, backgroundColor: colors.bgRaised }]}>
      <View style={ai.header}>
        <Text style={[ai.sparkle, { color: colors.accentLight }]}>✦</Text>
        <Text style={[ai.title, { color: colors.accentLight }]}>Análisis IA</Text>
      </View>
      {loading
        ? <ActivityIndicator size="small" color={colors.accentLight} style={{ marginTop: 4 }} />
        : text
          ? <Text style={[ai.body, { color: colors.textMuted }]}>{text}</Text>
          : <Text style={[ai.body, { color: colors.textMuted, opacity: 0.5 }]}>Sin análisis disponible</Text>
      }
    </View>
  );
}
const ai = StyleSheet.create({
  card:    { marginHorizontal: PAD, marginTop: 16, borderRadius: 14, borderWidth: 1, padding: 14 },
  header:  { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  sparkle: { fontSize: 11, fontWeight: "800" },
  title:   { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  body:    { fontSize: 13, lineHeight: 20 },
});

// ─── Tab content ──────────────────────────────────────────────────────────────

function IncomeTab({ periods, ticker, colors }: { periods: FinancialPeriod[]; ticker?: string; colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <View>
      <SectionLabel title="Ingresos Totales" colors={colors} />
      <View style={{ paddingHorizontal: PAD }}>
        <MiniBarChart periods={periods} field="Total Revenue" accent={colors.accentLight} muted={colors.textMuted} />
      </View>
      <View style={{ paddingHorizontal: PAD, paddingTop: 4 }}>
        <MetricRow label="Ingresos Totales"    periods={periods} field="Total Revenue"       colors={colors} />
        <MetricRow label="Costo de Ventas"     periods={periods} field="Cost Of Revenue"      colors={colors} />
        <MetricRow label="Utilidad Bruta"      periods={periods} field="Gross Profit"         colors={colors} />
        <MetricRow label="  Margen Bruto"      periods={periods} field="Gross Margin %"       isMargin indent colors={colors} />
        <MetricRow label="Gastos Operativos"   periods={periods} field="Operating Expenses"   colors={colors} />
        <MetricRow label="Utilidad Operativa"  periods={periods} field="Operating Income"     colors={colors} />
        <MetricRow label="  Margen Operativo"  periods={periods} field="Operating Margin %"   isMargin indent colors={colors} />
        <MetricRow label="EBITDA"              periods={periods} field="EBITDA"               colors={colors} />
        <MetricRow label="Utilidad Neta"       periods={periods} field="Net Income"           colors={colors} />
        <MetricRow label="  Margen Neto"       periods={periods} field="Net Margin %"         isMargin indent colors={colors} />
        <MetricRow label="EPS Diluido"         periods={periods} field="Diluted EPS"          colors={colors} />
      </View>
      {ticker && <AIAnalysis ticker={ticker} colors={colors} />}
      <View style={{ height: 16 }} />
    </View>
  );
}

function BalanceTab({ periods, colors }: { periods: FinancialPeriod[]; colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <View>
      <SectionLabel title="Activos Totales" colors={colors} />
      <View style={{ paddingHorizontal: PAD }}>
        <MiniBarChart periods={periods} field="Total Assets" accent={colors.accentLight} muted={colors.textMuted} />
      </View>
      <View style={{ paddingHorizontal: PAD, paddingTop: 4 }}>
        <MetricRow label="Activos Totales"    periods={periods} field="Total Assets"                           colors={colors} />
        <MetricRow label="Activos Corrientes" periods={periods} field="Current Assets"                         colors={colors} />
        <MetricRow label="Pasivos Totales"    periods={periods} field="Total Liabilities Net Minority Interest" colors={colors} />
        <MetricRow label="Patrimonio Neto"    periods={periods} field="Stockholders Equity"                    colors={colors} />
        <MetricRow label="Deuda Total"        periods={periods} field="Total Debt"                             colors={colors} />
      </View>
      <View style={{ height: 16 }} />
    </View>
  );
}

function CashFlowTab({ periods, colors }: { periods: FinancialPeriod[]; colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <View>
      <SectionLabel title="Flujo Operativo" colors={colors} />
      <View style={{ paddingHorizontal: PAD }}>
        <MiniBarChart periods={periods} field="Operating Cash Flow" accent={colors.accentLight} muted={colors.textMuted} />
      </View>
      <View style={{ paddingHorizontal: PAD, paddingTop: 4 }}>
        <MetricRow label="Flujo Operativo"     periods={periods} field="Operating Cash Flow" colors={colors} />
        <MetricRow label="Flujo de Caja Libre" periods={periods} field="Free Cash Flow"      colors={colors} />
        <MetricRow label="CapEx"               periods={periods} field="Capital Expenditure" colors={colors} />
      </View>
      <View style={{ height: 16 }} />
    </View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type SubTab = "income" | "balance" | "cashflow";
type Period = "annual" | "quarterly";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "income",   label: "Est. Resultados" },
  { key: "balance",  label: "Balance" },
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
  const { colors } = useTheme();
  const [subTab, setSubTab]   = useState<SubTab>("income");
  const [period, setPeriod]   = useState<Period>("annual");

  // Prefer rich fiscal.ai data; fall back to basic stock-detail data
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
      <View style={{ alignItems: "center", paddingVertical: 48 }}>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>Sin estados financieros</Text>
      </View>
    );
  }

  return (
    <View style={{ paddingTop: 12 }}>
      {/* ── Controls row ── */}
      <View style={s.controls}>
        {/* Annual / Quarterly */}
        <View style={[s.toggle, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
          {(["annual", "quarterly"] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => setPeriod(p)}
              style={[s.toggleBtn, period === p && { backgroundColor: colors.accentGlow }]}
              activeOpacity={0.7}
            >
              <Text style={[s.toggleText, { color: period === p ? colors.accentLight : colors.textMuted }]}>
                {p === "annual" ? "Anual" : "Trim."}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[s.source, { color: colors.textMuted }]}>
          {providerLabel(richFin?.provider ?? financials.source)}
        </Text>
      </View>

      {/* ── Sub-tab pills ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: PAD, gap: 8, paddingBottom: 12 }}
      >
        {SUB_TABS.map((t) => {
          const active = t.key === subTab;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setSubTab(t.key)}
              style={[s.pill, { backgroundColor: active ? colors.accentGlow : colors.bgRaised, borderColor: active ? colors.accentLight : colors.border }]}
              activeOpacity={0.7}
            >
              <Text style={[s.pillText, { color: active ? colors.accentLight : colors.textMuted }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Content ── */}
      {subTab === "income"   && <IncomeTab   periods={income}   ticker={ticker} colors={colors} />}
      {subTab === "balance"  && <BalanceTab  periods={balance}  colors={colors} />}
      {subTab === "cashflow" && <CashFlowTab periods={cashflow} colors={colors} />}
    </View>
  );
}

const s = StyleSheet.create({
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: PAD,
    paddingBottom: 10,
    gap: 8,
  },
  toggle: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  toggleText: {
    fontSize: 11,
    fontWeight: "700",
  },
  source: {
    fontSize: 9,
    fontWeight: "500",
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
