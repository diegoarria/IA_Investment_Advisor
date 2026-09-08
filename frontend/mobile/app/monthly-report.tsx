import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import api, { BASE_URL } from "../src/lib/api";
import { posthog } from "../src/config/posthog";

const LOGO = require("../assets/images/logo_new.png");

// Nuvos Monthly Report — monthly counterpart to wrapped.tsx (annual). Same
// real backend-driven pattern: GET /api/monthly-report?year=&month=, real
// data only, empty states instead of fabricated numbers. Deliberately its
// own file (not shared code with wrapped.tsx or with web's monthly-report
// components) — same reasoning wrapped.tsx's own header comment gives for
// not sharing code between mobile/web: each platform iterates on its
// report screen independently without risking drift-by-refactor.

// ── Real data shape (matches backend/app/services/monthly_report_service.py
//    exactly, same as web's components/monthly-report/types.ts) ──────────
interface MonthlyReportArchetype { key: string; name: string; emoji: string; tagline: string; traits: string[] }
interface MonthlyReportPositionMove { ticker: string; company_name?: string | null; move_pct: number }
type MonthlyReportComposition = Record<string, number>;

interface MonthlyReportPortfolio {
  available: boolean;
  return_pct: number | null;
  benchmark_pct: number | null;
  diff_pp: number | null;
  best_position: MonthlyReportPositionMove | null;
  worst_position: MonthlyReportPositionMove | null;
  composition: MonthlyReportComposition | null;
  insight: string | null;
}
interface MonthlyReportDecisions {
  total: number; buys_count: number; sells_count: number; holds_count: number;
  has_activity: boolean; highlight: string | null; improvement_tip: string | null;
}
interface MonthlyReportCompany { ticker: string; company_name?: string | null; times_analyzed: number }
interface MonthlyReportResearch {
  companies_researched: number; top_companies: MonthlyReportCompany[];
  favorite_company: MonthlyReportCompany | null; research_pattern: string[] | null; insight: string | null;
}
interface MonthlyReportWealth {
  available: boolean; portfolio_value: number | null; variation_pct: number | null;
  stocks_value: number | null; cash_value: number | null; dividend_value: number | null;
}
interface MonthlyReportHabits {
  active_days: number; longest_streak: number; favorite_weekday: string | null;
  activity_breakdown: { analizar: number; seguimiento: number; decisiones: number };
}
interface MonthlyReportEvolution {
  current_archetype: MonthlyReportArchetype | null; past_archetype: MonthlyReportArchetype | null;
  months_compared: number | null; insight: string | null;
}
interface MonthlyReportMission { key: string; title: string; text: string }
interface MonthlyReportNextMonth { missions: MonthlyReportMission[]; next_milestone: string | null }
interface MonthlyReportAchievement { id: string; name: string; description: string; icon: string }
interface MonthlyReportAchievements {
  unlocked_this_month: MonthlyReportAchievement[]; total_unlocked: number; total_available: number;
  next_achievement: MonthlyReportAchievement | null;
}
interface MonthlyReportShareCard {
  month_label: string;
  user_name: string;
  avatar_url: string | null;
  return_pct: number | null;
  positions_count: number;
  best_position: { ticker: string; company_name?: string | null; move_pct: number } | null;
  decisions_count: number;
  companies_researched: number;
  archetype_name: string | null;
  achievement: { name: string; icon: string } | null;
}
interface MonthlyReportOverview {
  month_label: string; year: number; month: number; is_current_month: boolean;
  decisions_count: number; companies_researched: number; active_days: number;
}
interface MonthlyReportData {
  available: true;
  overview: MonthlyReportOverview; portfolio: MonthlyReportPortfolio; decisions: MonthlyReportDecisions;
  research: MonthlyReportResearch; wealth: MonthlyReportWealth; habits: MonthlyReportHabits;
  evolution: MonthlyReportEvolution; next_month: MonthlyReportNextMonth; achievements: MonthlyReportAchievements;
  share_card: MonthlyReportShareCard;
}
interface MonthlyReportUnavailable { available: false; reason?: string }
type MonthlyReportResponse = MonthlyReportData | MonthlyReportUnavailable;

const WT = {
  bg: "#03060e", card: "#090f1f", card2: "#0d1526",
  border: "#162035", borderS: "#1e2e48",
  text: "#eef2ff", sub: "#8fa3c0", muted: "#546b85", dim: "#2a3f58",
  accent: "#00b96d", accentL: "#00e887",
  gold: "#D4A24C", coral: "#DD6E63", teal: "#4FA695",
};

const COMPOSITION_LABELS: Record<string, string> = { growth: "Growth", quality: "Quality", value: "Value", defensive: "Defensivo", other: "Otro" };
const COMPOSITION_COLORS: Record<string, string> = { growth: WT.accentL, quality: WT.teal, value: WT.gold, defensive: WT.coral, other: WT.muted };

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

function useCountUp(target: number, durationMs = 900, decimals = 0): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return decimals > 0 ? Number(value.toFixed(decimals)) : Math.round(value);
}

function FadeIn({ children, style }: { children: React.ReactNode; style?: any }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }).start(); }, []);
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}

function TickerLogo({ ticker, size }: { ticker: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: WT.card2, borderWidth: 1, borderColor: WT.border, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontWeight: "800", fontSize: size * 0.34, color: WT.sub }}>{ticker.slice(0, 2)}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: `${BASE_URL}/api/logo/${ticker.replace(".", "-")}?format=png` }}
      onError={() => setFailed(true)}
      resizeMode="contain"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#fff", borderWidth: 1, borderColor: WT.border }}
    />
  );
}

