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

const LOGO = require("../assets/images/logo_new.png");

// Diego, 2026-08-30: this screen used to be its own, much older 5-slide
// design reading fields (top_stocks, lessons, top_sector, growth_pct at the
// top level, milestones_this_year...) that GET /api/wrapped/annual hasn't
// returned in a long time — the real response shape is exactly WrappedData
// below, the same one web's wrapped/page.tsx + components/wrapped/*.tsx
// already use. Rebuilt to match web's real 8 screens 1:1 — same content,
// same order, same copy (Wrapped is Spanish-only on web too, no i18n, by
// the same deliberate design choice kept here) — so mobile and web actually
// show the same thing instead of two different, drifted experiences.

// ── Real data shape (matches backend/app/api/routes/wrapped.py exactly,
//    same as web's components/wrapped/types.ts) ──────────────────────────
interface WrappedArchetype { key: string; name: string; tagline: string; traits: string[] }
interface WrappedInvestorType { key: string; emoji: string; name: string; tagline: string }
interface WrappedInvestorScore { score: number; sub_scores: Record<string, number> }
interface WrappedPercentile { percentile: number; cohort_size: number }
interface WrappedFavoriteCompany { ticker: string; company_name?: string | null; times_analyzed: number; in_portfolio: boolean; weight_pct?: number | null }
interface WrappedTopPosition { ticker: string; company_name?: string | null; return_pct: number; invested: number; current_value: number }
interface WrappedWorstDecision { ticker: string; company_name?: string | null; pnl: number; pnl_pct: number; realized: boolean }

interface WrappedData {
  year: number;
  user_name: string;
  avatar_url?: string | null;
  archetype?: WrappedArchetype | null;
  investor_type?: WrappedInvestorType | null;
  portfolio_value: number;
  growth_pct?: number | null;
  companies_analyzed: number;
  arthur_conversations: number;
  longest_streak?: number | null;
  days_active: number;
  percentile?: WrappedPercentile | null;
  favorite_companies: WrappedFavoriteCompany[];
  top_positions: WrappedTopPosition[];
  worst_decision?: WrappedWorstDecision | null;
  investor_score?: WrappedInvestorScore | null;
}

const WT = {
  bg: "#03060e", card: "#090f1f", card2: "#0d1526",
  border: "#162035", borderS: "#1e2e48",
  text: "#eef2ff", sub: "#8fa3c0", muted: "#546b85", dim: "#2a3f58",
  accent: "#00b96d", accentL: "#00e887",
  gold: "#D4A24C", coral: "#DD6E63", teal: "#4FA695",
};

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

const SCORE_LABELS: Record<string, string> = {
  educacion: "Educación", paciencia: "Paciencia", diversificacion: "Diversificación", analisis: "Análisis",
};
function topStrength(score: WrappedInvestorScore | null | undefined): string | null {
  if (!score || !Object.keys(score.sub_scores).length) return null;
  const [key] = Object.entries(score.sub_scores).sort((a, b) => b[1] - a[1])[0];
  return SCORE_LABELS[key] || key;
}

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
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, []);
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
      // React Native's <Image> can't render SVG at all — this backend's
      // default response is SVG (fine for web's <img>), so ?format=png is
      // required here or every logo silently falls back to initials.
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

// ── Shared full-bleed chrome every screen sits inside — mirrors web's Stage
//    component: brand top-left, page counter top-right, glow, "sigue"
//    teaser, footer tagline. ────────────────────────────────────────────
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
      {!noChrome && (
        <Text style={st.footer}>NUVOS AI · TU AÑO COMO INVERSIONISTA</Text>
      )}
    </View>
  );
}

// ── 8 real screens, same order/content as web's components/wrapped/screens.tsx ──

