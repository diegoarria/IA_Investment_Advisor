"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Check, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { billing, upsells } from "@/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "@/lib/store";
import EmbeddedCheckout, { type CheckoutSummary } from "./EmbeddedCheckout";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function PricingModal({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [plan, setPlan] = useState<"monthly" | "yearly">("monthly");
  // Diego, 2026-09-15: card entry happens INSIDE this modal (Stripe
  // Elements) instead of redirecting to a Stripe-hosted page, for BOTH
  // the individual Premium plan and the Duo plan — this just swaps the
  // plan grid below for EmbeddedCheckout, same modal shell.
  const [checkoutMode, setCheckoutMode] = useState<"premium" | "duo" | null>(null);
  const { tier, isTrialPremium, trialStartedAt, duoSetupPending, duoSecondaryEmail, hasFetchedStatus } = useSubscriptionStore();
  const isPremium = hasPremiumAccess({ tier, isTrialPremium, hasFetchedStatus });
  // Best signal available client-side for "this account is the Duo owner"
  // — duo_plan_purchased_at itself isn't exposed to the frontend, but both
  // of these fields only ever get set as a side effect of it having been
  // purchased (see billing.py's /status).
  const isDuoOwner = !!duoSetupPending || !!duoSecondaryEmail;
  // Diego, 2026-09-15: "si una persona ya tuvo su premium trial... no
  // darles otro mes premium, ya se paga de una" (and: don't offer a trial
  // to someone who's ALREADY premium — manually comp'd accounts like
  // Diego's never go through the trial_started_at auto-start at all, so
  // that alone isn't enough). Checkout never actually applies a Stripe
  // trial_period_days either way — clicking "Pagar y suscribirme" always
  // charges immediately.
  const alreadyHadTrial = isPremium || !!trialStartedAt;

  const FREE_FEATURES = t("pricingModal.freeFeatures", { returnObjects: true }) as string[];
  const PREMIUM_FEATURES = t("pricingModal.premiumFeatures", { returnObjects: true }) as string[];
  const DUO_FEATURES = t("pricingModal.duoFeatures", { returnObjects: true }) as string[];

  if (!visible) return null;

  function handleCheckoutSuccess() {
    onClose();
    setCheckoutMode(null);
    if (checkoutMode === "duo") {
      // Duo's success page shows the secondary-account email setup form —
      // no payment verification needed there (unlike the 1:1 session
      // flow), it's driven purely by ?offer=family_plan.
      router.push("/upsell-success?offer=family_plan");
    } else {
      // Same post-payment polling (fetchStatus until tier flips to
      // premium) that the Stripe-hosted redirect flow already used —
      // reused as-is instead of duplicating that wait-for-webhook logic.
      router.push("/premium-success");
    }
  }

  // Yearly billing is always shown as its monthly-equivalent price up top
  // (what the user actually compares against the monthly plan), with the
  // real annual charge + savings called out just below — never the annual
  // total as the headline number.
  const monthlyPrice = plan === "monthly" ? "$14.99" : "$12.08";
  const duoPrice     = plan === "monthly" ? "$23.99" : "$18.75";
  const premiumAnnualTotal = "$144.99";
  const duoAnnualTotal     = "$224.99";

  // Recap shown next to the payment form in checkout — same price/features
  // the plan cards below already show, just kept visible past the click
  // into EmbeddedCheckout instead of disappearing.
  const premiumSummary: CheckoutSummary = {
    planName: t("pricingModal.premium"),
    priceLabel: monthlyPrice,
    priceSuffix: t("pricingModal.perMonthShort"),
    billingNote: plan === "yearly" ? t("pricingModal.billedAnnuallyAmount", { amount: premiumAnnualTotal }) : undefined,
    savingsNote: plan === "yearly" ? t("pricingModal.premiumSavings") : undefined,
    dueTodayLabel: plan === "yearly" ? premiumAnnualTotal : monthlyPrice,
    features: PREMIUM_FEATURES,
    accentColor: "#00d47e",
  };
  const duoSummary: CheckoutSummary = {
    planName: t("pricingModal.duoPlan"),
    priceLabel: duoPrice,
    priceSuffix: t("pricingModal.perMonthShort"),
    billingNote: plan === "yearly" ? t("pricingModal.billedAnnuallyAmount", { amount: duoAnnualTotal }) : undefined,
    savingsNote: plan === "yearly" ? t("pricingModal.duoSavings") : undefined,
    dueTodayLabel: plan === "yearly" ? duoAnnualTotal : duoPrice,
    features: DUO_FEATURES,
    accentColor: "#818cf8",
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col" style={{ background: "var(--bg)", border: "1px solid var(--border)", maxHeight: "90vh" }}>

        {/* Header — sticky, always visible */}
        <div className="relative flex items-center justify-center py-5 px-6 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
          <h1 className="text-xl font-black" style={{ color: "var(--text)" }}>
            {t(alreadyHadTrial ? "pricingModal.titleReturning" : "pricingModal.title")}
          </h1>
          <button onClick={onClose} aria-label={t("common.close")} className="absolute right-5 top-1/2 -translate-y-1/2 p-2 rounded-xl hover:bg-white/5 transition-colors" style={{ color: "var(--muted)" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">

        {checkoutMode ? (
          <div className="pt-4">
            <EmbeddedCheckout
              createIntent={() =>
                checkoutMode === "duo"
                  ? upsells.checkoutEmbedded("family_plan", plan, "pricing_modal").then((r) => r.data)
                  : billing.createEmbeddedSubscription(plan).then((r) => r.data)
              }
              returnUrl={`${window.location.origin}${checkoutMode === "duo" ? "/upsell-success?offer=family_plan" : "/premium-success"}`}
              onBack={() => setCheckoutMode(null)}
              onSuccess={handleCheckoutSuccess}
              summary={checkoutMode === "duo" ? duoSummary : premiumSummary}
            />
          </div>
        ) : (
        <>
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
              {p === "monthly" ? t("pricingModal.monthly") : t("pricingModal.yearly")}
              {p === "yearly" && <span className="ml-1.5 opacity-80">−17%</span>}
            </button>
          ))}
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-6 pb-6">

          {/* Free card */}
          <div className="rounded-2xl border p-5 flex flex-col" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <p className="text-lg font-black mb-1" style={{ color: "var(--text)" }}>{t("pricingModal.free")}</p>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-3xl font-black" style={{ color: "var(--text)" }}>$0</span>
              <span className="text-sm" style={{ color: "var(--muted)" }}>{t("pricingModal.perMonth")}</span>
            </div>
            <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>{t("pricingModal.freeTagline")}</p>

            {!isPremium && (
              <div className="rounded-xl py-2 px-4 text-center text-sm font-bold mb-5" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                {t("pricingModal.currentPlan")}
              </div>
            )}

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
              <p className="text-lg font-black" style={{ color: "#fff" }}>{t("pricingModal.premium")}</p>
            </div>

            <div className="flex items-baseline gap-2 mb-1 relative">
              <span className="text-3xl font-black text-white">{monthlyPrice}</span>
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{t("pricingModal.perMonthShort")}</span>
            </div>
            {plan === "yearly" ? (
              <>
                <p className="text-[11px] relative" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {t("pricingModal.billedAnnuallyAmount", { amount: "$144.99" })}
                </p>
                <p className="text-[10px] mb-3 relative" style={{ color: "#00d47e" }}>{t("pricingModal.premiumSavings")}</p>
              </>
            ) : (
              <div className="mb-3" />
            )}

            {isPremium && !isDuoOwner ? (
              <div className="relative rounded-xl py-2.5 px-4 text-center text-sm font-bold mb-5" style={{ background: "rgba(0,212,126,0.12)", border: "1px solid rgba(0,212,126,0.35)", color: "#00d47e" }}>
                {t("pricingModal.currentPlan")}
              </div>
            ) : (
              <button
                onClick={() => setCheckoutMode("premium")}
                className="relative w-full py-2.5 rounded-xl text-sm font-black transition-all mb-5"
                style={{ background: "#00d47e", color: "#000" }}
              >
                {t("pricingModal.subscribeCta")}
              </button>
            )}

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
              <p className="text-lg font-black text-white">{t("pricingModal.duoPlan")}</p>
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}>{t("pricingModal.new")}</span>
            </div>

            <div className="flex items-baseline gap-1 mb-1 relative">
              <span className="text-3xl font-black text-white">{duoPrice}</span>
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>USD {t("pricingModal.perMonthShort")}</span>
            </div>
            {plan === "yearly" ? (
              <>
                <p className="text-[11px] relative" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {t("pricingModal.billedAnnuallyAmount", { amount: "$224.99" })}
                </p>
                <p className="text-[10px] mb-3 relative" style={{ color: "#818cf8" }}>{t("pricingModal.duoSavings")}</p>
              </>
            ) : (
              <p className="text-[10px] mb-3 relative" style={{ color: "rgba(255,255,255,0.4)" }}>
                {t("pricingModal.billedMonthly")}
              </p>
            )}

            {isDuoOwner ? (
              <div className="relative rounded-xl py-2.5 px-4 text-center text-sm font-bold mb-5" style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8" }}>
                {t("pricingModal.currentPlan")}
              </div>
            ) : (
              <button
                onClick={() => setCheckoutMode("duo")}
                className="relative w-full py-2.5 rounded-xl text-sm font-black transition-all mb-5"
                style={{ background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8" }}
              >
                {t("pricingModal.hireDuoPlan")}
              </button>
            )}

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
          {t(alreadyHadTrial ? "pricingModal.footerNoteReturning" : "pricingModal.footerNote", { price: monthlyPrice, billing: plan === "yearly" ? t("pricingModal.billedAnnuallySuffix") : "" })}
        </p>
        </>
        )}

        </div>{/* end scrollable body */}
      </div>
    </div>
  );
}