function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <FadeIn style={c.card}>
      <View style={{ padding: 26, alignItems: "center" }}>
        <Text style={{ fontSize: 30, marginBottom: 10 }}>{emoji}</Text>
        <Text style={c.emptyText}>{text}</Text>
      </View>
    </FadeIn>
  );
}

function InsightCard({ text, accent = WT.accentL }: { text: string; accent?: string }) {
  return (
    <FadeIn style={[c.card, { padding: 14, backgroundColor: `${accent}0f`, borderColor: `${accent}33` }]}>
      <Text style={{ fontSize: 13, color: WT.text, lineHeight: 19 }}>{text}</Text>
    </FadeIn>
  );
}

function Stage({
  page, total, glow = "top", noChrome, nextLabel, children,
}: {
  page: number; total: number; glow?: "top" | "bottom" | "center";
  noChrome?: boolean; nextLabel?: string; children: React.ReactNode;
}) {
  const glowStyle: { top?: number; bottom?: number; alignSelf: "center" } =
    glow === "bottom" ? { bottom: -140, alignSelf: "center" } :
    glow === "center" ? { top: 260, alignSelf: "center" } :
    { top: -140, alignSelf: "center" };
  return (
    <View style={{ flex: 1, backgroundColor: WT.bg }}>
      <View style={[st.glow, glowStyle]} />
      {!noChrome && (
        <>
          <View style={st.brandRow}>
            <Image source={LOGO} style={st.brandLogo} />
            <Text style={st.brandName}>NUVOS AI</Text>
          </View>
          <Text style={st.pageCounter}>{String(page).padStart(2, "0")} / {total}</Text>
        </>
      )}
      <View style={st.content}>{children}</View>
      {!noChrome && nextLabel && (
        <View style={st.nextWrap}>
          <Text style={st.nextLabel}>Sigue</Text>
          <Text style={st.nextText}>{nextLabel}</Text>
        </View>
      )}
      {!noChrome && <Text style={st.footer}>NUVOS AI · TU MONTHLY REPORT</Text>}
    </View>
  );
}

type ScreenProps = { data: MonthlyReportData; total: number; page: number; nextLabel?: string };

// 1 — Portada
function ScreenPortada({ data, total, page, nextLabel }: ScreenProps) {
  const o = data.overview;
  const stats = [
    { emoji: "🎯", label: "Decisiones", value: String(o.decisions_count), accent: WT.accentL },
    { emoji: "🔍", label: "Investigadas", value: String(o.companies_researched), accent: WT.teal },
    { emoji: "⏱️", label: "Días activo", value: String(o.active_days), accent: WT.gold },
  ];
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <View style={{ alignItems: "center" }}>
        <FadeIn><Text style={c.eyebrow}>{o.month_label}</Text></FadeIn>
        <FadeIn style={{ marginTop: 6, marginBottom: 24 }}><Text style={[c.h1, { fontSize: 26 }]}>Tu mes como{"\n"}inversionista.</Text></FadeIn>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          {stats.map((s) => (
            <FadeIn key={s.label} style={[heroCard(s.accent), { width: "45%" }]}>
              <View style={heroIcon(s.accent)}><Text style={{ fontSize: 15 }}>{s.emoji}</Text></View>
              <Text style={st.heroLabel}>{s.label}</Text>
              <Text style={[st.heroValue, { color: WT.text }]}>{s.value}</Text>
            </FadeIn>
          ))}
        </View>
      </View>
    </Stage>
  );
}

