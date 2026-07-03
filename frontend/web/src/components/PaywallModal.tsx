"use client";

import { useState } from "react";
import { X, Star, Zap, TrendingUp, Shield, BarChart2, Brain, ChevronDown, ChevronUp, ArrowRight, Check } from "lucide-react";
import { billing } from "@/lib/api";

const PLANS = [
  {
    id: "monthly" as const,
    label: "Mensual",
    price: "$12.99",
    priceNum: 12.99,
    period: "/mes",
    badge: null,
    sub: "Facturado mensualmente",
  },
  {
    id: "yearly" as const,
    label: "Anual",
    price: "$125.99",
    priceNum: 125.99,
    period: "/año",
    badge: "MÁS POPULAR",
    sub: "$10.50/mes · Ahorra $29.89",
  },
];

const HERO_FEATURES = [
  { icon: Brain,      text: "Entiende qué hacer con tu dinero antes de que cierre el mercado" },
  { icon: TrendingUp, text: "Sabe exactamente cuánto ganaste o perdiste, y por qué" },
  { icon: Zap,        text: "Nunca te sorprende una noticia — te avisamos antes de que mueva tu dinero" },
  { icon: Shield,     text: "Tu portafolio armado en 30 segundos, sin hojas de cálculo" },
  { icon: BarChart2,  text: "5 oportunidades concretas cada semana, con la razón y el riesgo" },
];

const ALL_FEATURES = [
  { text: "Pregunta lo que quieras, cuando quieras — sin límite", detail: "Un mentor de IA disponible 24/7 que conoce tu portafolio real y te responde con contexto de lo que ya tienes, no en abstracto." },
  { text: "Sé el primero en saber cuando una de tus empresas va a reportar", detail: "Antes de los resultados trimestrales, la IA te explica qué esperar y si hay algo que te debería importar. Sin sorpresas." },
  { text: "Descubre si tu dinero aguantaría otra crisis como 2008 o el COVID", detail: "Simula tu portafolio actual en 30 crisis históricas reales. Ve cuánto hubieras perdido y si estarías cómodo con eso." },
  { text: "La IA te dice honestamente qué está mal en tu portafolio", detail: "Concentración excesiva en un sector, falta de diversificación, posiciones inconsistentes con tu perfil. Concreto, no genérico." },
  { text: "Sube tu estado de cuenta y la IA arma todo solo", detail: "Sube una foto o PDF de tu broker. La IA detecta automáticamente tus acciones, cantidades y precios de compra." },
  { text: "Cada lunes, 5 ideas de inversión pensadas para tu situación", detail: "No ideas genéricas. La IA considera lo que ya tienes, tu perfil y lo que está pasando en el mercado esa semana." },
  { text: "Entérate de lo que pasa con tus acciones antes de que afecte tu dinero", detail: "Notificaciones cuando algo importante mueve una de tus posiciones — con la explicación del por qué y si deberías hacer algo." },
  { text: "Al cierre de cada mes, sabe si le ganaste al mercado", detail: "Tu retorno real vs el S&P 500. Una nota personalizada de lo que funcionó y lo que no. Sin excusas, sin lenguaje técnico." },
  { text: "Aprende sobre las empresas que ya tienes en tu portafolio", detail: "Lecciones diseñadas para lo que tú tienes. Antes de que Apple reporte, entiende qué mirar. Relevante, no genérico." },
  { text: "Ve cómo se compara tu portafolio con el mercado en tiempo real", detail: "Un panel simple: tu rendimiento hoy, esta semana, este año — frente al S&P 500. Sabes en todo momento si vas bien." },
  { text: "Agrega todas las acciones que quieras, sin tope", detail: "El plan gratuito tiene límite de 10. Premium elimina ese límite para que tu portafolio sea tuyo, completo." },
  { text: "Nuvos te conoce mejor con el tiempo — y recuerda todo", detail: "Con Premium construyes tu memoria financiera completa: patrones de comportamiento, timeline de decisiones y evolución de tu portafolio. El plan gratuito solo guarda 10 creencias básicas." },
];