function ScreenPersonalidad({ data, total, page, nextLabel }: ScreenProps) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = !!data.avatar_url && !avatarFailed;
  const a = data.archetype;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <View style={{ alignItems: "center" }}>
        <FadeIn style={st.avatarRing}>
          {showAvatar ? (
            <Image source={{ uri: data.avatar_url as string }} onError={() => setAvatarFailed(true)} style={st.avatarImg} />
          ) : (
            <View style={[st.avatarImg, { alignItems: "center", justifyContent: "center", backgroundColor: WT.card2 }]}>
              <Text style={{ fontWeight: "800", fontSize: 24, color: WT.text }}>{initials(data.user_name)}</Text>
            </View>
          )}
        </FadeIn>
        <FadeIn style={{ marginTop: 14 }}><Text style={{ fontWeight: "700", fontSize: 15, color: WT.text }}>{data.user_name}</Text></FadeIn>
        <FadeIn style={{ marginTop: 4 }}><Text style={c.eyebrow}>Tu {data.year} como inversionista</Text></FadeIn>
        <FadeIn style={{ marginTop: 4, marginBottom: 22 }}><Text style={[c.h1, { fontSize: 20 }]}>Este año fuiste...</Text></FadeIn>

        {a ? (
          <FadeIn style={[c.card, { width: "100%", padding: 24, backgroundColor: "rgba(0,185,109,0.10)", borderColor: "rgba(0,185,109,0.32)" }]}>
            <Text style={{ fontWeight: "900", fontSize: 24, color: WT.accentL, marginBottom: 10 }}>{a.name}</Text>
            <Text style={c.body}>&ldquo;{a.tagline}&rdquo;</Text>
          </FadeIn>
        ) : (
          <EmptyState emoji="🌱" text="Todavía estamos conociendo tu estilo — necesitamos un poco más de actividad para definir tu personalidad." />
        )}
      </View>
    </Stage>
  );
}

function ScreenNumeros({ data, total, page, nextLabel }: ScreenProps) {
  const secondary: { emoji: string; label: string; value: string; accent: string }[] = [];
  if (data.companies_analyzed > 0) secondary.push({ emoji: "🏢", label: "Empresas analizadas", value: String(data.companies_analyzed), accent: WT.teal });
  if (data.arthur_conversations > 0) secondary.push({ emoji: "💬", label: "Hablaste con Arthur", value: `${data.arthur_conversations}×`, accent: WT.gold });
  if (data.longest_streak) secondary.push({ emoji: "🔥", label: "Racha más larga", value: `${data.longest_streak} días`, accent: WT.coral });
  secondary.push({ emoji: "⏱️", label: "Días activo en Nuvos", value: String(data.days_active), accent: WT.accentL });

  const animatedPortfolio = useCountUp(data.portfolio_value, 1000, 2);
  const animatedGrowth = useCountUp(data.growth_pct ?? 0, 1000, 2);
  const growthColor = (data.growth_pct ?? 0) >= 0 ? WT.accentL : WT.coral;
  const showHero = data.portfolio_value > 0 || data.growth_pct != null;

  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>{data.year} en números</Text>
      <Text style={[c.h1, { fontSize: 24, marginTop: 4, marginBottom: 20 }]}>Tu año, medido</Text>

      {showHero && (
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
          {data.portfolio_value > 0 && (
            <FadeIn style={[heroCard(WT.accentL), { flex: 1 }]}>
              <View style={heroIcon(WT.accentL)}><Text style={{ fontSize: 15 }}>💰</Text></View>
              <Text style={st.heroLabel}>Valor de tu portafolio</Text>
              <Text style={[st.heroValue, { color: WT.text }]}>{fmtUsd(animatedPortfolio)}</Text>
            </FadeIn>
          )}
          {data.growth_pct != null && (
            <FadeIn style={[heroCard(growthColor), { flex: 1 }]}>
              <View style={heroIcon(growthColor)}><Text style={{ fontSize: 15 }}>📈</Text></View>
              <Text style={st.heroLabel}>Rendimiento</Text>
              <Text style={[st.heroValue, { color: growthColor }]}>{fmtPct(animatedGrowth)}</Text>
            </FadeIn>
          )}
        </View>
      )}

      <View style={{ gap: 8 }}>
        {secondary.map((m) => (
          <FadeIn key={m.label} style={st.secondaryCard}>
            <View style={secondaryIcon(m.accent)}><Text style={{ fontSize: 15 }}>{m.emoji}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: WT.sub }}>{m.label}</Text>
              <Text style={{ fontWeight: "800", fontSize: 16, color: WT.text }}>{m.value}</Text>
            </View>
          </FadeIn>
        ))}
      </View>
    </Stage>
  );
}

