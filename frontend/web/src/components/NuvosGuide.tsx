"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X, ChevronRight, Lock } from "lucide-react";
import { useSubscriptionStore, useProfileStore } from "@/lib/store";

const SECTIONS = [
  {
    emoji: "🤖",
    title: "Mentor IA",
    subtitle: "Tu mentor personal de inversiones",
    description: "Hazle cualquier pregunta sobre acciones, mercados, estrategias o tu portafolio. Muestra fundamentos reales — P/E, márgenes, flujo de caja — y te enseña a pensar como inversor.",
    cta: "Hablar con Nuvos",
    href: "/chat",
    tip: "20 mensajes gratis al día. Empieza: '¿Qué es un ETF y cómo funciona?'",
    premium: false,
  },
  {
    emoji: "💼",
    title: "Tu Portafolio",
    subtitle: "Rastrea tus inversiones en tiempo real",
    description: "Agrega tus posiciones y ve tu rendimiento total, P&L por activo y valor actual. El análisis IA profundo (stress test, distribución por sector, comparativa vs S&P 500) es Premium.",
    cta: "Ver mi portafolio",
    href: "/portfolio",
    tip: "Agrega aunque sea una posición para activar el seguimiento en tiempo real.",
    premium: false,
  },
  {
    emoji: "👀",
    title: "Watchlist",
    subtitle: "Sigue las acciones que te interesan",
    description: "Monitorea hasta 25 empresas gratis con precios en tiempo real, variación del día y alertas de precio. Sin límite con Premium.",
    cta: "Ir a Watchlist",
    href: "/watchlist",
    tip: "Agrega empresas que usas en tu día a día: Apple, Amazon, Google...",
    premium: false,
  },
  {
    emoji: "📚",
    title: "Academy",
    subtitle: "Aprende a invertir paso a paso",
    description: "12 categorías completas: desde qué es una acción hasta análisis fundamental, psicología del inversor y estrategias avanzadas. Gratis sin límite.",
    cta: "Empezar a aprender",
    href: "/academy",
    tip: "5 minutos al día es suficiente. El streak de fuego te mantiene motivado.",
    premium: false,
  },
  {
    emoji: "🎬",
    title: "Videos educativos",
    subtitle: "Lo que dicen los mejores inversores del mundo",
    description: "Clips cortos de Warren Buffett, Ray Dalio, Peter Lynch y más. Filtra por tema (valor, macro, psicología) o por inversor. Gratis completo.",
    cta: "Ver videos",
    href: "/feed",
    tip: "Busca 'pánico' o 'crisis' para ver cómo piensan los mejores en momentos difíciles.",
    premium: false,
  },
  {
    emoji: "🧮",
    title: "Calculadora de riqueza",
    subtitle: "Proyecta tu futuro financiero",
    description: "Ingresa capital inicial, aporte mensual y rendimiento esperado. Ve tu proyección a 30 años: cuánto acumulas, cuánto es tuyo vs el mercado, y tu meta financiera.",
    cta: "Calcular mi meta",
    href: "/patrimonio",
    tip: "Prueba con $200/mes al 8% anual durante 20 años. El resultado sorprende.",
    premium: false,
  },
  {
    emoji: "📊",
    title: "Screener semanal",
    subtitle: "5 oportunidades cada lunes basadas en tu perfil",
    description: "Cada lunes la IA selecciona 5 activos con fundamentos reales: catalizador, score 0-100, análisis de riesgo y nota personalizada de tu mentor. Solo para Premium.",
    cta: "⭐ Activar Premium →",
    href: null,
    tip: null,
    premium: true,
  },
  {
    emoji: "🔬",
    title: "Análisis IA de portafolio",
    subtitle: "Fortalezas, debilidades y stress test",
    description: "Análisis profundo: distribución por sector, score de riesgo 0-100, stress test con 5 crisis históricas y comparativa vs S&P 500. Solo Premium.",
    cta: "⭐ Activar Premium →",
    href: null,
    tip: null,
    premium: true,
  },
  {
    emoji: "📥",
    title: "Importación inteligente",
    subtitle: "Conecta tu broker o importa desde PDF",
    description: "Sube tu estado de cuenta y la IA extrae todo automáticamente. O conecta Fidelity, Schwab, IOL u otros brokers para sincronización automática. Solo Premium.",
    cta: "⭐ Activar Premium →",
    href: null,
    tip: null,
    premium: true,
  },
  {
    emoji: "📈",
    title: "Reporte mensual",
    subtitle: "Tu performance real cada mes",
    description: "Al cierre de mes: retorno real, comparativa vs S&P 500, posiciones más rentables y nota personalizada de tu mentor. Solo Premium.",
    cta: "⭐ Activar Premium →",
    href: null,
    tip: null,
    premium: true,
  },
];

