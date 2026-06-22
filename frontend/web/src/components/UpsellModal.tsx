"use client";

import { useState } from "react";
import { X, Calendar, Users, Video, Star, ArrowRight, Check } from "lucide-react";
import api from "@/lib/api";

export type UpsellOffer = "annual_report" | "family_plan" | "session";

interface UpsellModalProps {
  offer: UpsellOffer | null;
  userTier: "free" | "premium";
  prices: Record<string, number>;
  triggerSource?: string;
  onClose: () => void;
}

const OFFER_META = {
  annual_report: {
    icon: Calendar,
    emoji: "📊",
    title: "Reporte Anual de Madurez Inversora",
    subtitle: "Tu evolución como inversor, documentada",
    features: [
      "Evolución mes a mes de tu Puntuación de Madurez (1-100)",
      "Los 3 sesgos que más afectaron tus decisiones este año",
      "Perfil de riesgo real vs. declarado al registrarte",
      "Recomendaciones de tu Mentor IA para el próximo año",
      'Certificado digital compartible: "Inversor Informado - Nuvos AI"',
    ],
    color: "#8b5cf6",
    badge: "Edición anual",
  },
  family_plan: {
    icon: Users,
    emoji: "👨‍👩‍👧",
    title: "Plan Familiar",
    subtitle: "Dos cuentas Premium, una sola factura",
    features: [
      "Todo lo de Premium para dos cuentas independientes",
      "Una sola factura, perfiles separados",
      "Seguimiento de sesgos y portafolios independientes",
      "Privacidad total — sin datos compartidos entre cuentas",
    ],
    color: "#3b82f6",
    badge: "Solo Premium",
  },
  session: {
    icon: Video,
    emoji: "🎯",
    title: "Sesión 1:1 con Diego",
    subtitle: "45 minutos con el fundador de Nuvos AI",
    features: [
      "Videollamada de 45 min con Diego Arria, fundador de Nuvos AI",
      "Revisión de tu historial de sesgos y puntuación de madurez",
      "Análisis de tu portafolio simulado y estrategia de inversión",
      "3 próximos pasos concretos para tu situación específica",
      "Grabación de la sesión entregada después de la llamada",
    ],
    color: "#00d47e",
    badge: "Agenda disponible",
  },
};

