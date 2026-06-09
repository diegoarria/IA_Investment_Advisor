/**
 * StockDetailScreen — diseño scroll único estilo Google Finance.
 * Enfoque: inversor de largo plazo. Sin gráficas de trading.
 *
 * Secciones:
 *   1. Gráfica (línea simple)
 *   2. Métricas Clave
 *   3. Acerca de
 *   4. Financiero
 *   5. Analistas
 *   6. Noticias
 *   7. Empresas Similares
 */

import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Rect, G, Text as SvgText } from "react-native-svg";
import { useRouter } from "expo-router";
import { useTheme } from "../../lib/ThemeContext";
import { useStockDetail, type FinancialPeriod } from "../../hooks/useStockDetail";
import StockHeader from "./StockHeader";
import StockChart from "../StockChart";
import StockNews from "./StockNews";
import StockCompetitors from "./StockCompetitors";

const { width: SCREEN_W } = Dimensions.get("window");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBig(n?: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtNum(n?: number | null, dec = 2): string {
  return n != null ? n.toFixed(dec) : "—";
}

function fmtPct(n?: number | null): string {
  return n != null ? `${(n * 100).toFixed(1)}%` : "—";
}

function consensusLabel(rec?: string | null): { label: string; color: string } {
  const r = (rec ?? "").toLowerCase();
  if (r.includes("strong_buy") || r.includes("strongbuy"))
    return { label: "Compra Fuerte", color: "#22c55e" };
  if (r.includes("strong_sell") || r.includes("strongsell"))
    return { label: "Venta Fuerte", color: "#ef4444" };
  if (r.includes("buy"))  return { label: "Comprar",  color: "#22c55e" };
  if (r.includes("sell")) return { label: "Vender",   color: "#ef4444" };
  return { label: "Neutral", color: "#f59e0b" };
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title, colors }: { title: string; colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <Text style={[sh.title, { color: colors.textMuted, borderBottomColor: colors.border }]}>
      {title}
    </Text>
  );
}