// 2 — Tu portafolio
function ScreenPortafolio({ data, total, page, nextLabel }: ScreenProps) {
  const p = data.portfolio;
  const animatedReturn = useCountUp(p.return_pct ?? 0, 1000, 2);
  const returnColor = (p.return_pct ?? 0) >= 0 ? WT.accentL : WT.coral;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Tu portafolio</Text>
      <Text style={[c.h1, { fontSize: 22, marginTop: 4, marginBottom: 18 }]}>¿Cómo te fue?</Text>
      {!p.available ? (
        <EmptyState emoji="📊" text="Todavía no tenemos suficiente actividad de portafolio este mes." />
      ) : (
        <View style={{ gap: 10 }}>
          {p.return_pct !== null && (
            <FadeIn style={[heroCard(returnColor), { alignItems: "center", padding: 20 }]}>
              <Text style={st.heroLabel}>Rendimiento del mes</Text>
              <Text style={{ fontWeight: "900", fontSize: 34, color: returnColor }}>{fmtPct(animatedReturn)}</Text>
              {p.benchmark_pct !== null && (
                <Text style={{ fontSize: 12, color: WT.sub, marginTop: 6 }}>
                  S&amp;P 500: {fmtPct(p.benchmark_pct)}{p.diff_pp !== null ? ` · vs mercado ${fmtPct(p.diff_pp)}` : ""}
                </Text>
              )}
            </FadeIn>
          )}
          {(p.best_position || p.worst_position) && (
            <View style={{ flexDirection: "row", gap: 10 }}>
              {p.best_position && (
                <FadeIn style={[st.secondaryCard, { flex: 1 }]}>
                  <TickerLogo ticker={p.best_position.ticker} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 9, color: WT.muted, textTransform: "uppercase" }}>Mejor</Text>
                    <Text style={{ fontWeight: "800", fontSize: 12, color: WT.text }}>{p.best_position.ticker}</Text>
                  </View>
                </FadeIn>
              )}
              {p.worst_position && (
                <FadeIn style={[st.secondaryCard, { flex: 1 }]}>
                  <TickerLogo ticker={p.worst_position.ticker} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 9, color: WT.muted, textTransform: "uppercase" }}>Peor</Text>
                    <Text style={{ fontWeight: "800", fontSize: 12, color: WT.text }}>{p.worst_position.ticker}</Text>
                  </View>
                </FadeIn>
              )}
            </View>
          )}
          {p.composition && Object.keys(p.composition).length > 0 && (
            <FadeIn style={[c.card, { padding: 14 }]}>
              <Text style={{ fontSize: 10, fontWeight: "700", color: WT.sub, textTransform: "uppercase", marginBottom: 8 }}>Composición</Text>
              <View style={{ flexDirection: "row", height: 8, borderRadius: 5, overflow: "hidden", marginBottom: 8 }}>
                {Object.entries(p.composition).map(([k, v]) => (
                  <View key={k} style={{ width: `${v}%`, backgroundColor: COMPOSITION_COLORS[k] || WT.muted }} />
                ))}
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {Object.entries(p.composition).map(([k, v]) => (
                  <Text key={k} style={{ fontSize: 11, color: WT.sub }}><Text style={{ fontWeight: "800", color: WT.text }}>{v}%</Text> {COMPOSITION_LABELS[k] || k}</Text>
                ))}
              </View>
            </FadeIn>
          )}
          {p.insight && <InsightCard text={p.insight} />}
        </View>
      )}
    </Stage>
  );
}

// 3 — Tus decisiones
function ScreenDecisiones({ data, total, page, nextLabel }: ScreenProps) {
  const d = data.decisions;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Tus decisiones</Text>
      <Text style={[c.h1, { fontSize: 40, marginTop: 4 }]}>{d.total}</Text>
      <Text style={[c.emptyText, { marginBottom: 18 }]}>decisiones este mes</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
        <View style={[st.secondaryCard, { flex: 1, flexDirection: "column", alignItems: "center", gap: 2 }]}>
          <Text style={{ fontWeight: "900", fontSize: 17, color: WT.accentL }}>{d.buys_count}</Text>
          <Text style={{ fontSize: 9, color: WT.muted }}>compras</Text>
        </View>
        <View style={[st.secondaryCard, { flex: 1, flexDirection: "column", alignItems: "center", gap: 2 }]}>
          <Text style={{ fontWeight: "900", fontSize: 17, color: WT.gold }}>{d.holds_count}</Text>
          <Text style={{ fontSize: 9, color: WT.muted }}>mantener</Text>
        </View>
        <View style={[st.secondaryCard, { flex: 1, flexDirection: "column", alignItems: "center", gap: 2 }]}>
          <Text style={{ fontWeight: "900", fontSize: 17, color: WT.coral }}>{d.sells_count}</Text>
          <Text style={{ fontSize: 9, color: WT.muted }}>ventas</Text>
        </View>
      </View>
      {d.highlight ? (
        <FadeIn style={[c.card, { padding: 14, marginBottom: 10 }]}>
          <Text style={{ fontSize: 10, fontWeight: "700", color: WT.accentL, textTransform: "uppercase", marginBottom: 6 }}>Tu decisión más importante</Text>
          <Text style={{ fontSize: 13, color: WT.text, lineHeight: 19 }}>{d.highlight}</Text>
        </FadeIn>
      ) : (
        <EmptyState emoji="🤔" text="Todavía no tenemos suficiente información para identificar tu decisión más importante." />
      )}
      {d.improvement_tip && (
        <FadeIn style={[c.card, { padding: 14, backgroundColor: "rgba(212,162,76,0.06)", borderColor: "rgba(212,162,76,0.2)" }]}>
          <Text style={{ fontSize: 10, fontWeight: "700", color: WT.gold, textTransform: "uppercase", marginBottom: 6 }}>Cómo mejorar</Text>
          <Text style={{ fontSize: 13, color: WT.text, lineHeight: 19 }}>{d.improvement_tip}</Text>
        </FadeIn>
      )}
    </Stage>
  );
}

// 4 — Empresas investigadas
function ScreenInvestigacion({ data, total, page, nextLabel }: ScreenProps) {
  const r = data.research;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Investigación</Text>
      <Text style={[c.h1, { fontSize: 22, marginTop: 4, marginBottom: 18 }]}>Empresas que investigaste</Text>
      {r.companies_researched === 0 ? (
        <EmptyState emoji="🔍" text="Todavía no registramos empresas investigadas este mes." />
      ) : (
        <View style={{ gap: 10 }}>
          <FadeIn style={[heroCard(WT.teal), { alignItems: "center", padding: 18 }]}>
            <Text style={st.heroLabel}>Empresas investigadas</Text>
            <Text style={{ fontWeight: "900", fontSize: 30, color: WT.text }}>{r.companies_researched}</Text>
          </FadeIn>
          {r.favorite_company && (
            <FadeIn style={[st.secondaryCard, { gap: 12 }]}>
              <TickerLogo ticker={r.favorite_company.ticker} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 9, color: WT.muted, textTransform: "uppercase" }}>Tu empresa más investigada</Text>
                <Text style={{ fontWeight: "800", fontSize: 14, color: WT.text }}>{r.favorite_company.company_name || r.favorite_company.ticker}</Text>
                <Text style={{ fontSize: 11, color: WT.sub }}>{r.favorite_company.times_analyzed} sesiones</Text>
              </View>
            </FadeIn>
          )}
          {r.research_pattern && r.research_pattern.length >= 2 && (
            <FadeIn style={[c.card, { padding: 14, alignItems: "center" }]}>
              <Text style={{ fontSize: 10, fontWeight: "700", color: WT.sub, textTransform: "uppercase", marginBottom: 8 }}>Tu patrón de investigación</Text>
              <Text style={{ fontSize: 13, color: WT.accentL, fontWeight: "800", textAlign: "center" }}>{r.research_pattern.join("  →  ")}</Text>
            </FadeIn>
          )}
          {r.insight && <InsightCard text={r.insight} accent={WT.teal} />}
        </View>
      )}
    </Stage>
  );
}

