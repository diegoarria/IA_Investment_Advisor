"use client";

import { useState } from "react";
import Stage from "./Stage";
import { WT, WrappedData, fmtPct, fmtUsd } from "./types";

const H1: React.CSSProperties = { fontWeight: 900, color: WT.text, letterSpacing: -0.5, textAlign: "center", lineHeight: 1.05 };
const EYEBROW: React.CSSProperties = { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: WT.accentL, textAlign: "center", marginBottom: 6 };
const CARD: React.CSSProperties = { background: WT.card, border: `1px solid ${WT.border}`, borderRadius: 20 };

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

// 1 — Portada
export function ScreenPortada({ data, total, page }: { data: WrappedData; total: number; page: number }) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = !!data.avatar_url && !avatarFailed;
  return (
    <Stage page={page} total={total} glow="top">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div style={{ width: 84, height: 84, borderRadius: "50%", background: WT.gradGreen, padding: 3, marginBottom: 18, boxShadow: "0 0 34px rgba(0,185,109,0.35)" }}>
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
            <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: WT.card2, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 28, color: WT.text }}>
              {initials(data.user_name)}
            </div>
          )}
        </div>
        <div style={{ fontWeight: 800, fontSize: 20, color: WT.text, marginBottom: 6 }}>{data.user_name}</div>
        <div style={EYEBROW}>Investor Wrapped {data.year}</div>
        <h1 style={{ ...H1, fontSize: 26, marginTop: 6 }}>Así se vio tu año<br />construyendo patrimonio</h1>
        {data.archetype && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 100, background: "rgba(0,185,109,0.1)", border: "1.5px solid rgba(0,185,109,0.35)", marginTop: 20 }}>
            <span style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 12, color: WT.accentL }}>{data.archetype.name}</span>
          </div>
        )}
      </div>
    </Stage>
  );
}

// 2 — Números
export function ScreenNumeros({ data, total, page }: { data: WrappedData; total: number; page: number }) {
  return (
    <Stage page={page} total={total} glow="top">
      <div style={EYEBROW}>{data.year} en números</div>
      <h1 style={{ ...H1, fontSize: 24, marginBottom: 24 }}>Tu año, medido</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {data.growth_pct !== undefined && (
          <div style={{ ...CARD, gridColumn: "1 / -1", padding: "18px 16px", background: "linear-gradient(135deg, rgba(0,185,109,0.12), rgba(0,232,135,0.04))", borderColor: "rgba(0,185,109,0.3)" }}>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, marginBottom: 4 }}>Rendimiento del año</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 34, color: WT.accentL }}>{fmtPct(data.growth_pct)}</div>
              {data.spy_ytd_pct !== undefined && data.spy_ytd_pct !== null && (
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub }}>
                  vs. <span style={{ fontWeight: 700, color: WT.text }}>{fmtPct(data.spy_ytd_pct)}</span> del S&amp;P 500
                </div>
              )}
            </div>
          </div>
        )}
        <div style={{ ...CARD, padding: "16px 14px" }}>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, marginBottom: 4 }}>Lecciones completadas</div>
          <div style={{ fontWeight: 800, fontSize: 24, color: WT.text }}>{data.lessons}</div>
        </div>
        <div style={{ ...CARD, padding: "16px 14px" }}>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, marginBottom: 4 }}>Sector principal</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: WT.text }}>
            {data.top_sector}
            {data.top_sector_pct != null && (
              <span style={{ fontWeight: 700, fontSize: 13, color: WT.accentL }}> · {data.top_sector_pct}%</span>
            )}
          </div>
        </div>
        <div style={{ ...CARD, gridColumn: "1 / -1", padding: "16px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: WT.card2 }}>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub }}>Días activo en Nuvos</div>
          <div style={{ fontWeight: 800, fontSize: 22, color: WT.text }}>{data.days_active}</div>
        </div>
      </div>
    </Stage>
  );
}

