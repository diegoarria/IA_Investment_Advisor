"use client";

// VigilarRiesgosPreview — Nuvos Radar 2.0, Fase 6 of the 7-phase learning
// journey. Diego, 2026-11-15: split out of what used to be section C of a
// combined Fase 5 ("separar... en otra fase completamente aparte poner los
// riesgos, cada uno en su respectivo lugar, así hay más orden"). Same thin-
// re-presentation principle as before: no financial/editorial logic is
// re-derived here, every risk shown comes straight from the same real
// editorial content the full Riesgos tab (RiesgosPreview.tsx) already
// reads, via the same dual-source pattern (local fixture for the 5
// still-draft pilots, real public endpoint otherwise).
//
// Shows only the first 2 risks in the array's own PERSISTED order — never
// re-sorted, never a fabricated relevance/materiality score (the real
// schema has no such field; this is the same discipline established and
// re-confirmed across every Riesgos round this session) — with a link out
// to the full Riesgos tab for the complete list rather than re-implementing
// its entire depth locally ("no duplicar toda la pestaña de Riesgos").
//
// Visual language duplicated locally from Fases 1-5 (Nivel1Block, the
// icon-per-block decorative tint, the draft-banner/header/"← Volver"/
// "Fase X de 7"/closing-note pattern) — same convention every phase this
// session has used, to avoid ever modifying an earlier, already-approved
// phase's own file.

