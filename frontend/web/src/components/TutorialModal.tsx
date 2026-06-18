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
    desc: "Nuvos AI te enseña a pensar como un inversor profesional. No te decimos qué comprar — te enseñamos a analizar, entender y tomar decisiones por ti mismo. Todos los datos se sincronizan en tiempo real entre la web y la app móvil.",
    tip: "💡 Completa el perfil inicial para que la IA adapte sus respuestas a tu nivel: Básico, Intermedio o Avanzado.",
  },
  {
    emoji: "🏠",
    color: "#00b96d",
    title: "Tu Dashboard",
    subtitle: "El pulso del mercado, de un vistazo",
    desc: "El Inicio muestra los índices S&P 500, Nasdaq y Dow Jones en tiempo real con scroll continuo cuando el mercado está abierto (LIVE). Debajo verás el valor de tu portafolio con tres métricas clave: rendimiento de Hoy, YTD (lo que va del año) y Total.",
    tip: "💡 La sección «Subiendo hoy» muestra automáticamente las 4 posiciones de tu portafolio con mayor ganancia del día.",
  },
  {
    emoji: "💬",
    color: "#10b981",
    title: "Chat con tu Mentor IA",
    subtitle: "La herramienta principal de Nuvos",
    desc: "Pregunta sobre cualquier empresa, ETF, concepto o estrategia. La IA conoce tu perfil de riesgo, tu portafolio real y tu nivel inversor, y detecta cuando tus decisiones los contradicen. Cada conversación actualiza tu barra de madurez conductual.",
    tip: "💡 Puedes editar cualquier mensaje haciendo clic en el ícono de lápiz que aparece al lado del texto.",
  },
  {
    emoji: "📊",
    color: "#3b82f6",
    title: "Portafolio en Tiempo Real",
    subtitle: "Tus inversiones con datos vivos",
    desc: "Agrega posiciones manualmente o pegando una captura de pantalla de tu broker (Ctrl+V / ⌘+V) — la IA extrae los datos automáticamente. Los precios se actualizan cada 30 segundos. Alterna entre vista Básica y Avanzada para ver Volumen, Market Cap, P/E, Ex-Dividendo y rango 52 semanas.",
    tip: "💡 El badge junto a «Mi Portafolio» (USD, MXN, EUR…) indica la moneda de tu portafolio. Haz clic en cualquier posición para ver su análisis completo.",
  },
  {
    emoji: "📅",
    color: "#f59e0b",
    title: "Calendario de Eventos",
    subtitle: "Earnings, dividendos y ex-dividendos",
    desc: "El calendario en Watchlist muestra automáticamente tres tipos de eventos para todas tus posiciones y watchlist: Earnings (resultados trimestrales), Ex-Dividendo (fecha límite para recibir el dividendo) y pago de Dividendo. Toca cualquier día para ver el detalle.",
    tip: "💡 Las posiciones de tu portafolio aparecen en verde intenso; las de watchlist en azul — así identificas de un vistazo cuáles te afectan directamente.",
  },
  {
    emoji: "👁️",
    color: "#0ea5e9",
    title: "Watchlist",
    subtitle: "Sigue acciones sin comprarlas",
    desc: "Agrega cualquier acción a tu Watchlist para seguir su precio, noticias y eventos en tiempo real. En modo Avanzado obtienes una tabla completa con columna de after-hours, market cap, P/E ratio, fecha de earnings y rango 52 semanas — ordenable por cualquier columna.",
    tip: "💡 Arrastra las tarjetas para reordenar tu watchlist. El orden se sincroniza automáticamente entre web y móvil.",
  },
  {
    emoji: "🎮",
    color: "#8b5cf6",
    title: "Simulador Paper Trading",
    subtitle: "Practica sin dinero real",
    desc: "Opera con $10,000 virtuales a precios reales del mercado. Compra, vende, sigue tus rendimientos y aprende a ejecutar estrategias sin arriesgar capital. Puedes recargar el saldo virtual en cualquier momento y comparar tu desempeño en el Leaderboard.",
    tip: "💡 El simulador usa los mismos precios en tiempo real que el portafolio — la práctica refleja condiciones reales del mercado.",
  },
  {
    emoji: "📚",
    color: "#06b6d4",
    title: "Aprendizaje & Herramientas",
    subtitle: "Todo lo que necesitas para invertir mejor",
    desc: "Biblioteca de conceptos financieros explicados con IA adaptada a tu nivel: ETFs, análisis fundamental, P/E ratio, DCA, Value Investing y psicología del inversor. El Screener semanal (Intermedio+) analiza el mercado y selecciona oportunidades personalizadas cada lunes.",
    tip: "💡 La sección Inversores te muestra cómo invierten los grandes fondos — útil para identificar tendencias y validar tus ideas.",
  },
  {
    emoji: "🧠",
    color: "#a855f7",
    title: "Tu Perfil & Madurez Inversora",
    subtitle: "La IA que te conoce como inversor",
    desc: "La IA analiza tu comportamiento real — si entras en pánico, si diversificas bien, si piensas a largo plazo — y te asigna una puntuación de Madurez Inversora (0-100) que evoluciona con el tiempo. Tu nivel (Básico, Intermedio o Avanzado) adapta toda la experiencia: análisis, respuestas del chat y columnas visibles.",
    tip: "💡 La barra de riesgo conductual en el menú lateral se actualiza automáticamente con cada conversación. Puedes cambiar tu nivel en Perfil en cualquier momento.",
  },
];

export default function TutorialModal() {
  const { tutorialOpen, markSeen } = useTutorialStore();
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
