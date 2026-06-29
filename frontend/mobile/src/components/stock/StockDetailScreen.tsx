import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { posthog } from "../../config/posthog";
import { useStockDetail, useStockScore, useRichFinancials, type EntryRange, type EntryRangesMeta } from "../../hooks/useStockDetail";
import StockChart from "../StockChart";
import StockNews from "./StockNews";
import StockCompetitors from "./StockCompetitors";
import StockFinancials from "./StockFinancials";
import StockAnalysts from "./StockAnalysts";
import StockAvatar from "../StockAvatar";

// ─── Palette ─────────────────────────────────────────────────────────────────
const D = {
  bg:       "#0a0d12",
  card:     "#111318",
  raised:   "#1a1d27",
  border:   "#1f2330",
  text:     "#fff",
  sub:      "#9ca3af",
  muted:    "#6b7280",
  dim:      "#4b5563",
  green:    "#00d47e",
  greenDim: "rgba(0,212,126,0.12)",
  greenBdr: "rgba(0,212,126,0.25)",
  red:      "#ef4444",
  amber:    "#f59e0b",
};

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

// ─── Entry Ranges (¿Cuándo entrar?) ──────────────────────────────────────────

function fmtP(n: number) {
  return n >= 1000
    ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function EntryRangesCard({ ranges, meta }: { ranges: EntryRange[]; meta: EntryRangesMeta }) {
  return (
    <View style={er.card}>
      {/* Header */}
      <View style={er.header}>
        <View style={er.headerLeft}>
          <View style={er.iconBox}>
            <Ionicons name="layers-outline" size={13} color={D.green} />
          </View>
          <Text style={er.title}>¿Cuándo entrar?</Text>
        </View>
        <View style={er.fairValuePill}>
          <Text style={er.fairValueText}>
            Valor justo {fmtP(meta.fair_value)}
          </Text>
          <Text style={er.fairValueSrc}>{meta.fair_value_src}</Text>
        </View>
      </View>

      {/* Range rows */}
      <View style={er.rangeList}>
        {ranges.map((range) => {
          const rangeStr =
            range.min !== null && range.max !== null
              ? `${fmtP(range.min)} – ${fmtP(range.max)}`
              : range.min !== null
              ? `> ${fmtP(range.min)}`
              : `< ${fmtP(range.max!)}`;

          return (
            <View
              key={range.signal}
              style={[
                er.rangeRow,
                range.is_current && {
                  backgroundColor: range.color + "18",
                  borderColor: range.color + "45",
                  borderWidth: 1,
                },
              ]}
            >
              <View style={[er.dot, { backgroundColor: range.color, opacity: range.is_current ? 1 : 0.3 }]} />
              <Text
                style={[
                  er.rangeLabel,
                  { color: range.is_current ? range.color : D.muted, opacity: range.is_current ? 1 : 0.65 },
                ]}
              >
                {range.label}
              </Text>
              <Text
                style={[
                  er.rangePrice,
                  { color: range.is_current ? D.text : D.muted, opacity: range.is_current ? 1 : 0.55 },
                ]}
              >
                {rangeStr}
              </Text>
              {range.is_current && (
                <View style={[er.nowBadge, { backgroundColor: range.color + "28" }]}>
                  <Text style={[er.nowText, { color: range.color }]}>AHORA</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const er = StyleSheet.create({
  card:          { borderRadius: 20, borderWidth: 1, borderColor: D.border, backgroundColor: D.card, padding: 16 },
  header:        { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, gap: 10 },
  headerLeft:    { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBox:       { width: 26, height: 26, borderRadius: 8, backgroundColor: D.greenDim, alignItems: "center", justifyContent: "center" },
  title:         { fontSize: 12, fontFamily: "DMSans_800ExtraBold", letterSpacing: 0.4, textTransform: "uppercase", color: D.sub },
  fairValuePill: { alignItems: "flex-end", gap: 2 },
  fairValueText: { fontSize: 11, fontFamily: "DMSans_700Bold", color: D.text },
  fairValueSrc:  { fontSize: 9, fontFamily: "DMSans_500Medium", color: D.dim, textTransform: "uppercase", letterSpacing: 0.3 },
  rangeList:     { gap: 4 },
  rangeRow:      { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: "transparent" },
  dot:           { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  rangeLabel:    { flex: 1, fontSize: 13, fontFamily: "DMSans_600SemiBold" },
  rangePrice:    { fontSize: 12, fontFamily: "DMSans_700Bold", letterSpacing: -0.2 },
  nowBadge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, marginLeft: 4 },
  nowText:       { fontSize: 9, fontFamily: "DMSans_800ExtraBold", letterSpacing: 0.5 },
});

// ─── Verdict ──────────────────────────────────────────────────────────────────

const SIGNAL_COLOR: Record<string, string> = {
  "COMPRA FUERTE": "#00d47e",
  "COMPRA":        "#22c55e",
  "MANTENER":      "#f59e0b",
  "VENDER":        "#f97316",
  "VENTA FUERTE":  "#ef4444",
};

function VerdictSection({ ticker }: { ticker: string }) {
  const { data, loading } = useStockScore(ticker);

  if (loading) {
    return (
      <View style={vd.loadRow}>
        <ActivityIndicator size="small" color={D.green} />
        <Text style={[vd.loadText, { color: D.muted }]}>Calculando veredicto IA…</Text>
      </View>
    );
  }
  if (!data) return null;

  const sigColor = SIGNAL_COLOR[data.signal] ?? D.amber;

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

  const R = 46, STROKE = 9, SIZE = (R + STROKE) * 2;
  const circ = 2 * Math.PI * R;
  const dash = (data.overall_score / 100) * circ;

  return (
    <View style={vd.container}>

      {/* ── Hero Card ── */}
      <View style={[vd.heroCard, { borderColor: sigColor + "28" }]}>
        {/* background glow orb */}
        <View style={[vd.glowOrb, { backgroundColor: sigColor + "0a" }]} />

        <View style={vd.heroRow}>
          {/* Ring */}
          <View style={{ width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" }}>
            <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
              <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={sigColor + "1e"} strokeWidth={STROKE} fill="none" />
              <Circle
                cx={SIZE / 2} cy={SIZE / 2} r={R}
                stroke={sigColor} strokeWidth={STROKE} fill="none"
                strokeDasharray={`${dash} ${circ}`}
                strokeLinecap="round"
                transform={`rotate(-90, ${SIZE / 2}, ${SIZE / 2})`}
              />
            </Svg>
            <View style={vd.ringCenter}>
              <Text style={[vd.scoreNum, { color: D.text }]}>{data.overall_score}</Text>
              <Text style={[vd.scoreSub, { color: D.muted }]}>/ 100</Text>
            </View>
          </View>

          {/* Grade + signal + short verdict */}
          <View style={{ flex: 1, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {data.grade ? (
                <Text style={[vd.gradeText, { color: sigColor }]}>{data.grade}</Text>
              ) : null}
              <View style={[vd.signalBadge, { backgroundColor: sigColor + "1a", borderColor: sigColor + "44" }]}>
                <View style={[vd.signalDot, { backgroundColor: sigColor }]} />
                <Text style={[vd.signalText, { color: sigColor }]}>{data.signal}</Text>
              </View>
            </View>
            <Text style={[vd.shortVerdict, { color: D.sub }]} numberOfLines={4}>
              {data.verdict_short}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Entry Ranges ── */}
      {data.entry_ranges && data.entry_ranges.length > 0 && data.entry_ranges_meta && (
        <EntryRangesCard ranges={data.entry_ranges} meta={data.entry_ranges_meta} />
      )}

      {/* ── CORTO / LARGO outlook ── */}
      {(cortoText || largoText) ? (
        <View style={vd.outlookRow}>
          {cortoText ? (
            <View style={[vd.outlookCard, { backgroundColor: "rgba(245,158,11,0.05)", borderColor: "rgba(245,158,11,0.18)" }]}>
              <View style={vd.outlookHeader}>
                <View style={[vd.outlookDot, { backgroundColor: D.amber }]} />
                <Text style={[vd.outlookLabel, { color: D.amber }]}>Corto plazo</Text>
              </View>
              <Text style={[vd.outlookText, { color: D.sub }]}>{cortoText}</Text>
            </View>
          ) : null}
          {largoText ? (
            <View style={[vd.outlookCard, { backgroundColor: "rgba(34,197,94,0.05)", borderColor: "rgba(34,197,94,0.18)" }]}>
              <View style={vd.outlookHeader}>
                <View style={[vd.outlookDot, { backgroundColor: "#22c55e" }]} />
                <Text style={[vd.outlookLabel, { color: "#22c55e" }]}>Largo plazo</Text>
              </View>
              <Text style={[vd.outlookText, { color: D.sub }]}>{largoText}</Text>
            </View>
          ) : null}
        </View>
      ) : preText ? (
        <View style={[vd.outlookCard, { backgroundColor: D.card, borderColor: D.border, flex: undefined }]}>
          <Text style={[vd.outlookText, { color: D.sub }]}>{preText}</Text>
        </View>
      ) : null}

      {/* ── Category grid ── */}
      <View style={vd.catGrid}>
        {data.categories.map((cat) => {
          const c = cat.score >= 75 ? "#22c55e" : cat.score >= 55 ? D.amber : D.red;
          return (
            <View key={cat.key} style={[vd.catTile, { borderColor: c + "28" }]}>
              <View style={vd.catTileTop}>
                <Text style={vd.catName} numberOfLines={1}>{cat.name}</Text>
                <Text style={[vd.catScore, { color: c }]}>{cat.score}</Text>
              </View>
              <View style={vd.catTrack}>
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
  container:    { padding: 16, gap: 12 },
  loadRow:      { flexDirection: "row", alignItems: "center", gap: 10, padding: 24 },
  loadText:     { fontSize: 13 },
  heroCard:     { borderRadius: 22, borderWidth: 1, overflow: "hidden", padding: 18, backgroundColor: D.card },
  glowOrb:      { position: "absolute", top: -40, right: -30, width: 160, height: 160, borderRadius: 80 },
  heroRow:      { flexDirection: "row", gap: 16, alignItems: "center" },
  ringCenter:   { position: "absolute", alignItems: "center", justifyContent: "center" },
  scoreNum:     { fontSize: 28, fontFamily: "DMSans_800ExtraBold", lineHeight: 32 },
  scoreSub:     { fontSize: 10, fontFamily: "DMSans_600SemiBold", marginTop: 1 },
  gradeText:    { fontSize: 42, fontFamily: "DMSans_800ExtraBold", lineHeight: 46 },
  signalBadge:  { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  signalDot:    { width: 6, height: 6, borderRadius: 3 },
  signalText:   { fontSize: 12, fontFamily: "DMSans_800ExtraBold", letterSpacing: 0.3 },
  shortVerdict: { fontSize: 13, fontFamily: "DMSans_400Regular", lineHeight: 19 },
  outlookRow:   { flexDirection: "row", gap: 8 },
  outlookCard:  { flex: 1, borderRadius: 16, borderWidth: 1, padding: 14 },
  outlookHeader:{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 7 },
  outlookDot:   { width: 5, height: 5, borderRadius: 3 },
  outlookLabel: { fontSize: 9, fontFamily: "DMSans_800ExtraBold", letterSpacing: 1, textTransform: "uppercase" },
  outlookText:  { fontSize: 12, fontFamily: "DMSans_400Regular", lineHeight: 17, color: D.sub },
  catGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catTile:      { width: "47%", borderRadius: 16, borderWidth: 1, padding: 12, backgroundColor: D.card },
  catTileTop:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  catName:      { fontSize: 10, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4, flex: 1, color: D.muted },
  catScore:     { fontSize: 18, fontFamily: "DMSans_800ExtraBold" },
  catTrack:     { height: 3, borderRadius: 2, overflow: "hidden", backgroundColor: D.border },
  catFill:      { height: 3, borderRadius: 2 },
});

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title, icon }: { title: string; icon?: React.ComponentProps<typeof Ionicons>["name"] }) {
  return (
    <View style={sh.row}>
      {icon && (
        <View style={sh.iconBox}>
          <Ionicons name={icon} size={13} color={D.green} />
        </View>
      )}
      <Text style={sh.title}>{title}</Text>
    </View>
  );
}

const sh = StyleSheet.create({
  row:    { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 28, paddingBottom: 12 },
  iconBox:{ width: 26, height: 26, borderRadius: 8, backgroundColor: D.greenDim, alignItems: "center", justifyContent: "center" },
  title:  { fontSize: 12, fontFamily: "DMSans_800ExtraBold", letterSpacing: 0.4, textTransform: "uppercase", color: D.sub },
});

// ─── Key Metrics ─────────────────────────────────────────────────────────────

type ProfileData = ReturnType<typeof useStockDetail>["data"] extends { profile: infer P } | null ? P | undefined : never;

function KeyMetrics({ profile }: { profile?: ProfileData }) {
  if (!profile) return null;

  const groups = [
    {
      label: "Valoración",
      items: [
        { label: "Market Cap",   value: fmtBig(profile.market_cap) },
        { label: "P/E (TTM)",    value: fmtNum(profile.pe_ratio) },
        { label: "P/E Fwd",      value: fmtNum(profile.forward_pe) },
        { label: "EPS (TTM)",    value: profile.eps != null ? `$${profile.eps.toFixed(2)}` : "—" },
      ],
    },
    {
      label: "Rentabilidad",
      items: [
        { label: "ROE",          value: fmtPct(profile.return_on_equity) },
        { label: "Margen Neto",  value: fmtPct(profile.profit_margins) },
        { label: "Div. Yield",   value: profile.dividend_yield ? `${profile.dividend_yield.toFixed(2)}%` : "—" },
        { label: "FCF",          value: fmtBig(profile.free_cashflow) },
      ],
    },
    {
      label: "Riesgo",
      items: [
        { label: "Beta",         value: fmtNum(profile.beta) },
        { label: "Deuda/Equity", value: fmtNum(profile.debt_to_equity) },
        { label: "52s Máx",      value: profile.week_52_high ? `$${profile.week_52_high.toFixed(0)}` : "—" },
        { label: "52s Mín",      value: profile.week_52_low  ? `$${profile.week_52_low.toFixed(0)}`  : "—" },
      ],
    },
  ];

  return (
    <View style={{ paddingHorizontal: 16, gap: 10 }}>
      {groups.map((group) => (
        <View key={group.label} style={km.groupCard}>
          <Text style={km.groupLabel}>{group.label}</Text>
          <View style={km.grid}>
            {group.items.map((item) => (
              <View key={item.label} style={km.cell}>
                <Text style={km.cellLabel}>{item.label}</Text>
                <Text style={km.cellValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const km = StyleSheet.create({
  groupCard:  { borderRadius: 18, borderWidth: 1, borderColor: D.border, backgroundColor: D.card, overflow: "hidden" },
  groupLabel: { fontSize: 9, fontFamily: "DMSans_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.8, color: D.green, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  grid:       { flexDirection: "row", flexWrap: "wrap" },
  cell:       { width: "50%", padding: 14, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: D.border },
  cellLabel:  { fontSize: 10, fontFamily: "DMSans_500Medium", color: D.muted, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 },
  cellValue:  { fontSize: 19, fontFamily: "DMSans_800ExtraBold", color: D.text },
});

// ─── About Section ────────────────────────────────────────────────────────────

function AboutSection({ profile }: { profile?: ProfileData }) {
  const [expanded, setExpanded] = useState(false);
  if (!profile) return null;

  const desc = profile.description ?? "";
  const short = desc.length > 260 && !expanded ? desc.slice(0, 260) + "…" : desc;

  const tags = [
    profile.sector   && { icon: "business-outline" as const,  text: profile.sector },
    profile.industry && { icon: "construct-outline" as const,  text: profile.industry },
    profile.country  && { icon: "location-outline" as const,   text: profile.city ? `${profile.city}, ${profile.country}` : profile.country },
    profile.employees&& { icon: "people-outline" as const,     text: profile.employees.toLocaleString() + " emp." },
  ].filter(Boolean) as { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }[];

  return (
    <View style={{ paddingHorizontal: 16, gap: 10 }}>
      {desc.length > 0 && (
        <View style={ab.descCard}>
          <Text style={ab.desc}>{short}</Text>
          {desc.length > 260 && (
            <TouchableOpacity onPress={() => setExpanded(!expanded)} style={{ marginTop: 10 }}>
              <Text style={ab.toggle}>{expanded ? "Ver menos ↑" : "Ver más ↓"}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {tags.length > 0 && (
        <View style={ab.tagsRow}>
          {tags.map((tag, i) => (
            <View key={i} style={ab.tag}>
              <Ionicons name={tag.icon} size={11} color={D.muted} />
              <Text style={ab.tagText}>{tag.text}</Text>
            </View>
          ))}
        </View>
      )}

      {profile.website && (
        <TouchableOpacity
          onPress={() => Linking.openURL(profile.website!)}
          style={ab.websiteBtn}
        >
          <Ionicons name="globe-outline" size={14} color={D.green} />
          <Text style={ab.websiteText} numberOfLines={1}>
            {profile.website.replace(/^https?:\/\//, "")}
          </Text>
          <Ionicons name="arrow-forward" size={13} color={D.green} style={{ marginLeft: "auto" }} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const ab = StyleSheet.create({
  descCard:   { borderRadius: 18, borderWidth: 1, borderColor: D.border, padding: 16, backgroundColor: D.card },
  desc:       { fontSize: 13, fontFamily: "DMSans_400Regular", lineHeight: 21, color: D.sub },
  toggle:     { fontSize: 12, fontFamily: "DMSans_700Bold", color: D.green },
  tagsRow:    { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  tag:        { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, borderWidth: 1, borderColor: D.border, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: D.card },
  tagText:    { fontSize: 11, fontFamily: "DMSans_600SemiBold", color: D.sub },
  websiteBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, borderColor: D.greenBdr, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: D.greenDim },
  websiteText:{ fontSize: 12, fontFamily: "DMSans_700Bold", flex: 1, color: D.green },
});

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "veredicto",   label: "Veredicto",    icon: "sparkles-outline" as const },
  { id: "grafica",     label: "Gráfica",      icon: "stats-chart-outline" as const },
  { id: "financieros", label: "Financieros",  icon: "bar-chart-outline" as const },
  { id: "analistas",   label: "Analistas",    icon: "people-outline" as const },
  { id: "empresa",     label: "Empresa",      icon: "business-outline" as const },
] as const;

type TabId = typeof TABS[number]["id"];

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StockDetailScreen({ ticker }: { ticker: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch } = useStockDetail(ticker);
  const [activeTab, setActiveTab] = useState<TabId>("veredicto");

  useEffect(() => {
    if (ticker) posthog.capture("stock_detail_viewed", { ticker });
  }, [ticker]);
  const { data: richFin } = useRichFinancials(ticker, activeTab === "financieros");

  const pricePct = data?.profile?.current_price != null && data?.profile?.prev_close != null && data.profile.prev_close !== 0
    ? ((data.profile.current_price - data.profile.prev_close) / data.profile.prev_close) * 100
    : null;
  const priceUp = (pricePct ?? 0) >= 0;
  const priceColor = priceUp ? "#22c55e" : D.red;

  const fmtDisplayPrice = (p: number) =>
    p >= 1000
      ? p.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : p.toFixed(2);

  function renderContent() {
    if (activeTab === "grafica") {
      return (
        <View style={{ marginHorizontal: 12, marginTop: 16 }}>
          <StockChart ticker={ticker} />
        </View>
      );
    }

    if (loading && !data) {
      return (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={D.green} />
          <Text style={s.loadingText}>Cargando análisis…</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={s.centered}>
          <View style={s.errorIcon}>
            <Ionicons name="alert-circle-outline" size={28} color={D.red} />
          </View>
          <Text style={s.errorText}>No se pudieron cargar los datos</Text>
          <TouchableOpacity onPress={refetch} style={s.retryBtn}>
            <Text style={s.retryText}>Reintentar</Text>
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
            <Ionicons name="bar-chart-outline" size={28} color={D.dim} />
            <Text style={s.emptyText}>Sin datos financieros</Text>
          </View>
        );
      }
      return <StockFinancials financials={data.financials} richFin={richFin ?? undefined} ticker={ticker} />;
    }

    if (activeTab === "analistas") {
      if (!data?.analyst) {
        return (
          <View style={s.centered}>
            <Ionicons name="people-outline" size={28} color={D.dim} />
            <Text style={s.emptyText}>Sin datos de analistas</Text>
          </View>
        );
      }
      return <StockAnalysts analyst={data.analyst} currentPrice={data?.profile?.current_price} />;
    }

    if (activeTab === "empresa") {
      return (
        <View style={{ paddingBottom: 48 }}>
          <SectionHeader title={`Acerca de ${data?.profile?.name ?? ticker}`} icon="business-outline" />
          <AboutSection profile={data?.profile} />

          <SectionHeader title="Métricas Clave" icon="stats-chart-outline" />
          <KeyMetrics profile={data?.profile} />

          <SectionHeader title="Noticias" icon="newspaper-outline" />
          <StockNews ticker={ticker} />

          <SectionHeader title="Empresas Similares" icon="git-compare-outline" />
          <StockCompetitors ticker={ticker} />
        </View>
      );
    }

    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: D.bg, paddingTop: insets.top }}>

      {/* ── Top Bar ── */}
      <View style={[tb.topBar, { borderBottomColor: priceColor + "22" }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={tb.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={D.sub} />
        </TouchableOpacity>

        <View style={tb.avatarWrap}>
          <StockAvatar ticker={ticker} size={36} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={tb.tickerText}>{ticker}</Text>
          {data?.profile?.name && (
            <Text style={tb.nameText} numberOfLines={1}>{data.profile.name}</Text>
          )}
        </View>

        {/* Price block */}
        <View style={tb.priceBlock}>
          {data?.profile?.current_price != null ? (
            <Text style={tb.priceText}>
              ${fmtDisplayPrice(data.profile.current_price)}
            </Text>
          ) : loading ? (
            <ActivityIndicator size="small" color={D.green} />
          ) : null}
          {pricePct != null && (
            <View style={[tb.changeBadge, { backgroundColor: priceColor + "18" }]}>
              <Ionicons
                name={priceUp ? "trending-up" : "trending-down"}
                size={11}
                color={priceColor}
              />
              <Text style={[tb.changeText, { color: priceColor }]}>
                {priceUp ? "+" : ""}{pricePct.toFixed(2)}%
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Tab Bar ── */}
      <View style={tb.tabBarOuter}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={tb.tabBarInner}
        >
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={[tb.tab, active && tb.tabActive]}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={tab.icon}
                  size={13}
                  color={active ? D.green : D.dim}
                />
                <Text style={[tb.tabLabel, { color: active ? D.green : D.muted, fontFamily: active ? "DMSans_800ExtraBold" : "DMSans_500Medium" }]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Content ── */}
      <ScrollView
        key={activeTab}
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 56 }}
      >
        {renderContent()}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  centered: {
    paddingVertical: 64,
    alignItems: "center",
    gap: 14,
  },
  loadingText: { color: D.muted, fontSize: 13, fontFamily: "DMSans_500Medium" },
  errorIcon:   { width: 56, height: 56, borderRadius: 18, backgroundColor: "rgba(239,68,68,0.1)", alignItems: "center", justifyContent: "center" },
  errorText:   { color: D.sub, fontSize: 14, fontFamily: "DMSans_500Medium" },
  retryBtn:    { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: D.greenBdr, backgroundColor: D.greenDim },
  retryText:   { color: D.green, fontSize: 13, fontFamily: "DMSans_700Bold" },
  emptyText:   { color: D.muted, fontSize: 13, fontFamily: "DMSans_500Medium" },
});

const tb = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    backgroundColor: D.bg,
  },
  backBtn:    { width: 34, height: 34, borderRadius: 10, backgroundColor: D.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: D.border },
  avatarWrap: {},
  tickerText: { fontSize: 16, fontFamily: "DMSans_800ExtraBold", color: D.text, letterSpacing: -0.3 },
  nameText:   { fontSize: 11, fontFamily: "DMSans_500Medium", color: D.muted, marginTop: 1 },
  priceBlock: { alignItems: "flex-end", gap: 4 },
  priceText:  { fontSize: 18, fontFamily: "DMSans_800ExtraBold", color: D.text, letterSpacing: -0.5 },
  changeBadge:{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  changeText: { fontSize: 11, fontFamily: "DMSans_700Bold" },

  tabBarOuter: { backgroundColor: D.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: D.border },
  tabBarInner: { paddingHorizontal: 12, paddingVertical: 10, gap: 6, flexDirection: "row" },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: D.card,
  },
  tabActive: {
    backgroundColor: D.greenDim,
    borderColor: D.greenBdr,
  },
  tabLabel: { fontSize: 12 },
});
