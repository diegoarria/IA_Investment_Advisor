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
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme } from "../../lib/ThemeContext";
import { useStockDetail, useStockScore, useRichFinancials } from "../../hooks/useStockDetail";
import StockChart from "../StockChart";
import StockNews from "./StockNews";
import StockCompetitors from "./StockCompetitors";
import StockFinancials from "./StockFinancials";
import StockAnalysts from "./StockAnalysts";
import StockAvatar from "../StockAvatar";

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

function SectionHeader({ title, emoji, colors }: { title: string; emoji?: string; colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <View style={sh.row}>
      <View style={[sh.bar, { backgroundColor: colors.accentLight }]} />
      {emoji ? <Text style={sh.emoji}>{emoji}</Text> : null}
      <Text style={[sh.title, { color: colors.textMuted }]}>{title}</Text>
    </View>
  );
}

const sh = StyleSheet.create({
  row:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 22, paddingBottom: 10 },
  bar:   { width: 3, height: 16, borderRadius: 2 },
  emoji: { fontSize: 14 },
  title: { fontSize: 11, fontFamily: "DMSans_800ExtraBold", letterSpacing: 0.5, textTransform: "uppercase", flex: 1 },
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {stats.map((s) => (
          <View key={s.label} style={[km.card, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
            <Text style={[km.label, { color: colors.textMuted }]}>{s.label}</Text>
            <Text style={[km.value, { color: colors.text }]}>{s.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const km = StyleSheet.create({
  card:  { width: "47%", borderRadius: 14, borderWidth: 1, padding: 12 },
  label: { fontSize: 10, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4, color: "#888", marginBottom: 4 },
  value: { fontSize: 17, fontFamily: "DMSans_800ExtraBold" },
});

// ─── 2. Acerca de ─────────────────────────────────────────────────────────────

function AboutSection({ profile }: { profile?: ReturnType<typeof useStockDetail>["data"] extends { profile: infer P } | null ? P | undefined : never }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (!profile) return null;

  const desc = profile.description ?? "";
  const short = desc.length > 240 && !expanded ? desc.slice(0, 240) + "…" : desc;

  const tags = [
    profile.sector    && { icon: "🏭", text: profile.sector },
    profile.industry  && { icon: "⚙️",  text: profile.industry },
    profile.country   && { icon: "🌍", text: profile.city ? `${profile.city}, ${profile.country}` : profile.country },
    profile.employees && { icon: "👥", text: profile.employees.toLocaleString() + " emp." },
  ].filter(Boolean) as { icon: string; text: string }[];

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
      {desc.length > 0 && (
        <View style={[ab.descCard, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
          <Text style={[ab.desc, { color: colors.textSub }]}>{short}</Text>
          {desc.length > 240 && (
            <TouchableOpacity onPress={() => setExpanded(!expanded)} style={{ marginTop: 6 }}>
              <Text style={[ab.toggle, { color: colors.accentLight }]}>
                {expanded ? "Ver menos" : "Ver más"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {tags.length > 0 && (
        <View style={ab.tagsRow}>
          {tags.map((tag, i) => (
            <View key={i} style={[ab.tag, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
              <Text style={{ fontSize: 12 }}>{tag.icon}</Text>
              <Text style={[ab.tagText, { color: colors.textSub }]}>{tag.text}</Text>
            </View>
          ))}
        </View>
      )}

      {profile.website && (
        <TouchableOpacity
          onPress={() => Linking.openURL(profile.website!)}
          style={[ab.websiteBtn, { backgroundColor: "rgba(0,168,94,0.08)", borderColor: "rgba(0,168,94,0.2)" }]}
        >
          <Ionicons name="globe-outline" size={14} color={colors.accentLight} />
          <Text style={[ab.websiteText, { color: colors.accentLight }]} numberOfLines={1}>
            {profile.website.replace(/^https?:\/\//, "")}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.accentLight} style={{ marginLeft: "auto" }} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const ab = StyleSheet.create({
  descCard:   { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12 },
  desc:       { fontSize: 13, fontFamily: "DMSans_400Regular", lineHeight: 20 },
  toggle:     { fontSize: 12, fontFamily: "DMSans_600SemiBold" },
  tagsRow:    { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  tag:        { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  tagText:    { fontSize: 11, fontFamily: "DMSans_600SemiBold" },
  websiteBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  websiteText:{ fontSize: 12, fontFamily: "DMSans_600SemiBold", flex: 1 },
});

// ─── 3. Financiero — gráfica de barras simple ─────────────────────────────────


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

  const pricePct = data?.profile?.current_price != null && data?.profile?.prev_close != null && data.profile.prev_close !== 0
    ? ((data.profile.current_price - data.profile.prev_close) / data.profile.prev_close) * 100
    : null;
  const priceUp = (pricePct ?? 0) >= 0;

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
          <SectionHeader title="Métricas Clave" emoji="📊" colors={colors} />
          <KeyMetrics profile={data?.profile} />
          <Divider color={colors.bgRaised} />
          <SectionHeader title={`Acerca de ${data?.profile?.name ?? ticker}`} emoji="🏢" colors={colors} />
          <AboutSection profile={data?.profile} />
          <Divider color={colors.bgRaised} />
          <SectionHeader title="Noticias" emoji="📰" colors={colors} />
          <StockNews ticker={ticker} />
          <Divider color={colors.bgRaised} />
          <SectionHeader title="Empresas Similares" emoji="🔎" colors={colors} />
          <StockCompetitors ticker={ticker} />
        </>
      );
    }

    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {/* ── Top bar ── */}
      <View style={[tb.topBar, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ marginLeft: 10 }}>
          <StockAvatar ticker={ticker} size={38} />
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[tb.topTicker, { color: colors.text }]}>{ticker}</Text>
          {data?.profile?.name && (
            <Text style={[tb.topName, { color: colors.textMuted }]} numberOfLines={1}>
              {data.profile.name}
            </Text>
          )}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {data?.profile?.current_price != null && (
            <Text style={[tb.topPrice, { color: colors.text }]}>
              ${data.profile.current_price >= 1000
                ? data.profile.current_price.toLocaleString("en-US", { maximumFractionDigits: 0 })
                : data.profile.current_price.toFixed(2)}
            </Text>
          )}
          {pricePct != null && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
              <Ionicons
                name={priceUp ? "trending-up" : "trending-down"}
                size={11}
                color={priceUp ? colors.up : colors.down}
              />
              <Text style={{ fontSize: 12, fontFamily: "DMSans_600SemiBold", color: priceUp ? colors.up : colors.down }}>
                {priceUp ? "+" : ""}{pricePct.toFixed(2)}%
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Tab Bar ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[tb.barWrap, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}
        contentContainerStyle={tb.bar}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={[
                tb.tab,
                active
                  ? { backgroundColor: "rgba(0,168,94,0.12)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(0,168,94,0.3)" }
                  : { borderWidth: 0 },
              ]}
            >
              <Text style={[tb.label, {
                color: active ? colors.accentLight : colors.textMuted,
                fontFamily: active ? "DMSans_800ExtraBold" : "DMSans_400Regular",
              }]}>
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
