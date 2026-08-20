"use client";

import { useState } from "react";
import { Building2, MessageCircle } from "lucide-react";
import Stage from "./Stage";
import { WT, WrappedData, fmtPct, fmtUsd, topStrength } from "./types";
import { apiBase } from "@/lib/apiBase";
import { useCountUp } from "./useCountUp";

const H1: React.CSSProperties = { fontWeight: 900, color: WT.text, letterSpacing: -0.5, textAlign: "center", lineHeight: 1.05 };
const EYEBROW: React.CSSProperties = { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: WT.accentL, textAlign: "center", marginBottom: 6 };
const CARD: React.CSSProperties = { background: WT.card, border: `1px solid ${WT.border}`, borderRadius: 20 };
const EMPTY_TEXT: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 13, color: WT.sub, textAlign: "center", lineHeight: 1.5 };

// ScreenCompartir's 3-stat row — bigger, icon-on-top layout so the numbers
// actually read at a glance instead of squeezing a label+value pair into a
// tiny box (Diego, 2026-08-20: "un diseño muchísimo mejor").
const SHARE_STAT_CARD: React.CSSProperties = {
  background: WT.card2, border: `1px solid ${WT.border}`, borderRadius: 18,
  minHeight: 116, padding: "16px 8px",
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  textAlign: "center", width: "100%",
};
const SHARE_STAT_VALUE: React.CSSProperties = { fontWeight: 900, fontSize: 20, color: WT.text, marginTop: 6 };
const SHARE_STAT_LABEL: React.CSSProperties = {
  fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 10, color: WT.muted,
  textTransform: "uppercase", letterSpacing: 0.5, marginTop: 3,
};

type RevealAnim = "animate-fade-in-up" | "animate-fade-in-up-glow" | "animate-scale-in" | "animate-slide-left";

// ScreenNumeros — portfolio value + rendimiento get their own bigger,
// color-coded "hero" cards (they're the two numbers people actually came
// for); everything else is a denser row-style secondary card below, instead
// of 6 identically-sized boxes competing for attention (Diego, 2026-08-20:
// "mejora el diseño de las cajas... mucho más bueno").
function heroStatCard(accentHex: string): React.CSSProperties {
  return {
    borderRadius: 22, padding: "18px 16px",
    background: `linear-gradient(160deg, ${accentHex}26 0%, ${WT.card} 65%)`,
    border: `1px solid ${accentHex}55`,
  };
}
function heroStatIcon(accentHex: string): React.CSSProperties {
  return {
    width: 34, height: 34, borderRadius: 11, background: `${accentHex}22`,
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, marginBottom: 10,
  };
}
const HERO_STAT_LABEL: React.CSSProperties = {
  fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 11, color: WT.sub, marginBottom: 3,
};
const HERO_STAT_VALUE: React.CSSProperties = { fontWeight: 900, fontSize: 22, letterSpacing: -0.3 };

const SECONDARY_STAT_CARD: React.CSSProperties = {
  ...CARD, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
};
function secondaryStatIcon(accentHex: string): React.CSSProperties {
  return {
    width: 38, height: 38, borderRadius: "50%", background: `${accentHex}1f`,
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0,
  };
}

// ScreenCompartir's 3-stat row — same color-coded-badge language as
// ScreenNumeros' hero/secondary cards, sized for a 3-column share card
// instead of plain identical boxes (Diego, 2026-08-20: "mismo caso para
// la pantalla 8").
function shareStatCard(accentHex: string): React.CSSProperties {
  return {
    ...SHARE_STAT_CARD,
    background: `linear-gradient(165deg, ${accentHex}24 0%, ${WT.card2} 70%)`,
    border: `1px solid ${accentHex}4a`,
  };
}
function shareStatIconBadge(accentHex: string): React.CSSProperties {
  return {
    width: 32, height: 32, borderRadius: 10, background: `${accentHex}28`,
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
  };
}

/** Reveals an element on mount, staggered by `delay` — every screen is a
 * fresh component instance each time the user navigates to it, so this
 * naturally replays on every visit, not just the first. The single
 * building block behind every screen's "entrance" choreography
 * (Diego, 2026-08-20: "textos... de entrada que sean atractivos"). Only
 * ONE `anim` class per element — a plain className list can't layer two
 * independently-timed CSS animations (the later stylesheet rule simply
 * wins), so a "glow after entrance" look uses the combined
 * animate-fade-in-up-glow keyframe set instead of stacking classes. */
