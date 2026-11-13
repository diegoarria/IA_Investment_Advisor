"use client";

// RiesgosPreview — Nuvos Radar "Riesgos" tab, local dev only (NOT wired into
// the real ficha, NOT reachable by real users). Diego, 2026-11-12: "¿Qué
// podría salir mal?" — pestaña de profundidad completa sobre riesgos,
// reutilizando el contenido editorial ya existente
// (company_qualitative_content.risks) y los componentes ya construidos en
// Resumen/Valuación (ExpandRow, SourceLinks, Pill, los constantes de
// fact_type/confianza) en vez de reconstruirlos.
//
// Rediseño premium (2026-11-12, segunda ronda) — UX/UI únicamente, sin datos
// nuevos. Motivado por: titulares truncados con "…" vía headlineFrom (una
// función pensada para los top-3 compactos de Resumen, donde el corte no
// importa porque el usuario puede expandir en otra pestaña; aquí, en la
// pestaña de profundidad, cortar el titular era inaceptable). Se reemplaza
// por `splitExplanation`, una transformación puramente basada en puntuación
// ya presente en el texto real (":", ";", "—", o un punto seguido de
// mayúscula/fin de texto — nunca un punto interno de abreviatura como
// "EE.UU." o de una cifra decimal, porque ambos casos carecen del espacio en
// blanco que la expresión regular exige después del punto). Nunca se corta
// a mitad de palabra, nunca se usa text-overflow/ellipsis, nunca se inventa
// una frase nueva — solo se decide EN QUÉ PUNTO del texto ya escrito separar
// el titular del resto.
//
// Tres ajustes de producto de Diego sobre el plan propuesto originalmente
// (primera ronda), que esta ronda de rediseño preserva sin regresión:
//
// 1. ORDEN — NO se reordena por fact_type (hecho → interpretación →
//    escenario). El esquema real no tiene ningún campo explícito de
//    prioridad/materialidad, así que se preserva el ORDEN YA PERSISTIDO en
//    el arreglo. `risksInPersistedOrder` es una identidad deliberada.
//
// 2. HECHOS/INTERPRETACIONES/ESCENARIOS — el esquema real solo permite
//    clasificar la tarjeta COMPLETA con un único `fact_type`, no cada
//    afirmación por separado. La insignia de fact_type ahora vive dentro del
//    panel expandido (sección 5 de este rediseño: "reduce su protagonismo
//    visual... pueden ubicarse dentro del detalle expandido"), y la sección
//    "Qué debería vigilar" sigue llevando su aclaración explícita de menor
//    certeza, sin cambios de fondo.
//
// 3. Ningún número de severidad, probabilidad o impacto monetario se
//    inventa en ningún punto de este archivo. Solo se muestran los campos
//    reales `confidence` (alta/media/baja) y `fact_type`.
//
// Arquitectura de publicación/seguridad: sin cambios. Este componente solo
// RENDERIZA lo que la página le pasa — no decide de dónde viene el
// contenido editorial.

import { useEffect, useState } from "react";
import {
  AlertTriangle, ShieldQuestion, Scale, Cpu, Coins, Landmark, UserCheck, Factory, Settings2, Users, CheckCircle2, Wallet,
} from "lucide-react";
import { GlowCard, IconSquare, IconDot, GOLD } from "@/components/subvaluadas/radarUi";
import { fmtPrice } from "@/lib/types/stock";
import {
  TabNav,
  ExpandRow,
  SourceLinks,
  Pill,
  _FACT_TYPE_LABEL,
  _FACT_TYPE_COLOR,
  _CONFIDENCE_LABEL,
  _CONFIDENCE_COLOR,
  _RISK_CATEGORY_LABEL,
  type QualitativeContentDraft,
  type QualitativeRisk,
} from "@/components/subvaluadas/ResumenPreview";
import type { FullCompanyDiagnosticData } from "@/lib/types/companyDiagnostic";
import { market as marketApi } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { usePortfolioStore } from "@/lib/portfolioStore";