const sh = StyleSheet.create({
  title: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

// ─── 1. Métricas Clave ────────────────────────────────────────────────────────

function KeyMetrics({ profile }: { profile?: ReturnType<typeof useStockDetail>["data"] extends { profile: infer P } | null ? P | undefined : never }) {
  const { colors } = useTheme();
  if (!profile) return null;

  const stats = [
    { label: "Market Cap",    value: fmtBig(profile.market_cap) },
    { label: "P/E Ratio",     value: fmtNum(profile.pe_ratio) },
    { label: "P/E Fwd",       value: fmtNum(profile.forward_pe) },
    { label: "EPS (TTM)",     value: profile.eps != null ? `$${profile.eps.toFixed(2)}` : "—" },
    { label: "Div. Yield",    value: profile.dividend_yield ? `${profile.dividend_yield.toFixed(2)}%` : "—" },
    { label: "Beta",          value: fmtNum(profile.beta) },
    { label: "52s Máx",       value: profile.week_52_high ? `$${profile.week_52_high.toFixed(0)}` : "—" },
    { label: "52s Mín",       value: profile.week_52_low  ? `$${profile.week_52_low.toFixed(0)}`  : "—" },
    { label: "ROE",           value: fmtPct(profile.return_on_equity) },
    { label: "Margen Neto",   value: fmtPct(profile.profit_margins) },
    { label: "Deuda/Equity",  value: fmtNum(profile.debt_to_equity) },
    { label: "FCF",           value: fmtBig(profile.free_cashflow) },
  ];

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
      <View style={km.grid}>
        {stats.map((s) => (
          <View key={s.label} style={[km.cell, { borderColor: colors.border }]}>
            <Text style={[km.label, { color: colors.textMuted }]}>{s.label}</Text>
            <Text style={[km.value, { color: colors.text }]}>{s.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const km = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: "50%",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 11, fontWeight: "500", marginBottom: 3 },
  value: { fontSize: 14, fontWeight: "700" },
});

// ─── 2. Acerca de ─────────────────────────────────────────────────────────────

function AboutSection({ profile }: { profile?: ReturnType<typeof useStockDetail>["data"] extends { profile: infer P } | null ? P | undefined : never }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (!profile) return null;

  const desc = profile.description ?? "";
  const short = desc.length > 240 && !expanded ? desc.slice(0, 240) + "…" : desc;

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
      {desc.length > 0 && (
        <>
          <Text style={[ab.desc, { color: colors.textSub }]}>{short}</Text>
          {desc.length > 240 && (
            <TouchableOpacity onPress={() => setExpanded(!expanded)}>
              <Text style={[ab.toggle, { color: colors.accentLight }]}>
                {expanded ? "Ver menos" : "Ver más"}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}

      <View style={{ marginTop: 14, gap: 8 }}>
        {[
          { label: "Sector",     value: profile.sector    },
          { label: "Industria",  value: profile.industry  },
          { label: "País",       value: profile.country   },
          { label: "Ciudad",     value: profile.city      },
          { label: "Empleados",  value: profile.employees?.toLocaleString() },
        ].filter((r) => r.value).map((r) => (
          <View key={r.label} style={ab.row}>
            <Text style={[ab.rLabel, { color: colors.textMuted }]}>{r.label}</Text>
            <Text style={[ab.rValue, { color: colors.text }]}>{r.value}</Text>
          </View>
        ))}
        {profile.website && (
          <TouchableOpacity onPress={() => Linking.openURL(profile.website!)}>
            <Text style={[ab.link, { color: colors.accentLight }]}>
              {profile.website.replace(/^https?:\/\//, "")}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const ab = StyleSheet.create({
  desc:   { fontSize: 13, lineHeight: 20 },
  toggle: { fontSize: 12, fontWeight: "600", marginTop: 6 },
  row:    { flexDirection: "row", justifyContent: "space-between" },
  rLabel: { fontSize: 12 },
  rValue: { fontSize: 12, fontWeight: "600" },
  link:   { fontSize: 12, fontWeight: "600" },
});

// ─── 3. Financiero — gráfica de barras simple ─────────────────────────────────

const FIN_W = SCREEN_W - 32;
const FIN_H = 90;
const BAR_LABEL_H = 16;
const DRAW_H = FIN_H - BAR_LABEL_H;

function MiniBarChart({ data, color, muted }: {
  data: { label: string; value: number | null }[];
  color: string;
  muted: string;
}) {
  const valid = data.filter((d) => d.value != null);
  if (valid.length < 2) return null;

  const maxAbs = Math.max(...valid.map((d) => Math.abs(d.value!)));
  const n = data.length;
  const gap = 6;
  const barW = Math.max(1, (FIN_W - gap * (n - 1)) / n);

  return (
    <Svg width={FIN_W} height={FIN_H}>
      {data.map((d, i) => {
        const x = i * (barW + gap);
        const val = d.value ?? 0;
        const barH = maxAbs > 0 ? (Math.abs(val) / maxAbs) * (DRAW_H - 6) : 0;
        const y = DRAW_H - barH;
        const barColor = val < 0 ? "#ef4444" : color;
        return (
          <G key={i}>
            {barH > 1 && (
              <Rect x={x} y={y} width={barW} height={barH} rx={3} fill={barColor} opacity={0.9} />
            )}
            <SvgText x={x + barW / 2} y={FIN_H - 2} textAnchor="middle" fontSize={9} fill={muted} fontWeight="600">
              {d.label}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

function FinancialSection({
  financials,
}: {
  financials?: ReturnType<typeof useStockDetail>["data"] extends { financials: infer F } | null ? F | undefined : never;
}) {
  const { colors } = useTheme();
  if (!financials) return null;

  const annual = financials.income?.annual ?? [];
  if (annual.length === 0) {
    return (
      <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>Sin estados financieros</Text>
      </View>
    );
  }

  function toBarData(key: keyof FinancialPeriod) {
    return [...annual].slice(-5).map((p) => ({
      label: p.period.slice(2, 4), // "2024" → "24"
      value: p[key] as number | null,
    }));
  }

  const revenue   = toBarData("Total Revenue");
  const netIncome = toBarData("Net Income");

  const latest   = annual[annual.length - 1] ?? {};
  const prev     = annual[annual.length - 2] ?? {};
  const revGrowth = latest["Total Revenue"] && prev["Total Revenue"]
    ? ((+latest["Total Revenue"]! - +prev["Total Revenue"]!) / Math.abs(+prev["Total Revenue"]!)) * 100
    : null;

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
      {/* Revenue bars */}
      <Text style={[fn.chartLabel, { color: colors.textMuted }]}>Ingresos anuales</Text>
      <MiniBarChart data={revenue} color={colors.accentLight} muted={colors.textMuted} />

      {/* Net Income bars */}
      <Text style={[fn.chartLabel, { color: colors.textMuted, marginTop: 16 }]}>Ganancia neta</Text>
      <MiniBarChart data={netIncome} color={colors.accentLight} muted={colors.textMuted} />

      {/* Key numbers row */}
      <View style={[fn.row, { borderTopColor: colors.border, marginTop: 14 }]}>
        {[
          { label: "Ingresos (TTM)",   value: fmtBig(latest["Total Revenue"]) },
          { label: "Ganancia Neta",    value: fmtBig(latest["Net Income"]) },
          { label: "Crecimiento YoY",  value: revGrowth != null ? `${revGrowth >= 0 ? "+" : ""}${revGrowth.toFixed(1)}%` : "—", isGrowth: true, isUp: (revGrowth ?? 0) >= 0 },
        ].map((item) => (
          <View key={item.label} style={fn.cell}>
            <Text style={[fn.cellLabel, { color: colors.textMuted }]}>{item.label}</Text>
            <Text style={[
              fn.cellValue,
              { color: item.isGrowth ? (item.isUp ? colors.up : colors.down) : colors.text },
            ]}>
              {item.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const fn = StyleSheet.create({
  chartLabel: { fontSize: 11, fontWeight: "600", marginBottom: 6 },
  row: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  cell:      { flex: 1, alignItems: "center" },
  cellLabel: { fontSize: 10, fontWeight: "500", marginBottom: 3 },
  cellValue: { fontSize: 13, fontWeight: "800" },
});

// ─── 4. Analistas ─────────────────────────────────────────────────────────────

function AnalystSection({
  analyst,
  currentPrice,
}: {
  analyst?: ReturnType<typeof useStockDetail>["data"] extends { analyst: infer A } | null ? A | undefined : never;
  currentPrice?: number;
}) {
  const { colors } = useTheme();
  if (!analyst) return null;

  const { label, color } = consensusLabel(analyst.recommendation);
  const pt = analyst.price_target ?? {};
  const upside = currentPrice && pt.mean
    ? ((pt.mean - currentPrice) / currentPrice) * 100
    : null;
  const isUp = (upside ?? 0) >= 0;
  const total = Object.values(analyst.ratings ?? {}).reduce((s, v) => s + (v ?? 0), 0);

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
      {/* Consensus pill */}
      <View style={an.headerRow}>
        <View style={[an.pill, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
          <Text style={[an.pillText, { color }]}>{label}</Text>
        </View>
        {total > 0 && (
          <Text style={[an.analystCount, { color: colors.textMuted }]}>
            {analyst.n_analysts ?? total} analistas
          </Text>
        )}
      </View>

      {/* Rating distribution — compact horizontal bars */}
      {total > 0 && (
        <View style={{ marginTop: 12, gap: 5 }}>
          {[
            { label: "Compra Fuerte", count: analyst.ratings.strong_buy,  barColor: colors.up },
            { label: "Comprar",       count: analyst.ratings.buy,         barColor: `${colors.up}88` },
            { label: "Neutral",       count: analyst.ratings.hold,        barColor: colors.warning },
            { label: "Vender",        count: analyst.ratings.sell,        barColor: `${colors.down}88` },
            { label: "Venta Fuerte",  count: analyst.ratings.strong_sell, barColor: colors.down },
          ].map((r) => (
            <View key={r.label} style={an.ratingRow}>
              <Text style={[an.ratingLabel, { color: colors.textMuted }]}>{r.label}</Text>
              <View style={[an.ratingTrack, { backgroundColor: colors.bgRaised }]}>
                <View
                  style={[
                    an.ratingFill,
                    { width: `${total > 0 ? (r.count / total) * 100 : 0}%`, backgroundColor: r.barColor },
                  ]}
                />
              </View>
              <Text style={[an.ratingCount, { color: colors.text }]}>{r.count}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Price target */}
      {pt.mean != null && currentPrice != null && (
        <View style={[an.targetRow, { borderTopColor: colors.border }]}>
          <View>
            <Text style={[an.targetLabel, { color: colors.textMuted }]}>Precio objetivo</Text>
            <Text style={[an.targetPrice, { color: colors.text }]}>
              {pt.mean >= 1000 ? `$${pt.mean.toFixed(0)}` : `$${pt.mean.toFixed(2)}`}
            </Text>
          </View>
          {upside != null && (
            <View style={[an.upsidePill, { backgroundColor: isUp ? `${colors.up}18` : `${colors.down}18` }]}>
              <Text style={[an.upsideText, { color: isUp ? colors.up : colors.down }]}>
                {isUp ? "+" : ""}{upside.toFixed(1)}% potencial
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const an = StyleSheet.create({
  headerRow:    { flexDirection: "row", alignItems: "center", gap: 10 },
  pill:         { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  pillText:     { fontSize: 14, fontWeight: "800" },
  analystCount: { fontSize: 12 },
  ratingRow:    { flexDirection: "row", alignItems: "center", gap: 8 },
  ratingLabel:  { fontSize: 11, fontWeight: "500", width: 90 },
  ratingTrack:  { flex: 1, height: 5, borderRadius: 3, overflow: "hidden" },
  ratingFill:   { height: 5, borderRadius: 3 },
  ratingCount:  { fontSize: 11, fontWeight: "700", width: 20, textAlign: "right" },
  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
    marginTop: 14,
  },
  targetLabel: { fontSize: 11, marginBottom: 3 },
  targetPrice: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  upsidePill:  { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  upsideText:  { fontSize: 14, fontWeight: "700" },
});

// ─── Divider ─────────────────────────────────────────────────────────────────

function Divider({ color }: { color: string }) {
  return <View style={{ height: 8, backgroundColor: color }} />;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StockDetailScreen({ ticker }: { ticker: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch } = useStockDetail(ticker);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <StockHeader
        ticker={ticker}
        profile={data?.profile}
        loading={loading}
        onBack={() => router.back()}
      />

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        {/* ── Gráfica ── */}
        <View style={[s.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <StockChart ticker={ticker} />
        </View>

        {loading && !data ? (
          <View style={s.centered}>
            <ActivityIndicator color={colors.accentLight} />
            <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 8 }}>
              Cargando análisis…
            </Text>
          </View>
        ) : error ? (
          <View style={s.centered}>
            <Text style={{ color: colors.textMuted, fontSize: 14 }}>
              No se pudieron cargar los datos
            </Text>
            <TouchableOpacity
              onPress={refetch}
              style={[s.retryBtn, { backgroundColor: colors.accentGlow, borderColor: colors.accentLight }]}
            >
              <Text style={{ color: colors.accentLight, fontSize: 13, fontWeight: "700" }}>
                Reintentar
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* 1 — Métricas Clave */}
            <SectionHeader title="Métricas Clave" colors={colors} />
            <KeyMetrics profile={data?.profile} />

            <Divider color={colors.bgRaised} />

            {/* 2 — Acerca de */}
            <SectionHeader title={`Acerca de ${data?.profile?.name ?? ticker}`} colors={colors} />
            <AboutSection profile={data?.profile} />

            <Divider color={colors.bgRaised} />

            {/* 3 — Financiero */}
            <SectionHeader title="Financiero" colors={colors} />
            <FinancialSection financials={data?.financials} />

            <Divider color={colors.bgRaised} />

            {/* 4 — Analistas */}
            <SectionHeader title="Opinión de Analistas" colors={colors} />
            <AnalystSection analyst={data?.analyst} currentPrice={data?.profile?.current_price} />

            <Divider color={colors.bgRaised} />

            {/* 5 — Noticias */}
            <SectionHeader title="Noticias" colors={colors} />
            <StockNews ticker={ticker} />

            <Divider color={colors.bgRaised} />

            {/* 6 — Empresas Similares */}
            <SectionHeader title="Empresas Similares" colors={colors} />
            <StockCompetitors ticker={ticker} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  chartCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 4,
  },
  centered: {
    paddingVertical: 48,
    alignItems: "center",
    gap: 12,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 4,
  },
});
