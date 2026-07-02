"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PricingModal from "@/components/PricingModal";
import { useSubscriptionStore, useAuthStore } from "@/lib/store";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
import {
  Brain, BarChart2, TrendingUp, Shield, Zap, BookOpen,
  GraduationCap, Bell, Calendar, RefreshCw, Target,
  Check, ArrowRight, Sparkles, FileText,
} from "lucide-react";

const SUBSCRIPTION_FEATURES = {
  free: [
    { icon: Brain,        text: "Hasta 15 mensajes/día con el mentor IA" },
    { icon: BarChart2,    text: "Portafolio de hasta 10 acciones" },
    { icon: TrendingUp,   text: "Gráfico básico de portafolio (5D y 1M)" },
    { icon: Bell,         text: "Notificaciones generales de tu portafolio y watchlist" },
    { icon: BookOpen,     text: "25 acciones en watchlist" },
    { icon: GraduationCap, text: "Academia completa + quizzes" },
  ],
  premium: [
    { icon: Brain,         text: "Chatea sin límites con tu mentor de IA, a cualquier hora" },
    { icon: BarChart2,     text: "Agrega todas las acciones que quieras, sin límite" },
    { icon: FileText,      text: "Sube una foto o PDF de tu cuenta y la IA arma tu portafolio" },
    { icon: Calendar,      text: "Te avisamos antes de que tus empresas reporten ganancias" },
    { icon: Shield,        text: "Mira cómo le hubiera ido a tu dinero en crisis pasadas (2008, COVID...)" },
    { icon: Sparkles,      text: "La IA revisa tu portafolio y te dice qué mejorar" },
    { icon: TrendingUp,    text: "Cada lunes, 5 ideas de inversión seleccionadas para ti" },
    { icon: Bell,          text: "Alertas personalizadas: te explicamos POR QUÉ se mueve tu dinero" },
    { icon: RefreshCw,     text: "Cada mes te decimos si le ganaste al mercado o no" },
    { icon: GraduationCap, text: "Lecciones pensadas para las acciones que ya tienes" },
    { icon: Zap,           text: "Notificaciones instantáneas cuando pasa algo importante con tu portafolio" },
    { icon: Target,        text: "Descubre tu estilo como inversor y cómo mejorar" },
  ],
};

const DUO_PLAN = {
  icon: "🌍",
  title: "Duo Plan",
  price: "$19.99",
  priceNote: "Anual $199.99/año",
};

const DUO_PLAN_FEATURES = [
  "Todo lo de Premium, para ambos",
  "Perfil y portafolio independientes para cada persona",
  "Comparte con un familiar o pareja",
  "Ideal para aprender a invertir juntos",
];

const ONE_TIME_PRODUCTS = [
  {
    icon: "📊",
    title: "Reporte Anual de Inversiones",
    features: [
      "Retorno real de todo tu año como inversor",
      "Comparativa vs índices (S&P 500 y más)",
      "Lecciones aprendidas generadas por IA",
      "Plan personalizado para el año siguiente",
    ],
    price_free: "$34.99 USD",
    price_premium: "$19.99 USD",
    available: true,
    offer: "annual_report",
    variant: "default",
  },
  {
    icon: "📱",
    title: "Sesión 1:1 de Guía Personalizada",
    features: [
      "45 minutos en vivo con un guía",
      "Configuramos tu portafolio juntos",
      "Ruta de aprendizaje personalizada según tus metas",
    ],
    price_free: "$149 USD",
    price_premium: "$99 USD",
    available: true,
    offer: "session",
    variant: "default",
  },
  {
    icon: "📦",
    title: "Pack 3 Sesiones de Seguimiento",
    features: [
      "3 sesiones 1:1 de seguimiento continuo",
      "Revisamos tu progreso en la app",
      "Ajustamos tu ruta de aprendizaje",
      "Resolvemos dudas conforme avanzas",
    ],
    price_premium: "$247 USD",
    note: "Solo disponible para Premium",
    available: true,
    offer: "session",
    variant: "bundle",
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
  const { token } = useAuthStore();
  const isPremium = subTier === "premium";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  async function handleCheckout(offer: string, variant: string) {
    if (!token) { router.push("/login"); return; }
    setCheckoutLoading(offer + variant);
    try {
      const res = await fetch(`${API}/api/upsells/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ offer, variant, trigger_source: "products_page" }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } finally {
      setCheckoutLoading(null);
    }
  }

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

                <div className="relative flex items-center gap-2 mb-0.5">
                  <span className="text-xl">{DUO_PLAN.icon}</span>
                  <p className="text-base font-black text-white">{DUO_PLAN.title}</p>
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}>NUEVO</span>
                </div>
                <p className="relative text-2xl font-black text-white mb-1">
                  {DUO_PLAN.price} <span className="text-sm font-normal" style={{ color: "rgba(255,255,255,0.5)" }}>/ mes</span>
                </p>
                <p className="relative text-[10px] mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>{DUO_PLAN.priceNote}</p>

                <button
                  onClick={() => setShowPricing(true)}
                  className="relative w-full py-2 rounded-xl text-xs font-black mb-4 transition-all hover:opacity-90 flex items-center justify-center gap-1"
                  style={{ background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8" }}
                >
                  Contratar Duo Plan <ArrowRight className="w-3 h-3" />
                </button>

                <div className="relative space-y-2.5">
                  {DUO_PLAN_FEATURES.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#818cf8" }} />
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ── Productos individuales ───────────────────────────────────── */}
            <section>
              <h2 className="text-base font-black mb-4" style={{ color: "var(--text)" }}>Productos de pago único</h2>
              <div className="space-y-3">
                {ONE_TIME_PRODUCTS.map((p, i) => (
                  <div key={i} className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xl">{p.icon}</span>
                      <p className="text-base font-black" style={{ color: "var(--text)" }}>{p.title}</p>
                    </div>

                    <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                      {p.price_premium && (
                        <span className="text-2xl font-black" style={{ color: "#00d47e" }}>{p.price_premium}</span>
                      )}
                      {p.price_free && (
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          Free: <strong style={{ color: "var(--sub)" }}>{p.price_free}</strong>
                        </span>
                      )}
                    </div>
                    {p.note && (
                      <span className="inline-block text-[10px] px-2 py-0.5 rounded-full mb-4" style={{ background: "rgba(0,212,126,0.08)", color: "#00d47e" }}>{p.note}</span>
                    )}

                    <button
                      onClick={() => handleCheckout(p.offer, p.variant ?? "default")}
                      disabled={checkoutLoading === p.offer + (p.variant ?? "default")}
                      className={`w-full py-2 rounded-xl text-xs font-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1 ${p.note ? "" : "mb-4"}`}
                      style={{ background: "#00d47e", color: "#000" }}
                    >
                      {checkoutLoading === p.offer + (p.variant ?? "default") ? "..." : <>Ver detalles <ArrowRight className="w-3 h-3" /></>}
                    </button>
                    {p.note && <div className="mb-4" />}

                    <div className="space-y-2.5">
                      {p.features.map((f, fi) => (
                        <div key={fi} className="flex items-start gap-2">
                          <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#00d47e" }} />
                          <span className="text-xs" style={{ color: "var(--muted)" }}>{f}</span>
                        </div>
                      ))}
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
