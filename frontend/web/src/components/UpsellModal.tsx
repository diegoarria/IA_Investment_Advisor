"use client";

import { useState } from "react";
import { X, Calendar, Users, Video, Star, ArrowRight, Check } from "lucide-react";
import api from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

export type UpsellOffer = "annual_report" | "family_plan" | "session";

interface UpsellModalProps {
  offer: UpsellOffer | null;
  userTier?: "free" | "premium"; // kept for API compat but overridden by store
  prices: Record<string, number>;
  triggerSource?: string;
  onClose: () => void;
}

function getOfferMeta(t: TFunction) {
  return {
    annual_report: {
      icon: Calendar,
      emoji: "📊",
      title: t("upsellModal.annualReport.title"),
      subtitle: t("upsellModal.annualReport.subtitle"),
      features: t("upsellModal.annualReport.features", { returnObjects: true }) as string[],
      color: "#8b5cf6",
      badge: t("upsellModal.annualReport.badge"),
    },
    family_plan: {
      icon: Users,
      emoji: "👫",
      title: t("upsellModal.familyPlan.title"),
      subtitle: t("upsellModal.familyPlan.subtitle"),
      features: t("upsellModal.familyPlan.features", { returnObjects: true }) as string[],
      color: "#3b82f6",
      badge: t("upsellModal.familyPlan.badge"),
    },
    session: {
      icon: Video,
      emoji: "🎯",
      title: t("upsellModal.session.title"),
      subtitle: t("upsellModal.session.subtitle"),
      features: t("upsellModal.session.features", { returnObjects: true }) as string[],
      color: "#00d47e",
      badge: t("upsellModal.session.badge"),
    },
  };
}

export default function UpsellModal({ offer, prices, triggerSource, onClose }: UpsellModalProps) {
  const { t } = useTranslation();
  const { tier } = useSubscriptionStore();
  const [loading, setLoading] = useState(false);
  const [variant, setVariant] = useState<"default" | "bundle">("default");
  const [duoVariant, setDuoVariant] = useState<"monthly" | "yearly">("monthly");

  if (!offer) return null;
  const OFFER_META = getOfferMeta(t);
  const meta = OFFER_META[offer];
  const isPremium = tier === "premium";

  const displayPrice = offer === "family_plan"
    ? duoVariant === "monthly" ? `$${prices.monthly ?? 23.99}${t("upsellModal.perMonth")}` : `$${prices.yearly ?? 224.99}${t("upsellModal.perYear")}`
    : isPremium
    ? `$${variant === "bundle" ? (prices.bundle ?? 247) : (prices.premium ?? 0)}`
    : `$${prices.free ?? 0}`;

  const handlePurchase = async () => {
    setLoading(true);
    try {
      const res = await api.post("/api/upsells/checkout", {
        offer,
        variant: offer === "family_plan" ? duoVariant : variant === "bundle" ? "bundle" : tier,
        trigger_source: triggerSource,
      });
      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        window.alert(t("pricingModal.paymentError"));
        setLoading(false);
      }
    } catch {
      window.alert(t("pricingModal.paymentError"));
      setLoading(false);
    }
  };

  const handleDismiss = async () => {
    try {
      await api.post("/api/upsells/dismiss", {
        offer_type: offer,
        user_tier: tier,
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
                    {v === "default" ? t("upsellModal.oneSession") : t("upsellModal.pack3Sessions")}
                  </p>
                  <p className="text-sm font-black mt-0.5" style={{ color: variant === v ? "#fff" : "var(--sub)" }}>
                    {v === "default" ? `$${prices.premium ?? 99}` : `$${prices.bundle ?? 247}`}
                  </p>
                  {v === "bundle" && (
                    <p className="text-[10px] mt-0.5" style={{ color: variant === v ? "rgba(255,255,255,0.75)" : "var(--dim)" }}>
                      {t("upsellModal.save", { amount: Math.round(((prices.premium ?? 99) * 3) - (prices.bundle ?? 247)) })}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Duo plan billing picker */}
          {offer === "family_plan" && (
            <div className="flex gap-2 p-1 rounded-xl" style={{ background: "var(--raised)" }}>
              {(["monthly", "yearly"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setDuoVariant(v)}
                  className="flex-1 rounded-lg py-2.5 px-2 text-center transition-all"
                  style={{
                    background: duoVariant === v ? `linear-gradient(135deg,${meta.color}cc,${meta.color})` : "transparent",
                    boxShadow: duoVariant === v ? `0 4px 12px ${meta.color}44` : "none",
                  }}
                >
                  <p className="text-xs font-black" style={{ color: duoVariant === v ? "#fff" : "var(--muted)" }}>
                    {v === "monthly" ? t("upsellModal.monthly") : t("upsellModal.annual")}
                  </p>
                  <p className="text-sm font-black mt-0.5" style={{ color: duoVariant === v ? "#fff" : "var(--sub)" }}>
                    {v === "monthly" ? `$${prices.monthly ?? 23.99}/mes` : `$${prices.yearly ?? 224.99}/año`}
                  </p>
                  {v === "yearly" && (
                    <p className="text-[10px] mt-0.5" style={{ color: duoVariant === v ? "rgba(255,255,255,0.75)" : "var(--dim)" }}>
                      {t("upsellModal.save", { amount: Math.round(((prices.monthly ?? 23.99) * 12) - (prices.yearly ?? 224.99)) })}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Price callout */}
          <div className="rounded-xl p-3" style={{ background: `${meta.color}0d`, border: `1px solid ${meta.color}25` }}>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black" style={{ color: "var(--text)" }}>{displayPrice}</span>
              {offer !== "family_plan" && (
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {isPremium ? `• ${t("upsellModal.exclusivePremiumPrice")}` : t("upsellModal.oneTimePayment")}
                </span>
              )}
            </div>
            {isPremium && (
              <div className="flex items-center gap-1 mt-1">
                <Star className="w-3 h-3 fill-current" style={{ color: meta.color }} />
                <span className="text-xs font-semibold" style={{ color: meta.color }}>{t("upsellModal.exclusivePremiumPrice")}</span>
              </div>
            )}
          </div>

          {/* Premium conversion nudge for free users — no revealing premium price */}
          {!isPremium && (
            <p className="text-center text-xs" style={{ color: "var(--dim)" }}>
              {t("upsellModal.notPremiumYet")}
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
            {loading ? t("upsellModal.redirecting") : (
              <>
                {offer === "session" ? t("upsellModal.bookSession") : offer === "family_plan" ? t("upsellModal.activateDuoPlan") : t("upsellModal.getMyReport")}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
          <button onClick={handleDismiss} className="w-full py-2 text-xs text-center hover:opacity-70 transition-opacity"
                  style={{ color: "var(--dim)" }}>
            {t("upsellModal.maybeLater")}
          </button>
        </div>
      </div>
    </div>
  );
}