// 5 — Tu patrimonio (PRIVADO)
function ScreenPatrimonio({ data, total, page, nextLabel }: ScreenProps) {
  const w = data.wealth;
  const animatedValue = useCountUp(w.portfolio_value ?? 0, 1000, 2);
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Privado · Solo para ti</Text>
      <Text style={[c.h1, { fontSize: 22, marginTop: 4, marginBottom: 18 }]}>Tu patrimonio</Text>
      {!w.available || w.portfolio_value === null ? (
        <EmptyState emoji="💼" text="Todavía no tenemos suficientes datos para mostrar tu patrimonio este mes." />
      ) : (
        <FadeIn style={[heroCard(WT.accentL), { alignItems: "center", padding: 20 }]}>
          <Text style={st.heroLabel}>Patrimonio total</Text>
          <Text style={{ fontWeight: "900", fontSize: 28, color: WT.text }}>{fmtUsd(animatedValue)}</Text>
          {w.variation_pct !== null && (
            <Text style={{ fontSize: 12, marginTop: 6, fontWeight: "700", color: w.variation_pct >= 0 ? WT.accentL : WT.coral }}>{fmtPct(w.variation_pct)} este mes</Text>
          )}
        </FadeIn>
      )}
    </Stage>
  );
}

// 6 — Tu hábito
function ScreenHabitos({ data, total, page, nextLabel }: ScreenProps) {
  const h = data.habits;
  const rows = [
    { emoji: "🔍", label: "Analizar", value: h.activity_breakdown.analizar },
    { emoji: "👀", label: "Seguimiento", value: h.activity_breakdown.seguimiento },
    { emoji: "🎯", label: "Decisiones", value: h.activity_breakdown.decisiones },
  ].filter((r) => r.value > 0);
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Tu hábito</Text>
      <Text style={[c.h1, { fontSize: 22, marginTop: 4, marginBottom: 18 }]}>Tu constancia este mes</Text>
      {h.active_days === 0 ? (
        <EmptyState emoji="🌱" text="Todavía no registramos actividad real este mes." />
      ) : (
        <View style={{ gap: 10 }}>
          <FadeIn style={[heroCard(WT.coral), { alignItems: "center", padding: 18 }]}>
            <View style={heroIcon(WT.coral)}><Text style={{ fontSize: 15 }}>🔥</Text></View>
            <Text style={st.heroLabel}>Racha más larga</Text>
            <Text style={{ fontWeight: "900", fontSize: 26, color: WT.text }}>{h.longest_streak} días</Text>
          </FadeIn>
          {rows.map((r) => (
            <FadeIn key={r.label} style={st.secondaryCard}>
              <View style={secondaryIcon(WT.teal)}><Text style={{ fontSize: 15 }}>{r.emoji}</Text></View>
              <Text style={{ flex: 1, fontWeight: "800", fontSize: 13, color: WT.text }}>{r.label}</Text>
              <Text style={{ fontWeight: "900", fontSize: 15, color: WT.text }}>{r.value}×</Text>
            </FadeIn>
          ))}
          {h.favorite_weekday && (
            <FadeIn style={[c.card, { padding: 14, alignItems: "center" }]}>
              <Text style={c.emptyText}>Tu día favorito: <Text style={{ color: WT.text, fontWeight: "700" }}>{h.favorite_weekday}</Text></Text>
            </FadeIn>
          )}
        </View>
      )}
    </Stage>
  );
}