// 3 — Evolución
export function ScreenEvolucion({ data, total, page }: { data: WrappedData; total: number; page: number }) {
  const ev = data.evolution;
  if (!ev || ev.start_score === undefined || ev.end_score === undefined) return null;
  const pct = Math.max(0, Math.min(100, Number(ev.end_score)));
  return (
    <Stage page={page} total={total} glow="bottom">
      <div style={EYEBROW}>Tu evolución</div>
      <h1 style={{ ...H1, fontSize: 22, marginBottom: 40 }}>Tu madurez como inversionista</h1>
      <div style={{ height: 10, borderRadius: 100, background: WT.card2, border: `1px solid ${WT.border}`, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 100, background: WT.gradGreen }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted, textTransform: "uppercase", letterSpacing: 1 }}>Enero</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: WT.gold }}>{ev.start_score} / 100</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted, textTransform: "uppercase", letterSpacing: 1 }}>Diciembre</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: WT.accentL }}>{ev.end_score} / 100</div>
        </div>
      </div>
    </Stage>
  );
}

// 4 — Estilo
export function ScreenEstilo({ data, total, page }: { data: WrappedData; total: number; page: number }) {
  const a = data.archetype;
  if (!a) return null;
  return (
    <Stage page={page} total={total} glow="top">
      <div style={EYEBROW}>Tu personalidad financiera</div>
      <div style={{ ...CARD, marginTop: 16, padding: "26px 20px", textAlign: "center", background: "linear-gradient(160deg, rgba(0,185,109,0.14), rgba(9,15,31,0.4))", borderColor: "rgba(0,185,109,0.32)" }}>
        <div style={{ fontWeight: 900, fontSize: 22, color: WT.text, marginBottom: 6 }}>{a.name}</div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: WT.sub, marginBottom: 18 }}>{a.tagline}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, textAlign: "left" }}>
          {a.traits.map((tr) => (
            <div key={tr} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, color: WT.text }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: WT.accentL, flexShrink: 0 }} />
              {tr}
            </div>
          ))}
        </div>
      </div>
    </Stage>
  );
}