// Rediseño premium #2 (2026-11-12, tercera ronda) — inspirado en una
// referencia visual que Diego compartió (otro producto: panel de síntesis +
// tarjetas con columnas cortas + panel "qué tendría que cambiar"), SIN
// copiarla literalmente. Dos elementos de esa referencia quedaron
// explícitamente OMITIDOS por decisión directa de Diego, porque requerían
// datos que no existen en el esquema real:
//   - Un score agregado "Riesgo global: [nivel]" — requeriría ponderar/puntuar
//     los riesgos entre sí; no existe ningún campo de materialidad/severidad
//     persistido, solo fact_type y confidence (que Diego mismo distinguió
//     explícitamente de "gravedad económica").
//   - Una gráfica "Impacto vs. probabilidad" — requeriría coordenadas
//     numéricas de impacto/probabilidad que tampoco existen.
// Pregunté directamente y Diego eligió "Omitirlos, solo visual real": nada de
// esto se construye, ni siquiera como placeholder. Todo lo que SÍ se agrega
// abajo (panorama de categorías, panel "qué tendría que cambiar", exposición
// real de portafolio) se deriva exclusivamente de campos reales ya
// persistidos — cero números inventados.

// Icono por categoría — identidad visual únicamente, no implica severidad.
const _CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  competencia: Users,
  regulacion: Scale,
  rentabilidad: Coins,
  deuda_liquidez: Landmark,
  concentracion_clientes: UserCheck,
  tecnologia_disrupcion: Cpu,
  ejecucion_operativa: Settings2,
  riesgo_sectorial: Factory,
};
function categoryIcon(category: string) {
  return _CATEGORY_ICON[category] ?? ShieldQuestion;
}

// Ajuste de producto #1 (ver nota de cabecera) — identidad deliberada, NO un
// `.sort()`. El esquema real no tiene ningún campo de materialidad
// explícito; el orden ya persistido en el arreglo es la señal más honesta
// disponible, así que se preserva exactamente tal como llega.
function risksInPersistedOrder(risks: QualitativeRisk[]): QualitativeRisk[] {
  return risks;
}

// Primer límite de cláusula "fuerte" en el texto: ":", ";", "—", o un punto
// que de verdad cierra una oración (seguido de espacio + mayúscula, o de fin
// de texto). Un punto SIN ese espacio-y-mayúscula después (como el primer y
// segundo punto de "EE.UU." — a cada uno le sigue una letra pegada o una
// minúscula) nunca califica, así que nunca se corta ahí. No es una lista de
// abreviaturas conocidas: es una propiedad estructural del texto en
// español, válida para cualquier ticker.
const CLAUSE_BOUNDARY_RE = /[:;—]|\.(?=\s+[A-ZÁÉÍÓÚÑ]|\s*$)/;

function nextClause(text: string): { clause: string; rest: string } | null {
  const m = text.match(CLAUSE_BOUNDARY_RE);
  if (!m || m.index == null) return null;
  const clause = text.slice(0, m.index).trim();
  if (!clause) return null;
  return { clause, rest: text.slice(m.index + m[0].length).trim() };
}

/** Deriva, del texto real de `explanation` (nunca de una frase nueva):
 * - headline: la primera cláusula — el titular completo, sin truncar, sin
 *   "…". Puede ocupar varias líneas; eso está permitido explícitamente.
 * - summary: la cláusula siguiente, SOLO si es breve (≤170 caracteres) —
 *   una frase corta que complementa el titular sin arrastrar cifras y
 *   antecedentes extensos al estado colapsado.
 * - detail: todo lo que sobra después de headline (+ summary, si se usó) —
 *   se muestra únicamente en el panel expandido, verbatim, sin recortes.
 * Si el texto no tiene ningún límite de cláusula (muy corto, o una sola
 * frase sin puntuación fuerte), headline es el texto completo y no hay
 * summary ni detail que ocultar — nada se pierde. */
function splitExplanation(text: string): { headline: string; summary: string | null; detail: string | null } {
  const clean = (text || "").trim();
  if (!clean) return { headline: "", summary: null, detail: null };
  const first = nextClause(clean);
  if (!first) return { headline: clean, summary: null, detail: null };
  const SHORT = 170;
  const second = first.rest ? nextClause(first.rest) : null;
  if (second && second.clause.length <= SHORT) {
    return { headline: first.clause, summary: second.clause, detail: second.rest || null };
  }
  return { headline: first.clause, summary: null, detail: first.rest || null };
}

