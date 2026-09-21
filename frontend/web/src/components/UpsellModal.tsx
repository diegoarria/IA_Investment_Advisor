"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Users, Video, Star, ArrowRight, Check } from "lucide-react";
import api, { upsells } from "@/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "@/lib/store";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import EmbeddedCheckout, { type CheckoutSummary } from "./EmbeddedCheckout";
import { fmtMxn } from "@/lib/pricing";

export type UpsellOffer = "family_plan" | "session";

interface UpsellModalProps {
  offer: UpsellOffer | null;
  userTier?: "free" | "premium"; // kept for API compat but overridden by store
  prices: Record<string, number>;
  currency?: string;
  triggerSource?: string;
  onClose: () => void;
}

function getOfferMeta(t: TFunction) {
  return {
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

export default function UpsellModal({ offer, prices, currency, triggerSource, onClose }: UpsellModalProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { tier, isTrialPremium, hasFetchedStatus } = useSubscriptionStore();
  const [variant, setVariant] = useState<"default" | "bundle">("default");
  const [duoVariant, setDuoVariant] = useState<"monthly" | "yearly">("monthly");
  // Diego, 2026-09-15: card entry happens INSIDE this modal (Stripe
  // Elements) instead of redirecting to a Stripe-hosted page.
  const [showCheckout, setShowCheckout] = useState(false);

  if (!offer) return null;
  const OFFER_META = getOfferMeta(t);
  const meta = OFFER_META[offer];
  // Bug fix (2026-08-12): missing isTrialPremium meant a trial user got
  // shown free-tier pricing here instead of their actual premium pricing —
  // same class of bug found across ~8 places before this app consolidated
  // onto is_premium_active() server-side; this frontend spot slipped through.
  const isPremium = hasPremiumAccess({ tier, isTrialPremium, hasFetchedStatus });

  // Under Adaptive Pricing the prices are the MXN ones actually charged (Stripe then localizes at checkout).
  const money = (n: number) => (currency === "mxn" ? `${fmtMxn(n)} MXN` : `$${n}`);
  const displayPrice = offer === "family_plan"
    ? duoVariant === "monthly" ? `${money(prices.monthly ?? 23.99)}${t("upsellModal.perMonth")}` : `${money(prices.yearly ?? 224.99)}${t("upsellModal.perYear")}`
    : isPremium
    ? money(variant === "bundle" ? (prices.bundle ?? 247) : (prices.premium ?? 0))
    : money(prices.free ?? 0);

  const purchaseVariant = offer === "family_plan" ? duoVariant : variant === "bundle" ? "bundle" : tier;

  // Diego, 2026-09-15: "quiero agregarle este resumen del pedido similar a
  // los productos con sus respectivos productos" — PricingModal's checkout
  // already shows an order-summary card (plan, features, price, total)
  // next to the payment form; this modal's own checkout (session/Duo
  // bought straight from an upsell prompt, not from the pricing page) was
  // missing the same recap. Built from the same `meta`/`displayPrice`
  // already used to render the pre-checkout card above, so it always
  // matches what the user just saw.
  const checkoutSummary: CheckoutSummary = {
    planName: offer === "session"
      ? `${meta.title} — ${variant === "bundle" ? t("upsellModal.pack3Sessions") : t("upsellModal.oneSession")}`
      : meta.title,
    priceLabel: displayPrice,
    priceSuffix: "",
    dueTodayLabel: displayPrice,
    features: meta.features,
    accentColor: meta.color,
  };

  const handleCheckoutSuccess = (paymentIntentId?: string) => {
    onClose();
    setShowCheckout(false);
    const target = offer === "family_plan"
      ? "/upsell-success?offer=family_plan"
      : `/upsell-success?offer=session${paymentIntentId ? `&payment_intent=${paymentIntentId}` : ""}`;
    router.push(target);
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
        // Widen for checkout: EmbeddedCheckout's order-summary layout puts
        // a 260px recap column beside the payment form (same as
        // PricingModal's own checkout, which uses max-w-4xl) — cramming
        // that into this modal's normal max-w-md would squeeze both
        // columns illegibly.
        className={`w-full rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col ${showCheckout ? "sm:max-w-2xl" : "sm:max-w-md"}`}
        style={{
          background: "var(--card)",
          border: `1px solid ${meta.color}35`,
          maxHeight: "90vh",
          boxShadow: `0 0 60px ${meta.color}22, 0 25px 50px rgba(0,0,0,0.5)`,
        }}
      >
        {/* Top accent bar */}
        <div className="h-1 shrink-0" style={{ background: `linear-gradient(90deg, ${meta.color}99, ${meta.color})` }} />

        {showCheckout ? (
          // Same overflow-y-auto/minHeight:0 wrapper as the non-checkout
          // branch below — without it, EmbeddedCheckout (card fields +
          // billing address + submit button) renders as a direct child of
          // this panel's overflow-hidden container and gets clipped with no
          // way to scroll to the rest of the form. Confirmed 2026-09-15
          // from a real screenshot of the session-purchase checkout.
          <div
            className="overflow-y-auto flex-1 pt-4"
            style={{ minHeight: 0, WebkitOverflowScrolling: "touch" }}
          >
            <EmbeddedCheckout
              createIntent={() => upsells.checkoutEmbedded(offer, purchaseVariant, triggerSource ?? "").then((r) => r.data)}
              adaptive={{
                createSession: () => upsells.checkoutAdaptive(offer, purchaseVariant, triggerSource ?? "").then((r) => r.data),
              }}
              returnUrl={`${window.location.origin}${offer === "family_plan" ? "/upsell-success?offer=family_plan" : "/upsell-success?offer=session"}`}
              onBack={() => setShowCheckout(false)}
              onSuccess={handleCheckoutSuccess}
              payCtaLabel={offer === "session" ? t("pricingModal.payCtaSession") : undefined}
              summary={checkoutSummary}
            />
          </div>
        ) : (
        <>
        <div
          className="overflow-y-auto flex-1 px-6 pt-5 pb-4 space-y-4"
          style={{ minHeight: 0, WebkitOverflowScrolling: "touch" }}
        >
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
                    {v === "default" ? money(prices.premium ?? 99) : money(prices.bundle ?? 247)}
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
                    {v === "monthly" ? `${money(prices.monthly ?? 23.99)}/mes` : `${money(prices.yearly ?? 224.99)}/año`}
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
            onClick={() => setShowCheckout(true)}
            className="w-full py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
            style={{
              background: `linear-gradient(135deg,${meta.color}cc,${meta.color})`,
              color: "#fff",
              boxShadow: `0 4px 20px ${meta.color}44`,
            }}
          >
            {offer === "session" ? t("upsellModal.bookSession") : offer === "family_plan" ? t("upsellModal.activateDuoPlan") : t("upsellModal.getMyReport")}
            <ArrowRight className="w-4 h-4" />
          </button>
          <button onClick={handleDismiss} className="w-full py-2 text-xs text-center hover:opacity-70 transition-opacity"
                  style={{ color: "var(--dim)" }}>
            {t("upsellModal.maybeLater")}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
