"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PricingModal from "@/components/PricingModal";
import { useSubscriptionStore } from "@/lib/store";
import {
  Brain, BarChart2, TrendingUp, Shield, Zap, BookOpen,
  GraduationCap, Bell, Calendar, RefreshCw, Target, Lock,
  Check, ArrowRight, Sparkles, Phone, FileText,
} from "lucide-react";

const SUBSCRIPTION_FEATURES = {
  free: [
    { icon: Brain,       text: "Hasta 20 mensajes/día con el mentor IA" },
    { icon: BarChart2,   text: "Portafolio de hasta 10 acciones" },
    { icon: TrendingUp,  text: "Gráfico básico de portafolio (5D y 1M)" },
    { icon: Bell,        text: "Noticias generales del mercado" },
    { icon: BookOpen,    text: "25 acciones en watchlist" },
    { icon: GraduationCap, text: "Academia completa + quizzes" },
  ],
  premium: [
    { icon: Brain,         text: "Mensajes ilimitados con el mentor 24/7" },
    { icon: BarChart2,     text: "Portafolio ilimitado — sin límite de acciones" },
    { icon: FileText,      text: "Importar portafolio desde PDF o screenshot" },
    { icon: Calendar,      text: "Earnings Calendar con análisis IA por posición" },
    { icon: Shield,        text: "Stress Test con 5 escenarios históricos" },
    { icon: Sparkles,      text: "Análisis IA profundo de tu portafolio" },
    { icon: TrendingUp,    text: "Screener semanal: 5 oportunidades cada lunes" },
    { icon: Bell,          text: "Noticias de TU portafolio con resumen IA" },
    { icon: RefreshCw,     text: "Reporte mensual de performance vs S&P 500" },
    { icon: GraduationCap, text: "Aprende con tu portafolio (lecciones contextuales)" },
    { icon: Zap,           text: "Mentor proactivo — alertas móviles personalizadas" },
    { icon: Target,        text: "Evaluación conductual BSCORE" },
  ],
};

const DUO_PLAN = {
  icon: "🌍",
  title: "Duo Plan",
  description: "Comparte Premium con un familiar o pareja. Cada uno con su perfil y portafolio independiente. Ideal para aprender a invertir juntos.",
  price: "$19.99/mes · $199.99/año",
  href: "/support",
};

const ONE_TIME_PRODUCTS = [
  {
    icon: "📊",
    title: "Reporte Anual de Inversiones",
    description: "Análisis completo de tu año como inversor: retorno real, comparativa vs índices, lecciones aprendidas y plan para el año siguiente. Generado por IA con tus datos reales.",
    price_free: "$34.99 USD",
    price_premium: "$19.99 USD",
    available: true,
    href: "/portfolio",
  },
  {
    icon: "📱",
    title: "Sesión 1:1 de Guía Personalizada",
    description: "Sesión privada de 45 minutos donde te guiamos por la app, configuramos tu portafolio juntos y diseñamos tu ruta de aprendizaje personalizada según tus metas de inversión.",
    price_free: "$149 USD",
    price_premium: "$99 USD",
    available: true,
    href: "/support",
  },
  {
    icon: "📦",
    title: "Pack 3 Sesiones de Seguimiento",
    description: "Tres sesiones 1:1 de guía y seguimiento continuo. Revisamos tu progreso en la app, ajustamos tu ruta de aprendizaje y resolvemos dudas conforme avanzas en tu camino como inversor.",
    price_premium: "$247 USD",
    note: "Solo disponible para Premium",
    available: true,
    href: "/support",
  },
];

const COMING_SOON = [
  {
    icon: "🔗",
    title: "Conectar Broker (Plaid / Fidelity / Schwab)",
    description: "Sincroniza tu portafolio real desde tu bróker automáticamente. Sin entrada manual, siempre actualizado.",
  },
  {
    icon: "📈",
    title: "Simulador de Opciones",
    description: "Aprende a operar opciones (calls y puts) con dinero virtual y análisis IA de cada estrategia.",
  },
];

