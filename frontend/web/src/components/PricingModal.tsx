"use client";

import { useState } from "react";
import { X, Check, Lock } from "lucide-react";
import { billing, upsells } from "@/lib/api";

const FREE_FEATURES = [
  "Hasta 20 mensajes/día con el mentor IA",
  "Portafolio con hasta 10 acciones",
  "Watchlist de hasta 25 acciones",
  "Lecciones y quizzes de academia",
  "Gráfico básico de portafolio (5D y 1M)",
  "Noticias generales del mercado",
];

const PREMIUM_FEATURES = [
  "Chatea sin límites con tu mentor de IA, a cualquier hora",
  "Agrega todas las acciones que quieras, sin límite",
  "Sube una foto o PDF de tu cuenta y la IA arma tu portafolio",
  "Te avisamos antes de que tus empresas reporten ganancias",
  "Mira cómo le hubiera ido a tu dinero en crisis pasadas (2008, COVID...)",
  "La IA revisa tu portafolio y te dice qué mejorar",
  "Cada lunes, 5 ideas de inversión seleccionadas para ti",
  "Noticias de tus acciones, resumidas por IA en segundos",
  "Cada mes te decimos si le ganaste al mercado o no",
  "Lecciones pensadas para las acciones que ya tienes",
  "Te avisamos cuando pasa algo importante con tu dinero",
  "Descubre tu estilo como inversor y cómo mejorar",
];