// Panel "Panorama de riesgos" — chips de categoría reales (campo `category`
// ya persistido, nunca una puntuación) + una frase de síntesis puramente
// factual (qué categorías aparecen y con qué frecuencia, no un juicio de
// gravedad).
function panoramaCategories(risks: QualitativeRisk[]): { category: string; count: number }[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const r of risks) {
    if (!counts.has(r.category)) order.push(r.category);
    counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  }
  return order.map((category) => ({ category, count: counts.get(category) ?? 0 }));
}

function panoramaSummary(cats: { category: string; count: number }[]): string {
  if (cats.length === 0) return "";
  const sorted = [...cats].sort((a, b) => b.count - a.count);
  const label = (c: string) => (_RISK_CATEGORY_LABEL[c] ?? c).toLowerCase();
  if (sorted.length === 1) return `Los riesgos identificados se concentran en ${label(sorted[0].category)}.`;
  return `Los riesgos identificados abarcan principalmente ${label(sorted[0].category)} y ${label(sorted[1].category)}.`;
}

function PanoramaPanel({ risks }: { risks: QualitativeRisk[] }) {
  const cats = panoramaCategories(risks);
  if (cats.length === 0) return null;
  return (
    <GlowCard className="h-full">
      <div className="flex items-center gap-2.5 mb-3">
        <IconSquare size={32} color={GOLD}><ShieldQuestion className="w-4 h-4" style={{ color: GOLD }} /></IconSquare>
        <p className="text-[14px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>Panorama de riesgos</p>
      </div>
      <p className="text-[12.5px] leading-[19px] mb-3.5" style={{ color: "var(--sub)" }}>{panoramaSummary(cats)}</p>
      <div className="flex flex-wrap gap-1.5">
        {cats.map(({ category, count }) => {
          const Icon = categoryIcon(category);
          return (
            <span
              key={category}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              <Icon className="w-3 h-3" style={{ color: GOLD }} />
              {_RISK_CATEGORY_LABEL[category] ?? category}
              {count > 1 && <span style={{ color: "var(--sub)" }}>· {count}</span>}
            </span>
          );
        })}
      </div>
    </GlowCard>
  );
}

// Panel "Qué tendría que cambiar" — una síntesis real: cada bala viene
// literalmente del campo `watch_indicator` ya persistido de cada riesgo (en
// el mismo orden del arreglo), nunca un escenario nuevo. Solo se deduplican
// textos EXACTAMENTE iguales (comparación insensible a mayúsculas/espacios);
// nada se reescribe ni se resume con pérdida de significado.
function watchIndicatorBullets(risks: QualitativeRisk[]): string[] {
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const r of risks) {
    const text = (r.watch_indicator || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(text);
  }
  return bullets;
}

function WhatToWatchPanel({ risks }: { risks: QualitativeRisk[] }) {
  const bullets = watchIndicatorBullets(risks);
  if (bullets.length === 0) return null;
  return (
    <GlowCard className="h-full">
      <div className="flex items-center gap-2.5 mb-3">
        <IconSquare size={32} color={GOLD}><CheckCircle2 className="w-4 h-4" style={{ color: GOLD }} /></IconSquare>
        <p className="text-[14px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>Qué tendría que cambiar</p>
      </div>
      <p className="text-[11px] leading-[16px] mb-3" style={{ color: "var(--dim)" }}>
        Señales a futuro, no hechos ya confirmados — su certeza es menor a la del resto del análisis de cada riesgo.
      </p>
      <ul className="space-y-2.5">
        {bullets.map((text, i) => (
          <li key={i} className="flex items-start gap-2 text-[12.5px] leading-[18px]" style={{ color: "var(--sub)" }}>
            <span className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: GOLD }} />
            {text}
          </li>
        ))}
      </ul>
    </GlowCard>
  );
}