// 7 — Tu evolución
function ScreenEvolucion({ data, total, page, nextLabel }: ScreenProps) {
  const e = data.evolution;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Tu evolución</Text>
      <Text style={[c.h1, { fontSize: 22, marginTop: 4, marginBottom: 18 }]}>Cómo estás cambiando</Text>
      {!e.current_archetype ? (
        <EmptyState emoji="🌱" text="Todavía estamos conociendo tu estilo — necesitamos un poco más de actividad." />
      ) : (
        <View style={{ gap: 10 }}>
          {e.past_archetype && (
            <FadeIn style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <View style={{ alignItems: "center" }}>
                <Text style={{ fontSize: 9, color: WT.muted, textTransform: "uppercase" }}>Hace {e.months_compared} meses</Text>
                <Text style={{ fontSize: 20 }}>{e.past_archetype.emoji}</Text>
                <Text style={{ fontWeight: "700", fontSize: 11, color: WT.sub }}>{e.past_archetype.name}</Text>
              </View>
              <Text style={{ color: WT.muted, fontSize: 16 }}>→</Text>
              <View style={{ alignItems: "center" }}>
                <Text style={{ fontSize: 9, color: WT.accentL, textTransform: "uppercase" }}>Hoy</Text>
                <Text style={{ fontSize: 20 }}>{e.current_archetype.emoji}</Text>
                <Text style={{ fontWeight: "700", fontSize: 11, color: WT.text }}>{e.current_archetype.name}</Text>
              </View>
            </FadeIn>
          )}
          <FadeIn style={[c.card, { padding: 22, alignItems: "center", backgroundColor: "rgba(0,185,109,0.10)", borderColor: "rgba(0,185,109,0.32)" }]}>
            <Text style={{ fontSize: 28, marginBottom: 8 }}>{e.current_archetype.emoji}</Text>
            <Text style={{ fontWeight: "900", fontSize: 19, color: WT.accentL, marginBottom: 8 }}>{e.current_archetype.name}</Text>
            <Text style={c.body}>&ldquo;{e.current_archetype.tagline}&rdquo;</Text>
          </FadeIn>
          {e.insight && <InsightCard text={e.insight} />}
        </View>
      )}
    </Stage>
  );
}

// 8 — Tu próximo mes
function ScreenProximoMes({ data, total, page, nextLabel }: ScreenProps) {
  const n = data.next_month;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Tu próximo mes</Text>
      <Text style={[c.h1, { fontSize: 22, marginTop: 4, marginBottom: 18 }]}>3 misiones para vos</Text>
      {n.missions.length === 0 ? (
        <EmptyState emoji="🎯" text="Sigue registrando actividad este mes para recibir misiones concretas." />
      ) : (
        <View style={{ gap: 10, marginBottom: 12 }}>
          {n.missions.map((m, i) => (
            <FadeIn key={m.key} style={st.secondaryCard}>
              <View style={[secondaryIcon(WT.accentL)]}><Text style={{ fontWeight: "900", fontSize: 12, color: WT.accentL }}>{String(i + 1).padStart(2, "0")}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 13, color: WT.text }}>{m.title}</Text>
                <Text style={{ fontSize: 12, color: WT.sub, marginTop: 2 }}>{m.text}</Text>
              </View>
            </FadeIn>
          ))}
        </View>
      )}
      {n.next_milestone && (
        <FadeIn style={[c.card, { padding: 14, backgroundColor: "rgba(212,162,76,0.06)", borderColor: "rgba(212,162,76,0.2)" }]}>
          <Text style={{ fontSize: 10, fontWeight: "700", color: WT.gold, textTransform: "uppercase", marginBottom: 4 }}>Tu siguiente milestone</Text>
          <Text style={{ fontSize: 13, color: WT.text }}>{n.next_milestone}</Text>
        </FadeIn>
      )}
    </Stage>
  );
}

// 9 — Tus logros
function ScreenLogros({ data, total, page, nextLabel }: ScreenProps) {
  const a = data.achievements;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Tus logros</Text>
      <Text style={[c.h1, { fontSize: 22, marginTop: 4, marginBottom: 18 }]}>{a.total_unlocked} / {a.total_available} desbloqueados</Text>
      {a.unlocked_this_month.length > 0 ? (
        <View style={{ gap: 10, marginBottom: 12 }}>
          <Text style={{ fontSize: 10, fontWeight: "700", color: WT.accentL, textTransform: "uppercase" }}>Este mes desbloqueaste</Text>
          {a.unlocked_this_month.map((ach) => (
            <FadeIn key={ach.id} style={[st.secondaryCard, { backgroundColor: "rgba(0,185,109,0.10)", borderColor: "rgba(0,185,109,0.32)" }]}>
              <View style={secondaryIcon(WT.accentL)}><Text style={{ fontSize: 17 }}>{ach.icon}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "900", fontSize: 13, color: WT.accentL }}>{ach.name}</Text>
                <Text style={{ fontSize: 11, color: WT.sub }}>{ach.description}</Text>
              </View>
            </FadeIn>
          ))}
        </View>
      ) : (
        <EmptyState emoji="🏆" text="Ningún logro nuevo este mes — seguí activo para desbloquear el siguiente." />
      )}
      {a.next_achievement && (
        <FadeIn style={[c.card, { padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }]}>
          <Text style={{ fontSize: 18, opacity: 0.5 }}>{a.next_achievement.icon}</Text>
          <View>
            <Text style={{ fontSize: 9, fontWeight: "700", color: WT.muted, textTransform: "uppercase" }}>Tu próximo logro</Text>
            <Text style={{ fontWeight: "800", fontSize: 13, color: WT.text }}>{a.next_achievement.name}</Text>
          </View>
        </FadeIn>
      )}
    </Stage>
  );
}

