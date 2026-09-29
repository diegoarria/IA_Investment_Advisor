"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Check, Lock, Leaf, Gem, Users, Sparkles, CheckCircle2, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { billing, upsells } from "@/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "@/lib/store";
import EmbeddedCheckout, { type CheckoutSummary } from "./EmbeddedCheckout";

interface Props {
  visible: boolean;
  onClose: () => void;
}

// Paywall redesign 2026-09-28 — same brand language as the Products page:
// segmented billing toggle, featured emerald Premium card, indigo Duo card,
// check-circle features.
function PlanFeature({ text, tint, textColor, muted }: { text: string; tint: string; textColor: string; muted?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="w-[19px] h-[19px] rounded-full border flex items-center justify-center shrink-0 mt-px"
            style={{ background: muted ? "transparent" : `color-mix(in srgb, ${tint} 18%, transparent)`, borderColor: muted ? `color-mix(in srgb, ${tint} 40%, transparent)` : "transparent" }}>
        <Check className="w-3 h-3" style={{ color: tint }} strokeWidth={3} />
      </span>
      <span className="text-[13.5px] leading-5" style={{ color: textColor }}>{text}</span>
    </div>
  );
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

  // Real billing currency for this user (MXN for Mexico when configured, else USD)
  // — the paywall must show exactly what Stripe will charge.
  const [pricing, setPricing] = useState<{ currency: string; adaptive?: boolean; monthly?: number; yearly?: number; duo_monthly?: number; duo_yearly?: number }>({ currency: "usd" });
  useEffect(() => {
    if (!visible) return;
    billing.getPricing().then((r) => setPricing(r.data)).catch(() => {});
  }, [visible]);

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
  const mxn = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const premiumMxn = pricing.currency === "mxn" && pricing.monthly != null && pricing.yearly != null;
  const duoMxn = pricing.currency === "mxn" && pricing.duo_monthly != null && pricing.duo_yearly != null;
  const monthlyPrice = premiumMxn
    ? (plan === "monthly" ? mxn(pricing.monthly!) : mxn(pricing.yearly! / 12))
    : (plan === "monthly" ? "$14.99" : "$12.08");
  const duoPrice = duoMxn
    ? (plan === "monthly" ? mxn(pricing.duo_monthly!) : mxn(pricing.duo_yearly! / 12))
    : (plan === "monthly" ? "$23.99" : "$18.75");
  const premiumAnnualTotal = premiumMxn ? mxn(pricing.yearly!) : "$144.99";
  const duoAnnualTotal     = duoMxn ? mxn(pricing.duo_yearly!) : "$224.99";
  const duoCurrency = duoMxn ? "MXN" : "USD";

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
      <div className="w-full max-w-5xl rounded-[28px] shadow-2xl flex flex-col overflow-hidden" style={{ background: "var(--bg)", border: "1px solid rgba(0,212,126,0.25)", maxHeight: "92vh" }}>

        {/* Header — sticky, always visible */}
        <div className="relative flex items-center justify-center gap-3 py-5 px-14 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
          <span className="hidden sm:flex w-9 h-9 rounded-[11px] items-center justify-center shrink-0" style={{ background: "var(--accent)" }}>
            <Sparkles className="w-[18px] h-[18px] text-white" />
          </span>
          <h1 className="text-xl sm:text-[22px] font-extrabold tracking-tight text-center" style={{ color: "var(--text)" }}>
            {t(alreadyHadTrial ? "pricingModal.titleReturning" : "pricingModal.title")}
          </h1>
          <button onClick={onClose} aria-label={t("common.close")}
                  className="absolute right-5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full border flex items-center justify-center transition-colors hover:border-[var(--accent)]"
                  style={{ color: "var(--sub)", borderColor: "var(--border)", background: "var(--card)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div
          className="overflow-y-auto flex-1"
          style={{ minHeight: 0, WebkitOverflowScrolling: "touch" }}
        >

        {checkoutMode ? (
          <div className="pt-4">
            <EmbeddedCheckout
              createIntent={() =>
                checkoutMode === "duo"
                  ? upsells.checkoutEmbedded("family_plan", plan, "pricing_modal", { currency: duoMxn ? "mxn" : "usd" }).then((r) => r.data)
                  : billing.createEmbeddedSubscription(plan, premiumMxn ? "mxn" : "usd").then((r) => r.data)
              }
              returnUrl={`${window.location.origin}${checkoutMode === "duo" ? "/upsell-success?offer=family_plan" : "/premium-success"}`}
              adaptive={{
                createSession: () =>
                  (checkoutMode === "duo"
                    ? upsells.checkoutAdaptive("family_plan", plan, "pricing_modal")
                    : billing.createAdaptiveCheckout(plan)
                  ).then((r) => r.data),
              }}
              onBack={() => setCheckoutMode(null)}
              onSuccess={handleCheckoutSuccess}
              summary={checkoutMode === "duo" ? duoSummary : premiumSummary}
            />
          </div>
        ) : (
        <>
        {/* Plan toggle — segmented control */}
        <div className="flex justify-center pt-6 pb-5 px-6">
          <div className="inline-flex p-1 rounded-full border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            {(["monthly", "yearly"] as const).map((p) => {
              const active = plan === p;
              return (
                <button
                  key={p}
                  onClick={() => setPlan(p)}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-[13px] font-extrabold transition-all"
                  style={{
                    background: active ? "#00D47E" : "transparent",
                    color: active ? "#06120D" : "var(--sub)",
                    boxShadow: active ? "0 6px 16px -8px rgba(0,212,126,0.8)" : "none",
                  }}
                >
                  {p === "monthly" ? t("pricingModal.monthly") : t("pricingModal.yearly")}
                  {p === "yearly" && (
                    <span className="text-[10.5px] font-extrabold px-1.5 py-0.5 rounded-full"
                          style={{ background: active ? "rgba(6,18,13,0.15)" : "rgba(0,185,109,0.14)", color: active ? "#06120D" : "var(--accent-l)" }}>
                      −17%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 px-6 pb-6 items-stretch">

          {/* Free card */}
          <div className="rounded-[24px] border p-6 flex flex-col" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0" style={{ background: "rgba(0,185,109,0.10)" }}>
                <Leaf className="w-[18px] h-[18px]" style={{ color: "var(--accent-l)" }} />
              </span>
              <p className="text-lg font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("pricingModal.free")}</p>
            </div>
            <div className="flex items-baseline gap-1.5 mt-5">
              <span className="text-[40px] font-extrabold tracking-[-1.4px] leading-none" style={{ color: "var(--text)" }}>$0</span>
              <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>{t("pricingModal.perMonth")}</span>
            </div>
            <p className="text-[13px] mt-2" style={{ color: "var(--muted)" }}>{t("pricingModal.freeTagline")}</p>

            {!isPremium && (
              <div className="mt-5 rounded-[14px] py-3 px-4 text-center text-sm font-bold border" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--sub)" }}>
                {t("pricingModal.currentPlan")}
              </div>
            )}

            <div className="h-px my-5" style={{ background: "var(--border)" }} />
            <div className="space-y-3 flex-1">
              {FREE_FEATURES.map((f, i) => (
                <PlanFeature key={i} text={f} tint="var(--sub)" textColor="var(--sub)" muted />
              ))}
            </div>
          </div>

          {/* Premium card — featured */}
          <div className="rounded-[24px] border p-6 flex flex-col relative overflow-hidden md:-my-2"
               style={{ background: "linear-gradient(160deg, #0F3326 0%, #0A1C1D 50%, #080E16 100%)", borderColor: "rgba(0,212,126,0.5)", boxShadow: "0 26px 60px -28px rgba(0,212,126,0.65)" }}>
            <div aria-hidden className="absolute -top-24 -right-20 w-72 h-72 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(0,232,135,0.22), transparent 70%)" }} />

            <div className="relative flex items-center gap-3">
              <span className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0" style={{ background: "#00D47E" }}>
                <Gem className="w-[18px] h-[18px]" style={{ color: "#06120D" }} />
              </span>
              <p className="text-lg font-extrabold tracking-tight text-white">{t("pricingModal.premium")}</p>
            </div>

            <div className="relative flex items-baseline gap-1.5 mt-5">
              <span className="text-[40px] font-extrabold tracking-[-1.4px] leading-none text-white">{monthlyPrice}</span>
              <span className="text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>{premiumMxn ? "MXN " : ""}{t("pricingModal.perMonthShort")}</span>
            </div>
            {pricing.adaptive && (
              <p className="relative text-xs mt-2" style={{ color: "rgba(255,255,255,0.6)" }}>{t("pricingModal.adaptiveNote")}</p>
            )}
            {plan === "yearly" && (
              <>
                <p className="relative text-xs mt-2" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {t("pricingModal.billedAnnuallyAmount", { amount: premiumAnnualTotal })}
                </p>
                <p className="relative text-xs font-bold mt-0.5" style={{ color: "#00D47E" }}>{t("pricingModal.premiumSavings")}</p>
              </>
            )}

            {isPremium && !isDuoOwner ? (
              <div className="relative mt-5 inline-flex items-center justify-center gap-2 rounded-[14px] py-3 px-4 text-sm font-extrabold border"
                   style={{ background: "rgba(0,212,126,0.12)", borderColor: "rgba(0,212,126,0.4)", color: "#00D47E" }}>
                <CheckCircle2 className="w-4 h-4" />
                {t("pricingModal.currentPlan")}
              </div>
            ) : (
              <button
                onClick={() => setCheckoutMode("premium")}
                className="relative mt-5 w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-[14px] text-sm font-extrabold transition-all hover:opacity-90 hover:-translate-y-0.5"
                style={{ background: "#00D47E", color: "#06120D", boxShadow: "0 12px 26px -12px rgba(0,212,126,0.8)" }}
              >
                {t("pricingModal.subscribeCta")}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            <div className="relative h-px my-5" style={{ background: "rgba(255,255,255,0.1)" }} />
            <div className="relative space-y-3 flex-1">
              {PREMIUM_FEATURES.map((f, i) => (
                <PlanFeature key={i} text={f} tint="#00D47E" textColor="rgba(255,255,255,0.88)" />
              ))}
            </div>
          </div>

          {/* Duo card */}
          <div className="rounded-[24px] border p-6 flex flex-col relative overflow-hidden"
               style={{ background: "linear-gradient(160deg, #1E2256 0%, #11142E 50%, #0A0C1C 100%)", borderColor: "rgba(129,140,248,0.45)", boxShadow: "0 22px 50px -30px rgba(129,140,248,0.6)" }}>
            <div aria-hidden className="absolute -top-24 -right-20 w-72 h-72 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(129,140,248,0.22), transparent 70%)" }} />

            <div className="relative flex items-center gap-3">
              <span className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0" style={{ background: "#818CF8" }}>
                <Users className="w-[18px] h-[18px]" style={{ color: "#0B0E22" }} />
              </span>
              <p className="text-lg font-extrabold tracking-tight text-white">{t("pricingModal.duoPlan")}</p>
              <span className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full border"
                    style={{ background: "rgba(129,140,248,0.18)", borderColor: "rgba(129,140,248,0.45)", color: "#A5B4FC" }}>{t("pricingModal.new")}</span>
            </div>

            <div className="relative flex items-baseline gap-1.5 mt-5">
              <span className="text-[40px] font-extrabold tracking-[-1.4px] leading-none text-white">{duoPrice}</span>
              <span className="text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>{duoCurrency} {t("pricingModal.perMonthShort")}</span>
            </div>
            {plan === "yearly" ? (
              <>
                <p className="relative text-xs mt-2" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {t("pricingModal.billedAnnuallyAmount", { amount: duoAnnualTotal })}
                </p>
                <p className="relative text-xs font-bold mt-0.5" style={{ color: "#A5B4FC" }}>{t("pricingModal.duoSavings")}</p>
              </>
            ) : (
              <p className="relative text-xs mt-2" style={{ color: "rgba(255,255,255,0.6)" }}>{t("pricingModal.billedMonthly")}</p>
            )}

            {isDuoOwner ? (
              <div className="relative mt-5 inline-flex items-center justify-center gap-2 rounded-[14px] py-3 px-4 text-sm font-extrabold border"
                   style={{ background: "rgba(129,140,248,0.15)", borderColor: "rgba(129,140,248,0.45)", color: "#A5B4FC" }}>
                <CheckCircle2 className="w-4 h-4" />
                {t("pricingModal.currentPlan")}
              </div>
            ) : (
              <button
                onClick={() => setCheckoutMode("duo")}
                className="relative mt-5 w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-[14px] text-sm font-extrabold transition-all hover:opacity-90 hover:-translate-y-0.5"
                style={{ background: "#818CF8", color: "#0B0E22", boxShadow: "0 12px 26px -12px rgba(129,140,248,0.8)" }}
              >
                {t("pricingModal.hireDuoPlan")}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            <div className="relative h-px my-5" style={{ background: "rgba(255,255,255,0.1)" }} />
            <div className="relative space-y-3 flex-1">
              {DUO_FEATURES.map((f, i) => (
                <PlanFeature key={i} text={f} tint="#A5B4FC" textColor="rgba(255,255,255,0.88)" />
              ))}
            </div>
          </div>
        </div>

        {/* Footer note */}
        <p className="flex items-center justify-center gap-1.5 text-center text-xs pb-6 px-8" style={{ color: "var(--muted)" }}>
          <Lock className="w-3.5 h-3.5 shrink-0" />
          {t(alreadyHadTrial ? "pricingModal.footerNoteReturning" : "pricingModal.footerNote", { price: monthlyPrice, billing: plan === "yearly" ? t("pricingModal.billedAnnuallySuffix") : "" })}
        </p>
        </>
        )}

        </div>{/* end scrollable body */}
      </div>
    </div>
  );
}