// Exposición real de portafolio — Diego, tercera ronda: "cómo podría
// impactar a su portafolio (en caso de que ya la tenga y aumente posición o
// de que la compre por primera vez)". Usa EXCLUSIVAMENTE datos reales ya
// disponibles en el cliente: la sesión real (useAuthStore, la misma que usa
// el resto de la app — nunca se simula un login) y las posiciones reales del
// usuario (usePortfolioStore, el mismo store que alimenta /portfolio).
// Precios: se reutiliza marketApi.getPrices (el mismo endpoint real que
// /portfolio ya usa para valuar posiciones) — NINGÚN endpoint nuevo. Si la
// llamada de precios falla, se usa avgPrice como respaldo, exactamente el
// mismo patrón de /portfolio (`pricesData[t]?.price ?? p.avgPrice`), nunca
// un valor inventado.
// Nunca se muestra una pérdida en dólares bajo un escenario hipotético — eso
// sería exactamente el tipo de impacto/probabilidad inventado que Diego
// prohibió. Solo exposición real de hoy (valor de la posición ÷ valor total
// del portafolio, ambos reales).
function PortfolioExposureNote({ ticker, companyName }: { ticker: string; companyName: string }) {
  const { isAuthenticated } = useAuthStore();
  const { positions } = usePortfolioStore();
  const [prices, setPrices] = useState<Record<string, { price?: number }>>({});

  useEffect(() => {
    if (!isAuthenticated || positions.length === 0) return;
    let cancelled = false;
    marketApi
      .getPrices(positions.map((p) => p.ticker))
      .then((res) => { if (!cancelled) setPrices(res.data || {}); })
      .catch(() => { /* respaldo silencioso a avgPrice, mismo patrón que /portfolio */ });
    return () => { cancelled = true; };
  }, [isAuthenticated, positions]);

  if (!isAuthenticated) return null; // nunca se simula una sesión

  const held = positions.find((p) => p.ticker === ticker);

  if (positions.length === 0) {
    return (
      <GlowCard>
        <div className="flex items-start gap-3">
          <IconDot color={GOLD} size={30}><Wallet className="w-3.5 h-3.5" /></IconDot>
          <p className="text-[12.5px] leading-[19px] flex-1" style={{ color: "var(--sub)" }}>
            Todavía no tienes posiciones registradas en Nuvos. Si consideras comprar {companyName} por primera vez,
            estos son los riesgos que formarían parte de tu decisión.
          </p>
        </div>
      </GlowCard>
    );
  }

  if (!held) {
    return (
      <GlowCard>
        <div className="flex items-start gap-3">
          <IconDot color={GOLD} size={30}><Wallet className="w-3.5 h-3.5" /></IconDot>
          <p className="text-[12.5px] leading-[19px] flex-1" style={{ color: "var(--sub)" }}>
            No tienes actualmente una posición en {ticker}. Si consideras comprarla por primera vez,
            estos son los riesgos que formarían parte de tu decisión.
          </p>
        </div>
      </GlowCard>
    );
  }

  const valueOf = (p: { ticker: string; shares: number; avgPrice: number }) =>
    p.shares * (prices[p.ticker]?.price ?? p.avgPrice);
  const totalValue = positions.reduce((sum, p) => sum + valueOf(p), 0);
  const thisValue = valueOf(held);
  const pct = totalValue > 0 ? (thisValue / totalValue) * 100 : null;

  return (
    <GlowCard tint={GOLD}>
      <div className="flex items-start gap-3">
        <IconDot color={GOLD} size={30}><Wallet className="w-3.5 h-3.5" /></IconDot>
        <div className="flex-1">
          <p className="text-[12.5px] leading-[19px]" style={{ color: "var(--text)" }}>
            Ya tienes una posición en {ticker}
            {pct != null && (
              <>: representa aproximadamente el <span className="font-black" style={{ color: GOLD }}>{pct.toFixed(1)}%</span> de tu portafolio actual</>
            )}
            {" "}({held.shares.toLocaleString("en-US")} acciones, ${thisValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}).
            Si aumentaras tu posición, estos riesgos aplicarían también a esa parte adicional.
          </p>
        </div>
      </div>
    </GlowCard>
  );
}

