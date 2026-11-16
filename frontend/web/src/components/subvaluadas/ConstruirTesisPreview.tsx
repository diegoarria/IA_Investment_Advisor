"use client";

// ConstruirTesisPreview — Nuvos Radar 2.0, Fase 7 (última) of the 7-phase
// learning journey. Diego, 2026-11-15: a mentor-style, one-question-at-a-
// time guided wizard that helps the user ORGANIZE their own opinion after
// walking through Fases 1-6 — never a recommendation, never an invented
// thesis. This is explicitly a DIFFERENT UI pattern than the existing main
// "Mi tesis" tab (MiTesisPreview.tsx — a single-screen chip form, already
// built earlier today): that tab stays untouched; this is a new, separate,
// step-by-step experience that lives only inside the guided journey.
//
// Inspected before building (per Diego's explicit ask), per his own
// instruction NOT to auto-reuse either if it doesn't fit:
//   - MiTesisPreview.tsx (main tab): single-screen, chip-based, persisted to
//     localStorage per ticker, with an explicit "solo local" disclaimer.
//     Different shape (no step-by-step, no mentor-contextual links) — not
//     reused directly, but its "never claim real account persistence"
//     discipline IS reused here.
//   - Legacy `user_investment_theses` (backend/app/api/routes/
//     research_engine.py, migration 061/062): free-text, versioned,
//     fork-from-draft, requires an authenticated session
//     (`get_current_user_id`). Confirmed orphaned — no live screen uses it.
//     Does not fit this chip/step shape and requires auth, which would
//     break the no-login preview pattern every phase uses. NOT reused.
//     Integrating any of these three (this wizard, the main tab, the
//     legacy backend) is an explicitly open/deferred decision — not made
//     here.
//
// Persistence: in-memory React state ONLY for this round (no localStorage,
// no Supabase write) — Diego: "mantener las respuestas TEMPORALMENTE en
// estado local... no presentar localStorage como almacenamiento permanente
// o seguro... no activar guardado real sin autenticación." Reloading the
// page loses all answers; the UI says so explicitly, never implying any
// account-level save.
//
// Visual language duplicated locally from Fases 1-6 (Nivel1Block, the
// draft-banner/header/"← Volver"/"Fase 7 de 7"/closing-note pattern) — same
// per-file-duplication convention every phase this session has used, to
// avoid ever modifying an earlier, already-approved phase's file.
//
// Q3's "qué te preocupa" options and Q5's "qué podría cambiar tu opinión"
// options are REAL, extracted from the same editorial risks/moat content
// every other phase/tab already reads (local fixture for the 5 draft
// pilots, real public endpoint otherwise) — never invented. Q4 shows the
// REAL current price and REAL estimated value as neutral context; the
// answer itself is the user's own subjective judgment, never pre-selected
// or hinted from Nuvos's own verdict.