const DUO_FEATURES = [
  "Todo lo de Premium, para ambos",
  "Perfil y portafolio independientes para cada persona",
  "Comparte con un familiar o pareja",
  "Ideal para aprender a invertir juntos",
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function PricingModal({ visible, onClose }: Props) {
  const [plan, setPlan] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(false);
  const [duoLoading, setDuoLoading] = useState(false);

  if (!visible) return null;

  async function handleUpgrade() {
    setLoading(true);
    try {
      const res = await billing.createCheckout(plan);
      if (res.data?.url) window.location.href = res.data.url;
    } catch {
      setLoading(false);
    }
  }

  async function handleDuoCheckout() {
    setDuoLoading(true);
    try {
      const res = await upsells.checkout("family_plan", plan, "pricing_modal");
      if (res.data?.url) window.location.href = res.data.url;
    } catch {
      setDuoLoading(false);
    }
  }

  const monthlyPrice = plan === "monthly" ? "$12.99" : "$10.50";
  const yearlyNote   = plan === "yearly" ? "· Ahorra $29.89 vs mensual" : null;
  const duoPrice     = plan === "monthly" ? "$19.99" : "$199.99";
  const duoPeriod    = plan === "monthly" ? "/mes" : "/año";

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col" style={{ background: "var(--bg)", border: "1px solid var(--border)", maxHeight: "90vh" }}>

        {/* Header — sticky, always visible */}
        <div className="relative flex items-center justify-center py-5 px-6 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
          <h1 className="text-xl font-black" style={{ color: "var(--text)" }}>
            Prueba Premium gratis por 1 mes
          </h1>
          <button onClick={onClose} className="absolute right-5 top-1/2 -translate-y-1/2 p-2 rounded-xl hover:bg-white/5 transition-colors" style={{ color: "var(--muted)" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">

        {/* Plan toggle */}
        <div className="flex justify-center gap-2 py-4 px-6">
          {(["monthly", "yearly"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlan(p)}
              className="px-4 py-1.5 rounded-full text-xs font-bold border transition-all"
              style={{
                background: plan === p ? "var(--accent)" : "transparent",
                borderColor: plan === p ? "var(--accent)" : "var(--border)",
                color: plan === p ? "#000" : "var(--muted)",
              }}
            >
              {p === "monthly" ? "Mensual" : "Anual"}
              {p === "yearly" && <span className="ml-1.5 opacity-80">−17%</span>}
            </button>
          ))}
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-6 pb-6">

          {/* Free card */}
          <div className="rounded-2xl border p-5 flex flex-col" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <p className="text-lg font-black mb-1" style={{ color: "var(--text)" }}>Free</p>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-3xl font-black" style={{ color: "var(--text)" }}>$0</span>
              <span className="text-sm" style={{ color: "var(--muted)" }}>USD / mes</span>
            </div>
            <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>Para empezar a invertir con IA</p>

            <div className="rounded-xl py-2 px-4 text-center text-sm font-bold mb-5" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--muted)" }}>
              Tu plan actual
            </div>

            <div className="space-y-2.5 flex-1">
              {FREE_FEATURES.map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--muted)" }} />
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Premium card */}
          <div className="rounded-2xl border p-5 flex flex-col relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0a1a10 0%, #0d1f15 100%)", borderColor: "rgba(0,212,126,0.35)" }}>
            {/* Glow */}
            <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at top right, rgba(0,212,126,0.08) 0%, transparent 60%)" }} />

            <div className="flex items-center justify-between mb-1 relative">
              <p className="text-lg font-black" style={{ color: "#fff" }}>Premium</p>
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(0,212,126,0.15)", border: "1px solid rgba(0,212,126,0.3)", color: "#00d47e" }}>
                TIEMPO LIMITADO
              </span>
            </div>

            <div className="flex items-baseline gap-2 mb-1 relative">
              <span className="text-xl line-through" style={{ color: "rgba(255,255,255,0.3)" }}>{monthlyPrice}</span>
              <span className="text-3xl font-black text-white">$0</span>
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>primer mes</span>
            </div>
            <p className="text-[10px] mb-0.5 relative" style={{ color: "rgba(255,255,255,0.5)" }}>
              Luego {monthlyPrice}/mes {plan === "yearly" ? "facturado anual" : ""}
            </p>
            {yearlyNote && (
              <p className="text-[10px] mb-3 relative" style={{ color: "#00d47e" }}>{yearlyNote}</p>
            )}
            {!yearlyNote && <div className="mb-3" />}

            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="relative w-full py-2.5 rounded-xl text-sm font-black transition-all mb-5"
              style={{ background: loading ? "rgba(0,212,126,0.5)" : "#00d47e", color: "#000" }}
            >
              {loading ? "Redirigiendo..." : "Reclamar oferta gratis"}
            </button>

            <div className="relative space-y-2.5 flex-1">
              {PREMIUM_FEATURES.map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#00d47e" }} />
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.8)" }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Duo card */}
          <div className="rounded-2xl border p-5 flex flex-col relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0d1020 0%, #111827 100%)", borderColor: "rgba(99,102,241,0.4)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at top right, rgba(99,102,241,0.07) 0%, transparent 60%)" }} />

            <div className="flex items-center gap-2 mb-1 relative">
              <span className="text-lg">👫</span>
              <p className="text-lg font-black text-white">Duo Plan</p>
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}>NUEVO</span>
            </div>

            <div className="flex items-baseline gap-1 mb-1 relative">
              <span className="text-3xl font-black text-white">{duoPrice}</span>
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>USD {duoPeriod}</span>
            </div>
            <p className="text-[10px] mb-3 relative" style={{ color: "rgba(255,255,255,0.4)" }}>
              {plan === "monthly" ? "Facturado mensualmente" : "$16.67/mes · Ahorra $40.87 vs mensual"}
            </p>

            <button
              onClick={handleDuoCheckout}
              disabled={duoLoading}
              className="relative w-full py-2.5 rounded-xl text-sm font-black transition-all mb-5"
              style={{ background: duoLoading ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8" }}
            >
              {duoLoading ? "Redirigiendo..." : "Contratar Duo Plan"}
            </button>

            <div className="relative space-y-2.5 flex-1">
              {DUO_FEATURES.map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#818cf8" }} />
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer note */}
        <p className="text-center text-[10px] pb-5 px-8" style={{ color: "var(--dim)" }}>
          Prueba gratis 30 días. Cancela cuando quieras antes de que termine y no se te cobra nada.
          Después del primer mes: {monthlyPrice}/mes{plan === "yearly" ? " facturado anualmente" : ""}.
        </p>

        </div>{/* end scrollable body */}
      </div>
    </div>
  );
}