function RiskCard({ risk, index, total }: { risk: QualitativeRisk; index: number; total: number }) {
  const { headline, summary, detail } = splitExplanation(risk.explanation);
  const hasMore = Boolean(detail || risk.evidence || risk.watch_indicator || risk.uncertainty || risk.source_name);
  const Icon = categoryIcon(risk.category);

  return (
    <div
      className="rounded-2xl p-5 sm:p-6 border border-[var(--border)] hover:border-[rgba(212,162,76,0.35)] transition-colors duration-200"
      style={{ background: "var(--card)" }}
    >
      <div className="flex items-center gap-2.5 mb-2.5">
        <IconDot color={GOLD} size={26}><Icon className="w-3.5 h-3.5" /></IconDot>
        <p className="text-[10.5px] font-extrabold uppercase tracking-wide" style={{ color: "var(--dim)" }}>
          Riesgo {index + 1} de {total} · {_RISK_CATEGORY_LABEL[risk.category] ?? risk.category}
        </p>
      </div>

      <h3 className="text-[16.5px] sm:text-[18px] leading-[24px] sm:leading-[26px] font-black mb-2" style={{ color: "var(--text)" }}>
        {headline}
      </h3>

      {summary && (
        <p className="text-[13px] leading-[20px] mb-1" style={{ color: "var(--sub)" }}>
          {summary}
        </p>
      )}

      {hasMore && (
        <div className="mt-3.5">
          <ExpandRow headline="Explorar este riesgo">
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Pill label={_FACT_TYPE_LABEL[risk.fact_type]} color={_FACT_TYPE_COLOR[risk.fact_type]} />
                <Pill label={_CONFIDENCE_LABEL[risk.confidence]} color={_CONFIDENCE_COLOR[risk.confidence]} />
              </div>

              {detail && (
                <div>
                  <p className="text-[9.5px] uppercase tracking-wide font-extrabold mb-1" style={{ color: "var(--dim)" }}>Por qué importa</p>
                  <p className="text-[12.5px] leading-[19px]" style={{ color: "var(--sub)" }}>{detail}</p>
                </div>
              )}

              {risk.evidence && (
                <div>
                  <p className="text-[9.5px] uppercase tracking-wide font-extrabold mb-1" style={{ color: "var(--dim)" }}>Evidencia disponible</p>
                  <p className="text-[12.5px] leading-[19px]" style={{ color: "var(--sub)" }}>{risk.evidence}</p>
                </div>
              )}

              {risk.watch_indicator && (
                <div>
                  <p className="text-[9.5px] uppercase tracking-wide font-extrabold mb-1" style={{ color: "var(--dim)" }}>Qué debería vigilar el inversionista</p>
                  <p className="text-[12.5px] leading-[19px]" style={{ color: "var(--sub)" }}>{risk.watch_indicator}</p>
                  {/* Ajuste de producto #2 — el fact_type de arriba describe la
                      tarjeta completa, no esta frase en particular: es, por
                      naturaleza, una proyección a futuro. */}
                  <p className="text-[10.5px] leading-[15px] mt-1.5 italic" style={{ color: "var(--dim)" }}>
                    Esto describe algo que todavía podría ocurrir, no un hecho ya confirmado — su certeza es menor a la
                    del resto de esta tarjeta, incluso cuando está etiquetada como &quot;{_FACT_TYPE_LABEL[risk.fact_type]}&quot;.
                  </p>
                </div>
              )}

              {risk.uncertainty && (
                <div>
                  <p className="text-[9.5px] uppercase tracking-wide font-extrabold mb-1" style={{ color: "var(--dim)" }}>Incertidumbres y límites de este análisis</p>
                  <p className="text-[12.5px] leading-[19px]" style={{ color: "var(--sub)" }}>{risk.uncertainty}</p>
                </div>
              )}

              {risk.source_name && <SourceLinks raw={risk.source_name} />}
            </div>
          </ExpandRow>
        </div>
      )}
    </div>
  );
}