// 10 — Investor Share Card
function ScreenCompartir({ data }: { data: MonthlyReportData }) {
  const s = data.share_card;
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = !!s.avatar_url && !avatarFailed;
  const returnColor = (s.return_pct ?? 0) >= 0 ? WT.accentL : WT.coral;
  const moveColor = s.best_position && s.best_position.move_pct >= 0 ? WT.accentL : WT.coral;

  const stats: { label: string; value: string; sub?: string }[] = [];
  if (s.best_position) {
    stats.push({ label: "Acción que más subió", value: s.best_position.ticker, sub: fmtPct(s.best_position.move_pct) });
  }
  stats.push({ label: "Decisiones tomadas", value: String(s.decisions_count) });
  stats.push({ label: "Empresas investigadas", value: String(s.companies_researched) });
  if (s.archetype_name) {
    stats.push({ label: "Tu personalidad de inversor", value: s.archetype_name });
  }

  return (
    <Stage page={10} total={10} noChrome>
      <View style={{ borderRadius: 26, borderWidth: 1.5, borderColor: "rgba(0,232,135,0.18)", backgroundColor: "rgba(9,15,31,0.65)", alignItems: "center", padding: 18 }}>
        <Image source={LOGO} style={{ width: 46, height: 46, borderRadius: 13, marginBottom: 10 }} />
        <Text style={{ fontWeight: "700", fontSize: 10, color: WT.accentL, letterSpacing: 1.5, textTransform: "uppercase" }}>{s.month_label}</Text>
        <Text style={{ fontWeight: "700", fontSize: 13, color: WT.sub, marginTop: 4 }}>MY MONTHLY REPORT</Text>

        {/* Hero card — avatar + portfolio return % + open-position count.
            Diego, 2026-09-08: explicit, confirmed exception to "never show
            return on the Share Card" — this IS the point of the redesign. */}
        <View style={{ width: "100%", borderRadius: 20, borderWidth: 1, borderColor: "rgba(0,185,109,0.32)", backgroundColor: "rgba(0,185,109,0.10)", alignItems: "center", padding: 20, marginTop: 16 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: WT.accentL, padding: 3, marginBottom: 12 }}>
            {showAvatar ? (
              <Image source={{ uri: s.avatar_url as string }} onError={() => setAvatarFailed(true)} style={{ width: "100%", height: "100%", borderRadius: 25 }} />
            ) : (
              <View style={{ width: "100%", height: "100%", borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: WT.card2 }}>
                <Text style={{ fontWeight: "800", fontSize: 18, color: WT.text }}>{initials(s.user_name)}</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 10, fontWeight: "700", color: WT.sub, textTransform: "uppercase", marginBottom: 6 }}>Rendimiento del mes</Text>
          {s.return_pct !== null ? (
            <Text style={{ fontWeight: "900", fontSize: 32, color: returnColor, marginBottom: 8 }}>{fmtPct(s.return_pct)}</Text>
          ) : (
            <Text style={{ fontSize: 13, color: WT.sub, marginBottom: 8 }}>Sin datos todavía</Text>
          )}
          <Text style={{ fontSize: 12, color: WT.sub }}>
            <Text style={{ color: WT.text, fontWeight: "800" }}>{s.positions_count}</Text> {s.positions_count === 1 ? "posición" : "posiciones"}
          </Text>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, width: "100%", marginTop: 16 }}>
          {stats.map((stat) => (
            <View key={stat.label} style={[shareStat(WT.accentL), { flex: 1, minWidth: "45%" }]}>
              <Text style={{ fontSize: 9, color: WT.muted, textTransform: "uppercase" }}>{stat.label}</Text>
              <Text style={{ fontWeight: "800", fontSize: 12, color: WT.text, marginTop: 4 }}>{stat.value}</Text>
              {stat.sub && <Text style={{ fontSize: 11, fontWeight: "700", color: moveColor, marginTop: 2 }}>{stat.sub}</Text>}
            </View>
          ))}
        </View>

        {s.achievement && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, backgroundColor: WT.card2, borderWidth: 1, borderColor: WT.border, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ fontSize: 15 }}>{s.achievement.icon}</Text>
            <Text style={{ fontWeight: "700", fontSize: 12, color: WT.text }}>Achievement unlocked: {s.achievement.name}</Text>
          </View>
        )}

        <Text style={{ fontWeight: "700", fontSize: 11, color: WT.muted, letterSpacing: 1, marginTop: 16 }}>NUVOS · DECIDE MEJOR.</Text>
      </View>
    </Stage>
  );
}

const SCREENS = [
  ScreenPortada, ScreenPortafolio, ScreenDecisiones, ScreenInvestigacion,
  ScreenPatrimonio, ScreenHabitos, ScreenEvolucion, ScreenProximoMes, ScreenLogros,
] as const;