export default function UpsellModal({ offer, userTier, prices, triggerSource, onClose }: UpsellModalProps) {
  const [loading, setLoading] = useState(false);
  const [variant, setVariant] = useState<"default" | "bundle">("default");

  if (!offer) return null;
  const meta = OFFER_META[offer];
  const Icon = meta.icon;
  const isPremium = userTier === "premium";

  const premiumSaving = offer === "annual_report"
    ? (prices.free ?? 34.99) - (prices.premium ?? 19.99)
    : offer === "session"
    ? (prices.free ?? 149) - (prices.premium ?? 99)
    : 0;

  const displayPrice = offer === "family_plan"
    ? `$${prices.monthly ?? 19.99}/mes`
    : isPremium
    ? `$${variant === "bundle" ? (prices.bundle ?? 247) : (prices.premium ?? 0)}`
    : `$${prices.free ?? 0}`;

  const handlePurchase = async () => {
    if (offer === "family_plan") {
      window.open("mailto:diego.arria19@gmail.com?subject=Plan%20Familiar%20Nuvos%20AI", "_blank");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post("/api/upsells/checkout", {
        offer,
        variant: variant === "bundle" ? "bundle" : userTier,
        trigger_source: triggerSource,
      });
      window.location.href = res.data.url;
    } catch {
      setLoading(false);
    }
  };

  const handleDismiss = async () => {
    try {
      await api.post("/api/upsells/dismiss", {
        offer_type: offer,
        user_tier: userTier,
        trigger_source: triggerSource,
      });
    } catch {}
    onClose();
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
          border: `1px solid ${meta.color}35`,
          maxHeight: "90vh",
          boxShadow: `0 0 60px ${meta.color}22, 0 25px 50px rgba(0,0,0,0.5)`,
        }}
      >
        {/* Top accent bar */}
        <div className="h-1 shrink-0" style={{ background: `linear-gradient(90deg, ${meta.color}99, ${meta.color})` }} />

        <div className="overflow-y-auto flex-1 px-6 pt-5 pb-4 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                   style={{ background: `${meta.color}18` }}>
                {meta.emoji}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: `${meta.color}18`, color: meta.color }}>
                    {meta.badge}
                  </span>
                </div>
                <p className="font-black text-base leading-tight" style={{ color: "var(--text)" }}>{meta.title}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{meta.subtitle}</p>
              </div>
            </div>
            <button onClick={handleDismiss} className="p-1.5 rounded-xl hover:opacity-70 shrink-0">
              <X className="w-4 h-4" style={{ color: "var(--muted)" }} />
            </button>
          </div>

          {/* Features */}
          <div className="space-y-2">
            {meta.features.map((f) => (
              <div key={f} className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                     style={{ background: `${meta.color}18` }}>
                  <Check className="w-3 h-3" style={{ color: meta.color }} />
                </div>
                <p className="text-sm leading-snug" style={{ color: "var(--sub)" }}>{f}</p>
              </div>
            ))}
          </div>

          {/* Bundle picker (session only) */}
          {offer === "session" && isPremium && (
            <div className="flex gap-2 p-1 rounded-xl" style={{ background: "var(--raised)" }}>
              {(["default", "bundle"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVariant(v)}
                  className="flex-1 rounded-lg py-2.5 px-2 text-center transition-all"
                  style={{
                    background: variant === v ? `linear-gradient(135deg,${meta.color}cc,${meta.color})` : "transparent",
                    boxShadow: variant === v ? `0 4px 12px ${meta.color}44` : "none",
                  }}
                >
                  <p className="text-xs font-black" style={{ color: variant === v ? "#fff" : "var(--muted)" }}>
                    {v === "default" ? "1 sesión" : "Pack 3 sesiones"}
                  </p>
                  <p className="text-sm font-black mt-0.5" style={{ color: variant === v ? "#fff" : "var(--sub)" }}>
                    {v === "default" ? `$${prices.premium ?? 99}` : `$${prices.bundle ?? 247}`}
                  </p>
                  {v === "bundle" && (
                    <p className="text-[10px] mt-0.5" style={{ color: variant === v ? "rgba(255,255,255,0.75)" : "var(--dim)" }}>
                      Ahorra ${Math.round(((prices.premium ?? 99) * 3) - (prices.bundle ?? 247))}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Family plan billing toggle */}
          {offer === "family_plan" && (
            <div className="rounded-xl p-3 space-y-1" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
              <div className="flex justify-between items-center">
                <span className="text-sm" style={{ color: "var(--sub)" }}>Mensual</span>
                <span className="font-bold" style={{ color: "var(--text)" }}>${prices.monthly ?? 19.99}/mes</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm" style={{ color: "var(--sub)" }}>Anual</span>
                <span className="font-bold" style={{ color: "var(--text)" }}>${prices.yearly ?? 149.99}/año</span>
              </div>
            </div>
          )}

          {/* Price + savings callout */}
          <div className="rounded-xl p-3" style={{ background: `${meta.color}0d`, border: `1px solid ${meta.color}25` }}>
            {!isPremium && premiumSaving > 0 && (
              <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>
                Usuarios Premium pagan{" "}
                <span style={{ color: meta.color, fontWeight: 700 }}>${prices.premium}</span>.
                {" "}Cambia tu plan y ahorra{" "}
                <span style={{ color: meta.color, fontWeight: 700 }}>${premiumSaving}</span>.
              </p>
            )}
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black" style={{ color: "var(--text)" }}>{displayPrice}</span>
              {offer !== "family_plan" && (
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {isPremium ? "• Precio exclusivo Premium" : "pago único"}
                </span>
              )}
            </div>
            {isPremium && (
              <div className="flex items-center gap-1 mt-1">
                <Star className="w-3 h-3 fill-current" style={{ color: meta.color }} />
                <span className="text-xs font-semibold" style={{ color: meta.color }}>Precio exclusivo Premium</span>
              </div>
            )}
          </div>

          {/* Premium conversion nudge for free users */}
          {!isPremium && (
            <p className="text-center text-xs" style={{ color: "var(--dim)" }}>
              ¿Aún no eres Premium? Por $12.99/mes accedes al precio reducido.
            </p>
          )}
        </div>

        {/* CTA footer */}
        <div className="px-6 pb-6 pt-2 shrink-0 space-y-2 border-t" style={{ borderColor: `${meta.color}15` }}>
          <button
            onClick={handlePurchase}
            disabled={loading}
            className="w-full py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60 active:scale-95"
            style={{
              background: `linear-gradient(135deg,${meta.color}cc,${meta.color})`,
              color: "#fff",
              boxShadow: `0 4px 20px ${meta.color}44`,
            }}
          >
            {loading ? "Redirigiendo…" : (
              <>
                {offer === "session" ? "Reservar sesión" : offer === "family_plan" ? "Contactar para activar" : "Obtener mi reporte"}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
          <button onClick={handleDismiss} className="w-full py-2 text-xs text-center hover:opacity-70 transition-opacity"
                  style={{ color: "var(--dim)" }}>
            Quizás más adelante
          </button>
        </div>
      </div>
    </div>
  );
}