function EmptyRiskState() {
  return (
    <GlowCard>
      <div className="flex items-start gap-3 py-2">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: GOLD }} />
        <div>
          <p className="text-[13.5px] font-bold mb-1" style={{ color: "var(--text)" }}>Todavía no hay riesgos publicados para esta empresa</p>
          <p className="text-[12.5px] leading-[19px]" style={{ color: "var(--sub)" }}>
            Nuvos solo muestra contenido editorial ya publicado y vigente. Cuando esté disponible, aquí aparecerán
            los riesgos más relevantes del negocio, con su evidencia y fuentes.
          </p>
        </div>
      </div>
    </GlowCard>
  );
}

export function RiesgosPreview({ data, editorial }: { data: FullCompanyDiagnosticData; editorial: QualitativeContentDraft | null }) {
  const { currentPrice } = data.valuation;
  const risks = editorial ? risksInPersistedOrder(editorial.risks) : [];

  return (
    <div className="max-w-[820px] mx-auto pb-10">
      {editorial?.review_status !== "published" && editorial != null && (
        <div
          className="rounded-xl px-3.5 py-2.5 mb-4 text-[11.5px] font-bold text-center"
          style={{ background: "rgba(212,162,76,0.12)", border: "1px dashed rgba(212,162,76,0.5)", color: GOLD }}
        >
          Vista previa interna — contenido editorial en borrador ({editorial.review_status}), no visible para usuarios reales.
        </div>
      )}

      {/* ── Encabezado: nombre, ticker, sector, precio y navegación ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <IconSquare size={48}><span className="text-lg font-black" style={{ color: "var(--text)" }}>{data.ticker.slice(0, 2)}</span></IconSquare>
          <div className="min-w-0">
            <p className="text-xl font-black tracking-tight truncate" style={{ color: "var(--text)" }}>{data.companyName}</p>
            <p className="text-[12.5px]" style={{ color: "var(--sub)" }}>
              {data.ticker} · {data.sector}
              {currentPrice != null && (
                <> · <span style={{ color: "var(--text)", fontWeight: 700 }}>{fmtPrice(currentPrice)}</span></>
              )}
            </p>
          </div>
        </div>
        <TabNav active="riesgos" ticker={data.ticker} />
      </div>

      {/* ── Título de la pestaña — número real de riesgos disponibles ── */}
      <div className="mb-7 px-1">
        <p className="text-[22px] md:text-[27px] font-black tracking-tight mb-2" style={{ color: "var(--text)" }}>
          ¿Qué podría salir mal?
        </p>
        <p className="text-[13.5px] leading-[20px]" style={{ color: "var(--sub)" }}>
          Conoce los principales riesgos que podrían afectar el negocio y qué señales conviene seguir.
          {risks.length > 0 && (
            <>{" "}Nuvos identificó {risks.length} riesgo{risks.length > 1 ? "s" : ""} con evidencia disponible para {data.companyName}.</>
          )}
        </p>
      </div>

      {/* ── Panorama + qué vigilar + exposición real de portafolio — todo
          derivado de campos reales ya persistidos, sin score global ni
          gráfica impacto/probabilidad (decisión explícita de Diego, ver
          nota de cabecera). ── */}
      {risks.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-7">
          <PanoramaPanel risks={risks} />
          <WhatToWatchPanel risks={risks} />
        </div>
      )}
      {risks.length > 0 && (
        <div className="mb-7">
          <PortfolioExposureNote ticker={data.ticker} companyName={data.companyName} />
        </div>
      )}

      {/* ── Lista completa, en el orden ya persistido (ver nota de
          cabecera, ajuste #1) — sin agrupar por categoría (Diego: no
          forzar agrupaciones si empeoran la lectura), sin recortar a un
          top-3 (esta ES la pestaña de profundidad). Más espacio entre
          tarjetas que en la primera versión (gap-5 en vez de gap-3). ── */}
      {risks.length > 0 ? (
        <div className="flex flex-col gap-5">
          {risks.map((risk, i) => <RiskCard key={i} risk={risk} index={i} total={risks.length} />)}
        </div>
      ) : (
        <EmptyRiskState />
      )}

      <p className="text-[10.5px] text-center mt-7" style={{ color: "var(--sub)" }}>
        Esta información es educativa y no constituye una recomendación de compra o venta.
      </p>
    </div>
  );
}