function Reveal({ delay = 0, anim = "animate-fade-in-up", style, children }: { delay?: number; anim?: RevealAnim; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <div className={anim} style={{ opacity: 0, animationDelay: `${delay}ms`, animationFillMode: "both", ...style }}>
      {children}
    </div>
  );
}

/** Same call shape as Reveal (so a component can switch between the two
 * with one variable), but renders already at its final, fully-visible
 * state — no animation, no opacity:0 base. html2canvas doesn't execute
 * CSS animations on the DOM it captures; it reads inline styles literally,
 * so every Reveal-wrapped element (opacity:0 inline, made visible only by
 * a running keyframe animation) came out invisible in the exported PNG —
 * confirmed live, 2026-08-2x: the downloaded Wrapped card was blank below
 * the logo. ScreenCompartir's off-screen capture clone (WrappedFlow.tsx)
 * uses this instead of Reveal for exactly that reason; the on-screen
 * preview instance still uses real Reveal for the entrance flourish. */
function StaticReveal({ style, children }: { delay?: number; anim?: RevealAnim; style?: React.CSSProperties; children: React.ReactNode }) {
  return <div style={style}>{children}</div>;
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

/** Empty state shared by every screen when its one real metric isn't
 * available yet — never invents a number, just says so warmly. Keeps the
 * screen count fixed at 8 no matter how new/inactive the account is. */
function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <Reveal delay={200} style={{ ...CARD, padding: "28px 22px", textAlign: "center" }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{emoji}</div>
      <p style={EMPTY_TEXT}>{text}</p>
    </Reveal>
  );
}