import { useState } from "react";
import {
  HelpCircle, Lightbulb, AlertTriangle, DollarSign, Compass, Clock,
  ArrowLeft, ArrowRight, Pencil, ClipboardList,
} from "lucide-react";
import { GlowCard, IconSquare, GOLD } from "@/components/subvaluadas/radarUi";
import { fmtPrice } from "@/lib/types/stock";
import type { QualitativeContentDraft } from "@/components/subvaluadas/ResumenPreview";
import { PhaseJumpMenu, JourneyBottomNav } from "@/components/subvaluadas/JourneyNav";
import type { FullCompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

// Misma extracción por puntuación real que Fases 1 y 6 ya usan (duplicada
// localmente, nunca importada entre archivos de fase) — nunca el párrafo
// completo como etiqueta de una opción seleccionable.
const CLAUSE_BOUNDARY_RE = /[:;—]|\.(?=\s+[A-ZÁÉÍÓÚÑ]|\s*$)/;
function headlineOf(text: string): string {
  const clean = (text || "").trim();
  if (!clean) return "";
  const m = clean.match(CLAUSE_BOUNDARY_RE);
  if (!m || m.index == null) return clean;
  const h = clean.slice(0, m.index).trim();
  return h || clean;
}

const NO_SE = "__no_se__";
const OTRO = "__otro__";

function Nivel1Block({
  icon, iconColor = GOLD, title, idea, children,
}: { icon: React.ReactNode; iconColor?: string; title: string; idea?: string; children?: React.ReactNode }) {
  return (
    <GlowCard
      tint={iconColor}
      className="transition-shadow duration-300 hover:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.55)]"
      style={{ boxShadow: "0 14px 32px -20px rgba(0,0,0,0.5)" }}
    >
      <div className="flex items-center gap-3 mb-3">
        <IconSquare color={iconColor} size={38}>{icon}</IconSquare>
        <p className="text-[21px] font-black tracking-tight" style={{ color: "var(--text)" }}>{title}</p>
      </div>
      {idea && <p className="text-[16px] leading-6 mb-4" style={{ color: "var(--sub)" }}>{idea}</p>}
      {children}
    </GlowCard>
  );
}

function OptionChip({
  label, selected, onClick,
}: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-2xl px-4 py-3 text-[15px] font-semibold transition-colors"
      style={
        selected
          ? { background: "rgba(212,162,76,0.14)", border: `1.5px solid ${GOLD}`, color: "var(--text)" }
          : { background: "rgba(127,127,127,0.05)", border: "1px solid var(--border)", color: "var(--text)" }
      }
    >
      {label}
    </button>
  );
}

// --- Las 6 preguntas -------------------------------------------------

type Q1 = "bueno" | "dudas" | "no_convence" | typeof NO_SE | null;
type Q4 = "razonable" | "elevado" | "no_info" | null;
type Q6 = "corto" | "medio" | "largo" | typeof NO_SE | null;

interface ThesisAnswers {
  q1: Q1;
  q2: string[];
  q3: string[];
  q4: Q4;
  q5: string[];
  q5Own: string;
  q6: Q6;
}

const EMPTY_ANSWERS: ThesisAnswers = { q1: null, q2: [], q3: [], q4: null, q5: [], q5Own: "", q6: null };

const Q2_OPTIONS = [
  { key: "ventaja", label: "Ventaja competitiva" },
  { key: "crecimiento", label: "Crecimiento" },
  { key: "rentabilidad", label: "Rentabilidad" },
  { key: "efectivo", label: "Generación de efectivo" },
  { key: OTRO, label: "Otro motivo" },
];

