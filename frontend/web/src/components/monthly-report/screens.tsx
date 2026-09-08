"use client";

import { useState } from "react";
import Stage from "../wrapped/Stage";
import { useCountUp } from "../wrapped/useCountUp";
import { apiBase } from "@/lib/apiBase";
import {
  WT, fmtPct, fmtUsd, COMPOSITION_LABELS,
  MonthlyReportData,
} from "./types";

const H1: React.CSSProperties = { fontWeight: 900, color: WT.text, letterSpacing: -0.5, textAlign: "center", lineHeight: 1.05 };
const EYEBROW: React.CSSProperties = { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: WT.accentL, textAlign: "center", marginBottom: 6 };
const CARD: React.CSSProperties = { background: WT.card, border: `1px solid ${WT.border}`, borderRadius: 20 };
const EMPTY_TEXT: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 13, color: WT.sub, textAlign: "center", lineHeight: 1.5 };
const FOOTER = "NUVOS AI · TU MONTHLY REPORT";

function heroStatCard(accentHex: string): React.CSSProperties {
  return { borderRadius: 22, padding: "18px 16px", background: `linear-gradient(160deg, ${accentHex}26 0%, ${WT.card} 65%)`, border: `1px solid ${accentHex}55` };
}
function heroStatIcon(accentHex: string): React.CSSProperties {
  return { width: 34, height: 34, borderRadius: 11, background: `${accentHex}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, marginBottom: 10 };
}
const HERO_LABEL: React.CSSProperties = { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 11, color: WT.sub, marginBottom: 3 };
const HERO_VALUE: React.CSSProperties = { fontWeight: 900, fontSize: 22, letterSpacing: -0.3 };
const SECONDARY_CARD: React.CSSProperties = { ...CARD, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" };
function secondaryIcon(accentHex: string): React.CSSProperties {
  return { width: 38, height: 38, borderRadius: "50%", background: `${accentHex}1f`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 };
}

type RevealAnim = "animate-fade-in-up" | "animate-fade-in-up-glow" | "animate-scale-in" | "animate-slide-left";

function Reveal({ delay = 0, anim = "animate-fade-in-up", style, children }: { delay?: number; anim?: RevealAnim; style?: React.CSSProperties; children: React.ReactNode }) {
  return <div className={anim} style={{ opacity: 0, animationDelay: `${delay}ms`, animationFillMode: "both", ...style }}>{children}</div>;
}
function StaticReveal({ style, children }: { delay?: number; anim?: RevealAnim; style?: React.CSSProperties; children: React.ReactNode }) {
  return <div style={style}>{children}</div>;
}

function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <Reveal delay={200} style={{ ...CARD, padding: "28px 22px", textAlign: "center" }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{emoji}</div>
      <p style={EMPTY_TEXT}>{text}</p>
    </Reveal>
  );
}

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
    <img src={src} alt={ticker} crossOrigin="anonymous" onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "contain", background: "#fff", border: `1px solid ${WT.border}`, flexShrink: 0 }} />
  );
}

type ScreenProps = { data: MonthlyReportData; total: number; page: number; nextLabel?: string };

// 1 — Portada
export function ScreenPortada({ data, total, page, nextLabel }: ScreenProps) {
  const o = data.overview;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel} footerLabel={FOOTER}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <Reveal delay={0} style={EYEBROW}>{o.month_label}</Reveal>
        <Reveal delay={100}><h1 style={{ ...H1, fontSize: 26, marginBottom: 26 }}>Tu mes como<br />inversionista.</h1></Reveal>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" }}>
          <Reveal delay={220} anim="animate-fade-in-up-glow" style={heroStatCard(WT.accentL)}>
            <div style={heroStatIcon(WT.accentL)}>🎯</div>
            <div style={HERO_LABEL}>Decisiones</div>
            <div style={{ ...HERO_VALUE, color: WT.text }}>{o.decisions_count}</div>
          </Reveal>
          <Reveal delay={300} anim="animate-fade-in-up-glow" style={heroStatCard(WT.teal)}>
            <div style={heroStatIcon(WT.teal)}>🔍</div>
            <div style={HERO_LABEL}>Investigadas</div>
            <div style={{ ...HERO_VALUE, color: WT.text }}>{o.companies_researched}</div>
          </Reveal>
          <Reveal delay={380} anim="animate-fade-in-up-glow" style={heroStatCard(WT.gold)}>
            <div style={heroStatIcon(WT.gold)}>⏱️</div>
            <div style={HERO_LABEL}>Días activo</div>
            <div style={{ ...HERO_VALUE, color: WT.text }}>{o.active_days}</div>
          </Reveal>
          <Reveal delay={460} anim="animate-fade-in-up-glow" style={heroStatCard(WT.coral)}>
            <div style={heroStatIcon(WT.coral)}>📅</div>
            <div style={HERO_LABEL}>{o.is_current_month ? "Mes en curso" : "Mes cerrado"}</div>
            <div style={{ ...HERO_VALUE, fontSize: 15, color: WT.text }}>{o.month_label.split(" ")[0]}</div>
          </Reveal>
        </div>
      </div>
    </Stage>
  );
}

// 2 — Tu portafolio
export function ScreenPortafolio({ data, total, page, nextLabel }: ScreenProps) {
  const p = data.portfolio;
  const animatedReturn = useCountUp(p.return_pct ?? 0, 1000, 2);
  const returnColor = (p.return_pct ?? 0) >= 0 ? WT.accentL : WT.coral;

  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel} footerLabel={FOOTER}>
      <Reveal delay={0} style={EYEBROW}>Tu portafolio</Reveal>
      <Reveal delay={100}><h1 style={{ ...H1, fontSize: 22, marginBottom: 20 }}>¿Cómo te fue?</h1></Reveal>

      {!p.available ? (
        <EmptyState emoji="📊" text="Todavía no tenemos suficiente actividad de portafolio este mes para mostrar tu rendimiento." />
      ) : (
        <>
          {p.return_pct !== null && (
            <Reveal delay={220} anim="animate-fade-in-up-glow" style={{ ...heroStatCard(returnColor), textAlign: "center", marginBottom: 10 }}>
              <div style={HERO_LABEL}>Rendimiento del mes</div>
              <div style={{ fontWeight: 900, fontSize: 36, color: returnColor, letterSpacing: -1 }}>{fmtPct(animatedReturn)}</div>
              {p.benchmark_pct !== null && (
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, marginTop: 6 }}>
                  S&amp;P 500: {fmtPct(p.benchmark_pct)} · {p.diff_pp !== null && (p.diff_pp >= 0 ? "vs mercado " : "vs mercado ")}
                  <span style={{ color: (p.diff_pp ?? 0) >= 0 ? WT.accentL : WT.coral, fontWeight: 700 }}>
                    {p.diff_pp !== null ? fmtPct(p.diff_pp) : ""}
                  </span>
                </div>
              )}
            </Reveal>
          )}

          {(p.best_position || p.worst_position) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              {p.best_position && (
                <Reveal delay={340} style={SECONDARY_CARD}>
                  <TickerLogo ticker={p.best_position.ticker} size={30} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted, textTransform: "uppercase" }}>Mejor</div>
                    <div style={{ fontWeight: 800, fontSize: 13, color: WT.text }}>{p.best_position.ticker}</div>
                  </div>
                </Reveal>
              )}
              {p.worst_position && (
                <Reveal delay={400} style={SECONDARY_CARD}>
                  <TickerLogo ticker={p.worst_position.ticker} size={30} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted, textTransform: "uppercase" }}>Peor</div>
                    <div style={{ fontWeight: 800, fontSize: 13, color: WT.text }}>{p.worst_position.ticker}</div>
                  </div>
                </Reveal>
              )}
            </div>
          )}

          {p.composition && Object.keys(p.composition).length > 0 && (
            <Reveal delay={480} style={{ ...CARD, padding: 16, marginBottom: 10 }}>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 700, color: WT.sub, textTransform: "uppercase", marginBottom: 10 }}>Composición</div>
              <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
                {Object.entries(p.composition).map(([k, v]) => (
                  <div key={k} style={{ width: `${v}%`, background: { growth: WT.accentL, quality: WT.teal, value: WT.gold, defensive: WT.coral, other: WT.muted }[k] || WT.muted }} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {Object.entries(p.composition).map(([k, v]) => (
                  <div key={k} style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.sub }}>
                    <span style={{ fontWeight: 800, color: WT.text }}>{v}%</span> {COMPOSITION_LABELS[k] || k}
                  </div>
                ))}
              </div>
            </Reveal>
          )}

          {p.insight && (
            <Reveal delay={560} style={{ ...CARD, padding: "14px 16px", background: "rgba(0,185,109,0.06)", borderColor: "rgba(0,185,109,0.2)" }}>
              <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: WT.text, lineHeight: 1.5, margin: 0 }}>{p.insight}</p>
            </Reveal>
          )}
        </>
      )}
    </Stage>
  );
}

// 3 — Tus decisiones
export function ScreenDecisiones({ data, total, page, nextLabel }: ScreenProps) {
  const d = data.decisions;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel} footerLabel={FOOTER}>
      <Reveal delay={0} style={EYEBROW}>Tus decisiones</Reveal>
      <Reveal delay={100}><h1 style={{ ...H1, fontSize: 40, marginBottom: 4 }}>{d.total}</h1></Reveal>
      <Reveal delay={140}><p style={{ ...EMPTY_TEXT, marginBottom: 20 }}>decisiones este mes</p></Reveal>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
        <Reveal delay={220} style={{ ...SECONDARY_CARD, flexDirection: "column", textAlign: "center", gap: 4 }}>
          <div style={{ fontWeight: 900, fontSize: 18, color: WT.accentL }}>{d.buys_count}</div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted }}>compras</div>
        </Reveal>
        <Reveal delay={280} style={{ ...SECONDARY_CARD, flexDirection: "column", textAlign: "center", gap: 4 }}>
          <div style={{ fontWeight: 900, fontSize: 18, color: WT.gold }}>{d.holds_count}</div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted }}>mantener</div>
        </Reveal>
        <Reveal delay={340} style={{ ...SECONDARY_CARD, flexDirection: "column", textAlign: "center", gap: 4 }}>
          <div style={{ fontWeight: 900, fontSize: 18, color: WT.coral }}>{d.sells_count}</div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted }}>ventas</div>
        </Reveal>
      </div>

      {d.highlight ? (
        <Reveal delay={420} style={{ ...CARD, padding: 16, marginBottom: 10 }}>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 700, color: WT.accentL, textTransform: "uppercase", marginBottom: 6 }}>Tu decisión más importante</div>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: WT.text, lineHeight: 1.5, margin: 0 }}>{d.highlight}</p>
        </Reveal>
      ) : (
        <EmptyState emoji="🤔" text="Todavía no tenemos suficiente información para identificar tu decisión más importante." />
      )}

      {d.improvement_tip && (
        <Reveal delay={500} style={{ ...CARD, padding: 16, background: "rgba(212,162,76,0.06)", borderColor: "rgba(212,162,76,0.2)" }}>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 700, color: WT.gold, textTransform: "uppercase", marginBottom: 6 }}>Cómo mejorar</div>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: WT.text, lineHeight: 1.5, margin: 0 }}>{d.improvement_tip}</p>
        </Reveal>
      )}
    </Stage>
  );
}

// 4 — Empresas investigadas
export function ScreenInvestigacion({ data, total, page, nextLabel }: ScreenProps) {
  const r = data.research;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel} footerLabel={FOOTER}>
      <Reveal delay={0} style={EYEBROW}>Investigación</Reveal>
      <Reveal delay={100}><h1 style={{ ...H1, fontSize: 22, marginBottom: 20 }}>Empresas que investigaste</h1></Reveal>

      {r.companies_researched === 0 ? (
        <EmptyState emoji="🔍" text="Todavía no registramos empresas investigadas este mes — buscar y analizar tickers en Oportunidades cuenta." />
      ) : (
        <>
          <Reveal delay={200} anim="animate-fade-in-up-glow" style={{ ...heroStatCard(WT.teal), textAlign: "center", marginBottom: 14 }}>
            <div style={HERO_LABEL}>Empresas investigadas</div>
            <div style={{ fontWeight: 900, fontSize: 32, color: WT.text }}>{r.companies_researched}</div>
          </Reveal>

          {r.favorite_company && (
            <Reveal delay={300} style={{ ...SECONDARY_CARD, marginBottom: 10 }}>
              <TickerLogo ticker={r.favorite_company.ticker} size={36} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: WT.muted, textTransform: "uppercase" }}>Tu empresa más investigada</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: WT.text }}>{r.favorite_company.company_name || r.favorite_company.ticker}</div>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.sub }}>{r.favorite_company.times_analyzed} sesiones</div>
              </div>
            </Reveal>
          )}

          {r.research_pattern && r.research_pattern.length >= 2 && (
            <Reveal delay={380} style={{ ...CARD, padding: 16, marginBottom: 10, textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 700, color: WT.sub, textTransform: "uppercase", marginBottom: 8 }}>Tu patrón de investigación</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
                {r.research_pattern.map((label, i) => (
                  <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 13, color: WT.accentL }}>{label}</span>
                    {i < r.research_pattern!.length - 1 && <span style={{ color: WT.muted }}>→</span>}
                  </span>
                ))}
              </div>
            </Reveal>
          )}

          {r.insight && (
            <Reveal delay={460} style={{ ...CARD, padding: "14px 16px", background: "rgba(79,166,149,0.06)", borderColor: "rgba(79,166,149,0.2)" }}>
              <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: WT.text, lineHeight: 1.5, margin: 0 }}>{r.insight}</p>
            </Reveal>
          )}
        </>
      )}
    </Stage>
  );
}

// 5 — Tu patrimonio (PRIVATE — never in the share card)
export function ScreenPatrimonio({ data, total, page, nextLabel }: ScreenProps) {
  const w = data.wealth;
  const animatedValue = useCountUp(w.portfolio_value ?? 0, 1000, 2);
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel} footerLabel={FOOTER}>
      <Reveal delay={0} style={EYEBROW}>Privado · Solo para ti</Reveal>
      <Reveal delay={100}><h1 style={{ ...H1, fontSize: 22, marginBottom: 20 }}>Tu patrimonio</h1></Reveal>

      {!w.available || w.portfolio_value === null ? (
        <EmptyState emoji="💼" text="Todavía no tenemos suficientes datos para mostrar tu patrimonio este mes." />
      ) : (
        <>
          <Reveal delay={220} anim="animate-fade-in-up-glow" style={{ ...heroStatCard(WT.accentL), textAlign: "center", marginBottom: 10 }}>
            <div style={HERO_LABEL}>Patrimonio total</div>
            <div style={{ fontWeight: 900, fontSize: 30, color: WT.text }}>{fmtUsd(animatedValue)}</div>
            {w.variation_pct !== null && (
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, marginTop: 6, color: w.variation_pct >= 0 ? WT.accentL : WT.coral, fontWeight: 700 }}>
                {fmtPct(w.variation_pct)} este mes
              </div>
            )}
          </Reveal>
        </>
      )}
    </Stage>
  );
}

// 6 — Tu hábito como inversionista
export function ScreenHabitos({ data, total, page, nextLabel }: ScreenProps) {
  const h = data.habits;
  const rows = [
    { emoji: "🔍", label: "Analizar", value: h.activity_breakdown.analizar },
    { emoji: "👀", label: "Seguimiento", value: h.activity_breakdown.seguimiento },
    { emoji: "🎯", label: "Decisiones", value: h.activity_breakdown.decisiones },
  ].filter((r) => r.value > 0);

  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel} footerLabel={FOOTER}>
      <Reveal delay={0} style={EYEBROW}>Tu hábito</Reveal>
      <Reveal delay={100}><h1 style={{ ...H1, fontSize: 22, marginBottom: 20 }}>Tu constancia este mes</h1></Reveal>

      {h.active_days === 0 ? (
        <EmptyState emoji="🌱" text="Todavía no registramos actividad real este mes — analizar empresas, hacer seguimiento o registrar decisiones cuentan." />
      ) : (
        <>
          <Reveal delay={220} anim="animate-fade-in-up-glow" style={{ ...heroStatCard(WT.coral), textAlign: "center", marginBottom: 14 }}>
            <div style={heroStatIcon(WT.coral)}>🔥</div>
            <div style={HERO_LABEL}>Racha más larga</div>
            <div style={{ fontWeight: 900, fontSize: 28, color: WT.text }}>{h.longest_streak} días</div>
          </Reveal>

          {rows.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
              {rows.map((r) => (
                <Reveal key={r.label} delay={320} style={SECONDARY_CARD}>
                  <div style={secondaryIcon(WT.teal)}>{r.emoji}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: WT.text }}>{r.label}</div>
                  </div>
                  <div style={{ fontWeight: 900, fontSize: 16, color: WT.text }}>{r.value}×</div>
                </Reveal>
              ))}
            </div>
          )}

          {h.favorite_weekday && (
            <Reveal delay={420} style={{ ...CARD, padding: "14px 16px", textAlign: "center" }}>
              <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: WT.sub, margin: 0 }}>
                Tu día favorito para invertir tiempo: <span style={{ color: WT.text, fontWeight: 700 }}>{h.favorite_weekday}</span>
              </p>
            </Reveal>
          )}
        </>
      )}
    </Stage>
  );
}

// 7 — Tu evolución como inversionista
export function ScreenEvolucion({ data, total, page, nextLabel }: ScreenProps) {
  const e = data.evolution;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel} footerLabel={FOOTER}>
      <Reveal delay={0} style={EYEBROW}>Tu evolución</Reveal>
      <Reveal delay={100}><h1 style={{ ...H1, fontSize: 22, marginBottom: 20 }}>Cómo estás cambiando</h1></Reveal>

      {!e.current_archetype ? (
        <EmptyState emoji="🌱" text="Todavía estamos conociendo tu estilo — necesitamos un poco más de actividad para leer tu evolución." />
      ) : (
        <>
          {e.past_archetype && (
            <Reveal delay={200} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted, textTransform: "uppercase", marginBottom: 4 }}>Hace {e.months_compared} meses</div>
                <div style={{ fontSize: 22 }}>{e.past_archetype.emoji}</div>
                <div style={{ fontWeight: 700, fontSize: 11, color: WT.sub }}>{e.past_archetype.name}</div>
              </div>
              <div style={{ color: WT.muted, fontSize: 18 }}>→</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.accentL, textTransform: "uppercase", marginBottom: 4 }}>Hoy</div>
                <div style={{ fontSize: 22 }}>{e.current_archetype.emoji}</div>
                <div style={{ fontWeight: 700, fontSize: 11, color: WT.text }}>{e.current_archetype.name}</div>
              </div>
            </Reveal>
          )}

          <Reveal delay={320} anim="animate-fade-in-up-glow" style={{ ...CARD, padding: "26px 20px", background: "linear-gradient(160deg, rgba(0,185,109,0.14), rgba(9,15,31,0.4))", borderColor: "rgba(0,185,109,0.32)", textAlign: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>{e.current_archetype.emoji}</div>
            <div style={{ fontWeight: 900, fontSize: 20, color: WT.accentL, letterSpacing: 0.5, marginBottom: 8 }}>{e.current_archetype.name}</div>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: WT.text, lineHeight: 1.5, margin: 0 }}>&ldquo;{e.current_archetype.tagline}&rdquo;</p>
          </Reveal>

          {e.insight && (
            <Reveal delay={420} style={{ ...CARD, padding: "14px 16px" }}>
              <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: WT.text, lineHeight: 1.5, margin: 0 }}>{e.insight}</p>
            </Reveal>
          )}
        </>
      )}
    </Stage>
  );
}

// 8 — Tu próximo mes
export function ScreenProximoMes({ data, total, page, nextLabel }: ScreenProps) {
  const n = data.next_month;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel} footerLabel={FOOTER}>
      <Reveal delay={0} style={EYEBROW}>Tu próximo mes</Reveal>
      <Reveal delay={100}><h1 style={{ ...H1, fontSize: 22, marginBottom: 20 }}>3 misiones para vos</h1></Reveal>

      {n.missions.length === 0 ? (
        <EmptyState emoji="🎯" text="Sigue registrando actividad este mes — con más datos te vamos a poder sugerir misiones concretas." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          {n.missions.map((m, i) => (
            <Reveal key={m.key} delay={220 + i * 100} style={SECONDARY_CARD}>
              <div style={{ ...secondaryIcon(WT.accentL), fontWeight: 900, fontSize: 13 }}>{String(i + 1).padStart(2, "0")}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: WT.text }}>{m.title}</div>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub, lineHeight: 1.4 }}>{m.text}</div>
              </div>
            </Reveal>
          ))}
        </div>
      )}

      {n.next_milestone && (
        <Reveal delay={560} style={{ ...CARD, padding: "14px 16px", background: "rgba(212,162,76,0.06)", borderColor: "rgba(212,162,76,0.2)" }}>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 700, color: WT.gold, textTransform: "uppercase", marginBottom: 4 }}>Tu siguiente milestone</div>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: WT.text, margin: 0 }}>{n.next_milestone}</p>
        </Reveal>
      )}
    </Stage>
  );
}

// 9 — Tus logros
export function ScreenLogros({ data, total, page, nextLabel }: ScreenProps) {
  const a = data.achievements;
  return (
    <Stage page={page} total={total} glow="top" nextLabel={nextLabel} footerLabel={FOOTER}>
      <Reveal delay={0} style={EYEBROW}>Tus logros</Reveal>
      <Reveal delay={100}><h1 style={{ ...H1, fontSize: 22, marginBottom: 20 }}>{a.total_unlocked} / {a.total_available} desbloqueados</h1></Reveal>

      {a.unlocked_this_month.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <Reveal delay={200} style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 700, color: WT.accentL, textTransform: "uppercase" }}>Este mes desbloqueaste</Reveal>
          {a.unlocked_this_month.map((ach, i) => (
            <Reveal key={ach.id} delay={260 + i * 100} anim="animate-fade-in-up-glow" style={{ ...SECONDARY_CARD, background: "linear-gradient(160deg, rgba(0,185,109,0.14), rgba(9,15,31,0.4))", borderColor: "rgba(0,185,109,0.32)" }}>
              <div style={{ ...secondaryIcon(WT.accentL), fontSize: 20 }}>{ach.icon}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 13, color: WT.accentL }}>{ach.name}</div>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: WT.sub }}>{ach.description}</div>
              </div>
            </Reveal>
          ))}
        </div>
      ) : (
        <EmptyState emoji="🏆" text="Ningún logro nuevo este mes — seguí activo para desbloquear el siguiente." />
      )}

      {a.next_achievement && (
        <Reveal delay={480} style={{ ...CARD, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 20, opacity: 0.5 }}>{a.next_achievement.icon}</div>
          <div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 700, color: WT.muted, textTransform: "uppercase" }}>Tu próximo logro</div>
            <div style={{ fontWeight: 800, fontSize: 13, color: WT.text }}>{a.next_achievement.name}</div>
          </div>
        </Reveal>
      )}
    </Stage>
  );
}

// 10 — Investor Share Card (staticMode = the off-screen html2canvas clone,
// see MonthlyReportFlow.tsx — no Reveal animations there, StaticReveal instead)
function shareInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

export function ScreenCompartir({ data, staticMode }: { data: MonthlyReportData; staticMode?: boolean }) {
  const R = staticMode ? StaticReveal : Reveal;
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
    <Stage page={0} total={0} noChrome glow="center">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "40px 0" }}>
        <R delay={0} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Nuvos AI" width={26} height={26} crossOrigin="anonymous" style={{ borderRadius: 7 }} />
          <span style={{ fontWeight: 800, fontSize: 14, color: WT.text }}>NUVOS AI</span>
        </R>
        <R delay={80} style={EYEBROW}>{s.month_label}</R>
        <R delay={140}><h1 style={{ ...H1, fontSize: 15, marginBottom: 24, color: WT.sub, fontWeight: 700 }}>MY MONTHLY REPORT</h1></R>

        {/* Hero card — avatar + portfolio return % + open-position count.
            Diego, 2026-09-08: explicit, confirmed exception to "never show
            return on the Share Card" — this IS the point of the redesign. */}
        <R delay={220} anim="animate-fade-in-up-glow" style={{ ...CARD, padding: "28px 22px", background: "linear-gradient(160deg, rgba(0,185,109,0.16), rgba(9,15,31,0.4))", borderColor: "rgba(0,185,109,0.35)", width: "100%", marginBottom: 18 }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: WT.gradGreen, padding: 3, margin: "0 auto 14px" }}>
            {showAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.avatar_url as string} alt={s.user_name} crossOrigin="anonymous" onError={() => setAvatarFailed(true)}
                style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: WT.card2, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20, color: WT.text }}>
                {shareInitials(s.user_name)}
              </div>
            )}
          </div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 700, color: WT.sub, textTransform: "uppercase", marginBottom: 6 }}>Rendimiento del mes</div>
          {s.return_pct !== null ? (
            <div style={{ fontWeight: 900, fontSize: 36, color: returnColor, letterSpacing: -1, marginBottom: 10 }}>{fmtPct(s.return_pct)}</div>
          ) : (
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: WT.sub, marginBottom: 10 }}>Sin datos todavía</div>
          )}
          <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: WT.sub }}>
            <span style={{ color: WT.text, fontWeight: 800 }}>{s.positions_count}</span> {s.positions_count === 1 ? "posición" : "posiciones"}
          </div>
        </R>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%", marginBottom: 18 }}>
          {stats.map((stat, i) => (
            <R key={stat.label} delay={340 + i * 40} style={{ ...CARD, padding: "14px 10px" }}>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 9, color: WT.muted, textTransform: "uppercase", marginBottom: 4 }}>{stat.label}</div>
              <div style={{ fontWeight: 800, fontSize: 12, color: WT.text }}>{stat.value}</div>
              {stat.sub && <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 700, color: moveColor, marginTop: 2 }}>{stat.sub}</div>}
            </R>
          ))}
        </div>

        {s.achievement && (
          <R delay={520} style={{ display: "flex", alignItems: "center", gap: 8, ...CARD, padding: "10px 16px", marginBottom: 18 }}>
            <span style={{ fontSize: 16 }}>{s.achievement.icon}</span>
            <span style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 12, color: WT.text }}>Achievement unlocked: {s.achievement.name}</span>
          </R>
        )}

        <R delay={600} style={{ fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 700, color: WT.muted, letterSpacing: 1 }}>NUVOS · DECIDE MEJOR.</R>
      </div>
    </Stage>
  );
}