export default function NuvosGuide() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { tier } = useSubscriptionStore();
  const { profile } = useProfileStore();

  const isAuthPage = !pathname || pathname === "/" || pathname.startsWith("/auth") || pathname === "/onboarding" || pathname === "/join";
  if (isAuthPage) return null;
  if (tier === "premium") return null;

  const freeSections    = SECTIONS.filter((s) => !s.premium);
  const premiumSections = SECTIONS.filter((s) => s.premium);

  const handleCta = (section: typeof SECTIONS[0]) => {
    if (section.premium) {
      router.push("/profile");
    } else if (section.href) {
      router.push(section.href);
    }
    setOpen(false);
    setActive(null);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl font-bold text-sm transition-all hover:scale-105 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #22c55e, #16a34a)",
          color: "#000",
          boxShadow: "0 4px 24px rgba(34,197,94,0.4)",
        }}
      >
        <span className="text-base">🗺️</span>
        <span>Guía Nuvos</span>
      </button>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex" onClick={() => { setOpen(false); setActive(null); }}>
          {/* Backdrop */}
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }} />

          {/* Drawer */}
          <div
            className="absolute right-0 top-0 h-full w-full max-w-md flex flex-col"
            style={{ background: "var(--card)", borderLeft: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <div>
                <p className="font-black text-base" style={{ color: "var(--text)" }}>🗺️ Guía Nuvos</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>Todo lo que puedes hacer en la plataforma</p>
              </div>
              <button onClick={() => { setOpen(false); setActive(null); }} className="p-1.5 rounded-xl hover:opacity-70">
                <X className="w-5 h-5" style={{ color: "var(--muted)" }} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">

              {/* Free features */}
              <p className="text-[10px] font-bold uppercase tracking-widest px-1 mb-3" style={{ color: "var(--dim)" }}>
                Disponible en tu plan gratuito
              </p>

              {freeSections.map((s, i) => (
                <div key={i}>
                  <button
                    onClick={() => setActive(active === i ? null : i)}
                    className="w-full flex items-center gap-3 p-3.5 rounded-2xl text-left transition-all hover:opacity-90"
                    style={{
                      background: active === i ? "rgba(34,197,94,0.08)" : "var(--raised)",
                      border: `1px solid ${active === i ? "rgba(34,197,94,0.3)" : "var(--border)"}`,
                    }}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                         style={{ background: "var(--card)" }}>
                      {s.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{s.title}</p>
                      <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{s.subtitle}</p>
                    </div>
                    <ChevronRight
                      className="w-4 h-4 shrink-0 transition-transform"
                      style={{ color: "var(--dim)", transform: active === i ? "rotate(90deg)" : "none" }}
                    />
                  </button>

                  {active === i && (
                    <div className="mx-1 px-4 py-4 rounded-b-2xl space-y-3 -mt-1"
                         style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.15)", borderTop: "none" }}>
                      <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>{s.description}</p>

                      {s.tip && (
                        <div className="text-xs px-3 py-2 rounded-xl italic"
                             style={{ background: "var(--raised)", color: "var(--muted)" }}>
                          💡 {s.tip}
                        </div>
                      )}
                      <button
                        onClick={() => handleCta(s)}
                        className="w-full py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90"
                        style={{ background: "#22c55e", color: "#000" }}
                      >
                        {s.cta} →
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {/* Premium teaser */}
              <p className="text-[10px] font-bold uppercase tracking-widest px-1 mt-5 mb-3" style={{ color: "var(--dim)" }}>
                ⭐ Exclusivo Premium — desbloquea todo
              </p>

              {premiumSections.map((s, i) => {
                const idx = freeSections.length + i;
                return (
                  <div key={idx}>
                    <button
                      onClick={() => setActive(active === idx ? null : idx)}
                      className="w-full flex items-center gap-3 p-3.5 rounded-2xl text-left transition-all hover:opacity-90"
                      style={{
                        background: active === idx ? "rgba(245,158,11,0.08)" : "var(--raised)",
                        border: `1px solid ${active === idx ? "rgba(245,158,11,0.3)" : "var(--border)"}`,
                        opacity: 0.85,
                      }}
                    >
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 relative"
                           style={{ background: "var(--card)" }}>
                        {s.emoji}
                        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                             style={{ background: "#f59e0b" }}>
                          <Lock className="w-2.5 h-2.5" style={{ color: "#000" }} />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{s.title}</p>
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                                style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                            PREMIUM
                          </span>
                        </div>
                        <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{s.subtitle}</p>
                      </div>
                      <ChevronRight
                        className="w-4 h-4 shrink-0 transition-transform"
                        style={{ color: "var(--dim)", transform: active === idx ? "rotate(90deg)" : "none" }}
                      />
                    </button>

                    {active === idx && (
                      <div className="mx-1 px-4 py-4 rounded-b-2xl space-y-3 -mt-1"
                           style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)", borderTop: "none" }}>
                        <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>{s.description}</p>
                        <button
                          onClick={() => handleCta(s)}
                          className="w-full py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90"
                          style={{ background: "linear-gradient(90deg,#f59e0b,#f97316)", color: "#000" }}
                        >
                          ⭐ Activar Premium →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Bottom CTA */}
              <div className="pt-2 pb-4">
                <button
                  onClick={() => { router.push("/profile"); setOpen(false); }}
                  className="w-full py-3.5 rounded-2xl text-sm font-black transition-all hover:opacity-90"
                  style={{ background: "linear-gradient(90deg,#f59e0b,#f97316)", color: "#000" }}
                >
                  ⭐ Activar Premium — $10.33/mes
                </button>
                <p className="text-center text-xs mt-2" style={{ color: "var(--dim)" }}>
                  Cancela cuando quieras · Sin compromiso
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