const Q6_OPTIONS: { key: Q6; label: string }[] = [
  { key: "corto", label: "Menos de 3 años" },
  { key: "medio", label: "De 3 a 5 años" },
  { key: "largo", label: "Más de 5 años" },
  { key: NO_SE, label: "Todavía no lo sé" },
];

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function ConstruirTesisPreview({
  data, editorial,
}: { data: FullCompanyDiagnosticData; editorial: QualitativeContentDraft | null }) {
  const [step, setStep] = useState(0); // 0-5 = preguntas, 6 = resumen
  const [a, setA] = useState<ThesisAnswers>(EMPTY_ANSWERS);

  const risks = editorial?.risks ?? [];
  const riskOptions = risks.map((r) => ({ headline: headlineOf(r.explanation), category: r.category }));
  const moatConcerns = (editorial?.moat ?? [])
    .map((m) => headlineOf(m.weakening_factors))
    .filter((h) => h.length > 0);
  const q5Options = Array.from(new Set([...riskOptions.map((r) => r.headline), ...moatConcerns])).slice(0, 6);

  const { currentPrice, baseFairValue } = data.valuation;

  const concernedAboutCompetition = a.q3.some((h) => {
    const r = riskOptions.find((o) => o.headline === h);
    return r?.category === "competencia" || r?.category === "tecnologia_disrupcion";
  });
  const unsureAboutValuation = a.q4 === "no_info";

  const totalQuestions = 6;
  const isSummary = step === totalQuestions;

  function next() {
    setStep((s) => Math.min(s + 1, totalQuestions));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }
  function goTo(s: number) {
    setStep(s);
  }

  return (
    <div className="max-w-[760px] mx-auto pb-10">
      <div
        className="rounded-xl px-3.5 py-2.5 mb-4 text-[15px] font-bold text-center"
        style={{ background: "rgba(212,162,76,0.12)", border: "1px dashed rgba(212,162,76,0.5)", color: "#D4A24C" }}
      >
        Prototipo interno — Radar 2.0, Fase 7 de 7, no visible para usuarios reales.
      </div>

      <div className="flex items-center justify-between gap-4 mb-2">
        <a href={`/subvaluadas/resumen-preview/${data.ticker}/riesgos-a-vigilar`} className="text-[16.5px] font-bold" style={{ color: "var(--sub)" }}>
          ← Riesgos a vigilar
        </a>
        <PhaseJumpMenu ticker={data.ticker} phase={7} />
      </div>
      <div className="flex items-center gap-3.5 mb-8">
        <IconSquare size={48}><span className="text-lg font-black" style={{ color: "var(--text)" }}>{data.ticker.slice(0, 2)}</span></IconSquare>
        <div className="min-w-0">
          <p className="text-[28px] font-black tracking-tight" style={{ color: "var(--text)" }}>Mi tesis</p>
          <p className="text-[16.5px]" style={{ color: "var(--sub)" }}>
            {data.companyName} · {data.ticker} · {data.sector}
            {currentPrice != null && <> · {fmtPrice(currentPrice)}</>}
          </p>
        </div>
      </div>

      {!isSummary && (
        <p className="text-[13px] font-bold uppercase tracking-wide mb-3" style={{ color: "var(--sub)" }}>
          Pregunta {step + 1} de {totalQuestions}
        </p>
      )}

      {step === 0 && (
        <Nivel1Block icon={<HelpCircle className="w-4 h-4" style={{ color: GOLD }} />} title="¿Qué piensas del negocio?">
          <div className="grid gap-2.5">
            <OptionChip label="Me parece un buen negocio" selected={a.q1 === "bueno"} onClick={() => setA({ ...a, q1: "bueno" })} />
            <OptionChip label="Todavía tengo dudas" selected={a.q1 === "dudas"} onClick={() => setA({ ...a, q1: "dudas" })} />
            <OptionChip label="No me convence" selected={a.q1 === "no_convence"} onClick={() => setA({ ...a, q1: "no_convence" })} />
            <OptionChip label="No lo sé todavía" selected={a.q1 === NO_SE} onClick={() => setA({ ...a, q1: NO_SE })} />
          </div>
        </Nivel1Block>
      )}

      {step === 1 && (
        <Nivel1Block icon={<Lightbulb className="w-4 h-4" style={{ color: GOLD }} />} title="¿Qué es lo que más te interesa?">
          <div className="grid gap-2.5">
            {Q2_OPTIONS.map((o) => (
              <OptionChip key={o.key} label={o.label} selected={a.q2.includes(o.key)} onClick={() => setA({ ...a, q2: toggleInList(a.q2, o.key) })} />
            ))}
          </div>
        </Nivel1Block>
      )}

      {step === 2 && (
        <Nivel1Block
          icon={<AlertTriangle className="w-4 h-4" style={{ color: GOLD }} />}
          title="¿Qué es lo que más te preocupa?"
          idea={riskOptions.length > 0 ? "Puedes elegir más de una." : "Todavía no hay riesgos editoriales publicados para esta empresa."}
        >
          <div className="grid gap-2.5">
            {riskOptions.map((o) => (
              <OptionChip key={o.headline} label={o.headline} selected={a.q3.includes(o.headline)} onClick={() => setA({ ...a, q3: toggleInList(a.q3, o.headline) })} />
            ))}
            <OptionChip label="No lo sé / necesito investigar más" selected={a.q3.includes(NO_SE)} onClick={() => setA({ ...a, q3: toggleInList(a.q3, NO_SE) })} />
          </div>
          {concernedAboutCompetition && (
            <p className="mt-3 text-[13.5px]" style={{ color: "var(--sub)" }}>
              Puedes volver a revisar cómo compite {data.companyName} y qué podría cambiar su industria en{" "}
              <a href={`/subvaluadas/resumen-preview/${data.ticker}/entender-industria`} className="font-bold" style={{ color: GOLD }}>
                Fase 4: Entender la industria →
              </a>
            </p>
          )}
        </Nivel1Block>
      )}

      {step === 3 && (
        <Nivel1Block icon={<DollarSign className="w-4 h-4" style={{ color: GOLD }} />} title="¿Qué opinas del precio frente al valor estimado?">
          <div className="rounded-2xl p-3.5 mb-4" style={{ background: "rgba(127,127,127,0.05)", border: "1px solid var(--border)" }}>
            <p className="text-[14px]" style={{ color: "var(--sub)" }}>
              Precio actual: <strong style={{ color: "var(--text)" }}>{currentPrice != null ? fmtPrice(currentPrice) : "no disponible"}</strong>
              {" · "}Valor estimado por Nuvos: <strong style={{ color: "var(--text)" }}>{baseFairValue != null ? fmtPrice(baseFairValue) : "no disponible"}</strong>
            </p>
            <p className="text-[12.5px] mt-1" style={{ color: "var(--sub)" }}>
              El valor estimado es una estimación de Nuvos sujeta a supuestos, no un hecho — esta es tu propia opinión, no la nuestra.
            </p>
          </div>
          <div className="grid gap-2.5">
            <OptionChip label="Me parece razonable" selected={a.q4 === "razonable"} onClick={() => setA({ ...a, q4: "razonable" })} />
            <OptionChip label="Me parece elevado" selected={a.q4 === "elevado"} onClick={() => setA({ ...a, q4: "elevado" })} />
            <OptionChip label="No tengo suficiente información" selected={a.q4 === "no_info"} onClick={() => setA({ ...a, q4: "no_info" })} />
          </div>
          {unsureAboutValuation && (
            <p className="mt-3 text-[13.5px]" style={{ color: "var(--sub)" }}>
              Puedes revisar cómo llegamos a este valor en{" "}
              <a href={`/subvaluadas/resumen-preview/${data.ticker}/entender-valuacion`} className="font-bold" style={{ color: GOLD }}>
                Fase 5: Entender la valuación →
              </a>
            </p>
          )}
        </Nivel1Block>
      )}

      {step === 4 && (
        <Nivel1Block
          icon={<Compass className="w-4 h-4" style={{ color: GOLD }} />}
          title="¿Qué podría hacerte cambiar de opinión?"
          idea="Elige lo que ya identificamos, o escribe la tuya."
        >
          <div className="grid gap-2.5 mb-3">
            {q5Options.map((o) => (
              <OptionChip key={o} label={o} selected={a.q5.includes(o)} onClick={() => setA({ ...a, q5: toggleInList(a.q5, o) })} />
            ))}
          </div>
          <textarea
            value={a.q5Own}
            onChange={(e) => setA({ ...a, q5Own: e.target.value })}
            placeholder="Escribe algo propio (opcional)…"
            rows={2}
            className="w-full rounded-xl px-3 py-2.5 text-[14px]"
            style={{ background: "rgba(127,127,127,0.05)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
        </Nivel1Block>
      )}

      {step === 5 && (
        <Nivel1Block icon={<Clock className="w-4 h-4" style={{ color: GOLD }} />} title="¿Cuál es tu horizonte?">
          <div className="grid gap-2.5">
            {Q6_OPTIONS.map((o) => (
              <OptionChip key={o.key} label={o.label} selected={a.q6 === o.key} onClick={() => setA({ ...a, q6: o.key })} />
            ))}
          </div>
        </Nivel1Block>
      )}

      {isSummary && (
        <Nivel1Block icon={<ClipboardList className="w-4 h-4" style={{ color: GOLD }} />} title={`Mi tesis sobre ${data.companyName}`}>
          <div className="space-y-4">
            <SummaryRow label="Mi opinión actual" value={q1Label(a.q1)} onEdit={() => goTo(0)} />
            <SummaryRow label="Qué me interesa" value={listLabel(a.q2, Q2_OPTIONS)} onEdit={() => goTo(1)} />
            <SummaryRow label="Qué me preocupa" value={a.q3.filter((v) => v !== NO_SE).join(" · ") || (a.q3.includes(NO_SE) ? "Todavía no lo sé" : "")} onEdit={() => goTo(2)} />
            <SummaryRow label="Qué pienso del precio" value={q4Label(a.q4)} onEdit={() => goTo(3)} />
            <SummaryRow label="Qué podría cambiar mi opinión" value={[...a.q5, a.q5Own].filter(Boolean).join(" · ")} onEdit={() => goTo(4)} />
            <SummaryRow label="Mi horizonte" value={q6Label(a.q6)} onEdit={() => goTo(5)} />
          </div>
          <p className="mt-5 text-[12.5px] leading-5" style={{ color: "var(--sub)" }}>
            Esto refleja únicamente lo que elegiste — no es una recomendación de Nuvos ni una evaluación de si tu decisión es buena o mala.
            Tus respuestas solo existen en esta sesión del navegador: se pierden si recargas la página. El guardado permanente en tu cuenta todavía no está disponible.
          </p>
        </Nivel1Block>
      )}

      <div className="flex items-center justify-between mt-5">
        <button
          type="button"
          onClick={back}
          disabled={step === 0}
          className="flex items-center gap-1.5 text-[14px] font-bold disabled:opacity-30"
          style={{ color: "var(--sub)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Atrás
        </button>
        {!isSummary && (
          <button
            type="button"
            onClick={next}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[14px] font-bold"
            style={{ background: GOLD, color: "#1A1A1A" }}
          >
            {step === totalQuestions - 1 ? "Ver mi tesis" : "Siguiente"} <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      <p className="text-[13.5px] text-center mt-6" style={{ color: "var(--sub)" }}>
        <AlertTriangle className="inline w-3 h-3 mr-1 -mt-0.5" />
        Esta información es educativa y no constituye una recomendación de compra o venta.
      </p>

      <JourneyBottomNav ticker={data.ticker} phase={7} />
    </div>
  );
}

function SummaryRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="min-w-0">
        <p className="text-[12px] font-black uppercase tracking-wide mb-0.5" style={{ color: "var(--sub)" }}>{label}</p>
        <p className="text-[15px] leading-5 font-semibold" style={{ color: "var(--text)" }}>{value || "Sin responder"}</p>
      </div>
      <button type="button" onClick={onEdit} className="flex items-center gap-1 text-[12.5px] font-bold shrink-0" style={{ color: GOLD }}>
        <Pencil className="w-3 h-3" /> Editar
      </button>
    </div>
  );
}

function q1Label(v: Q1): string {
  if (v === "bueno") return "Me parece un buen negocio";
  if (v === "dudas") return "Todavía tengo dudas";
  if (v === "no_convence") return "No me convence";
  if (v === NO_SE) return "No lo sé todavía";
  return "";
}
function q4Label(v: Q4): string {
  if (v === "razonable") return "Me parece razonable";
  if (v === "elevado") return "Me parece elevado";
  if (v === "no_info") return "No tengo suficiente información";
  return "";
}
function q6Label(v: Q6): string {
  const found = Q6_OPTIONS.find((o) => o.key === v);
  return found ? found.label : "";
}
function listLabel(keys: string[], options: { key: string; label: string }[]): string {
  return keys.map((k) => options.find((o) => o.key === k)?.label ?? k).join(" · ");
}