// Company logo — proxied through our own backend (GET /api/logo/:ticker,
// see backend/app/api/routes/logo.py), plain <img crossOrigin> (not
// next/image) so html2canvas's useCORS export can actually paint it.
// Fetching parqet.com directly used to fail outright (not just for canvas
// export): it never sends Access-Control-Allow-Origin, so a crossOrigin
// fetch of it is rejected by the browser before the image ever renders —
// confirmed live, 2026-08-20, every logo on this screen fell back to
// initials for every user. Our own domain's CORSMiddleware (main.py)
// covers this endpoint automatically.
function TickerLogo({ ticker, size }: { ticker: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const src = `${apiBase()}/api/logo/${ticker.replace(".", "-")}`;
  if (failed) {
    return (
      <div style={{ width: size, height: size, borderRadius: "50%", background: WT.card2, border: `1px solid ${WT.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: size * 0.34, color: WT.sub, flexShrink: 0 }}>
        {ticker.slice(0, 2)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={ticker}
      crossOrigin="anonymous"
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "contain", background: "#fff", border: `1px solid ${WT.border}`, flexShrink: 0 }}
    />
  );
}

type ScreenProps = {
  data: WrappedData;
  total: number;
  page: number;
  /** Curiosity-driving teaser for the screen that comes right after this
   * one — see Stage's nextLabel prop. Omitted on the last content screen. */
  nextLabel?: string;
};

// 1 — Personalidad como inversionista
export function ScreenPersonalidad({ data, total, page, nextLabel }: ScreenProps) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = !!data.avatar_url && !avatarFailed;
  const a = data.archetype;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <Reveal delay={0} anim="animate-scale-in" style={{ width: 72, height: 72, borderRadius: "50%", background: WT.gradGreen, padding: 3, marginBottom: 14, boxShadow: "0 0 34px rgba(0,185,109,0.35)" }}>
          {showAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.avatar_url as string}
              alt={data.user_name}
              crossOrigin="anonymous"
              onError={() => setAvatarFailed(true)}
              style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: WT.card2, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 24, color: WT.text }}>
              {initials(data.user_name)}
            </div>
          )}
        </Reveal>
        <Reveal delay={180} style={{ fontWeight: 700, fontSize: 15, color: WT.text, marginBottom: 4 }}>{data.user_name}</Reveal>
        <Reveal delay={260} style={EYEBROW}>Tu {data.year} como inversionista</Reveal>
        <Reveal delay={340}><h1 style={{ ...H1, fontSize: 20, marginTop: 4, marginBottom: 22 }}>Este año fuiste...</h1></Reveal>

        {a ? (
          <Reveal delay={520} anim="animate-fade-in-up-glow" style={{ ...CARD, padding: "26px 20px", background: "linear-gradient(160deg, rgba(0,185,109,0.14), rgba(9,15,31,0.4))", borderColor: "rgba(0,185,109,0.32)", width: "100%" }}>
            <div style={{ fontWeight: 900, fontSize: 24, color: WT.accentL, letterSpacing: 0.5, marginBottom: 10 }}>{a.name}</div>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: WT.text, lineHeight: 1.5, margin: 0 }}>&ldquo;{a.tagline}&rdquo;</p>
          </Reveal>
        ) : (
          <EmptyState emoji="🌱" text="Todavía estamos conociendo tu estilo — necesitamos un poco más de actividad para definir tu personalidad." />
        )}
      </div>
    </Stage>
  );
}

// 2 — Tu año en números
export function ScreenNumeros({ data, total, page, nextLabel }: ScreenProps) {
  const secondary: { emoji: string; label: string; value: string; accent: string }[] = [];
  if (data.companies_analyzed > 0) secondary.push({ emoji: "🏢", label: "Empresas analizadas", value: String(data.companies_analyzed), accent: WT.teal });
  if (data.arthur_conversations > 0) secondary.push({ emoji: "💬", label: "Hablaste con Arthur", value: `${data.arthur_conversations}×`, accent: WT.gold });
  if (data.longest_streak) secondary.push({ emoji: "🔥", label: "Racha más larga", value: `${data.longest_streak} días`, accent: WT.coral });
  secondary.push({ emoji: "⏱️", label: "Días activo en Nuvos", value: String(data.days_active), accent: WT.accentL });

  const animatedPortfolio = useCountUp(data.portfolio_value, 1000, 2);
  const animatedGrowth = useCountUp(data.growth_pct ?? 0, 1000, 2);
  const growthColor = (data.growth_pct ?? 0) >= 0 ? WT.accentL : WT.coral;

  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Reveal delay={0} style={EYEBROW}>{data.year} en números</Reveal>
      <Reveal delay={100}><h1 style={{ ...H1, fontSize: 24, marginBottom: 22 }}>Tu año, medido</h1></Reveal>

      {(data.portfolio_value > 0 || data.growth_pct != null) && (
        <div style={{ display: "grid", gridTemplateColumns: data.portfolio_value > 0 && data.growth_pct != null ? "1fr 1fr" : "1fr", gap: 10, marginBottom: 10 }}>
          {data.portfolio_value > 0 && (
            <Reveal delay={240} anim="animate-fade-in-up-glow" style={heroStatCard(WT.accentL)}>
              <div style={heroStatIcon(WT.accentL)}>💰</div>
              <div style={HERO_STAT_LABEL}>Valor de tu portafolio</div>
              <div style={{ ...HERO_STAT_VALUE, color: WT.text }}>{fmtUsd(animatedPortfolio)}</div>
            </Reveal>
          )}
          {data.growth_pct != null && (
            <Reveal delay={340} anim="animate-fade-in-up-glow" style={heroStatCard(growthColor)}>
              <div style={heroStatIcon(growthColor)}>📈</div>
              <div style={HERO_STAT_LABEL}>Rendimiento</div>
              <div style={{ ...HERO_STAT_VALUE, color: growthColor }}>{fmtPct(animatedGrowth)}</div>
            </Reveal>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {secondary.map((m, i) => (
          <Reveal key={m.label} delay={480 + i * 100} anim="animate-slide-left" style={SECONDARY_STAT_CARD}>
            <div style={secondaryStatIcon(m.accent)}>{m.emoji}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.sub }}>{m.label}</div>
              <div style={{ fontWeight: 800, fontSize: 16, color: WT.text }}>{m.value}</div>
            </div>
          </Reveal>
        ))}
      </div>
    </Stage>
  );
}

// 3 — Tu posición dentro de Nuvos
export function ScreenPercentil({ data, total, page, nextLabel }: ScreenProps) {
  const p = data.percentile;
  const topPct = p ? Math.max(1, 100 - p.percentile) : 0;
  const animatedTop = useCountUp(topPct, 1100);
  return (
    <Stage page={page} total={total} glow="center" nextLabel={nextLabel}>
      <Reveal delay={0} style={EYEBROW}>Tu posición dentro de Nuvos</Reveal>
      {p ? (
        <div style={{ textAlign: "center" }}>
          <Reveal delay={150} anim="animate-scale-in" style={{ fontWeight: 900, fontSize: 56, color: WT.accentL, margin: "8px 0 4px", filter: "drop-shadow(0 0 26px rgba(0,232,135,0.45))" }}>
            TOP {animatedTop}%
          </Reveal>
          <Reveal delay={550} style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 13, color: WT.text, letterSpacing: 1, marginBottom: 18 }}>NUVOS INVESTOR</Reveal>
          <Reveal delay={700} style={{ ...CARD, padding: "14px 18px" }}>
            <p style={EMPTY_TEXT}>
              Estuviste entre el <span style={{ color: WT.accentL, fontWeight: 800 }}>{topPct}%</span> de usuarios más activos de Nuvos este año, entre {p.cohort_size} inversionistas con tu mismo perfil de riesgo.
            </p>
          </Reveal>
        </div>
      ) : (
        <EmptyState emoji="📊" text="Todavía no hay suficientes datos de la comunidad con tu perfil de riesgo para calcular tu posición." />
      )}
    </Stage>
  );
}

// 4 — Tu empresa favorita
export function ScreenEmpresaFavorita({ data, total, page, nextLabel }: ScreenProps) {
  const [first, ...rest] = data.favorite_companies;
  const medals = ["#9aa7ba", "#b5743a"];
  const animatedTimes = useCountUp(first?.times_analyzed ?? 0, 900);
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Reveal delay={0} style={EYEBROW}>Tu empresa del año</Reveal>
      {first ? (
        <>
          <Reveal delay={100}><h1 style={{ ...H1, fontSize: 20, marginBottom: 6 }}>Claramente tenías una favorita.</h1></Reveal>
          <Reveal delay={280} anim="animate-fade-in-up-glow" style={{ ...CARD, display: "flex", alignItems: "center", gap: 16, padding: "18px 18px", marginTop: 16, background: "linear-gradient(160deg, rgba(212,162,76,0.12), rgba(9,15,31,0.4))", borderColor: "rgba(212,162,76,0.32)" }}>
            <TickerLogo ticker={first.ticker} size={54} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: 18, color: WT.text }}>{first.company_name || first.ticker}</div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub }}>{first.ticker}{first.in_portfolio ? " · en tu portafolio" : ""}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 20, color: WT.accentL }}>{animatedTimes}×</div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>analizada</div>
            </div>
          </Reveal>
          {first.in_portfolio && first.weight_pct != null && (
            <Reveal delay={550} style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.muted, textAlign: "center", marginTop: 8 }}>
              {first.weight_pct}% de tu portafolio actual
            </Reveal>
          )}

          {rest.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              {rest.map((f, i) => (
                <Reveal key={f.ticker} delay={650 + i * 130} anim="animate-slide-left" style={{ ...CARD, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: medals[i], color: "#1a1206", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 10, flexShrink: 0 }}>{i + 2}º</div>
                  <TickerLogo ticker={f.ticker} size={28} />
                  <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13, color: WT.text }}>{f.company_name || f.ticker}</div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: WT.accentL }}>{f.times_analyzed}×</div>
                </Reveal>
              ))}
            </div>
          )}
        </>
      ) : (
        <EmptyState emoji="🔎" text="Aún no analizaste suficientes empresas este año para tener una favorita clara." />
      )}
    </Stage>
  );
}

// 5 — Tus 3 posiciones que más crecieron
export function ScreenTopPosiciones({ data, total, page, nextLabel }: ScreenProps) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Reveal delay={0} style={EYEBROW}>Tus mejores movimientos</Reveal>
      <Reveal delay={100}><h1 style={{ ...H1, fontSize: 20, marginBottom: 22 }}>Tus 3 posiciones que más crecieron</h1></Reveal>
      {data.top_positions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.top_positions.map((p, i) => (
            <Reveal key={p.ticker} delay={260 + i * 160} anim="animate-slide-left" style={{ ...CARD, display: "flex", alignItems: "center", gap: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 22, flexShrink: 0 }}>{medals[i]}</div>
              <TickerLogo ticker={p.ticker} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: WT.text }}>{p.company_name || p.ticker}</div>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.muted }}>{p.ticker}</div>
              </div>
              <div style={{ fontWeight: 900, fontSize: 20, color: WT.accentL, flexShrink: 0 }}>{fmtPct(p.return_pct)}</div>
            </Reveal>
          ))}
        </div>
      ) : (
        <EmptyState emoji="📈" text="Aún no tienes posiciones en tu portafolio para mostrar aquí." />
      )}
    </Stage>
  );
}

// 6 — Tu peor decisión
export function ScreenPeorDecision({ data, total, page, nextLabel }: ScreenProps) {
  const w = data.worst_decision;
  const animatedPnl = useCountUp(w?.pnl ?? 0, 1000, 2);
  return (
    <Stage page={page} total={total} glow="bottom" nextLabel={nextLabel}>
      <Reveal delay={0} style={EYEBROW}>Todos tenemos una.</Reveal>
      <Reveal delay={100}><h1 style={{ ...H1, fontSize: 20, marginBottom: 22 }}>Tu peor decisión de {data.year}</h1></Reveal>
      {w ? (
        <Reveal delay={260} anim="animate-scale-in" style={{ ...CARD, padding: "22px 20px", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 14 }}>
            <TickerLogo ticker={w.ticker} size={34} />
            <span style={{ fontWeight: 800, fontSize: 16, color: WT.text }}>{w.company_name || w.ticker}</span>
          </div>
          <div style={{ fontWeight: 900, fontSize: 32, color: WT.coral }}>{fmtUsd(animatedPnl)}</div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, marginTop: 4 }}>
            {fmtPct(w.pnl_pct)} {w.realized ? "· posición cerrada" : "· todavía sin vender"}
          </div>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${WT.border}` }}>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.muted, textTransform: "uppercase", letterSpacing: 1 }}>Valor de la lección</div>
            <div className="animate-pulse-glow" style={{ fontWeight: 900, fontSize: 26, color: WT.accentL, display: "inline-block", borderRadius: 8 }}>∞</div>
          </div>
        </Reveal>
      ) : (
        <EmptyState emoji="✨" text="Este año no tuviste ninguna pérdida registrada — bien hecho." />
      )}
    </Stage>
  );
}