function ScreenPercentil({ data, total, page, nextLabel }: ScreenProps) {
  const p = data.percentile;
  const topPct = p ? Math.max(1, 100 - p.percentile) : 0;
  const animatedTop = useCountUp(topPct, 1100);
  return (
    <Stage page={page} total={total} glow="center" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Tu posición dentro de Nuvos</Text>
      {p ? (
        <View style={{ alignItems: "center", marginTop: 8 }}>
          <FadeIn><Text style={{ fontWeight: "900", fontSize: 52, color: WT.accentL, marginVertical: 6 }}>TOP {animatedTop}%</Text></FadeIn>
          <FadeIn><Text style={{ fontWeight: "700", fontSize: 13, color: WT.text, letterSpacing: 1, marginBottom: 18 }}>NUVOS INVESTOR</Text></FadeIn>
          <FadeIn style={[c.card, { padding: 16 }]}>
            <Text style={c.emptyText}>
              Estuviste entre el <Text style={{ color: WT.accentL, fontWeight: "800" }}>{topPct}%</Text> de usuarios más activos de Nuvos este año, entre {p.cohort_size} inversionistas con tu mismo perfil de riesgo.
            </Text>
          </FadeIn>
        </View>
      ) : (
        <EmptyState emoji="📊" text="Todavía no hay suficientes datos de la comunidad con tu perfil de riesgo para calcular tu posición." />
      )}
    </Stage>
  );
}

function ScreenEmpresaFavorita({ data, total, page, nextLabel }: ScreenProps) {
  const [first, ...rest] = data.favorite_companies;
  const medals = ["#9aa7ba", "#b5743a"];
  const animatedTimes = useCountUp(first?.times_analyzed ?? 0, 900);
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Tu empresa del año</Text>
      {first ? (
        <>
          <Text style={[c.h1, { fontSize: 20, marginTop: 4, marginBottom: 6 }]}>Claramente tenías una favorita.</Text>
          <FadeIn style={[c.card, { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, marginTop: 14, backgroundColor: "rgba(212,162,76,0.10)", borderColor: "rgba(212,162,76,0.32)" }]}>
            <TickerLogo ticker={first.ticker} size={50} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "900", fontSize: 17, color: WT.text }}>{first.company_name || first.ticker}</Text>
              <Text style={{ fontSize: 12, color: WT.sub }}>{first.ticker}{first.in_portfolio ? " · en tu portafolio" : ""}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontWeight: "800", fontSize: 20, color: WT.accentL }}>{animatedTimes}×</Text>
              <Text style={{ fontSize: 9, color: WT.muted }}>analizada</Text>
            </View>
          </FadeIn>
          {first.in_portfolio && first.weight_pct != null && (
            <Text style={{ fontSize: 11, color: WT.muted, textAlign: "center", marginTop: 8 }}>{first.weight_pct}% de tu portafolio actual</Text>
          )}
          {rest.length > 0 && (
            <View style={{ gap: 8, marginTop: 14 }}>
              {rest.map((f, i) => (
                <FadeIn key={f.ticker} style={[c.card, { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }]}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: medals[i], alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#1a1206", fontWeight: "800", fontSize: 10 }}>{i + 2}º</Text>
                  </View>
                  <TickerLogo ticker={f.ticker} size={26} />
                  <Text style={{ flex: 1, fontWeight: "700", fontSize: 13, color: WT.text }}>{f.company_name || f.ticker}</Text>
                  <Text style={{ fontWeight: "800", fontSize: 13, color: WT.accentL }}>{f.times_analyzed}×</Text>
                </FadeIn>
              ))}
            </View>
          )}
        </>
      ) : (
        <EmptyState emoji="🔎" text="Aún no analizaste suficientes empresas este año para tener una favorita clara." />
      )}
    </Stage>
  );
}

