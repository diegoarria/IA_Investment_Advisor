"use client";

import { useState } from "react";
import Stage from "./Stage";
import { WT, WrappedData, fmtPct, fmtUsd, topStrength } from "./types";
import { apiBase } from "@/lib/apiBase";

const H1: React.CSSProperties = { fontWeight: 900, color: WT.text, letterSpacing: -0.5, textAlign: "center", lineHeight: 1.05 };
const EYEBROW: React.CSSProperties = { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: WT.accentL, textAlign: "center", marginBottom: 6 };
const CARD: React.CSSProperties = { background: WT.card, border: `1px solid ${WT.border}`, borderRadius: 20 };
const EMPTY_TEXT: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 13, color: WT.sub, textAlign: "center", lineHeight: 1.5 };

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

/** Empty state shared by every screen when its one real metric isn't
 * available yet — never invents a number, just says so warmly. Keeps the
 * screen count fixed at 8 no matter how new/inactive the account is. */
function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div style={{ ...CARD, padding: "28px 22px", textAlign: "center" }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{emoji}</div>
      <p style={EMPTY_TEXT}>{text}</p>
    </div>
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
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "contain", background: "#fff", padding: size * 0.12, border: `1px solid ${WT.border}`, flexShrink: 0 }}
    />
  );
}

type ScreenProps = { data: WrappedData; total: number; page: number };

// 1 — Personalidad como inversionista
export function ScreenPersonalidad({ data, total, page }: ScreenProps) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = !!data.avatar_url && !avatarFailed;
  const a = data.archetype;
  return (
    <Stage page={page} total={total} glow="top">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: WT.gradGreen, padding: 3, marginBottom: 14, boxShadow: "0 0 34px rgba(0,185,109,0.35)" }}>
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
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, color: WT.text, marginBottom: 4 }}>{data.user_name}</div>
        <div style={EYEBROW}>Tu {data.year} como inversionista</div>
        <h1 style={{ ...H1, fontSize: 20, marginTop: 4, marginBottom: 22 }}>Este año fuiste...</h1>

        {a ? (
          <div style={{ ...CARD, padding: "26px 20px", background: "linear-gradient(160deg, rgba(0,185,109,0.14), rgba(9,15,31,0.4))", borderColor: "rgba(0,185,109,0.32)", width: "100%" }}>
            <div style={{ fontWeight: 900, fontSize: 24, color: WT.accentL, letterSpacing: 0.5, marginBottom: 10 }}>{a.name}</div>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: WT.text, lineHeight: 1.5, margin: 0 }}>&ldquo;{a.tagline}&rdquo;</p>
          </div>
        ) : (
          <EmptyState emoji="🌱" text="Todavía estamos conociendo tu estilo — necesitamos un poco más de actividad para definir tu personalidad." />
        )}
      </div>
    </Stage>
  );
}

// 2 — Tu año en números
export function ScreenNumeros({ data, total, page }: ScreenProps) {
  const metrics: { emoji: string; label: string; value: string }[] = [];
  if (data.portfolio_value > 0) metrics.push({ emoji: "💰", label: "Valor de tu portafolio", value: fmtUsd(data.portfolio_value) });
  if (data.growth_pct != null) metrics.push({ emoji: "📈", label: "Rendimiento", value: fmtPct(data.growth_pct) });
  if (data.companies_analyzed > 0) metrics.push({ emoji: "🏢", label: "Empresas analizadas", value: String(data.companies_analyzed) });
  if (data.arthur_conversations > 0) metrics.push({ emoji: "💬", label: "Hablaste con Arthur", value: `${data.arthur_conversations}×` });
  if (data.longest_streak) metrics.push({ emoji: "🔥", label: "Racha más larga", value: `${data.longest_streak} días` });
  metrics.push({ emoji: "⏱️", label: "Días activo en Nuvos", value: String(data.days_active) });

  return (
    <Stage page={page} total={total} glow="top">
      <div style={EYEBROW}>{data.year} en números</div>
      <h1 style={{ ...H1, fontSize: 24, marginBottom: 22 }}>Tu año, medido</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {metrics.map((m) => (
          <div key={m.label} style={{ ...CARD, padding: "14px 12px" }}>
            <div style={{ fontSize: 18, marginBottom: 6 }}>{m.emoji}</div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.sub, marginBottom: 2 }}>{m.label}</div>
            <div style={{ fontWeight: 800, fontSize: 17, color: WT.text }}>{m.value}</div>
          </div>
        ))}
      </div>
    </Stage>
  );
}