// 7 — Tu tipo de inversionista
export function ScreenTipoInversionista({ data, total, page, nextLabel }: ScreenProps) {
  const t = data.investor_type;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel}>
      <Reveal delay={0} style={EYEBROW}>Tu tipo de inversionista</Reveal>
      {t ? (
        <Reveal delay={200} anim="animate-scale-in" style={{ ...CARD, padding: "30px 22px", textAlign: "center", background: "linear-gradient(160deg, rgba(0,185,109,0.12), rgba(9,15,31,0.4))", borderColor: "rgba(0,185,109,0.3)" }}>
          <div className="animate-float" style={{ fontSize: 46, marginBottom: 12 }}>{t.emoji}</div>
          <div style={{ fontWeight: 900, fontSize: 22, color: WT.text, letterSpacing: 0.5, marginBottom: 10 }}>{t.name}</div>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: WT.sub, lineHeight: 1.5, margin: 0 }}>&ldquo;{t.tagline}&rdquo;</p>
        </Reveal>
      ) : (
        <EmptyState emoji="🎲" text="Necesitamos un poco más de historial para descubrir tu tipo de inversionista." />
      )}
    </Stage>
  );
}

// 8 — Tarjeta para compartir (9:16)
export function ScreenCompartir({ data, staticMode }: { data: WrappedData; staticMode?: boolean }) {
  const strength = topStrength(data.investor_score);
  const topGrower = data.top_positions[0] || null;
  const animatedGrowth = useCountUp(data.growth_pct ?? 0, 1100, 2);
  const growthColor = (data.growth_pct ?? 0) >= 0 ? WT.accentL : WT.coral;
  const growerColor = topGrower && topGrower.return_pct >= 0 ? WT.accentL : WT.coral;
  const R = staticMode ? StaticReveal : Reveal;
  return (
    <Stage page={8} total={8} noChrome>
      <div style={{ position: "absolute", inset: 20, borderRadius: 26, background: "linear-gradient(165deg, rgba(9,15,31,0.75) 0%, rgba(3,6,14,0.6) 55%, rgba(9,15,31,0.75) 100%)", border: "1.5px solid rgba(0,232,135,0.18)" }} />
      <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 10px 10px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Nuvos AI" crossOrigin="anonymous" style={{ width: 58, height: 58, borderRadius: 15, marginBottom: 10 }} className="animate-fade-in" />
        <R delay={100} style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 10, color: WT.accentL, letterSpacing: 1.5, textTransform: "uppercase" }}>Nuvos Wrapped {data.year}</R>

        {data.archetype && (
          <R delay={220} style={{ fontWeight: 900, fontSize: 22, color: WT.text, marginTop: 10, textAlign: "center" }}>{data.archetype.name}</R>
        )}
        {data.growth_pct != null && (
          <>
            <R delay={320} style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 11, color: WT.muted, textTransform: "uppercase", letterSpacing: 1, marginTop: 8 }}>
              Rendimiento de tu portafolio {data.year}
            </R>
            <R delay={380} anim="animate-scale-in" style={{ fontWeight: 900, fontSize: 40, color: growthColor, filter: `drop-shadow(0 0 22px ${growthColor}73)`, margin: "2px 0 2px" }}>
              {fmtPct(animatedGrowth)}
            </R>
          </>
        )}

        {/* Deliberately no $ portfolio amount here — this screen is meant
            to be shared to social media, and Diego doesn't want to force
            a real dollar figure onto everyone's feed (2026-08-20). */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, width: "100%", maxWidth: 360, marginTop: 20 }}>
          {data.companies_analyzed > 0 && (
            <R delay={600} anim="animate-scale-in" style={shareStatCard(WT.teal)}>
              <div style={shareStatIconBadge(WT.teal)}><Building2 size={16} color={WT.teal} /></div>
              <div style={SHARE_STAT_VALUE}>{data.companies_analyzed}</div>
              <div style={SHARE_STAT_LABEL}>Analizadas</div>
            </R>
          )}
          {data.arthur_conversations > 0 && (
            <R delay={720} anim="animate-scale-in" style={shareStatCard(WT.gold)}>
              <div style={shareStatIconBadge(WT.gold)}><MessageCircle size={16} color={WT.gold} /></div>
              <div style={SHARE_STAT_VALUE}>{data.arthur_conversations}×</div>
              <div style={SHARE_STAT_LABEL}>Con Arthur</div>
            </R>
          )}
          {topGrower && (
            <R delay={840} anim="animate-scale-in" style={shareStatCard(growerColor)}>
              <TickerLogo ticker={topGrower.ticker} size={30} />
              <div style={{ fontWeight: 800, fontSize: 11, color: WT.text, lineHeight: 1.3, marginTop: 10, width: "100%", textAlign: "center", overflowWrap: "break-word" }}>
                {topGrower.company_name || topGrower.ticker}
              </div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted, marginTop: 3 }}>{topGrower.ticker}</div>
              <div style={{ fontWeight: 800, fontSize: 14, color: growerColor, marginTop: 2 }}>{fmtPct(topGrower.return_pct)}</div>
            </R>
          )}
        </div>

        {strength && (
          <R delay={1000} style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
            <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 24px", borderRadius: 100, background: `${WT.gold}1f`, border: `1px solid ${WT.gold}55` }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted, textTransform: "uppercase", letterSpacing: 1 }}>Tu mayor fortaleza</span>
              <span style={{ fontWeight: 900, fontSize: 17, color: WT.gold }}>{strength.toUpperCase()}</span>
            </div>
          </R>
        )}

        <R delay={1150} style={{ fontWeight: 800, fontSize: 14, color: WT.text, marginTop: 20, textAlign: "center" }}>
          <p style={{ margin: 0 }}>¿Cuál eres tú?</p>
          <p style={{ fontWeight: 800, fontSize: 13, color: WT.text, marginTop: 2 }}>NUVOS <span style={{ color: WT.accentL }}>AI</span></p>
        </R>
      </div>
    </Stage>
  );
}