// 5 — Mejor decisión
export function ScreenMejorDecision({ data, total, page }: { data: WrappedData; total: number; page: number }) {
  const top = data.top_stocks;
  if (!top.length) return null;
  const [first, ...rest] = top;
  return (
    <Stage page={page} total={total} glow="top">
      <div style={EYEBROW}>Tus mejores decisiones</div>
      <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(160deg,#D4A24C,#8a6423)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 12, color: "#1a1206", margin: "10px auto 14px" }}>1º</div>
      <div style={{ ...CARD, padding: "22px 20px", textAlign: "center" }}>
        <span style={{ fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: 12, color: "#0a0f1a", background: WT.gradGreen, padding: "4px 10px", borderRadius: 8 }}>{first.ticker}</span>
        <div style={{ fontWeight: 800, fontSize: 26, color: WT.accentL, margin: "10px 0 4px" }}>{fmtPct(first.ytd_pct)}</div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub }}>de retorno este año</div>
        {first.invested !== undefined && first.current_value !== undefined && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", marginTop: 16, background: WT.border, borderRadius: 12, overflow: "hidden", gap: 1 }}>
            <div style={{ background: WT.card2, padding: "10px 8px" }}>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted }}>Invertiste</div>
              <div style={{ fontWeight: 800, fontSize: 15, color: WT.text }}>{fmtUsd(first.invested)}</div>
            </div>
            <div style={{ background: WT.card2, padding: "10px 8px" }}>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted }}>Valor actual</div>
              <div style={{ fontWeight: 800, fontSize: 15, color: WT.accentL }}>{fmtUsd(first.current_value)}</div>
            </div>
          </div>
        )}
      </div>
      {rest.length > 0 && (
        <>
          <div style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 10, color: WT.muted, textTransform: "uppercase", letterSpacing: 1, textAlign: "center", margin: "18px 0 10px" }}>También en tu podio</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${rest.length}, 1fr)`, gap: 8 }}>
            {rest.map((r, i) => (
              <div key={r.ticker} style={{ ...CARD, padding: "12px 8px", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 10, color: WT.muted }}>{i + 2}º · {r.ticker}</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: WT.accentL, marginTop: 2 }}>{fmtPct(r.ytd_pct)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Stage>
  );
}

// 6 — Favoritas
export function ScreenFavoritas({ data, total, page }: { data: WrappedData; total: number; page: number }) {
  if (!data.favoritas.length) return null;
  const [first, ...rest] = data.favoritas;
  const medals = ["#9aa7ba", "#b5743a"];
  return (
    <Stage page={page} total={total} glow="top">
      <div style={EYEBROW}>Tus negocios favoritos</div>
      <h1 style={{ ...H1, fontSize: 20, marginBottom: 22 }}>Las empresas que más analizaste</h1>

      <div style={{ ...CARD, display: "flex", alignItems: "center", gap: 16, padding: "18px 18px", background: "linear-gradient(160deg, rgba(212,162,76,0.12), rgba(9,15,31,0.4))", borderColor: "rgba(212,162,76,0.32)" }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <TickerLogo ticker={first.ticker} size={54} />
          <div style={{ position: "absolute", bottom: -4, right: -4, width: 20, height: 20, borderRadius: "50%", background: "linear-gradient(160deg,#D4A24C,#8a6423)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 10, color: "#1a1206", border: `2px solid ${WT.card}` }}>1º</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: WT.text }}>{first.ticker}</div>
          {first.company_name && (
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{first.company_name}</div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 22, color: WT.accentL }}>{first.times_analyzed}×</div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>analizada</div>
        </div>
      </div>

      {rest.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
          {rest.map((f, i) => (
            <div key={f.ticker} style={{ ...CARD, display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}>
              <TickerLogo ticker={f.ticker} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: WT.text }}>{f.ticker}</div>
                {f.company_name && (
                  <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.company_name}</div>
                )}
              </div>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: medals[i], color: "#1a1206", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 10, flexShrink: 0 }}>{i + 2}º</div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: WT.accentL }}>{f.times_analyzed}×</div>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>analizada</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Stage>
  );
}

// 7 — Mayor aprendizaje
const LESSON_QUOTES = [
  "Las grandes inversiones no se hacen cuando todos están emocionados, sino cuando entiendes el negocio mejor que el mercado.",
  "La paciencia no es esperar sin hacer nada — es seguir investigando mientras el mercado decide.",
  "Diversificar no es diluir tu convicción, es proteger tu capital de tus propios errores.",
];
export function ScreenAprendizaje({ data, total, page }: { data: WrappedData; total: number; page: number }) {
  if (!data.decisions_logged_this_year) return null;
  const quote = LESSON_QUOTES[data.year % LESSON_QUOTES.length];
  return (
    <Stage page={page} total={total} glow="center">
      <div style={EYEBROW}>La lección que definió tu año</div>
      <p style={{ fontWeight: 700, fontSize: 19, lineHeight: 1.4, color: WT.text, textAlign: "center", margin: "18px 0 24px" }}>{quote}</p>
      <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
        <div style={{ ...CARD, padding: "10px 16px", textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: WT.text }}>{data.decisions_logged_this_year}</div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>decisiones registradas</div>
        </div>
        <div style={{ ...CARD, padding: "10px 16px", textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: WT.text }}>{data.lessons}</div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>lecciones completadas</div>
        </div>
      </div>
    </Stage>
  );
}

// 8 — Vs. el mercado
export function ScreenComparacion({ data, total, page }: { data: WrappedData; total: number; page: number }) {
  if (data.growth_pct === undefined || data.spy_ytd_pct === undefined || data.spy_ytd_pct === null) return null;
  const won = data.growth_pct > data.spy_ytd_pct;
  return (
    <Stage page={page} total={total} glow="top">
      <div style={EYEBROW}>Tú vs. el mercado</div>
      <h1 style={{ ...H1, fontSize: 22, marginBottom: 26 }}>¿Le ganaste al mercado?</h1>
      <div style={{ display: "flex", justifyContent: "center", gap: 20, alignItems: "flex-end", height: 110, marginBottom: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: WT.accentL, marginBottom: 6 }}>{fmtPct(data.growth_pct)}</div>
          <div style={{ width: 56, height: Math.max(24, Math.min(90, Math.abs(data.growth_pct) * 3)), borderRadius: "10px 10px 0 0", background: WT.gradGreen }} />
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.sub, marginTop: 6 }}>Tu cartera</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: WT.sub, marginBottom: 6 }}>{fmtPct(data.spy_ytd_pct)}</div>
          <div style={{ width: 56, height: Math.max(24, Math.min(90, Math.abs(data.spy_ytd_pct) * 3)), borderRadius: "10px 10px 0 0", background: WT.card2, border: `1.5px solid ${WT.border}` }} />
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.sub, marginTop: 6 }}>S&amp;P 500</div>
        </div>
      </div>
      {won && (
        <div style={{ ...CARD, padding: "12px 16px", textAlign: "center", background: "linear-gradient(135deg, rgba(212,162,76,0.14), rgba(9,15,31,0.3))", borderColor: "rgba(212,162,76,0.35)" }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: WT.gold }}>🏆 Superaste al mercado</div>
        </div>
      )}
    </Stage>
  );
}

// 9 — Vs. otros inversionistas
export function ScreenVsInversores({ data, total, page }: { data: WrappedData; total: number; page: number }) {
  const c = data.vs_community;
  if (!c) return null;
  const topPct = Math.max(1, 100 - c.percentile);
  return (
    <Stage page={page} total={total} glow="top">
      <div style={EYEBROW}>Tú vs. la comunidad Nuvos</div>
      <h1 style={{ ...H1, fontSize: 20, marginBottom: 22 }}>¿Qué tan bien te fue frente a otros inversionistas?</h1>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: WT.sub }}>Estás en el</div>
        <div style={{ fontWeight: 900, fontSize: 46, color: WT.accentL, margin: "2px 0 18px" }}>TOP {topPct}%</div>
      </div>
      <div style={{ ...CARD, display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
        <span style={{ fontSize: 20 }}>👥</span>
        <p style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12, color: WT.text, margin: 0 }}>
          Superaste a <span style={{ color: WT.accentL, fontWeight: 800 }}>{Math.round((c.percentile / 100) * c.cohort_size)} de {c.cohort_size}</span> inversionistas Nuvos con tu mismo perfil de riesgo
        </p>
      </div>
    </Stage>
  );
}

// 10 — Investor Score
const SCORE_LABELS: Record<string, string> = { educacion: "Educación", paciencia: "Paciencia", diversificacion: "Diversificación", analisis: "Análisis" };
export function ScreenScore({ data, total, page }: { data: WrappedData; total: number; page: number }) {
  const s = data.investor_score;
  if (!s) return null;
  return (
    <Stage page={page} total={total} glow="top">
      <div style={EYEBROW}>Tu Investor Score</div>
      <div style={{ textAlign: "center", margin: "8px 0 24px" }}>
        <div style={{ fontWeight: 900, fontSize: 52, color: WT.text }}>{s.score}</div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.muted }}>de 100</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Object.entries(s.sub_scores).map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12, color: WT.sub, width: 90, flexShrink: 0 }}>{SCORE_LABELS[k] || k}</span>
            <div style={{ flex: 1, height: 8, borderRadius: 100, background: WT.card2, border: `1px solid ${WT.border}`, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${v}%`, borderRadius: 100, background: WT.gradGreen }} />
            </div>
            <span style={{ fontWeight: 800, fontSize: 13, color: WT.text, width: 24, textAlign: "right" }}>{v}</span>
          </div>
        ))}
      </div>
    </Stage>
  );
}

