"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, CheckCircle2, X } from "lucide-react";
import { getUserLevel } from "@/lib/userLevel";
import { useProfileStore } from "@/lib/store";

const STEPS = [
  {
    id: "chat",
    emoji: "💬",
    title: "Habla con tu mentor IA",
    desc: "Pregúntale cualquier duda sobre inversiones — te responde en tu nivel, sin tecnicismos.",
    cta: "Ir al Chat",
    href: "/chat",
    hint: "Prueba: \"¿Qué es una acción y cómo gano dinero con ella?\"",
  },
  {
    id: "learn",
    emoji: "📚",
    title: "Aprende tu primer concepto",
    desc: "Elige un tema básico y la IA te lo explica en menos de 30 segundos con ejemplos reales.",
    cta: "Ir a Aprendizaje",
    href: "/learn",
    hint: "Recomendado: Capitalización de Mercado o CETES",
  },
  {
    id: "portfolio",
    emoji: "📊",
    title: "Agrega tu primera posición",
    desc: "Importa una captura de pantalla de tu broker o añade una acción manualmente para hacer seguimiento.",
    cta: "Ir a Portafolio",
    href: "/portfolio",
    hint: "Puedes usar una posición real o de práctica para empezar.",
  },
  {
    id: "simulator",
    emoji: "🎮",
    title: "Practica sin arriesgar dinero real",
    desc: "En el Simulador tomas decisiones en escenarios históricos reales y ves qué habría pasado.",
    cta: "Ir a Play",
    href: "/arena",
    hint: "No necesitas dinero real — es 100% educativo.",
  },
];

const STORAGE_KEY = "nuvos_guided_step";

export default function GuidedSteps({ currentPage }: { currentPage?: string }) {
  const { profile } = useProfileStore();
  const router = useRouter();
  const level = getUserLevel(profile);
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setStep(Math.min(parseInt(saved), STEPS.length));
  }, []);

  const advanceStep = () => {
    const next = Math.min(step + 1, STEPS.length);
    setStep(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  };

  const markDoneAndGo = (href: string) => {
    advanceStep();
    router.push(href);
  };

  // Only show for principiante (A) or básico (B)
  if (level !== "basico") return null;
  if (dismissed) return null;
  if (step >= STEPS.length) return null;

  // Skip step if we're already on that page
  const current = STEPS[step];
  const skipThisStep = currentPage && current.href.includes(currentPage);
  const displayStep = skipThisStep ? Math.min(step + 1, STEPS.length - 1) : step;
  if (displayStep >= STEPS.length) return null;

  const s = STEPS[displayStep];

  return (
    <div className="mx-4 mt-3 mb-1 rounded-2xl border overflow-hidden shrink-0"
         style={{ background: "var(--card)", borderColor: "rgba(0,168,94,0.3)" }}>
      {/* Accent + progress */}
      <div className="h-[3px] rounded-full" style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }} />
      <div className="px-4 py-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--accent-l)" }}>
              Guía rápida · Paso {displayStep + 1} de {STEPS.length}
            </span>
          </div>
          <button onClick={() => setDismissed(true)} className="shrink-0" style={{ color: "var(--dim)" }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Step progress dots */}
        <div className="flex gap-1.5 mb-3">
          {STEPS.map((_, i) => (
            <div key={i} className="h-1 flex-1 rounded-full transition-all"
                 style={{ background: i <= displayStep ? "var(--accent-l)" : "var(--border)" }} />
          ))}
        </div>

        {/* Current step */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-xl"
               style={{ background: "rgba(0,168,94,0.1)" }}>
            {s.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm leading-tight" style={{ color: "var(--text)" }}>{s.title}</p>
            <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--muted)" }}>{s.desc}</p>
            {s.hint && (
              <p className="text-[10px] mt-1.5 italic" style={{ color: "var(--dim)" }}>💡 {s.hint}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3">
          <button onClick={() => markDoneAndGo(s.href)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90"
                  style={{ background: "var(--accent-l)" }}>
            {s.cta} <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button onClick={advanceStep}
                  className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors hover:bg-white/5"
                  style={{ color: "var(--muted)", border: "1px solid var(--border)" }}>
            <CheckCircle2 className="w-3.5 h-3.5" />
            Ya lo hice
          </button>
        </div>
      </div>

      {/* Completed steps */}
      {displayStep > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {STEPS.slice(0, displayStep).map((done) => (
            <span key={done.id} className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(0,168,94,0.1)", color: "var(--accent-l)" }}>
              ✓ {done.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