// 3 — Tu posición dentro de Nuvos
export function ScreenPercentil({ data, total, page }: ScreenProps) {
  const p = data.percentile;
  return (
    <Stage page={page} total={total} glow="center">
      <div style={EYEBROW}>Tu posición dentro de Nuvos</div>
      {p ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 56, color: WT.accentL, margin: "8px 0 4px" }}>TOP {Math.max(1, 100 - p.percentile)}%</div>
          <div style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 13, color: WT.text, letterSpacing: 1, marginBottom: 18 }}>NUVOS INVESTOR</div>
          <div style={{ ...CARD, padding: "14px 18px" }}>
            <p style={EMPTY_TEXT}>
              Estuviste entre el <span style={{ color: WT.accentL, fontWeight: 800 }}>{Math.max(1, 100 - p.percentile)}%</span> de usuarios más activos de Nuvos este año, entre {p.cohort_size} inversionistas con tu mismo perfil de riesgo.
            </p>
          </div>
        </div>
      ) : (
        <EmptyState emoji="📊" text="Todavía no hay suficientes datos de la comunidad con tu perfil de riesgo para calcular tu posición." />
      )}
    </Stage>
  );
}

// 4 — Tu empresa favorita
export function ScreenEmpresaFavorita({ data, total, page }: ScreenProps) {
  const [first, ...rest] = data.favorite_companies;
  const medals = ["#9aa7ba", "#b5743a"];
  return (
    <Stage page={page} total={total} glow="top">
      <div style={EYEBROW}>Tu empresa del año</div>
      {first ? (
        <>
          <h1 style={{ ...H1, fontSize: 20, marginBottom: 6 }}>Claramente tenías una favorita.</h1>
          <div style={{ ...CARD, display: "flex", alignItems: "center", gap: 16, padding: "18px 18px", marginTop: 16, background: "linear-gradient(160deg, rgba(212,162,76,0.12), rgba(9,15,31,0.4))", borderColor: "rgba(212,162,76,0.32)" }}>
            <TickerLogo ticker={first.ticker} size={54} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: 18, color: WT.text }}>{first.company_name || first.ticker}</div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub }}>{first.ticker}{first.in_portfolio ? " · en tu portafolio" : ""}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 20, color: WT.accentL }}>{first.times_analyzed}×</div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>analizada</div>
            </div>
          </div>
          {first.in_portfolio && first.weight_pct != null && (
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.muted, textAlign: "center", marginTop: 8 }}>
              {first.weight_pct}% de tu portafolio actual
            </div>
          )}

          {rest.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              {rest.map((f, i) => (
                <div key={f.ticker} style={{ ...CARD, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: medals[i], color: "#1a1206", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 10, flexShrink: 0 }}>{i + 2}º</div>
                  <TickerLogo ticker={f.ticker} size={28} />
                  <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13, color: WT.text }}>{f.company_name || f.ticker}</div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: WT.accentL }}>{f.times_analyzed}×</div>
                </div>
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
export function ScreenTopPosiciones({ data, total, page }: ScreenProps) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <Stage page={page} total={total} glow="top">
      <div style={EYEBROW}>Tus mejores movimientos</div>
      <h1 style={{ ...H1, fontSize: 20, marginBottom: 22 }}>Tus 3 posiciones que más crecieron</h1>
      {data.top_positions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.top_positions.map((p, i) => (
            <div key={p.ticker} style={{ ...CARD, display: "flex", alignItems: "center", gap: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 22, flexShrink: 0 }}>{medals[i]}</div>
              <TickerLogo ticker={p.ticker} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: WT.text }}>{p.company_name || p.ticker}</div>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.muted }}>{p.ticker}</div>
              </div>
              <div style={{ fontWeight: 900, fontSize: 20, color: WT.accentL, flexShrink: 0 }}>{fmtPct(p.return_pct)}</div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState emoji="📈" text="Aún no tienes posiciones en tu portafolio para mostrar aquí." />
      )}
    </Stage>
  );
}

