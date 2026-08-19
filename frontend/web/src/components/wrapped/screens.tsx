"use client";

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
  return (
    <Stage page={page} total={total} glow="top">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div style={{ width: 84, height: 84, borderRadius: "50%", background: WT.gradGreen, padding: 3, marginBottom: 18, boxShadow: "0 0 34px rgba(0,185,109,0.35)" }}>
          <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: WT.card2, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 28, color: WT.text }}>
            {initials(data.user_name)}
          </div>
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
            <div style={{ fontWeight: 800, fontSize: 34, color: WT.accentL }}>{fmtPct(data.growth_pct)}</div>
          </div>
        )}
        <div style={{ ...CARD, padding: "16px 14px" }}>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, marginBottom: 4 }}>Lecciones completadas</div>
          <div style={{ fontWeight: 800, fontSize: 24, color: WT.text }}>{data.lessons}</div>
        </div>
        <div style={{ ...CARD, padding: "16px 14px" }}>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, marginBottom: 4 }}>Sector principal</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: WT.text }}>{data.top_sector}</div>
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
  const medals = ["#D4A24C", "#9aa7ba", "#b5743a"];
  return (
    <Stage page={page} total={total} glow="top">
      <div style={EYEBROW}>Tus negocios favoritos</div>
      <h1 style={{ ...H1, fontSize: 20, marginBottom: 22 }}>Las empresas que más analizaste</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.favoritas.map((f, i) => (
          <div key={f.ticker} style={{ ...CARD, display: "flex", alignItems: "center", gap: 14, padding: "12px 14px" }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: medals[i], color: "#1a1206", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, flexShrink: 0 }}>{i + 1}º</div>
            <div style={{ fontWeight: 800, fontSize: 15, color: WT.text, flex: 1 }}>{f.ticker}</div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: WT.accentL }}>{f.times_analyzed}×</div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>analizada</div>
            </div>
          </div>
        ))}
      </div>
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

// 12 — Compartir
export function ScreenCompartir({ data }: { data: WrappedData }) {
  return (
    <Stage page={12} total={12} noChrome>
      <div style={{ position: "absolute", inset: 20, borderRadius: 26, background: "linear-gradient(165deg, rgba(9,15,31,0.7) 0%, rgba(3,6,14,0.55) 55%, rgba(9,15,31,0.7) 100%)", border: "1.5px solid rgba(0,232,135,0.16)" }} />
      <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: WT.gradGreen }} />
          <span style={{ fontWeight: 800, fontSize: 14, color: WT.text }}>NUVOS AI</span>
        </div>
        <div style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 11, color: WT.accentL, textTransform: "uppercase", letterSpacing: 1 }}>Rendimiento de portafolio</div>
        {data.growth_pct !== undefined && (
          <div style={{ fontWeight: 900, fontSize: 74, color: WT.accentL, filter: "drop-shadow(0 0 24px rgba(0,232,135,0.4))", margin: "4px 0" }}>{fmtPct(data.growth_pct)}</div>
        )}
        <p style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, marginBottom: 16 }}>Mi año como inversionista con Nuvos AI</p>
        {data.archetype && (
          <div style={{ display: "inline-flex", alignItems: "center", padding: "8px 18px", borderRadius: 100, background: "rgba(0,185,109,0.1)", border: "1.5px solid rgba(0,232,135,0.4)", marginBottom: 20 }}>
            <span style={{ fontWeight: 800, fontSize: 13, color: WT.text }}>{data.archetype.name}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 0, width: "100%", maxWidth: 280, marginBottom: 8 }}>
          {data.top_stocks[0] && (
            <div style={{ flex: 1, textAlign: "center", padding: "0 8px" }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: WT.gold }}>{data.top_stocks[0].ticker}</div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>Mejor inversión</div>
            </div>
          )}
          {data.investor_score && (
            <div style={{ flex: 1, textAlign: "center", padding: "0 8px", borderLeft: `1px solid ${WT.border}` }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: WT.text }}>{data.investor_score.score}</div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>Investor Score</div>
            </div>
          )}
          {data.vs_community && (
            <div style={{ flex: 1, textAlign: "center", padding: "0 8px", borderLeft: `1px solid ${WT.border}` }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: WT.text }}>+{Math.round(((data.growth_pct ?? 0) - (data.spy_ytd_pct ?? 0)))}</div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted }}>pts vs S&amp;P 500</div>
            </div>
          )}
        </div>
        <p style={{ fontWeight: 800, fontSize: 15, color: WT.text, marginTop: 14 }}>#<span style={{ color: WT.accentL }}>Nuvos</span>Investor</p>
      </div>
    </Stage>
  );
}