const NEXT_TEASERS = [
  "Tu portafolio 📊", "Tus decisiones 🎯", "Empresas investigadas 🔍",
  "Tu patrimonio 💼", "Tu constancia 🔥", "Tu evolución 📈",
  "Tu próximo mes 🎯", "Tus logros 🏆", "Tu tarjeta para compartir 🎉",
] as const;

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export default function MonthlyReportScreen() {
  const { t } = useTranslation();
  const [{ year, month }, setYearMonth] = useState(currentYearMonth);
  const [data, setData] = useState<MonthlyReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [premiumLocked, setPremiumLocked] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [sharing, setSharing] = useState(false);
  const shareRef = useRef<View>(null);

  const load = (y: number, m: number) => {
    setLoading(true);
    setError(null);
    setPremiumLocked(null);
    api.get("/api/monthly-report", { params: { year: y, month: m }, timeout: 30000 })
      .then((r) => setData(r.data))
      .catch((e) => {
        const detail = e?.response?.data?.detail;
        if (e?.response?.status === 403 && detail?.code === "premium_required") {
          setPremiumLocked(detail.message);
        } else {
          setError(String(detail ?? e?.response?.status ?? e?.message ?? t("monthlyReport.unknownError")));
        }
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(year, month); setIndex(0); }, [year, month]);
  useEffect(() => { posthog.capture("monthly_report_opened", { year, month }); }, [year, month]);

  const total = SCREENS.length + 1;
  const isLast = index === SCREENS.length;
  const next = () => setIndex((i) => Math.min(i + 1, SCREENS.length));
  const prev = () => setIndex((i) => Math.max(i - 1, 0));

  useEffect(() => {
    if (loading || !data?.available) return;
    if (isLast) posthog.capture("monthly_report_share_card_viewed", { year, month });
    else posthog.capture("monthly_report_section_viewed", { year, month, section: index });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, isLast, loading]);

  const now = currentYearMonth();
  const canGoNext = year < now.year || (year === now.year && month < now.month);

  const navigateMonth = (direction: 1 | -1) => {
    let newMonth = month + direction;
    let newYear = year;
    if (newMonth < 1) { newMonth = 12; newYear -= 1; }
    if (newMonth > 12) { newMonth = 1; newYear += 1; }
    setYearMonth({ year: newYear, month: newMonth });
  };

  const handleShare = async () => {
    if (!shareRef.current) return;
    setSharing(true);
    posthog.capture("monthly_report_share_clicked", { year, month });
    try {
      const uri = await captureRef(shareRef, { format: "png", quality: 1 });
      posthog.capture("monthly_report_share_generated", { year, month });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Nuvos Monthly Report" });
        posthog.capture("monthly_report_share_downloaded", { year, month });
      }
    } catch {
      // user cancelled the share sheet, or capture failed — not fatal
    } finally {
      setSharing(false);
    }
  };

  if (loading) return (
    <View style={ldg.container}>
      <ActivityIndicator color={WT.accentL} size="large" />
      <Text style={ldg.text}>{t("monthlyReport.loadingText")}</Text>
    </View>
  );

  if (premiumLocked) return (
    <View style={ldg.container}>
      <Text style={{ fontSize: 34, marginBottom: 6 }}>🔒</Text>
      <Text style={[ldg.text, { fontWeight: "800", color: WT.text, fontSize: 16 }]}>{t("monthlyReport.premiumTitle")}</Text>
      <Text style={{ color: "#9ca3af", fontSize: 13, marginTop: 6, textAlign: "center", paddingHorizontal: 32 }}>{premiumLocked}</Text>
      <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
        <Text style={{ color: WT.accentL, fontSize: 14 }}>{t("monthlyReport.back")}</Text>
      </TouchableOpacity>
    </View>
  );

  if (!data || error) return (
    <View style={ldg.container}>
      <Text style={ldg.text}>{t("monthlyReport.loadFailedText")}</Text>
      {error && <Text style={{ color: "#ef4444", fontSize: 12, marginTop: 8, textAlign: "center", paddingHorizontal: 32 }}>{error}</Text>}
      <TouchableOpacity onPress={() => load(year, month)} style={{ marginTop: 16 }}>
        <Text style={{ color: WT.accentL, fontSize: 14 }}>{t("monthlyReport.retry")}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 10 }}>
        <Text style={{ color: "#6b7280", fontSize: 13 }}>{t("monthlyReport.back")}</Text>
      </TouchableOpacity>
    </View>
  );

  if (!data.available) return (
    <View style={ldg.container}>
      <Text style={{ fontSize: 34, marginBottom: 12 }}>{month === now.month && year === now.year ? "🌱" : "📅"}</Text>
      <Text style={[ldg.text, { fontWeight: "800", color: WT.text, fontSize: 16, textAlign: "center", paddingHorizontal: 32 }]}>
        {data.reason === "before_account_inception" ? "Todavía no existías en Nuvos" : "Tu Monthly Report está tomando forma"}
      </Text>
      <Text style={{ color: "#9ca3af", fontSize: 13, marginTop: 8, textAlign: "center", paddingHorizontal: 32 }}>
        {data.reason === "before_account_inception"
          ? "Este mes es anterior a tu primera inversión con Nuvos."
          : "No tenemos suficiente actividad todavía. Sigue aprendiendo y tomando decisiones en Nuvos."}
      </Text>
      <View style={{ flexDirection: "row", gap: 14, marginTop: 18 }}>
        {canGoNext && (
          <TouchableOpacity onPress={() => navigateMonth(1)}>
            <Text style={{ color: WT.accentL, fontSize: 14 }}>{t("monthlyReport.nextMonth")}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ color: "#6b7280", fontSize: 13 }}>{t("monthlyReport.back")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={root.container}>
      <SafeAreaView style={root.progressWrap}>
        <View style={root.progressRow}>
          {Array.from({ length: total }).map((_, i) => (
            <View key={i} style={[root.progressBar, { backgroundColor: i <= index ? WT.accentL : "rgba(255,255,255,0.18)" }]} />
          ))}
        </View>
      </SafeAreaView>

      <TouchableOpacity style={root.closeBtn} onPress={() => router.back()}>
        <Text style={root.closeTxt}>✕</Text>
      </TouchableOpacity>

      {index === 0 && canGoNext && (
        <View style={root.navRow}>
          <View />
          <TouchableOpacity style={root.navBtn} onPress={() => navigateMonth(1)}>
            <Text style={root.closeTxt}>›</Text>
          </TouchableOpacity>
        </View>
      )}
      {index === 0 && (
        <View style={[root.navRow, { justifyContent: "flex-start" }]}>
          <TouchableOpacity style={root.navBtn} onPress={() => navigateMonth(-1)}>
            <Text style={root.closeTxt}>‹</Text>
          </TouchableOpacity>
        </View>
      )}

      {isLast ? (
        <View ref={shareRef} collapsable={false} style={{ flex: 1 }}>
          <ScreenCompartir data={data} />
        </View>
      ) : (
        (() => {
          const Comp = SCREENS[index];
          return <Comp data={data} total={total} page={index + 1} nextLabel={NEXT_TEASERS[index]} />;
        })()
      )}

      {isLast && (
        <View style={root.shareRow}>
          <TouchableOpacity onPress={handleShare} disabled={sharing} style={root.shareBtn} activeOpacity={0.85}>
            {sharing ? <ActivityIndicator color="#062a1a" size="small" /> : <Text style={root.shareBtnText}>Compartir mi Investor Personality ✨</Text>}
          </TouchableOpacity>
        </View>
      )}

      <View style={root.tapZones} pointerEvents="box-none">
        <TouchableOpacity style={{ width: "35%" }} onPress={prev} activeOpacity={1} />
        <View style={{ width: "30%" }} />
        <TouchableOpacity style={{ width: "35%" }} onPress={isLast ? undefined : next} activeOpacity={1} disabled={isLast} />
      </View>
    </View>
  );
}