// 6 — Tu peor decisión
export function ScreenPeorDecision({ data, total, page }: ScreenProps) {
  const w = data.worst_decision;
  return (
    <Stage page={page} total={total} glow="bottom">
      <div style={EYEBROW}>Todos tenemos una.</div>
      <h1 style={{ ...H1, fontSize: 20, marginBottom: 22 }}>Tu peor decisión de {data.year}</h1>
      {w ? (
        <div style={{ ...CARD, padding: "22px 20px", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 14 }}>
            <TickerLogo ticker={w.ticker} size={34} />
            <span style={{ fontWeight: 800, fontSize: 16, color: WT.text }}>{w.company_name || w.ticker}</span>
          </div>
          <div style={{ fontWeight: 900, fontSize: 32, color: WT.coral }}>{fmtUsd(w.pnl)}</div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, marginTop: 4 }}>
            {fmtPct(w.pnl_pct)} {w.realized ? "· posición cerrada" : "· todavía sin vender"}
          </div>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${WT.border}` }}>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.muted, textTransform: "uppercase", letterSpacing: 1 }}>Valor de la lección</div>
            <div style={{ fontWeight: 900, fontSize: 26, color: WT.accentL }}>∞</div>
          </div>
        </div>
      ) : (
        <EmptyState emoji="✨" text="Este año no tuviste ninguna pérdida registrada — bien hecho." />
      )}
    </Stage>
  );
}

// 7 — Tu tipo de inversionista
export function ScreenTipoInversionista({ data, total, page }: ScreenProps) {
  const t = data.investor_type;
  return (
    <Stage page={page} total={total} glow="top">
      <div style={EYEBROW}>Tu tipo de inversionista</div>
      {t ? (
        <div style={{ ...CARD, padding: "30px 22px", textAlign: "center", background: "linear-gradient(160deg, rgba(0,185,109,0.12), rgba(9,15,31,0.4))", borderColor: "rgba(0,185,109,0.3)" }}>
          <div style={{ fontSize: 46, marginBottom: 12 }}>{t.emoji}</div>
          <div style={{ fontWeight: 900, fontSize: 22, color: WT.text, letterSpacing: 0.5, marginBottom: 10 }}>{t.name}</div>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: WT.sub, lineHeight: 1.5, margin: 0 }}>&ldquo;{t.tagline}&rdquo;</p>
        </div>
      ) : (
        <EmptyState emoji="🎲" text="Necesitamos un poco más de historial para descubrir tu tipo de inversionista." />
      )}
    </Stage>
  );
}

// 8 — Tarjeta para compartir (9:16)
export function ScreenCompartir({ data }: { data: WrappedData }) {
  const strength = topStrength(data.investor_score);
  const topPct = data.percentile ? Math.max(1, 100 - data.percentile.percentile) : null;
  return (
    <Stage page={8} total={8} noChrome>
      <div style={{ position: "absolute", inset: 20, borderRadius: 26, background: "linear-gradient(165deg, rgba(9,15,31,0.75) 0%, rgba(3,6,14,0.6) 55%, rgba(9,15,31,0.75) 100%)", border: "1.5px solid rgba(0,232,135,0.18)" }} />
      <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 10px 10px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Nuvos AI" crossOrigin="anonymous" style={{ width: 30, height: 30, borderRadius: 8, marginBottom: 8 }} />
        <span style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 10, color: WT.accentL, letterSpacing: 1.5, textTransform: "uppercase" }}>Nuvos Wrapped {data.year}</span>

        {data.archetype && (
          <div style={{ fontWeight: 900, fontSize: 22, color: WT.text, marginTop: 10, textAlign: "center" }}>{data.archetype.name}</div>
        )}
        {topPct != null && (
          <div style={{ fontWeight: 900, fontSize: 40, color: WT.accentL, filter: "drop-shadow(0 0 20px rgba(0,232,135,0.4))", margin: "6px 0 2px" }}>TOP {topPct}%</div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%", maxWidth: 300, marginTop: 16 }}>
          {data.portfolio_value > 0 && (
            <div style={{ ...CARD, padding: "10px 12px" }}>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted }}>💰 Portafolio</div>
              <div style={{ fontWeight: 800, fontSize: 15, color: WT.text }}>{fmtUsd(data.portfolio_value)}</div>
            </div>
          )}
          {data.growth_pct != null && (
            <div style={{ ...CARD, padding: "10px 12px" }}>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted }}>📈 Rendimiento</div>
              <div style={{ fontWeight: 800, fontSize: 15, color: WT.accentL }}>{fmtPct(data.growth_pct)}</div>
            </div>
          )}
          {data.companies_analyzed > 0 && (
            <div style={{ ...CARD, padding: "10px 12px" }}>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted }}>🏢 Analizadas</div>
              <div style={{ fontWeight: 800, fontSize: 15, color: WT.text }}>{data.companies_analyzed}</div>
            </div>
          )}
          {data.arthur_conversations > 0 && (
            <div style={{ ...CARD, padding: "10px 12px" }}>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted }}>💬 Con Arthur</div>
              <div style={{ fontWeight: 800, fontSize: 15, color: WT.text }}>{data.arthur_conversations}×</div>
            </div>
          )}
        </div>

        {strength && (
          <div style={{ marginTop: 18, textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted, textTransform: "uppercase", letterSpacing: 1 }}>Tu mayor fortaleza</div>
            <div style={{ fontWeight: 900, fontSize: 18, color: WT.gold }}>{strength.toUpperCase()}</div>
          </div>
        )}

        <p style={{ fontWeight: 800, fontSize: 14, color: WT.text, marginTop: 20 }}>¿Cuál eres tú?</p>
        <p style={{ fontWeight: 800, fontSize: 13, color: WT.text, marginTop: 2 }}>NUVOS <span style={{ color: WT.accentL }}>AI</span></p>
      </div>
    </Stage>
  );
}