// 11 — Próximo capítulo
export function ScreenProximoCapitulo({ data, total, page }: { data: WrappedData; total: number; page: number }) {
  const goal = data.next_chapter || "Seguir construyendo tu patrimonio, un poco cada mes";
  return (
    <Stage page={page} total={total} glow="bottom">
      <div style={{ textAlign: "center" }}>
        <div style={EYEBROW}>Tu próximo capítulo</div>
        <div style={{ fontWeight: 900, fontSize: 64, background: WT.gradGreen, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", margin: "6px 0 20px" }}>{data.year + 1}</div>
        <p style={{ fontWeight: 700, fontSize: 18, color: WT.text, lineHeight: 1.35, margin: 0 }}>{goal}</p>
        <p style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, marginTop: 12 }}>Arthur y Nuvos AI te acompañan un año más.</p>
      </div>
    </Stage>
  );
}

// Company logo for the share card — same source/fallback convention as
// StockAvatar, but a plain <img crossOrigin> instead of next/image so
// html2canvas (useCORS: true, see WrappedFlow) can actually paint it into
// the exported PNG.
function TickerLogo({ ticker, size }: { ticker: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const src = `https://assets.parqet.com/logos/symbol/${ticker.replace(".", "-")}?format=svg`;
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

// 12 — Compartir
export function ScreenCompartir({ data }: { data: WrappedData }) {
  const best = data.top_stocks[0];
  const hasMarketCompare = data.growth_pct !== undefined && data.spy_ytd_pct !== undefined && data.spy_ytd_pct !== null;
  const wonMarket = hasMarketCompare && (data.growth_pct as number) > (data.spy_ytd_pct as number);

  return (
    <Stage page={12} total={12} noChrome>
      <div style={{ position: "absolute", inset: 20, borderRadius: 26, background: "linear-gradient(165deg, rgba(9,15,31,0.75) 0%, rgba(3,6,14,0.6) 55%, rgba(9,15,31,0.75) 100%)", border: "1.5px solid rgba(0,232,135,0.18)" }} />
      <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 10px 10px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Nuvos AI" crossOrigin="anonymous" style={{ width: 30, height: 30, borderRadius: 8, marginBottom: 8 }} />
        <span style={{ fontWeight: 800, fontSize: 13, color: WT.text, letterSpacing: 0.5, marginBottom: 16 }}>NUVOS AI</span>

        <div style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 11, color: WT.accentL, textTransform: "uppercase", letterSpacing: 1 }}>Rendimiento de portafolio {data.year}</div>
        {data.growth_pct !== undefined && (
          <div style={{ fontWeight: 900, fontSize: 66, color: WT.accentL, filter: "drop-shadow(0 0 24px rgba(0,232,135,0.4))", margin: "2px 0 4px", lineHeight: 1 }}>{fmtPct(data.growth_pct)}</div>
        )}

        {hasMarketCompare && (
          <div style={{ ...CARD, width: "100%", maxWidth: 300, display: "flex", alignItems: "center", justifyContent: "space-around", padding: "10px 12px", marginTop: 10, background: WT.card2 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: WT.accentL }}>{fmtPct(data.growth_pct as number)}</div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>Tu cartera</div>
            </div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.dim, fontWeight: 700 }}>VS</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: WT.sub }}>{fmtPct(data.spy_ytd_pct as number)}</div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>S&amp;P 500</div>
            </div>
            {wonMarket && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: WT.gold }}>🏆</div>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>Le ganaste</div>
              </div>
            )}
          </div>
        )}

        {best && (
          <div style={{ ...CARD, width: "100%", maxWidth: 300, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", marginTop: 10 }}>
            <TickerLogo ticker={best.ticker} size={38} />
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: WT.text }}>{best.ticker}</div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted }}>Tu mejor inversión del año</div>
            </div>
            <div style={{ fontWeight: 800, fontSize: 18, color: WT.accentL }}>{fmtPct(best.ytd_pct)}</div>
          </div>
        )}

        <p style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, margin: "16px 0 12px" }}>Mi año como inversionista con Nuvos AI</p>

        {data.archetype && (
          <div style={{ display: "inline-flex", alignItems: "center", padding: "8px 18px", borderRadius: 100, background: "rgba(0,185,109,0.1)", border: "1.5px solid rgba(0,232,135,0.4)", marginBottom: 16 }}>
            <span style={{ fontWeight: 800, fontSize: 13, color: WT.text }}>{data.archetype.name}</span>
          </div>
        )}

        {data.investor_score && (
          <div style={{ textAlign: "center", marginBottom: 6 }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: WT.text }}>{data.investor_score.score}</span>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted }}> / 100 Investor Score</span>
          </div>
        )}

        <p style={{ fontWeight: 800, fontSize: 15, color: WT.text, marginTop: 10 }}>#<span style={{ color: WT.accentL }}>Nuvos</span>Investor</p>
      </div>
    </Stage>
  );
}