function ScreenTopPosiciones({ data, total, page, nextLabel }: ScreenProps) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Tus mejores movimientos</Text>
      <Text style={[c.h1, { fontSize: 20, marginTop: 4, marginBottom: 20 }]}>Tus 3 posiciones que más crecieron</Text>
      {data.top_positions.length > 0 ? (
        <View style={{ gap: 10 }}>
          {data.top_positions.map((p, i) => (
            <FadeIn key={p.ticker} style={[c.card, { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }]}>
              <Text style={{ fontSize: 20 }}>{medals[i]}</Text>
              <TickerLogo ticker={p.ticker} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 15, color: WT.text }}>{p.company_name || p.ticker}</Text>
                <Text style={{ fontSize: 11, color: WT.muted }}>{p.ticker}</Text>
              </View>
              <Text style={{ fontWeight: "900", fontSize: 19, color: WT.accentL }}>{fmtPct(p.return_pct)}</Text>
            </FadeIn>
          ))}
        </View>
      ) : (
        <EmptyState emoji="📈" text="Aún no tienes posiciones en tu portafolio para mostrar aquí." />
      )}
    </Stage>
  );
}

function ScreenPeorDecision({ data, total, page, nextLabel }: ScreenProps) {
  const w = data.worst_decision;
  const animatedPnl = useCountUp(w?.pnl ?? 0, 1000, 2);
  return (
    <Stage page={page} total={total} glow="bottom" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Todos tenemos una.</Text>
      <Text style={[c.h1, { fontSize: 20, marginTop: 4, marginBottom: 20 }]}>Tu peor decisión de {data.year}</Text>
      {w ? (
        <FadeIn style={[c.card, { padding: 20, alignItems: "center" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <TickerLogo ticker={w.ticker} size={32} />
            <Text style={{ fontWeight: "800", fontSize: 16, color: WT.text }}>{w.company_name || w.ticker}</Text>
          </View>
          <Text style={{ fontWeight: "900", fontSize: 30, color: WT.coral }}>{fmtUsd(animatedPnl)}</Text>
          <Text style={{ fontSize: 12, color: WT.sub, marginTop: 4 }}>
            {fmtPct(w.pnl_pct)} {w.realized ? "· posición cerrada" : "· todavía sin vender"}
          </Text>
          <View style={{ marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: WT.border, alignItems: "center" }}>
            <Text style={{ fontSize: 10, color: WT.muted, textTransform: "uppercase", letterSpacing: 1 }}>Valor de la lección</Text>
            <Text style={{ fontWeight: "900", fontSize: 24, color: WT.accentL }}>∞</Text>
          </View>
        </FadeIn>
      ) : (
        <EmptyState emoji="✨" text="Este año no tuviste ninguna pérdida registrada — bien hecho." />
      )}
    </Stage>
  );
}

function ScreenTipoInversionista({ data, total, page, nextLabel }: ScreenProps) {
  const t = data.investor_type;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Text style={c.eyebrow}>Tu tipo de inversionista</Text>
      {t ? (
        <FadeIn style={[c.card, { padding: 28, alignItems: "center", marginTop: 8, backgroundColor: "rgba(0,185,109,0.10)", borderColor: "rgba(0,185,109,0.3)" }]}>
          <Text style={{ fontSize: 44, marginBottom: 12 }}>{t.emoji}</Text>
          <Text style={{ fontWeight: "900", fontSize: 22, color: WT.text, marginBottom: 10 }}>{t.name}</Text>
          <Text style={c.body}>&ldquo;{t.tagline}&rdquo;</Text>
        </FadeIn>
      ) : (
        <EmptyState emoji="🎲" text="Necesitamos un poco más de historial para descubrir tu tipo de inversionista." />
      )}
    </Stage>
  );
}

function ScreenCompartir({ data }: { data: WrappedData }) {
  const strength = topStrength(data.investor_score);
  const topGrower = data.top_positions[0] || null;
  const animatedGrowth = useCountUp(data.growth_pct ?? 0, 1100, 2);
  const growthColor = (data.growth_pct ?? 0) >= 0 ? WT.accentL : WT.coral;
  const growerColor = topGrower && topGrower.return_pct >= 0 ? WT.accentL : WT.coral;
  return (
    <Stage page={8} total={8} noChrome>
      <View style={{ borderRadius: 26, borderWidth: 1.5, borderColor: "rgba(0,232,135,0.18)", backgroundColor: "rgba(9,15,31,0.65)", alignItems: "center", padding: 18 }}>
        <Image source={LOGO} style={{ width: 54, height: 54, borderRadius: 15, marginBottom: 10 }} />
        <Text style={{ fontWeight: "700", fontSize: 10, color: WT.accentL, letterSpacing: 1.5, textTransform: "uppercase" }}>Nuvos Wrapped {data.year}</Text>

        {data.archetype && <Text style={{ fontWeight: "900", fontSize: 21, color: WT.text, marginTop: 10, textAlign: "center" }}>{data.archetype.name}</Text>}
        {data.growth_pct != null && (
          <>
            <Text style={{ fontSize: 11, color: WT.muted, textTransform: "uppercase", letterSpacing: 1, marginTop: 8 }}>Rendimiento de tu portafolio {data.year}</Text>
            <Text style={{ fontWeight: "900", fontSize: 38, color: growthColor, marginVertical: 2 }}>{fmtPct(animatedGrowth)}</Text>
          </>
        )}

        <View style={{ flexDirection: "row", gap: 8, width: "100%", marginTop: 18 }}>
          {data.companies_analyzed > 0 && (
            <View style={[shareStat(WT.teal), { flex: 1 }]}>
              <View style={shareBadge(WT.teal)}><Text>🏢</Text></View>
              <Text style={st.shareValue}>{data.companies_analyzed}</Text>
              <Text style={st.shareLabel}>Analizadas</Text>
            </View>
          )}
          {data.arthur_conversations > 0 && (
            <View style={[shareStat(WT.gold), { flex: 1 }]}>
              <View style={shareBadge(WT.gold)}><Text>💬</Text></View>
              <Text style={st.shareValue}>{data.arthur_conversations}×</Text>
              <Text style={st.shareLabel}>Con Arthur</Text>
            </View>
          )}
          {topGrower && (
            <View style={[shareStat(growerColor), { flex: 1 }]}>
              <TickerLogo ticker={topGrower.ticker} size={28} />
              <Text style={{ fontWeight: "800", fontSize: 10, color: WT.text, marginTop: 8, textAlign: "center" }}>{topGrower.company_name || topGrower.ticker}</Text>
              <Text style={{ fontWeight: "800", fontSize: 13, color: growerColor, marginTop: 2 }}>{fmtPct(topGrower.return_pct)}</Text>
            </View>
          )}
        </View>

        {strength && (
          <View style={{ marginTop: 14, paddingHorizontal: 20, paddingVertical: 9, borderRadius: 100, backgroundColor: `${WT.gold}1f`, borderWidth: 1, borderColor: `${WT.gold}55`, alignItems: "center" }}>
            <Text style={{ fontSize: 9, color: WT.muted, textTransform: "uppercase", letterSpacing: 1 }}>Tu mayor fortaleza</Text>
            <Text style={{ fontWeight: "900", fontSize: 16, color: WT.gold }}>{strength.toUpperCase()}</Text>
          </View>
        )}

        <Text style={{ fontWeight: "800", fontSize: 14, color: WT.text, marginTop: 18, textAlign: "center" }}>¿Cuál eres tú?</Text>
        <Text style={{ fontWeight: "800", fontSize: 13, color: WT.text, marginTop: 2 }}>NUVOS <Text style={{ color: WT.accentL }}>AI</Text></Text>
      </View>
    </Stage>
  );
}

type ScreenProps = { data: WrappedData; total: number; page: number; nextLabel?: string };

const SCREENS = [
  ScreenPersonalidad, ScreenNumeros, ScreenPercentil, ScreenEmpresaFavorita,
  ScreenTopPosiciones, ScreenPeorDecision, ScreenTipoInversionista,
] as const;

const NEXT_TEASERS = [
  "Tu año, medido 📊", "¿Qué tan arriba estás? 🏆", "Tu empresa favorita 🏢",
  "Tus mejores jugadas 📈", "Tu peor decisión 😬", "¿Qué tipo de inversionista eres? 🎯",
  "Tu tarjeta para compartir 🎉",
] as const;

export default function WrappedScreen() {
  const { t } = useTranslation();
  const [data, setData] = useState<WrappedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [sharing, setSharing] = useState(false);
  const shareRef = useRef<View>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api.get("/api/wrapped/annual")
      .then((r) => setData(r.data))
      .catch((e) => {
        const msg = e?.response?.data?.detail ?? e?.response?.status ?? e?.message ?? t("wrapped.unknownError");
        setError(String(msg));
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const total = SCREENS.length + 1; // +1 for the always-shown Compartir closer
  const isLast = index === SCREENS.length;
  const next = () => setIndex((i) => Math.min(i + 1, SCREENS.length));
  const prev = () => setIndex((i) => Math.max(i - 1, 0));

  const handleShare = async () => {
    if (!shareRef.current) return;
    setSharing(true);
    try {
      const uri = await captureRef(shareRef, { format: "png", quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Nuvos AI Investor Wrapped" });
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
      <Text style={ldg.text}>{t("wrapped.loadingText")}</Text>
    </View>
  );

  if (!data) return (
    <View style={ldg.container}>
      <Text style={ldg.text}>{t("wrapped.loadFailedText")}</Text>
      {error && <Text style={{ color: "#ef4444", fontSize: 12, marginTop: 8, textAlign: "center", paddingHorizontal: 32 }}>{error}</Text>}
      <TouchableOpacity onPress={load} style={{ marginTop: 16 }}>
        <Text style={{ color: WT.accentL, fontSize: 14 }}>{t("wrapped.retry")}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 10 }}>
        <Text style={{ color: "#6b7280", fontSize: 13 }}>{t("wrapped.back")}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={root.container}>
      {/* Progress bars */}
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
            {sharing ? <ActivityIndicator color="#062a1a" size="small" /> : <Text style={root.shareBtnText}>Compartir mi Wrapped ✨</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* Tap zones — 35%/35% left/right, same asymmetric split as web
          (leaves the middle third free for the Compartir buttons to
          receive their own taps instead of being swallowed by "next"). */}
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

  avatarRing: { width: 72, height: 72, borderRadius: 36, backgroundColor: WT.accentL, padding: 3 },
  avatarImg: { width: "100%", height: "100%", borderRadius: 33 },

  heroLabel: { fontWeight: "700", fontSize: 11, color: WT.sub, marginBottom: 3 },
  heroValue: { fontWeight: "900", fontSize: 20 },

  secondaryCard: { backgroundColor: WT.card, borderWidth: 1, borderColor: WT.border, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 12, padding: 13 },

  shareValue: { fontWeight: "900", fontSize: 18, color: WT.text, marginTop: 6 },
  shareLabel: { fontWeight: "700", fontSize: 9, color: WT.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 },
});

// Color-parameterized styles — kept as plain functions, not StyleSheet.create
// entries (RN's StyleSheet.create can't type a function value alongside
// plain style objects without corrupting inference for every other key in
// the same sheet).
const heroCard = (accent: string): any => ({ borderRadius: 20, padding: 16, backgroundColor: `${accent}1f`, borderWidth: 1, borderColor: `${accent}55` });
const heroIcon = (accent: string): any => ({ width: 30, height: 30, borderRadius: 10, backgroundColor: `${accent}22`, alignItems: "center", justifyContent: "center", marginBottom: 8 });
const secondaryIcon = (accent: string): any => ({ width: 36, height: 36, borderRadius: 18, backgroundColor: `${accent}1f`, alignItems: "center", justifyContent: "center" });
const shareStat = (accent: string): any => ({ backgroundColor: WT.card2, borderWidth: 1, borderColor: `${accent}4a`, borderRadius: 16, minHeight: 100, padding: 12, alignItems: "center", justifyContent: "center" });
const shareBadge = (accent: string): any => ({ width: 28, height: 28, borderRadius: 9, backgroundColor: `${accent}28`, alignItems: "center", justifyContent: "center" });

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
  shareRow: { position: "absolute", bottom: 24, left: 20, right: 20, zIndex: 20 },
  shareBtn: { paddingVertical: 15, borderRadius: 100, backgroundColor: WT.accentL, alignItems: "center", justifyContent: "center" },
  shareBtnText: { color: "#062a1a", fontWeight: "900", fontSize: 14 },
  tapZones: { position: "absolute", top: 90, bottom: 90, left: 0, right: 0, flexDirection: "row" },
});
