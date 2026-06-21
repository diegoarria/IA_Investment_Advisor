"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X, ChevronRight, Lock } from "lucide-react";
import { useSubscriptionStore, useProfileStore } from "@/lib/store";

const SECTIONS = [
  {
    emoji: "🤖",
    title: "Mentor IA",
    subtitle: "Tu asesor personal de inversiones",
    description: "Hazle cualquier pregunta sobre acciones, mercados, estrategias o tu portafolio. Responde como un experto financiero adaptado a tu perfil de riesgo.",
    cta: "Hablar con Nuvos",
    href: "/chat",
    tip: "Empieza preguntando: '¿Qué es un ETF y debería tener uno?'",
    premium: false,
  },
  {
    emoji: "💼",
    title: "Tu Portafolio",
    subtitle: "Rastrea tus inversiones en tiempo real",
    description: "Agrega tus acciones, ETFs y activos. Ve tu rendimiento total, cuánto ganaste o perdiste, y compara contra el S&P 500.",
    cta: "Ver mi portafolio",
    href: "/portfolio",
    tip: "Agrega una posición aunque sean pocas acciones — así activas el análisis IA.",
    premium: false,
    limit: "Hasta 5 posiciones en el plan gratuito",
  },
  {
    emoji: "👀",
    title: "Watchlist",
    subtitle: "Sigue las acciones que te interesan",
    description: "Agrega empresas que quieres monitorear sin comprar todavía. Ve precios, cambios y noticias de cada una en tiempo real.",
    cta: "Ir a Watchlist",
    href: "/watchlist",
    tip: "Agrega empresas que usas en tu día a día: Apple, Amazon, Google...",
    premium: false,
    limit: "Hasta 10 activos en el plan gratuito",
  },
  {
    emoji: "📚",
    title: "Academy",
    subtitle: "Aprende a invertir paso a paso",
    description: "Lecciones cortas de 2-5 minutos sobre acciones, ETFs, diversificación, análisis fundamental y más. Construye tu racha diaria de aprendizaje.",
    cta: "Empezar a aprender",
    href: "/academy",
    tip: "5 minutos al día es suficiente. El streak te mantiene motivado.",
    premium: false,
  },
  {
    emoji: "🧪",
    title: "Simulador",
    subtitle: "Practica sin arriesgar dinero real",
    description: "Compra y vende acciones con dinero virtual. Aprende cómo funciona el mercado sin consecuencias reales. Perfecto para principiantes.",
    cta: "Empezar a simular",
    href: "/paper",
    tip: "Simula comprar Tesla o NVIDIA y ve cómo hubiera resultado.",
    premium: false,
  },
  {
    emoji: "🏆",
    title: "Leaderboard",
    subtitle: "Compite con otros inversores",
    description: "Ve cómo te comparas con otros usuarios en rendimiento, racha de aprendizaje y madurez inversora. Sube de nivel y desbloquea insignias.",
    cta: "Ver ranking",
    href: "/leaderboard",
    tip: "Tu posición sube automáticamente mientras más uses la app.",
    premium: false,
  },
  {
    emoji: "📊",
    title: "Screener",
    subtitle: "Encuentra acciones según tus criterios",
    description: "Filtra miles de acciones por sector, capitalización, rendimiento, dividendos y más. Descubre empresas que no conocías.",
    cta: "Explorar acciones",
    href: "/screener",
    tip: "Filtra por 'dividendos altos' si quieres ingresos pasivos.",
    premium: false,
  },
  {
    emoji: "📈",
    title: "Reporte mensual",
    subtitle: "Análisis profundo de tu portafolio",
    description: "Cada mes recibes un reporte completo: rendimiento real, posiciones más rentables, análisis de riesgo y recomendaciones personalizadas.",
    cta: "Activar Premium",
    href: null,
    tip: null,
    premium: true,
  },
  {
    emoji: "📧",
    title: "Email diario personalizado",
    subtitle: "Tu portafolio en tu bandeja cada día",
    description: "Al cierre del mercado recibes un email con el rendimiento exacto de TUS acciones ese día. Cuánto ganaste, qué movió tu portafolio y un análisis de la jornada.",
    cta: "Activar Premium",
    href: null,
    tip: null,
    premium: true,
  },
  {
    emoji: "✉️",
    title: "Carta del mentor",
    subtitle: "Warren Buffett, Ray Dalio o Bill Ackman te escriben",
    description: "Cada mes tu mentor favorito te envía una carta personalizada analizando tu comportamiento inversor con su estilo único.",
    cta: "Activar Premium",
    href: null,
    tip: null,
    premium: true,
  },
  {
    emoji: "🧠",
    title: "AI Insights",
    subtitle: "Análisis de tu comportamiento inversor",
    description: "La IA analiza tus conversaciones y detecta sesgos, patrones y oportunidades de mejora en tu mentalidad inversora.",
    cta: "Activar Premium",
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
                      {s.limit && (
                        <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
                             style={{ background: "rgba(251,191,36,0.1)", color: "#f59e0b" }}>
                          ⚠️ {s.limit}
                        </div>
                      )}
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
