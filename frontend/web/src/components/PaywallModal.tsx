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
  { icon: Brain,      text: "Mensajes ilimitados con tu mentor 24/7" },
  { icon: BarChart2,  text: "Análisis IA profundo de portafolio + Stress test" },
  { icon: TrendingUp, text: "Screener semanal: 5 oportunidades cada lunes" },
  { icon: Shield,     text: "Importa desde PDF, screenshot o broker conectado" },
  { icon: Zap,        text: "Resumen IA de noticias + reporte mensual de performance" },
];

const ALL_FEATURES = [
  { text: "Mensajes ilimitados con el mentor", detail: "Sin límite de 20 mensajes al día. Habla con tu mentor cuando quieras, sin restricciones." },
  { text: "Watchlist ilimitada", detail: "En el plan gratuito puedes seguir hasta 25 acciones. Premium elimina ese límite — sigue todas las empresas que quieras." },
  { text: "Análisis IA profundo del portafolio", detail: "Fortalezas, debilidades y sugerencias concretas sobre tu portafolio generadas por IA. Incluye distribución por sector y score de riesgo 0-100." },
  { text: "Stress test con 5 escenarios históricos", detail: "Simula cómo hubiera reaccionado tu portafolio en Crisis 2008, COVID-19, Tech Crash 2022, subida de tasas Fed y Bull Market." },
  { text: "Gráfico interactivo + comparativa vs S&P 500", detail: "Evolución de tu portafolio desde 1D hasta MÁX, comparada con el índice de referencia. Visualiza en qué períodos ganaste o perdiste contra el mercado." },
  { text: "Screener semanal personalizado", detail: "Cada lunes la IA selecciona 5 oportunidades con catalizador, score 0-100, análisis de riesgo y nota de tu mentor. Basado en tu perfil real." },
  { text: "Importar portafolio desde PDF o screenshot", detail: "Sube tu estado de cuenta y la IA extrae tickers, cantidades y precios promedio automáticamente. Sin entrada manual." },
  { text: "Conectar broker (Plaid, IOL, Fidelity, Schwab)", detail: "Sincroniza tu portafolio real automáticamente desde tu bróker. Sin errores manuales, siempre actualizado." },
  { text: "Resumen IA de noticias", detail: "Cada noticia de tus posiciones viene con un resumen generado por IA. Lee el punto clave en segundos, no el artículo completo." },
  { text: "Reporte mensual de performance", detail: "Al cierre de cada mes: retorno real, comparativa vs S&P 500, posiciones más rentables y nota personalizada de tu mentor." },
  { text: "Evaluación conductual BSCORE", detail: "La IA analiza tu perfil inversor y conversaciones para medir tu madurez como inversor con sugerencias concretas de mejora." },
  { text: "Cambiar moneda del portafolio", detail: "Ve tu portafolio en USD, MXN, EUR u otras monedas. Útil si tu capital está en una moneda diferente a USD." },
  { text: "Emails semanales personalizados", detail: "Cada viernes recibes un resumen del mercado adaptado a tu perfil, tus conversaciones y el estado de tu portafolio." },
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
              Invierte como los<br />
              <span style={{ color: "#00d47e" }}>mejores del mundo</span>
            </h2>
            <p className="text-center text-sm mb-4" style={{ color: "var(--muted)" }}>
              Tu asesor de inversiones con IA, disponible 24/7
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
              {showAllFeatures ? "Ver menos" : `Ver los ${ALL_FEATURES.length} beneficios`}
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
