"use client";

import { useState } from "react";
import { X, Star, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { billing } from "@/lib/api";

const PLANS = [
  {
    id: "monthly" as const,
    label: "Mensual",
    price: "$11.99",
    period: "/mes",
    badge: null,
  },
  {
    id: "yearly" as const,
    label: "Anual",
    price: "$117.99",
    period: "/año",
    badge: "Ahorra 20%",
  },
];

const FEATURES = [
  {
    text: "Mensajes ilimitados",
    detail: "Sin límite de 20 mensajes al día. Habla con tu mentor cuando quieras sin restricciones.",
  },
  {
    text: "5 mentores de inversión",
    detail: "Elige entre Warren Buffett, Ray Dalio, Michael Burry, Bill Ackman y Peter Lynch. Cada uno responde desde su filosofía real.",
  },
  {
    text: "Portafolio ilimitado",
    detail: "Agrega más de 10 posiciones y da seguimiento completo con rendimientos en tiempo real.",
  },
  {
    text: "Screener semanal personalizado",
    detail: "Cada lunes la IA selecciona 5 oportunidades del mercado adaptadas a tu perfil de riesgo y mentor.",
  },
  {
    text: "Análisis de earnings automático",
    detail: "Cuando una empresa de tu portafolio reporta resultados, la IA los analiza al instante y calcula el impacto en tu inversión.",
  },
  {
    text: "Stress test de portafolio",
    detail: "Simula crisis del 2008, COVID-19, subida de tasas y otros escenarios extremos sobre tu portafolio actual.",
  },
  {
    text: "Simulador What-If",
    detail: "¿Qué pasa si vendo X y compro Y? Proyecta swaps, aportes mensuales y eventos macroeconómicos antes de ejecutarlos.",
  },
  {
    text: "Diario de decisiones + sesgos",
    detail: "Registra cada operación, detecta sesgos como FOMO y pánico, y recibe un score como inversor con retos semanales del mentor.",
  },
  {
    text: "Reporte mensual PDF",
    detail: "Descarga un análisis completo con rendimiento, Sharpe Ratio, comparativa vs S&P 500 y nota personalizada del mentor.",
  },
  {
    text: "Análisis de riesgo avanzado",
    detail: "Barra de riesgo detallada en cada respuesta para entender tu exposición real por sector y ticker.",
  },
  {
    text: "Noticias + filtros por empresa",
    detail: "Todas las noticias de tus posiciones en tiempo real, filtrables por ticker para enfocarte en lo que importa.",
  },
  {
    text: "Paper Trading sin límites",
    detail: "Practica estrategias con capital virtual sin restricciones de cantidad ni frecuencia.",
  },
  {
    text: "Emails semanales personalizados",
    detail: "Cada viernes recibes un resumen del mercado adaptado a tu perfil, tus conversaciones y tu portafolio.",
  },
];

interface PaywallModalProps {
  visible: boolean;
  onClose: () => void;
  reason?: string;
}

export default function PaywallModal({ visible, onClose, reason }: PaywallModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "yearly">("yearly");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl border overflow-hidden"
           style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        {/* Header accent */}
        <div className="h-1" style={{ background: "linear-gradient(90deg, #00a85e, #00d47e)" }} />

        <div className="p-6">
          {/* Close + title */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                   style={{ background: "rgba(0,168,94,0.15)" }}>
                <Star className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
              </div>
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI Premium</span>
            </div>
            <button onClick={onClose}
                    className="p-1 rounded-lg hover:bg-white/5 transition-colors"
                    style={{ color: "var(--muted)" }}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {reason && (
            <p className="text-xs mb-4 px-3 py-2 rounded-lg border"
               style={{ color: "var(--sub)", borderColor: "rgba(0,168,94,0.3)", background: "rgba(0,168,94,0.06)" }}>
              {reason}
            </p>
          )}

          {/* Plan selector */}
          <div className="flex gap-2 mb-4">
            {PLANS.map((plan) => {
              const isActive = selectedPlan === plan.id;
              return (
                <button key={plan.id}
                        onClick={() => setSelectedPlan(plan.id)}
                        className="flex-1 rounded-xl border p-3 transition-all text-left"
                        style={{
                          borderColor: isActive ? "var(--accent)" : "var(--border)",
                          background: isActive ? "rgba(0,168,94,0.1)" : "var(--raised)",
                        }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium" style={{ color: isActive ? "var(--text)" : "var(--muted)" }}>
                      {plan.label}
                    </span>
                    {plan.badge && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: "rgba(0,168,94,0.2)", color: "var(--accent-l)" }}>
                        {plan.badge}
                      </span>
                    )}
                  </div>
                  <span className="font-bold text-sm" style={{ color: isActive ? "var(--accent-l)" : "var(--sub)" }}>
                    {plan.price}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--muted)" }}>{plan.period}</span>
                </button>
              );
            })}
          </div>

          {/* Features */}
          <div className="space-y-1 mb-5 max-h-52 overflow-y-auto scrollbar-thin">
            {FEATURES.map((feat) => {
              const expanded = expandedFeature === feat.text;
              return (
                <div key={feat.text}>
                  <button
                    onClick={() => setExpandedFeature(expanded ? null : feat.text)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/3 transition-colors text-left"
                    style={{ background: expanded ? "rgba(0,168,94,0.06)" : "transparent" }}>
                    <Zap className="w-3 h-3 shrink-0" style={{ color: "var(--accent-l)" }} />
                    <span className="flex-1 text-xs font-medium" style={{ color: "var(--sub)" }}>{feat.text}</span>
                    {expanded
                      ? <ChevronUp className="w-3 h-3 shrink-0" style={{ color: "var(--muted)" }} />
                      : <ChevronDown className="w-3 h-3 shrink-0" style={{ color: "var(--muted)" }} />
                    }
                  </button>
                  {expanded && (
                    <p className="text-[11px] px-8 pb-2" style={{ color: "var(--muted)" }}>
                      {feat.detail}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* CTA */}
          <button
            onClick={handleUpgrade}
            disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-sm text-white transition-opacity disabled:opacity-60"
            style={{ background: "linear-gradient(90deg, #00a85e, #00d47e)" }}>
            {loading ? "Redirigiendo..." : `Activar Premium · ${active.price}${active.period}`}
          </button>
          <p className="text-center text-[10px] mt-2" style={{ color: "var(--dim)" }}>
            Cancela cuando quieras · Pago seguro con Stripe
          </p>
        </div>
      </div>
    </div>
  );
}
