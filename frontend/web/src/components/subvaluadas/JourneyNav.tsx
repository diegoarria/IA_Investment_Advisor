"use client";

// JourneyNav — Diego, 2026-11-15 ("INTEGRACIÓN DEFINITIVA DEL RECORRIDO"):
// shared navigation for the 7-phase guided journey (Entender el negocio →
// Entender las finanzas → Conocer a quienes dirigen → Entender la
// industria → Entender la valuación → Riesgos a vigilar → Mi tesis),
// built incrementally today as 7 separate files. This component does NOT
// touch any phase's educational content — it only replaces each phase's
// hand-rolled "Fase X de 7" tag with the same text turned into a compact
// jump-to-any-phase menu, and adds a bottom Anterior/Siguiente bar. The
// existing "← [previous phase]" top link stays exactly as each file
// already has it (untouched, not part of this component) so no phase's
// already-approved header layout shifts.
//
// Explicitly NOT a 7-tab horizontal strip (Diego vetoed that for mobile) —
// one compact dropdown instead.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { GOLD } from "@/components/subvaluadas/radarUi";

export const JOURNEY_PHASES = [
  { n: 1, slug: "entender-negocio", label: "Entender el negocio" },
  { n: 2, slug: "entender-finanzas", label: "Entender las finanzas" },
  { n: 3, slug: "conocer-liderazgo", label: "Conocer a quienes dirigen" },
  { n: 4, slug: "entender-industria", label: "Entender la industria" },
  { n: 5, slug: "entender-valuacion", label: "Entender la valuación" },
  { n: 6, slug: "riesgos-a-vigilar", label: "Riesgos a vigilar" },
  { n: 7, slug: "construir-tesis", label: "Mi tesis" },
] as const;

function journeyHref(ticker: string, slug: string): string {
  return `/subvaluadas/resumen-preview/${ticker}/${slug}`;
}

/** Drop-in replacement for the plain "Fase X de 7 · El recorrido completo"
 * <p> every phase already renders — same text/classes at rest, but now a
 * button that opens a compact list of all 7 phases to jump to directly. */
export function PhaseJumpMenu({ ticker, phase }: { ticker: string; phase: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[12px] font-black uppercase tracking-wide flex items-center gap-1"
        style={{ color: "var(--sub)" }}
      >
        Fase {phase} de 7 · El recorrido completo
        <ChevronDown className="w-3 h-3" style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-7 z-20 rounded-xl p-1.5 w-[260px] max-w-[80vw]"
            style={{ background: "var(--raised)", border: "1px solid var(--border)", boxShadow: "0 18px 40px -16px rgba(0,0,0,0.6)" }}
          >
            {JOURNEY_PHASES.map((p) => (
              <a
                key={p.slug}
                href={journeyHref(ticker, p.slug)}
                className="block rounded-lg px-3 py-2 text-[12.5px] font-bold text-left"
                style={{
                  color: p.n === phase ? GOLD : "var(--text)",
                  background: p.n === phase ? "rgba(212,162,76,0.12)" : "transparent",
                }}
              >
                Fase {p.n} · {p.label}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Anterior/Siguiente bar — appended at the bottom of each phase, below
 * whatever closing note that phase already has. Purely additive. */
export function JourneyBottomNav({ ticker, phase }: { ticker: string; phase: number }) {
  const prev = JOURNEY_PHASES.find((p) => p.n === phase - 1);
  const next = JOURNEY_PHASES.find((p) => p.n === phase + 1);
  return (
    <div className="mt-5 pt-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderTop: "1px solid var(--border)" }}>
      {prev ? (
        <a href={journeyHref(ticker, prev.slug)} className="text-[13.5px] font-bold" style={{ color: "var(--sub)" }}>
          ← Fase {prev.n}: {prev.label}
        </a>
      ) : (
        <a href={`/subvaluadas/resumen-preview/${ticker}`} className="text-[13.5px] font-bold" style={{ color: "var(--sub)" }}>
          ← Volver a Resumen
        </a>
      )}
      {next ? (
        <a href={journeyHref(ticker, next.slug)} className="text-[13.5px] font-bold" style={{ color: GOLD }}>
          Siguiente: Fase {next.n} {next.label} →
        </a>
      ) : (
        <span className="text-[13px] font-bold" style={{ color: "var(--sub)" }}>
          Has llegado al final del recorrido guiado.
        </span>
      )}
    </div>
  );
}
