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
import type { Financials, FinancialPeriod } from "../../hooks/useStockDetail";

const { width: SCREEN_W } = Dimensions.get("window");
const CHART_OUTER_PAD = 16;
const CHART_W = SCREEN_W - CHART_OUTER_PAD * 2; // full card inner width
const CHART_H = 180;
const BAR_LABEL_H = 20;
const DRAWABLE_H = CHART_H - BAR_LABEL_H;

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtBig(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function yearLabel(period: string): string {
  return period.slice(0, 4).slice(-2); // "2024-09" → "'24"
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────

interface BarDatum {
  label: string;
  value: number | null | undefined;
}

function BarChart({ data, positiveColor, muted }: {
  data: BarDatum[];
  positiveColor: string;
  muted: string;
}) {
  const valid = data.filter((d) => d.value != null && d.value !== 0);
  if (valid.length < 2) {
    return (
      <View style={{ height: CHART_H, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: muted, fontSize: 12 }}>Sin datos</Text>
      </View>
    );
  }

  const maxAbs = Math.max(...valid.map((d) => Math.abs(d.value!)));
  const n = data.length;
  const gap = 6;
  const barW = (CHART_W - gap * (n - 1)) / n;

  return (
    <Svg width={CHART_W} height={CHART_H}>
      {/* Baseline */}
      <Line
        x1={0} y1={DRAWABLE_H}
        x2={CHART_W} y2={DRAWABLE_H}
        stroke={muted}
        strokeWidth={0.5}
        opacity={0.4}
      />

      {data.map((d, i) => {
        const x = i * (barW + gap);
        const val = d.value ?? 0;
        const barH = maxAbs > 0 ? (Math.abs(val) / maxAbs) * (DRAWABLE_H - 4) : 0;
        const y = DRAWABLE_H - barH;
        const color = val < 0 ? "#ef4444" : positiveColor;

        return (
          <G key={i}>
            {barH > 0 && (
              <Rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={4}
                fill={color}
                opacity={0.9}
              />
            )}
            {/* Year label */}
            <SvgText
              x={x + barW / 2}
              y={CHART_H - 3}
              textAnchor="middle"
              fontSize={10}
              fill={muted}
              fontWeight="600"
            >
              {d.label}
            </SvgText>
            {/* Value label above bar */}
            {barH > 12 && (
              <SvgText
                x={x + barW / 2}
                y={y - 3}
                textAnchor="middle"
                fontSize={8.5}
                fill={color}
                fontWeight="700"
              >
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

function MetricRow({ label, data, colors }: {
  label: string;
  data: BarDatum[];
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const latest = data[data.length - 1]?.value;
  const prev   = data[data.length - 2]?.value;
  const growth = latest != null && prev != null && prev !== 0
    ? ((latest - prev) / Math.abs(prev)) * 100
    : null;
  const isUp   = (growth ?? 0) >= 0;

  return (
    <View style={[mr.row, { borderTopColor: colors.border }]}>
      <Text style={[mr.label, { color: colors.textMuted }]}>{label}</Text>
      <View style={mr.right}>
        <Text style={[mr.value, { color: colors.text }]}>{fmtBig(latest)}</Text>
        {growth != null && (
          <Text style={[mr.growth, { color: isUp ? colors.up : colors.down }]}>
            {isUp ? "▲" : "▼"} {Math.abs(growth).toFixed(1)}%
          </Text>
        )}
      </View>
    </View>
  );
}

const mr = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  label:  { fontSize: 15, fontWeight: "500" },
  right:  { flexDirection: "row", alignItems: "center", gap: 10 },
  value:  { fontSize: 15, fontWeight: "700" },
  growth: { fontSize: 13, fontWeight: "600" },
});

// ─── Margin Row (shows % with pp delta) ──────────────────────────────────────

function MarginRow({ annual, field, label, colors }: {
  annual: FinancialPeriod[];
  field: keyof FinancialPeriod;
  label: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const last5 = annual.slice(-5);
  const latest = last5[last5.length - 1]?.[field] as number | null | undefined;
  const prev   = last5[last5.length - 2]?.[field] as number | null | undefined;
  if (latest == null) return null;
  const delta = prev != null ? latest - prev : null;
  const isUp  = (delta ?? 0) >= 0;
  return (
    <View style={[mr.row, { borderTopColor: colors.border, paddingLeft: 12, backgroundColor: "rgba(0,0,0,0.018)" }]}>
      <Text style={[mr.label, { color: colors.textMuted, fontSize: 13, fontStyle: "italic" }]}>{label}</Text>
      <View style={mr.right}>
        <Text style={[mr.value, { color: latest >= 0 ? colors.up : colors.down, fontSize: 14 }]}>
          {latest.toFixed(1)}%
        </Text>
        {delta != null && (
          <Text style={[mr.growth, { color: isUp ? colors.up : colors.down, fontSize: 12 }]}>
            {isUp ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}pp
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function periodsToBarData(
  periods: FinancialPeriod[],
  key: keyof FinancialPeriod,
): BarDatum[] {
  return [...periods]
    .slice(-5)
    .reverse() // oldest → newest (left → right)
    .reverse()
    .map((p) => ({
      label: yearLabel(p.period),
      value: p[key] as number | null | undefined,
    }));
}

// ─── Tab Content ─────────────────────────────────────────────────────────────

function IncomeTab({ annual, ticker }: { annual: FinancialPeriod[]; ticker?: string }) {
  const { colors } = useTheme();
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading]   = useState(false);
  const aiLoaded = useRef(false);

  useEffect(() => {
    if (!ticker || aiLoaded.current) return;
    aiLoaded.current = true;
    setAiLoading(true);
    marketApi.getIncomeAnalysis(ticker)
      .then((r) => setAiAnalysis(r.data?.analysis ?? ""))
      .catch(() => {})
      .finally(() => setAiLoading(false));
  }, [ticker]);

  const revenue   = useMemo(() => periodsToBarData(annual, "Total Revenue"),        [annual]);
  const costRev   = useMemo(() => periodsToBarData(annual, "Cost Of Revenue"),       [annual]);
  const gross     = useMemo(() => periodsToBarData(annual, "Gross Profit"),          [annual]);
  const opEx      = useMemo(() => periodsToBarData(annual, "Operating Expenses"),    [annual]);
  const opIncome  = useMemo(() => periodsToBarData(annual, "Operating Income"),      [annual]);
  const ebitda    = useMemo(() => periodsToBarData(annual, "EBITDA"),                [annual]);
  const netIncome = useMemo(() => periodsToBarData(annual, "Net Income"),            [annual]);

  return (
    <View>
      <Text style={[tt.chartLabel, { color: colors.textMuted, paddingHorizontal: 16 }]}>Ingresos Totales</Text>
      <BarChart data={revenue} positiveColor={colors.accentLight} muted={colors.textMuted} />
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={[tt.legend, { color: colors.textMuted }]}>▲▼ % = variación vs año anterior</Text>
        <MetricRow label="Ingresos"            data={revenue}   colors={colors} />
        <MetricRow label="Costo de Ventas"     data={costRev}   colors={colors} />
        <MetricRow label="Utilidad Bruta"      data={gross}     colors={colors} />
        <MarginRow annual={annual} field="Gross Margin %"      label="% Margen Bruto"     colors={colors} />
        <MetricRow label="Gastos Operativos"   data={opEx}      colors={colors} />
        <MetricRow label="Utilidad Operativa"  data={opIncome}  colors={colors} />
        <MarginRow annual={annual} field="Operating Margin %"  label="% Margen Operativo" colors={colors} />
        <MetricRow label="EBITDA"              data={ebitda}    colors={colors} />
        <MetricRow label="Utilidad Neta"       data={netIncome} colors={colors} />
        <MarginRow annual={annual} field="Net Margin %"        label="% Margen Neto"      colors={colors} />
      </View>

      {/* AI Analysis */}
      <View style={[ais.card, { borderColor: colors.border, backgroundColor: colors.bgRaised }]}>
        <View style={ais.header}>
          <Text style={[ais.sparkle, { color: colors.accentLight }]}>✦</Text>
          <Text style={[ais.title, { color: colors.accentLight }]}>Análisis IA</Text>
        </View>
        {aiLoading ? (
          <ActivityIndicator size="small" color={colors.accentLight} style={{ marginTop: 4 }} />
        ) : aiAnalysis ? (
          <Text style={[ais.body, { color: colors.textMuted }]}>{aiAnalysis}</Text>
        ) : (
          <Text style={[ais.empty, { color: colors.textMuted }]}>
            {ticker ? "Sin análisis disponible" : ""}
          </Text>
        )}
      </View>
      <View style={{ height: 16 }} />
    </View>
  );
}

const ais = StyleSheet.create({
  card:    { marginHorizontal: 16, marginTop: 16, borderRadius: 16, borderWidth: 1, padding: 14 },
  header:  { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  sparkle: { fontSize: 12, fontWeight: "800" },
  title:   { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  body:    { fontSize: 13, lineHeight: 20 },
  empty:   { fontSize: 12, opacity: 0.5 },
});

function BalanceTab({ annual }: { annual: FinancialPeriod[] }) {
  const { colors } = useTheme();

  const assets      = useMemo(() => periodsToBarData(annual, "Total Assets"), [annual]);
  const liabilities = useMemo(() => periodsToBarData(annual, "Total Liabilities Net Minority Interest"), [annual]);
  const equity      = useMemo(() => periodsToBarData(annual, "Stockholders Equity"), [annual]);
  const debt        = useMemo(() => periodsToBarData(annual, "Total Debt"), [annual]);

  return (
    <View>
      <Text style={[tt.chartLabel, { color: colors.textMuted, paddingHorizontal: 16 }]}>Activos Totales</Text>
      <BarChart data={assets} positiveColor={colors.accentLight} muted={colors.textMuted} />
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={[tt.legend, { color: colors.textMuted }]}>▲▼ % = variación vs año anterior</Text>
        <MetricRow label="Activos Totales"   data={assets}      colors={colors} />
        <MetricRow label="Pasivos Totales"   data={liabilities} colors={colors} />
        <MetricRow label="Patrimonio Neto"   data={equity}      colors={colors} />
        <MetricRow label="Deuda Total"       data={debt}        colors={colors} />
      </View>
    </View>
  );
}

function CashFlowTab({ annual }: { annual: FinancialPeriod[] }) {
  const { colors } = useTheme();

  const opCF  = useMemo(() => periodsToBarData(annual, "Operating Cash Flow"), [annual]);
  const fcf   = useMemo(() => periodsToBarData(annual, "Free Cash Flow"), [annual]);
  const capex = useMemo(() => periodsToBarData(annual, "Capital Expenditure"), [annual]);

  return (
    <View>
      <Text style={[tt.chartLabel, { color: colors.textMuted, paddingHorizontal: 16 }]}>Flujo Operativo</Text>
      <BarChart data={opCF} positiveColor={colors.accentLight} muted={colors.textMuted} />
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={[tt.legend, { color: colors.textMuted }]}>▲▼ % = variación vs año anterior</Text>
        <MetricRow label="Flujo Operativo"     data={opCF}  colors={colors} />
        <MetricRow label="Flujo de Caja Libre" data={fcf}   colors={colors} />
        <MetricRow label="CapEx"               data={capex} colors={colors} />
      </View>
    </View>
  );
}

const tt = StyleSheet.create({
  chartLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 10,
  },
  legend: {
    fontSize: 9,
    fontWeight: "500",
    marginBottom: 4,
    opacity: 0.7,
  },
});

// ─── Main Component ───────────────────────────────────────────────────────────

type SubTab = "income" | "balance" | "cashflow";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "income",   label: "Est. Resultados" },
  { key: "balance",  label: "Balance" },
  { key: "cashflow", label: "Flujo de Caja" },
];

export default function StockFinancials({ financials, ticker }: { financials: Financials; ticker?: string }) {
  const { colors } = useTheme();
  const [subTab, setSubTab] = useState<SubTab>("income");

  const incomeAnnual   = financials.income?.annual   ?? [];
  const balanceAnnual  = financials.balance?.annual  ?? [];
  const cashflowAnnual = financials.cashflow?.annual ?? [];

  const hasData = incomeAnnual.length > 0 || balanceAnnual.length > 0 || cashflowAnnual.length > 0;

  return (
    <View style={{ paddingVertical: 12 }}>
      {/* Sub-tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}
      >
        {SUB_TABS.map((t) => {
          const active = t.key === subTab;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setSubTab(t.key)}
              style={[
                s.subTabBtn,
                {
                  backgroundColor: active ? colors.accentGlow : colors.bgRaised,
                  borderColor: active ? colors.accentLight : colors.border,
                },
              ]}
              activeOpacity={0.7}
            >
              <Text style={[s.subTabText, { color: active ? colors.accentLight : colors.textMuted }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      {!hasData ? (
        <View style={{ alignItems: "center", paddingVertical: 40 }}>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>Sin estados financieros</Text>
        </View>
      ) : (
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {subTab === "income"   && <IncomeTab   annual={incomeAnnual} ticker={ticker} />}
          {subTab === "balance"  && <BalanceTab  annual={balanceAnnual} />}
          {subTab === "cashflow" && <CashFlowTab annual={cashflowAnnual} />}
          <View style={{ height: 8 }} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  subTabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  subTabText: {
    fontSize: 12,
    fontWeight: "700",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 16,
    paddingTop: 12,
    overflow: "hidden",
  },
});