import type { ReactNode } from "react";
import { AlertTriangle, Scale, Cpu, Coins, Landmark, UserCheck, Factory, Settings2, Users, ShieldQuestion } from "lucide-react";
import { GlowCard, IconSquare, GOLD } from "@/components/subvaluadas/radarUi";
import { fmtPrice } from "@/lib/types/stock";
import {
  ExpandRow,
  SourceLinks,
  _RISK_CATEGORY_LABEL,
  type QualitativeContentDraft,
  type QualitativeRisk,
} from "@/components/subvaluadas/ResumenPreview";
import { PhaseJumpMenu, JourneyBottomNav } from "@/components/subvaluadas/JourneyNav";
import type { FullCompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

const ENTENDERLO_MEJOR = "Quiero entenderlo mejor";
const BLOCK_RED = "#D98C8C";

// Icono por categoría — identidad visual únicamente, nunca implica
// severidad. Mismo mapeo que la pestaña Riesgos completa (RiesgosPreview.tsx
// `_CATEGORY_ICON`), duplicado localmente por la misma convención que cada
// archivo de fase ya usa (nunca importar entre archivos de fase/pestaña).
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

// Misma extracción por puntuación real que la pestaña Riesgos completa usa
// (`splitExplanation`/`nextClause` en RiesgosPreview.tsx) — duplicada
// localmente, nunca importada entre archivos. Corta en ":", ";", "—", o un
// punto que de verdad cierra una oración (seguido de espacio+mayúscula o fin
// de texto) — nunca en una abreviatura como "EE.UU.". El texto de riesgos
// reales de GOOGL es a menudo UNA sola oración compuesta larga (con ";"/"—"
// internos no seguidos de mayúscula), así que cortar solo por oración no
// basta para acortarlo — por eso aquí, a diferencia de `firstSentence` de
// Fase 1, el límite también corta en ":"/";"/"—" incondicionalmente.
const CLAUSE_BOUNDARY_RE = /[:;—]|\.(?=\s+[A-ZÁÉÍÓÚÑ]|\s*$)/;
function nextClause(text: string): { clause: string; rest: string } | null {
  const m = text.match(CLAUSE_BOUNDARY_RE);
  if (!m || m.index == null) return null;
  const clause = text.slice(0, m.index).trim();
  if (!clause) return null;
  return { clause, rest: text.slice(m.index + m[0].length).trim() };
}
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

/** Same card wrapper as Fases 1-5's `Nivel1Block` (duplicated locally, same
 * established convention — never imported across phase files). */
function Nivel1Block({
  icon, iconColor = GOLD, title, idea, visual, expand,
}: {
  icon: ReactNode; iconColor?: string; title: string; idea: string; visual?: ReactNode; expand?: ReactNode;
}) {
  return (
    <GlowCard
      tint={iconColor}
      className="h-full flex flex-col transition-shadow duration-300 hover:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.55)]"
      style={{ boxShadow: "0 14px 32px -20px rgba(0,0,0,0.5)" }}
    >
      <div className="flex items-center gap-3 mb-1">
        <IconSquare color={iconColor} size={38}>{icon}</IconSquare>
        <p className="text-[21px] font-black tracking-tight" style={{ color: "var(--text)" }}>{title}</p>
      </div>
      <div className="flex-1 flex flex-col justify-center gap-4 py-3">
        <p className="text-[18px] leading-6 font-semibold" style={{ color: "var(--text)" }}>{idea}</p>
        {visual}
      </div>
      {expand && <ExpandRow headline={ENTENDERLO_MEJOR}>{expand}</ExpandRow>}
    </GlowCard>
  );
}

/** Una mini-tarjeta por riesgo: ícono de categoría + titular corto (nunca el
 * párrafo completo) + un expand propio con el detalle real completo, el
 * watch_indicator (con su nota de menor certeza) y las fuentes — nunca el
 * texto denso visible por defecto. */
function RiskCard({ risk }: { risk: QualitativeRisk }) {
  const Icon = categoryIcon(risk.category);
  const { headline, summary, detail } = splitExplanation(risk.explanation);
  const hasExpand = Boolean(detail || risk.watch_indicator || risk.uncertainty || risk.source_name);
  return (
    <div className="rounded-2xl p-3.5" style={{ background: "rgba(127,127,127,0.05)", border: "1px solid var(--border)" }}>
      <div className="flex items-start gap-2.5">
        <IconSquare color={BLOCK_RED} size={30}><Icon className="w-3.5 h-3.5" style={{ color: BLOCK_RED }} /></IconSquare>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-black uppercase tracking-wide mb-1" style={{ color: "var(--sub)" }}>
            {_RISK_CATEGORY_LABEL[risk.category] ?? risk.category}
          </p>
          <p className="text-[18px] leading-5 font-bold" style={{ color: "var(--text)" }}>{headline}</p>
          {summary && <p className="text-[15px] leading-5 mt-1" style={{ color: "var(--sub)" }}>{summary}</p>}
        </div>
      </div>
      {hasExpand && (
        <div className="mt-2.5">
          <ExpandRow headline="Ver detalle y fuentes">
            <div className="space-y-2">
              {detail && <p className="text-[15px] leading-5" style={{ color: "var(--sub)" }}>{detail}</p>}
              {risk.watch_indicator && (
                <p className="text-[16.5px] leading-5" style={{ color: "var(--sub)" }}>
                  <span className="font-bold" style={{ color: "var(--text)" }}>Qué vigilar: </span>
                  {risk.watch_indicator}
                  <span className="block mt-0.5 text-[12.5px] italic" style={{ color: "var(--sub)" }}>
                    Esto describe algo a futuro — tiene menos certeza que el resto de esta tarjeta.
                  </span>
                </p>
              )}
              {risk.uncertainty && (
                <p className="text-[13.5px] leading-5 italic" style={{ color: "var(--sub)" }}>{risk.uncertainty}</p>
              )}
              {risk.source_name && <SourceLinks raw={risk.source_name} />}
            </div>
          </ExpandRow>
        </div>
      )}
    </div>
  );
}

/** ¿Qué podría cambiar la estimación? — only the first 2 risks in the
 * editorial content's own PERSISTED order, with a link to the full Riesgos
 * tab rather than re-implementing its full depth here. */
function RiesgosAVigilar({ ticker, risks }: { ticker: string; risks: QualitativeRisk[] }) {
  const shown = risks.slice(0, 2);
  if (shown.length === 0) {
    return (
      <Nivel1Block
        icon={<AlertTriangle className="w-4 h-4" style={{ color: BLOCK_RED }} />}
        iconColor={BLOCK_RED}
        title="¿Qué deberíamos vigilar?"
        idea="Todavía no hay riesgos editoriales publicados para esta empresa."
      />
    );
  }
  return (
    <Nivel1Block
      icon={<AlertTriangle className="w-4 h-4" style={{ color: BLOCK_RED }} />}
      iconColor={BLOCK_RED}
      title="¿Qué deberíamos vigilar?"
      idea={`Nuvos identificó ${risks.length} riesgo${risks.length > 1 ? "s" : ""} con evidencia disponible — estos son los primeros ${shown.length}.`}
      visual={
        <div className="space-y-2.5">
          {shown.map((risk, i) => <RiskCard key={i} risk={risk} />)}
        </div>
      }
      expand={
        <a
          href={`/subvaluadas/resumen-preview/${ticker}/riesgos`}
          className="inline-block text-[13.5px] font-bold"
          style={{ color: GOLD }}
        >
          Ver todos los riesgos en la pestaña Riesgos →
        </a>
      }
    />
  );
}

export function VigilarRiesgosPreview({
  data, editorial,
}: { data: FullCompanyDiagnosticData; editorial: QualitativeContentDraft | null }) {
  const risks = editorial?.risks ?? [];

  return (
    <div className="max-w-[760px] mx-auto pb-10">
      <div
        className="rounded-xl px-3.5 py-2.5 mb-4 text-[15px] font-bold text-center"
        style={{ background: "rgba(212,162,76,0.12)", border: "1px dashed rgba(212,162,76,0.5)", color: "#D4A24C" }}
      >
        Prototipo interno — Radar 2.0, Fase 6 de 7, no visible para usuarios reales.
      </div>

      <div className="flex items-center justify-between gap-4 mb-2">
        <a href={`/subvaluadas/resumen-preview/${data.ticker}/entender-valuacion`} className="text-[16.5px] font-bold" style={{ color: "var(--sub)" }}>
          ← Entender la valuación
        </a>
        <PhaseJumpMenu ticker={data.ticker} phase={6} />
      </div>
      <div className="flex items-center gap-3.5 mb-8">
        <IconSquare size={48}><span className="text-lg font-black" style={{ color: "var(--text)" }}>{data.ticker.slice(0, 2)}</span></IconSquare>
        <div className="min-w-0">
          <p className="text-[28px] font-black tracking-tight" style={{ color: "var(--text)" }}>Riesgos a vigilar</p>
          <p className="text-[16.5px]" style={{ color: "var(--sub)" }}>
            {data.companyName} · {data.ticker} · {data.sector}
            {data.valuation.currentPrice != null && <> · {fmtPrice(data.valuation.currentPrice)}</>}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <RiesgosAVigilar ticker={data.ticker} risks={risks} />
      </div>

      <div className="mt-6 text-center">
        <a
          href={`/subvaluadas/resumen-preview/${data.ticker}/construir-tesis`}
          className="inline-block text-[16.5px] font-bold"
          style={{ color: GOLD }}
        >
          → Fase 7: Mi tesis
        </a>
      </div>
      <p className="text-[13.5px] text-center mt-3" style={{ color: "var(--sub)" }}>
        <AlertTriangle className="inline w-3 h-3 mr-1 -mt-0.5" />
        Esta información es educativa y no constituye una recomendación de compra o venta.
      </p>

      <JourneyBottomNav ticker={data.ticker} phase={6} />
    </div>
  );
}
