"use client";

import { useState } from "react";
import { useTutorialStore } from "@/lib/store";
import { X, ArrowRight, ArrowLeft } from "lucide-react";

const STEPS = [
  {
    emoji: "👋",
    color: "#00b96d",
    title: "Bienvenido a Nuvos AI",
    subtitle: "Tu mentor de inversiones con IA",
    desc: "Nuvos AI te enseña a pensar como un inversor profesional. No te decimos qué comprar — te enseñamos a analizar, entender y tomar decisiones por ti mismo. Todos los usuarios nuevos reciben 90 días de Premium gratis, sin tarjeta.",
    tip: "Tus datos se sincronizan automáticamente entre la web y la app móvil. Empieza donde quieras.",
  },
  {
    emoji: "💬",
    color: "#00b96d",
    title: "Chat con tu mentor IA",
    subtitle: "La herramienta principal de Nuvos",
    desc: "Pregunta sobre cualquier empresa, ETF, concepto o estrategia. La IA conoce tu perfil de riesgo y tu portafolio real, y detecta cuando tus decisiones lo contradicen. Tu barra de riesgo conductual se ajusta con cada conversación.",
    tip: "💡 Puedes editar cualquier mensaje tuyo haciendo clic en el ícono de lápiz que aparece al lado.",
  },
  {
    emoji: "📊",
    color: "#3b82f6",
    title: "Portafolio",
    subtitle: "Analiza tus inversiones reales",
    desc: "Importa tus posiciones pegando una captura de pantalla de tu broker (Ctrl+V / ⌘+V) o agrégalas manualmente. La IA extrae todo automáticamente. Obtén análisis de riesgo, stress test en crisis históricas (2008, COVID-19) y simulaciones de rendimiento.",
    tip: "💡 Toca cualquier posición para abrir su análisis completo con estados financieros y gráfico histórico.",
  },
  {
    emoji: "📈",
    color: "#0ea5e9",
    title: "Análisis de Acciones",
    subtitle: "Estados financieros completos",
    desc: "Cada acción tiene su propio perfil con estado de resultados, balance general y flujo de caja en tiempo real. Compara períodos trimestrales y anuales, revisa márgenes y detecta tendencias antes de invertir.",
    tip: "💡 El calendario de ganancias en Portafolio muestra las fechas de reporte de tus posiciones y Watchlist.",
  },
  {
    emoji: "🎮",
    color: "#8b5cf6",
    title: "Simulador",
    subtitle: "Practica sin dinero real",
    desc: "Opera con $10,000 virtuales a precios reales del mercado. Compra y vende acciones, sigue tus rendimientos y aprende a ejecutar estrategias sin arriesgar tu capital. Puedes recargar el saldo virtual cuando quieras.",
    tip: "💡 El simulador usa precios en tiempo real, así que la práctica refleja condiciones reales del mercado.",
  },
  {
    emoji: "📚",
    color: "#06b6d4",
    title: "Aprendizaje",
    subtitle: "45+ temas financieros",
    desc: "Biblioteca de conceptos explicados con IA: ETFs, análisis fundamental, P/E ratio, DCA, Value Investing, psicología del inversor y mucho más. Cada tema en menos de 2 minutos con ejemplos de inversores reales.",
    tip: "💡 Busca cualquier concepto financiero que no conozcas — la IA lo explica de forma clara con ejemplos.",
  },
  {
    emoji: "🔔",
    color: "#f97316",
    title: "Notificaciones & Watchlist",
    subtitle: "El mercado en tiempo real",
    desc: "Ve el rendimiento diario de tu portafolio, noticias filtradas automáticamente de tus posiciones y alertas de movimientos importantes. Agrega acciones al Watchlist y reordénalas a tu gusto arrastrando las tarjetas.",
    tip: "💡 Las noticias de tu portafolio se agregan automáticamente de todas tus posiciones — sin configuración.",
  },
  {
    emoji: "🧠",
    color: "#a855f7",
    title: "Tu Perfil & Madurez Inversora",
    subtitle: "Conoce tu evolución como inversor",
    desc: "La IA analiza tu comportamiento real en la app — detecta si entras en pánico, si diversificas bien, si piensas a largo plazo — y te asigna una Madurez Inversora (0-100) que evoluciona con el tiempo. Tus preferencias se sincronizan entre dispositivos.",
    tip: "💡 La barra de riesgo conductual en el menú lateral se actualiza automáticamente con cada conversación.",
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
