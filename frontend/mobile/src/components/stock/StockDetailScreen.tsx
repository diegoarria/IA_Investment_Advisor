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
import Svg, { Circle, Rect, G, Text as SvgText } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme } from "../../lib/ThemeContext";
import { useStockDetail, useStockScore, useRichFinancials, type FinancialPeriod } from "../../hooks/useStockDetail";
import StockChart from "../StockChart";
import StockNews from "./StockNews";
import StockCompetitors from "./StockCompetitors";
import StockFinancials from "./StockFinancials";
import StockAnalysts from "./StockAnalysts";

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

// ─── Verdict ──────────────────────────────────────────────────────────────────

const SIGNAL_COLOR: Record<string, string> = {
  "COMPRA FUERTE": "#00d47e",
  "COMPRA":        "#22c55e",
  "MANTENER":      "#f59e0b",
  "VENDER":        "#f97316",
  "VENTA FUERTE":  "#ef4444",
};

function VerdictSection({ ticker }: { ticker: string }) {
  const { colors } = useTheme();
  const { data, loading } = useStockScore(ticker);

  if (loading) {
    return (
      <View style={vd.loadRow}>
        <ActivityIndicator size="small" color={colors.accentLight} />
        <Text style={[vd.loadText, { color: colors.textMuted }]}>Calculando veredicto IA…</Text>
      </View>
    );
  }
  if (!data) return null;

  const sigColor = SIGNAL_COLOR[data.signal] ?? "#f59e0b";

  // Parse CORTO/LARGO from verdict_long
  const text = data.verdict_long ?? "";
  const cortoIdx = text.indexOf("**CORTO:**");
  const largoIdx = text.indexOf("**LARGO:**");
  let preText = "", cortoText = "", largoText = "";
  if (cortoIdx !== -1 || largoIdx !== -1) {
    const rawMarkers = [
      cortoIdx !== -1 ? { key: "corto", idx: cortoIdx, marker: "**CORTO:**" } : null,
      largoIdx !== -1 ? { key: "largo", idx: largoIdx, marker: "**LARGO:**" } : null,
    ].filter(Boolean) as { key: string; idx: number; marker: string }[];
    const markers = rawMarkers.sort((a, b) => a.idx - b.idx);
    preText = text.slice(0, markers[0].idx).trim();
    markers.forEach((m, i) => {
      const start = m.idx + m.marker.length;
      const end = i < markers.length - 1 ? markers[i + 1].idx : text.length;
      const content = text.slice(start, end).trim();
      if (m.key === "corto") cortoText = content;
      else largoText = content;
    });
  } else { preText = text; }

  // Ring geometry
  const R = 48, STROKE = 10, SIZE = (R + STROKE) * 2;
  const circ = 2 * Math.PI * R;
  const dash = (data.overall_score / 100) * circ;

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>

      {/* ── Score Hero Card ── */}
      <View style={[vd.heroCard, { backgroundColor: sigColor + "14", borderColor: sigColor + "30" }]}>
        <View style={[vd.deco1, { backgroundColor: sigColor + "10" }]} />
        <View style={[vd.deco2, { backgroundColor: sigColor + "08" }]} />
        <View style={vd.heroRow}>
          {/* Big ring */}
          <View style={{ width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" }}>
            <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
              <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={sigColor + "25"} strokeWidth={STROKE} fill="none" />
              <Circle
                cx={SIZE / 2} cy={SIZE / 2} r={R}
                stroke={sigColor} strokeWidth={STROKE} fill="none"
                strokeDasharray={`${dash} ${circ}`}
                strokeLinecap="round"
                transform={`rotate(-90, ${SIZE / 2}, ${SIZE / 2})`}
              />
            </Svg>
            <View style={vd.ringCenter}>
              <Text style={[vd.scoreNum, { color: colors.text }]}>{data.overall_score}</Text>
              <Text style={[vd.scoreDenom, { color: colors.textMuted }]}>/ 100</Text>
            </View>
          </View>

          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {data.grade ? (
                <Text style={[vd.gradeText, { color: sigColor }]}>{data.grade}</Text>
              ) : null}
              <View style={[vd.signalBadge, { backgroundColor: sigColor + "18", borderColor: sigColor + "44" }]}>
                <Text style={[vd.signalText, { color: sigColor }]}>{data.signal}</Text>
              </View>
            </View>
            <Text style={[vd.shortVerdict, { color: colors.textSub }]} numberOfLines={4}>
              {data.verdict_short}
            </Text>
          </View>
        </View>
      </View>

      {/* ── CORTO / LARGO outlook ── */}
      {(cortoText || largoText) ? (
        <View style={vd.outlookRow}>
          {cortoText ? (
            <View style={[vd.outlookCard, { flex: 1, backgroundColor: "rgba(245,158,11,0.06)", borderColor: "rgba(245,158,11,0.2)" }]}>
              <View style={vd.outlookHeader}>
                <View style={[vd.outlookDot, { backgroundColor: "#f59e0b" }]} />
                <Text style={[vd.outlookLabel, { color: "#f59e0b" }]}>Corto plazo</Text>
              </View>
              <Text style={[vd.outlookText, { color: colors.textSub }]}>{cortoText}</Text>
            </View>
          ) : null}
          {largoText ? (
            <View style={[vd.outlookCard, { flex: 1, backgroundColor: "rgba(34,197,94,0.06)", borderColor: "rgba(34,197,94,0.2)" }]}>
              <View style={vd.outlookHeader}>
                <View style={[vd.outlookDot, { backgroundColor: "#22c55e" }]} />
                <Text style={[vd.outlookLabel, { color: "#22c55e" }]}>Largo plazo</Text>
              </View>
              <Text style={[vd.outlookText, { color: colors.textSub }]}>{largoText}</Text>
            </View>
          ) : null}
        </View>
      ) : preText ? (
        <Text style={[vd.outlookText, { color: colors.textSub }]}>{preText}</Text>
      ) : null}

      {/* ── Category grid ── */}
      <View style={vd.catGrid}>
        {data.categories.map((cat) => {
          const c = cat.score >= 75 ? "#22c55e" : cat.score >= 55 ? "#f59e0b" : "#ef4444";
          return (
            <View key={cat.key} style={[vd.catTile, { backgroundColor: colors.bgRaised, borderColor: c + "30" }]}>
              <View style={vd.catTileTop}>
                <Text style={[vd.catName, { color: colors.textMuted }]} numberOfLines={1}>{cat.name}</Text>
                <Text style={[vd.catScore, { color: c }]}>{cat.score}</Text>
              </View>
              <View style={[vd.catTrack, { backgroundColor: colors.border }]}>
                <View style={[vd.catFill, { width: `${cat.score}%` as any, backgroundColor: c }]} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const vd = StyleSheet.create({
  loadRow:      { flexDirection: "row", alignItems: "center", gap: 10, padding: 16 },
  loadText:     { fontSize: 13 },
  // Hero card
  heroCard:     { borderRadius: 20, borderWidth: 1, overflow: "hidden", padding: 16 },
  deco1:        { position: "absolute", top: -24, right: -20, width: 120, height: 120, borderRadius: 60 },
  deco2:        { position: "absolute", bottom: -28, left: -16, width: 80, height: 80, borderRadius: 40 },
  heroRow:      { flexDirection: "row", gap: 14, alignItems: "center" },
  ringCenter:   { position: "absolute", alignItems: "center", justifyContent: "center" },
  scoreNum:     { fontSize: 30, fontFamily: "DMSans_800ExtraBold", lineHeight: 34 },
  scoreDenom:   { fontSize: 10, fontFamily: "DMSans_600SemiBold", marginTop: 2 },
  gradeText:    { fontSize: 44, fontFamily: "DMSans_800ExtraBold", lineHeight: 48 },
  signalBadge:  { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  signalText:   { fontSize: 12, fontFamily: "DMSans_800ExtraBold", letterSpacing: 0.5 },
  shortVerdict: { fontSize: 13, fontFamily: "DMSans_400Regular", lineHeight: 19 },
  // Outlook cards
  outlookRow:   { flexDirection: "row", gap: 8 },
  outlookCard:  { borderRadius: 16, borderWidth: 1, padding: 12 },
  outlookHeader:{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  outlookDot:   { width: 6, height: 6, borderRadius: 3 },
  outlookLabel: { fontSize: 9, fontFamily: "DMSans_800ExtraBold", letterSpacing: 1, textTransform: "uppercase" },
  outlookText:  { fontSize: 12, fontFamily: "DMSans_400Regular", lineHeight: 17 },
  // Category grid
  catGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catTile:      { width: "47%", borderRadius: 14, borderWidth: 1, padding: 10 },
  catTileTop:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  catName:      { fontSize: 9, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, flex: 1 },
  catScore:     { fontSize: 14, fontFamily: "DMSans_800ExtraBold" },
  catTrack:     { height: 4, borderRadius: 2, overflow: "hidden" },
  catFill:      { height: 4, borderRadius: 2 },
});

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

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "veredicto",   label: "Veredicto" },
  { id: "grafica",     label: "Gráfica" },
  { id: "financieros", label: "Financieros" },
  { id: "analistas",   label: "Analistas" },
  { id: "empresa",     label: "Empresa" },
] as const;

type TabId = typeof TABS[number]["id"];

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StockDetailScreen({ ticker }: { ticker: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch } = useStockDetail(ticker);
  const [activeTab, setActiveTab] = useState<TabId>("veredicto");
  const { data: richFin } = useRichFinancials(ticker, activeTab === "financieros");

  function renderContent() {
    if (activeTab === "grafica") {
      return (
        <View style={{ marginHorizontal: 12, marginTop: 12 }}>
          <StockChart ticker={ticker} />
        </View>
      );
    }

    if (loading && !data) {
      return (
        <View style={s.centered}>
          <ActivityIndicator color={colors.accentLight} />
          <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 8 }}>
            Cargando análisis…
          </Text>
        </View>
      );
    }

    if (error) {
      return (
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
      );
    }

    if (activeTab === "veredicto") {
      return <VerdictSection ticker={ticker} />;
    }

    if (activeTab === "financieros") {
      if (!data?.financials) {
        return (
          <View style={s.centered}>
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>Sin datos financieros</Text>
          </View>
        );
      }
      return <StockFinancials financials={data.financials} richFin={richFin ?? undefined} ticker={ticker} />;
    }

    if (activeTab === "analistas") {
      if (!data?.analyst) {
        return (
          <View style={s.centered}>
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>Sin datos de analistas</Text>
          </View>
        );
      }
      return <StockAnalysts analyst={data.analyst} currentPrice={data?.profile?.current_price} />;
    }

    if (activeTab === "empresa") {
      return (
        <>
          <SectionHeader title="Métricas Clave" colors={colors} />
          <KeyMetrics profile={data?.profile} />
          <Divider color={colors.bgRaised} />
          <SectionHeader title={`Acerca de ${data?.profile?.name ?? ticker}`} colors={colors} />
          <AboutSection profile={data?.profile} />
          <Divider color={colors.bgRaised} />
          <SectionHeader title="Noticias" colors={colors} />
          <StockNews ticker={ticker} />
          <Divider color={colors.bgRaised} />
          <SectionHeader title="Empresas Similares" colors={colors} />
          <StockCompetitors ticker={ticker} />
        </>
      );
    }

    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {/* ── Minimal top bar ── */}
      <View style={[tb.topBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={[tb.topTicker, { color: colors.text }]}>{ticker}</Text>
          {data?.profile?.name && (
            <Text style={[tb.topName, { color: colors.textMuted }]} numberOfLines={1}>
              {data.profile.name}
            </Text>
          )}
        </View>
        {data?.profile?.current_price != null && (
          <Text style={[tb.topPrice, { color: colors.text }]}>
            ${data.profile.current_price >= 1000
              ? data.profile.current_price.toLocaleString("en-US", { maximumFractionDigits: 0 })
              : data.profile.current_price.toFixed(2)}
          </Text>
        )}
      </View>

      {/* ── Tab Bar ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[tb.barWrap, { borderBottomColor: colors.border }]}
        contentContainerStyle={tb.bar}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={[tb.tab, active && { borderBottomColor: colors.accentLight }]}
            >
              <Text style={[tb.label, { color: active ? colors.accentLight : colors.textMuted }]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Tab Content ── */}
      <ScrollView
        key={activeTab}
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        {renderContent()}
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

const tb = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  topTicker: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  topName: {
    fontSize: 11,
    fontWeight: "500",
    marginTop: 1,
  },
  topPrice: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  barWrap: {
    flexGrow: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bar: {
    flexDirection: "row",
    paddingHorizontal: 4,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  label: {
    fontSize: 13,
    fontFamily: "DMSans_600SemiBold",
  },
});