export default function ProductsPage() {
  const router = useRouter();
  const { tier: subTier } = useSubscriptionStore();
  const isPremium = subTier === "premium";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPricing, setShowPricing] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-10">

            {/* Header */}
            <div>
              <h1 className="text-2xl font-black mb-1" style={{ color: "var(--text)" }}>Productos y Servicios</h1>
              <p className="text-sm" style={{ color: "var(--muted)" }}>Todo lo que ofrece Nuvos AI — en un solo lugar</p>
            </div>

            {/* ── Suscripción ─────────────────────────────────────────────── */}
            <section>
              <h2 className="text-base font-black mb-4" style={{ color: "var(--text)" }}>Suscripción</h2>

              <div className="grid grid-cols-2 gap-4">
                {/* Free */}
                <div className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <p className="text-base font-black mb-0.5" style={{ color: "var(--text)" }}>Free</p>
                  <p className="text-2xl font-black mb-1" style={{ color: "var(--text)" }}>$0 <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>/ mes</span></p>
                  <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>Para empezar a invertir con IA</p>
                  {!isPremium && (
                    <div className="text-center text-xs font-bold py-2 px-3 rounded-xl mb-4" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                      Tu plan actual
                    </div>
                  )}
                  <div className="space-y-2.5">
                    {SUBSCRIPTION_FEATURES.free.map((f, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--muted)" }} />
                        <span className="text-xs" style={{ color: "var(--muted)" }}>{f.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Premium */}
                <div className="rounded-2xl border p-5 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0a1a10 0%, #0d1f15 100%)", borderColor: "rgba(0,212,126,0.4)" }}>
                  <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at top right, rgba(0,212,126,0.08) 0%, transparent 60%)" }} />

                  <div className="relative flex items-center justify-between mb-0.5">
                    <p className="text-base font-black text-white">Premium</p>
                    {isPremium && (
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(0,212,126,0.2)", color: "#00d47e" }}>TU PLAN</span>
                    )}
                  </div>
                  <div className="relative flex items-baseline gap-1 mb-1">
                    <span className="text-xl line-through" style={{ color: "rgba(255,255,255,0.3)" }}>$12.99</span>
                    <span className="text-2xl font-black text-white">$0</span>
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>primer mes</span>
                  </div>
                  <p className="relative text-[10px] mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>Luego $12.99/mes · Anual $125.99/año</p>

                  {!isPremium ? (
                    <button
                      onClick={() => setShowPricing(true)}
                      className="relative w-full py-2 rounded-xl text-xs font-black mb-4 transition-all hover:opacity-90"
                      style={{ background: "#00d47e", color: "#000" }}
                    >
                      Reclamar primer mes gratis →
                    </button>
                  ) : (
                    <div className="relative text-center text-xs font-bold py-2 px-3 rounded-xl mb-4" style={{ background: "rgba(0,212,126,0.15)", color: "#00d47e" }}>
                      Activo ✓
                    </div>
                  )}

                  <div className="relative space-y-2.5">
                    {SUBSCRIPTION_FEATURES.premium.map((f, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#00d47e" }} />
                        <span className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>{f.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* ── Duo Plan ────────────────────────────────────────────────── */}
            <section>
              <h2 className="text-base font-black mb-4" style={{ color: "var(--text)" }}>Duo Plan</h2>
              <div className="rounded-2xl border p-5 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0d1020 0%, #111827 100%)", borderColor: "rgba(99,102,241,0.4)" }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at top right, rgba(99,102,241,0.07) 0%, transparent 60%)" }} />
                <div className="relative flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{DUO_PLAN.icon}</span>
                      <h3 className="text-sm font-black text-white">{DUO_PLAN.title}</h3>
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}>NUEVO</span>
                    </div>
                    <p className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.55)", lineHeight: 1.55 }}>{DUO_PLAN.description}</p>
                    <span className="text-xs font-bold" style={{ color: "#818cf8" }}>{DUO_PLAN.price}</span>
                  </div>
                  <button
                    onClick={() => router.push(DUO_PLAN.href)}
                    className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold transition-all hover:opacity-80"
                    style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8" }}
                  >
                    Ver <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </section>

            {/* ── Productos individuales ───────────────────────────────────── */}
            <section>
              <h2 className="text-base font-black mb-4" style={{ color: "var(--text)" }}>Productos de pago único</h2>
              <div className="space-y-3">
                {ONE_TIME_PRODUCTS.map((p, i) => (
                  <div key={i} className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl">{p.icon}</span>
                          <h3 className="text-sm font-black" style={{ color: "var(--text)" }}>{p.title}</h3>
                        </div>
                        <p className="text-xs mb-3" style={{ color: "var(--muted)", lineHeight: 1.55 }}>{p.description}</p>
                        <div className="flex items-center gap-3">
                          {p.price_free && (
                            <span className="text-xs" style={{ color: "var(--muted)" }}>
                              Free: <strong style={{ color: "var(--sub)" }}>{p.price_free}</strong>
                            </span>
                          )}
                          {p.price_premium && (
                            <span className="text-xs" style={{ color: "var(--muted)" }}>
                              Premium: <strong style={{ color: "#00d47e" }}>{p.price_premium}</strong>
                            </span>
                          )}
                          {p.note && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(0,212,126,0.08)", color: "#00d47e" }}>{p.note}</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => router.push(p.href)}
                        className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold transition-all hover:opacity-80"
                        style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--sub)" }}
                      >
                        Ver <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Próximamente ─────────────────────────────────────────────── */}
            <section>
              <h2 className="text-base font-black mb-4" style={{ color: "var(--text)" }}>Próximamente</h2>
              <div className="space-y-3">
                {COMING_SOON.map((p, i) => (
                  <div key={i} className="rounded-2xl border p-5 opacity-60" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <div className="flex items-start gap-3">
                      <span className="text-xl">{p.icon}</span>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-black" style={{ color: "var(--text)" }}>{p.title}</h3>
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>PRONTO</span>
                        </div>
                        <p className="text-xs" style={{ color: "var(--muted)", lineHeight: 1.55 }}>{p.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

          </div>
        </main>
      </div>

      <PricingModal visible={showPricing} onClose={() => setShowPricing(false)} />
    </div>
  );
}
