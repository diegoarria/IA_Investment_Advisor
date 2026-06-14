"use client";

import { useState } from "react";
import { useTutorialStore } from "@/lib/store";
import { X, ArrowRight, ArrowLeft } from "lucide-react";

const STEPS = [
  {
    emoji: "👋",
    color: "#00b96d",
    title: "Bienvenido a Nuvos AI",
    subtitle: "Tu mentor de inversiones con inteligencia artificial",
    desc: "Nuvos AI te enseña a pensar como un inversor profesional. No te decimos qué comprar — te enseñamos a analizar, entender y tomar decisiones por ti mismo.",
    tip: "Este tutorial dura menos de 2 minutos. Puedes saltarlo ahora y reabrirlo desde tu perfil cuando quieras.",
  },
  {
    emoji: "💬",
    color: "#00b96d",
    title: "Chat con tu mentor IA",
    subtitle: "La herramienta principal de Nuvos",
    desc: "Pregunta sobre cualquier empresa, ETF, concepto financiero o estrategia. La IA conoce tu perfil de riesgo, tu portafolio real y detecta si tus decisiones contradicen tu perfil declarado.",
    tip: "💡 Puedes editar un mensaje tuyo haciendo clic en el ícono de lápiz que aparece al lado.",
  },
  {
    emoji: "📊",
    color: "#3b82f6",
    title: "Portafolio",
    subtitle: "Analiza tus inversiones reales",
    desc: "Importa tus posiciones con una captura de pantalla de tu broker o manualmente. Obtén análisis de riesgo del portafolio, stress test en crisis históricas (2008, COVID) y simulaciones de rendimiento.",
    tip: "💡 El simulador proyecta tu portafolio en distintos escenarios de mercado.",
  },
  {
    emoji: "🎮",
    color: "#8b5cf6",
    title: "Simulador",
    subtitle: "Practica sin dinero real",
    desc: "Opera con $100,000 virtuales en mercados reales. Compra y vende acciones, sigue tus rendimientos y aprende a ejecutar estrategias sin arriesgar tu capital.",
    tip: "💡 El simulador usa precios reales del mercado en tiempo real.",
  },
  {
    emoji: "📚",
    color: "#06b6d4",
    title: "Aprendizaje",
    subtitle: "45+ temas financieros",
    desc: "Biblioteca de conceptos explicados con IA en menos de 2 minutos: ETFs, análisis fundamental, P/E, DCA, Value Investing, psicología del inversor y mucho más.",
    tip: "💡 Busca cualquier concepto financiero que no conozcas — la IA lo explica de forma clara.",
  },
  {
    emoji: "🔔",
    color: "#f97316",
    title: "Notificaciones & Watchlist",
    subtitle: "Mantente al tanto del mercado",
    desc: "Recibe alertas sobre movimientos del mercado relevantes para tu perfil. Agrega acciones a tu Watchlist y ve sus precios en tiempo real. La sección de Noticias filtra artículos de tus posiciones reales.",
    tip: "💡 Agrega acciones al Watchlist desde la sección de Portafolio para seguirlas aquí.",
  },
  {
    emoji: "🧠",
    color: "#a855f7",
    title: "Tu perfil e Insights IA",
    subtitle: "Conoce tu madurez como inversor",
    desc: "La IA analiza tu comportamiento real en la app — detecta si entras en pánico, si diversificas bien, si piensas a largo plazo — y te asigna una puntuación de Madurez Inversora (0-100) que evoluciona con el tiempo.",
    tip: "💡 Los insights del perfil te alertan cuando tu comportamiento real contradice tu perfil declarado.",
  },
];

export default function TutorialModal() {
  const { tutorialOpen, closeTutorial, markSeen } = useTutorialStore();
  const [step, setStep] = useState(0);

  if (!tutorialOpen) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const progress = ((step + 1) / STEPS.length) * 100;

  const handleNext = () => {
    if (isLast) { markSeen(); setStep(0); }
    else setStep(step + 1);
  };

  const handleClose = () => { markSeen(); setStep(0); };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
         style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}>
      <div className="w-full max-w-md animate-fade-in-up relative"
           style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "28px", overflow: "hidden", boxShadow: "var(--shadow-lg)" }}>

        {/* Progress bar */}
        <div className="h-0.5 w-full" style={{ background: "var(--border)" }}>
          <div className="h-full transition-all duration-500"
               style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${current.color}, ${current.color}cc)` }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--dim)" }}>
            {step + 1} / {STEPS.length}
          </span>
          <button onClick={handleClose}
                  className="p-1.5 rounded-xl hover:bg-white/5 transition-colors"
                  style={{ color: "var(--muted)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {/* Emoji */}
          <div className="flex justify-center mb-5">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
                 style={{ background: current.color + "15", border: `2px solid ${current.color}30` }}>
              {current.emoji}
            </div>
          </div>

          <h2 className="text-xl font-black text-center mb-1 tracking-tight"
              style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {current.title}
          </h2>
          <p className="text-xs text-center font-semibold mb-4 uppercase tracking-wider"
             style={{ color: current.color }}>
            {current.subtitle}
          </p>
          <p className="text-sm leading-relaxed text-center mb-5"
             style={{ color: "var(--sub)" }}>
            {current.desc}
          </p>

          {/* Tip */}
          <div className="rounded-2xl px-4 py-3 mb-6 text-xs leading-relaxed"
               style={{ background: current.color + "0e", border: `1px solid ${current.color}25`, color: "var(--muted)" }}>
            {current.tip}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-3">
            {step > 0 ? (
              <button onClick={() => setStep(step - 1)}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all"
                      style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                <ArrowLeft className="w-3.5 h-3.5" />
                Atrás
              </button>
            ) : (
              <button onClick={handleClose}
                      className="px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all"
                      style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                Saltar
              </button>
            )}

            <button onClick={handleNext}
                    className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm"
                    style={{ background: `linear-gradient(135deg, ${current.color}, ${current.color}cc)`, boxShadow: `0 4px 16px ${current.color}40` }}>
              {isLast ? "¡Empezar!" : "Siguiente"}
              {!isLast && <ArrowRight className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Dots */}
          <div className="flex justify-center gap-1.5 mt-4">
            {STEPS.map((_, i) => (
              <button key={i} onClick={() => setStep(i)}
                      className="rounded-full transition-all"
                      style={{
                        width: i === step ? 20 : 6,
                        height: 6,
                        background: i === step ? current.color : "var(--border)",
                      }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