const c = StyleSheet.create({
  eyebrow: { fontWeight: "700", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: WT.accentL, textAlign: "center" },
  h1: { fontWeight: "900", color: WT.text, textAlign: "center" },
  body: { fontSize: 14, color: WT.text, lineHeight: 20 },
  emptyText: { fontSize: 13, color: WT.sub, textAlign: "center", lineHeight: 19 },
  card: { backgroundColor: WT.card, borderWidth: 1, borderColor: WT.border, borderRadius: 20 },
});

const st = StyleSheet.create({
  glow: { position: "absolute", width: 340, height: 340, borderRadius: 170, backgroundColor: "rgba(0,185,109,0.10)" },
  brandRow: { position: "absolute", top: 54, left: 20, flexDirection: "row", alignItems: "center", gap: 8, zIndex: 5 },
  brandLogo: { width: 26, height: 26, borderRadius: 8 },
  brandName: { color: WT.text, fontWeight: "800", fontSize: 13 },
  pageCounter: { position: "absolute", top: 58, right: 20, color: WT.muted, fontWeight: "600", fontSize: 12, zIndex: 5 },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 20, paddingTop: 96, paddingBottom: 90 },
  nextWrap: { position: "absolute", bottom: 44, left: 0, right: 0, alignItems: "center" },
  nextLabel: { color: WT.accentL, fontWeight: "700", fontSize: 10, letterSpacing: 1, textTransform: "uppercase" },
  nextText: { color: WT.sub, fontWeight: "600", fontSize: 12, marginTop: 2 },
  footer: { position: "absolute", bottom: 20, left: 0, right: 0, textAlign: "center", color: WT.dim, fontWeight: "600", fontSize: 10, letterSpacing: 1 },
  heroLabel: { fontWeight: "700", fontSize: 11, color: WT.sub, marginBottom: 3 },
  heroValue: { fontWeight: "900", fontSize: 20 },
  secondaryCard: { backgroundColor: WT.card, borderWidth: 1, borderColor: WT.border, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 12, padding: 13 },
});

const heroCard = (accent: string): any => ({ borderRadius: 20, padding: 16, backgroundColor: `${accent}1f`, borderWidth: 1, borderColor: `${accent}55` });
const heroIcon = (accent: string): any => ({ width: 30, height: 30, borderRadius: 10, backgroundColor: `${accent}22`, alignItems: "center", justifyContent: "center", marginBottom: 8 });
const secondaryIcon = (accent: string): any => ({ width: 36, height: 36, borderRadius: 18, backgroundColor: `${accent}1f`, alignItems: "center", justifyContent: "center" });
const shareStat = (accent: string): any => ({ backgroundColor: WT.card2, borderWidth: 1, borderColor: `${accent}4a`, borderRadius: 16, padding: 12 });

const ldg = StyleSheet.create({
  container: { flex: 1, backgroundColor: WT.bg, alignItems: "center", justifyContent: "center", gap: 16 },
  text: { color: "#9ca3af", fontSize: 14 },
});

const root = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  progressWrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 },
  progressRow: { flexDirection: "row", gap: 4, paddingHorizontal: 16, paddingTop: 30 },
  progressBar: { flex: 1, height: 3, borderRadius: 2 },
  closeBtn: { position: "absolute", top: 56, right: 16, zIndex: 30, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10, width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  closeTxt: { color: "#fff", fontSize: 14, fontWeight: "700" },
  navRow: { position: "absolute", top: 94, left: 0, right: 0, zIndex: 20, flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16 },
  navBtn: { backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10, width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  shareRow: { position: "absolute", bottom: 24, left: 20, right: 20, zIndex: 20 },
  shareBtn: { paddingVertical: 15, borderRadius: 100, backgroundColor: WT.accentL, alignItems: "center", justifyContent: "center" },
  shareBtnText: { color: "#062a1a", fontWeight: "900", fontSize: 14 },
  tapZones: { position: "absolute", top: 90, bottom: 90, left: 0, right: 0, flexDirection: "row" },
});