interface PaywallModalProps {
  visible: boolean;
  onClose: () => void;
  reason?: string;
}

export default function PaywallModal({ visible, onClose, reason }: PaywallModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "yearly">("yearly");
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!visible) return null;

  const active = PLANS.find((p) => p.id === selectedPlan)!;

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const res = await billing.createCheckout(selectedPlan);
      window.location.href = res.data.url;
    } catch {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: "var(--card)",
          border: "1px solid rgba(0,212,126,0.25)",
          maxHeight: "92vh",
          boxShadow: "0 0 60px rgba(0,212,126,0.12), 0 25px 50px rgba(0,0,0,0.5)",
        }}
      >
        {/* Gradient top bar */}
        <div className="h-1 shrink-0" style={{ background: "linear-gradient(90deg,#00a85e,#00d47e,#3ecf8e)" }} />

        {/* Scrollable content */}
        <div className="overflow-y-auto scrollbar-thin flex-1">
          {/* Hero */}
          <div
            className="px-6 pt-5 pb-6 relative"
            style={{ background: "linear-gradient(180deg, rgba(0,168,94,0.1) 0%, transparent 100%)" }}
          >
            {/* Close */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-xl hover:bg-white/10 transition-colors"
              style={{ color: "var(--muted)" }}
            >
              <X className="w-4 h-4" />
            </button>

            {/* Badge */}
            <div className="flex justify-center mb-3">
              <div
                className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold"
                style={{
                  background: "rgba(0,212,126,0.15)",
                  border: "1px solid rgba(0,212,126,0.35)",
                  color: "#00d47e",
                }}
              >
                <Star className="w-3 h-3 fill-current" />
                Nuvos AI Premium
              </div>
            </div>

            {/* Headline */}
            <h2
              className="text-center text-2xl font-black leading-tight mb-2"
              style={{ color: "var(--text)" }}
            >
              Conviértete en<br />
              <span style={{ color: "#00d47e" }}>inversionista de verdad</span>
            </h2>
            <p className="text-center text-sm mb-4" style={{ color: "var(--muted)" }}>
              El acompañamiento que necesitas para que tu dinero trabaje para ti — todos los días.
            </p>

            {/* Social proof */}
            <div
              className="flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl mb-5"
              style={{ background: "rgba(0,168,94,0.08)", border: "1px solid rgba(0,168,94,0.2)" }}
            >
              <div className="flex -space-x-1.5">
                {["#8b5cf6","#3b82f6","#f59e0b","#ef4444","#22c55e"].map((c, i) => (
                  <div key={i} className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-[9px] font-black text-white"
                       style={{ borderColor: "var(--card)", background: c }}>
                    {String.fromCharCode(65 + i)}
                  </div>
                ))}
              </div>
              <p className="text-xs" style={{ color: "var(--sub)" }}>
                <span className="font-bold" style={{ color: "var(--text)" }}>+2,400 inversores</span> ya usan Premium
              </p>
            </div>

            {reason && (
              <p
                className="text-xs mb-4 px-3 py-2 rounded-xl border text-center"
                style={{ color: "var(--sub)", borderColor: "rgba(0,168,94,0.25)", background: "rgba(0,168,94,0.06)" }}
              >
                {reason}
              </p>
            )}
          </div>

          <div className="px-5 pb-5 space-y-4">
            {/* Plan selector */}
            <div
              className="flex gap-2 p-1 rounded-2xl"
              style={{ background: "var(--raised)" }}
            >
              {PLANS.map((plan) => {
                const isActive = selectedPlan === plan.id;
                return (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id)}
                    className="flex-1 rounded-xl py-3 px-3 transition-all relative"
                    style={{
                      background: isActive ? "linear-gradient(135deg,#00a85e,#00d47e)" : "transparent",
                      boxShadow: isActive ? "0 4px 12px rgba(0,168,94,0.3)" : "none",
                    }}
                  >
                    {plan.badge && (
                      <span
                        className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[9px] font-black px-2 py-0.5 rounded-full whitespace-nowrap"
                        style={{ background: "#f59e0b", color: "#000" }}
                      >
                        {plan.badge}
                      </span>
                    )}
                    <div className="text-xs font-bold mb-0.5" style={{ color: isActive ? "#fff" : "var(--muted)" }}>
                      {plan.label}
                    </div>
                    <div className="font-black text-lg leading-none" style={{ color: isActive ? "#fff" : "var(--sub)" }}>
                      {plan.price}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: isActive ? "rgba(255,255,255,0.75)" : "var(--dim)" }}>
                      {plan.sub}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Hero features */}
            <div className="space-y-2">
              {HERO_FEATURES.map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-start gap-3">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "rgba(0,212,126,0.12)" }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: "#00d47e" }} />
                  </div>
                  <span className="text-sm leading-snug" style={{ color: "var(--sub)" }}>{text}</span>
                </div>
              ))}
            </div>

            {/* Expand all features */}
            <button
              onClick={() => setShowAllFeatures((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors hover:opacity-80"
              style={{ color: "var(--muted)", background: "var(--raised)" }}
            >
              {showAllFeatures ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showAllFeatures ? "Ver menos" : `Ver los ${ALL_FEATURES.length} resultados incluidos`}
            </button>

            {showAllFeatures && (
              <div className="space-y-0.5 rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
                {ALL_FEATURES.map((feat) => {
                  const expanded = expandedFeature === feat.text;
                  return (
                    <div key={feat.text}>
                      <button
                        onClick={() => setExpandedFeature(expanded ? null : feat.text)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/3"
                        style={{ background: expanded ? "rgba(0,168,94,0.06)" : "transparent" }}
                      >
                        <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "#00d47e" }} />
                        <span className="flex-1 text-xs font-medium" style={{ color: "var(--sub)" }}>{feat.text}</span>
                        {expanded
                          ? <ChevronUp className="w-3 h-3 shrink-0" style={{ color: "var(--muted)" }} />
                          : <ChevronDown className="w-3 h-3 shrink-0" style={{ color: "var(--muted)" }} />}
                      </button>
                      {expanded && (
                        <p className="text-[11px] px-9 pb-2.5" style={{ color: "var(--muted)" }}>
                          {feat.detail}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sticky CTA footer */}
        <div
          className="px-5 pt-3 pb-5 shrink-0 border-t"
          style={{ borderColor: "rgba(0,168,94,0.15)", background: "var(--card)" }}
        >
          <button
            onClick={handleUpgrade}
            disabled={loading}
            className="w-full py-4 rounded-2xl font-black text-base text-white flex items-center justify-center gap-2 transition-all disabled:opacity-60 active:scale-95"
            style={{
              background: "linear-gradient(135deg,#00a85e,#00d47e)",
              boxShadow: "0 4px 20px rgba(0,168,94,0.4)",
            }}
          >
            {loading ? (
              "Redirigiendo..."
            ) : (
              <>
                Comenzar ahora · {active.price}{active.period}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
          <div className="flex items-center justify-center gap-4 mt-2.5">
            {["Cancela cuando quieras", "Pago seguro con Stripe", "7 días gratis"].map((t) => (
              <span key={t} className="flex items-center gap-1 text-[10px]" style={{ color: "var(--dim)" }}>
                <Check className="w-2.5 h-2.5" style={{ color: "#00d47e" }} />
                {t}
              </span>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t" style={{ borderColor: "rgba(0,168,94,0.1)" }}>
            <a href="https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai" target="_blank" rel="noopener noreferrer"
               className="flex items-center justify-center gap-2 py-2 rounded-xl hover:opacity-80 transition-opacity"
               style={{ background: "rgba(0,168,94,0.06)" }}>
              <span className="text-sm">📅</span>
              <span className="text-xs font-semibold" style={{ color: "var(--accent-l)" }}>
                ¿Prefieres una guía 1:1 con Diego?
              </span>
              <ArrowRight className="w-3 h-3" style={{ color: "var(--accent-l)" }} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
