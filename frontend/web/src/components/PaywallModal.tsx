"use client";

import { useState, useEffect } from "react";
import { X, Check } from "lucide-react";
import posthog from "posthog-js";
import { billing, upsells } from "@/lib/api";
import { useTranslation } from "react-i18next";

interface PaywallModalProps {
  visible: boolean;
  onClose: () => void;
  reason?: string;
}

// Diego, 2026-08-30: rewritten to match PricingModal's (Productos) design
// language almost exactly — same plan toggle, same card styling — instead
// of its own single-plan hero layout. Two differences from PricingModal on
// purpose: (1) no Free card here, since whoever sees this modal is already
// on Free — showing "Free · tu plan actual" would just be wasted space on
// their own tier; (2) Premium's feature list is 5 curated high-value
// bullets + a closing "y muchas funcionalidades más" line instead of
// PricingModal's full checklist — this modal interrupts a locked feature,
// it isn't the place someone goes to compare every included feature (that
// stays PricingModal's job, unchanged).
export default function PaywallModal({ visible, onClose, reason }: PaywallModalProps) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(false);
  const [duoLoading, setDuoLoading] = useState(false);

  // Diego's Aug 16 Free/Premium spec, §17 — reuse the analytics infra that
  // already exists (PostHog is wired but had zero custom events on web)
  // rather than build a new system. Centralized here so every paywall in
  // the app (existing and new: Morning Brief, Portfolio Review, Smart
  // Alerts, Oportunidades) reports without a per-page call.
  useEffect(() => {
    if (visible) posthog.capture("premium_paywall_viewed", { reason: reason ?? null });
  }, [visible, reason]);

  if (!visible) return null;

  const HERO_FEATURES = [
    t("paywallModal.heroFeature1"),
    t("paywallModal.heroFeature2"),
    t("paywallModal.heroFeature3"),
    t("paywallModal.heroFeature4"),
    t("paywallModal.heroFeature5"),
  ];
  const DUO_FEATURES = t("pricingModal.duoFeatures", { returnObjects: true }) as string[];

  // Same monthly-equivalent-price-up-top convention PricingModal uses —
  // the real annual charge + savings are called out just below, never the
  // annual total as the headline number.
  const monthlyPrice = plan === "monthly" ? "$14.99" : "$12.08";
  const duoPrice = plan === "monthly" ? "$23.99" : "$18.75";

  async function handleUpgrade() {
    posthog.capture("premium_paywall_clicked", { reason: reason ?? null, plan });
    setLoading(true);
    try {
      const res = await billing.createCheckout(plan);
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
  }

  async function handleDuoCheckout() {
    posthog.capture("premium_paywall_clicked", { reason: reason ?? null, plan: "duo" });
    setDuoLoading(true);
    try {
      const res = await upsells.checkout("family_plan", plan, "paywall_modal");
      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        window.alert(t("pricingModal.paymentError"));
        setDuoLoading(false);
      }
    } catch {
      window.alert(t("pricingModal.paymentError"));
      setDuoLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full max-w-xl rounded-3xl shadow-2xl flex flex-col"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", maxHeight: "92vh" }}
      >
        {/* Header — sticky, always visible */}
        <div className="relative flex items-center justify-center py-5 px-6 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
          <h1 className="text-xl font-black" style={{ color: "var(--text)" }}>{t("paywallModal.premiumBadge")}</h1>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="absolute right-5 top-1/2 -translate-y-1/2 p-2 rounded-xl hover:bg-white/5 transition-colors"
            style={{ color: "var(--muted)" }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Contextual reason — the one thing PricingModal doesn't need,
              since it's never opened from a locked feature */}
          {reason && (
            <div
              className="mx-6 mt-5 px-4 py-2.5 rounded-xl text-center text-xs"
              style={{ background: "rgba(0,168,94,0.08)", border: "1px solid rgba(0,168,94,0.25)", color: "var(--sub)" }}
            >
              🔒 {reason}
            </div>
          )}

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

          {/* Cards — Premium + Duo only, no Free */}
          <div className="grid grid-cols-2 gap-4 px-6">
            {/* Premium card */}
            <div
              className="rounded-2xl border p-5 flex flex-col relative overflow-hidden"
              style={{ background: "linear-gradient(135deg, #0a1a10 0%, #0d1f15 100%)", borderColor: "rgba(0,212,126,0.35)" }}
            >
              <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at top right, rgba(0,212,126,0.08) 0%, transparent 60%)" }} />
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2 text-[9px] font-black px-2.5 py-1 rounded-b-lg"
                style={{ background: "#f59e0b", color: "#000" }}
              >
                {t("paywallModal.planYearlyBadge")}
              </span>

              <p className="text-lg font-black mt-4 mb-1 relative" style={{ color: "#fff" }}>{t("pricingModal.premium")}</p>
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

              <button
                onClick={handleUpgrade}
                disabled={loading}
                className="relative w-full py-2.5 rounded-xl text-sm font-black transition-all mb-5"
                style={{ background: loading ? "rgba(0,212,126,0.5)" : "#00d47e", color: "#000" }}
              >
                {loading ? t("pricingModal.redirecting") : t("paywallModal.startNow")}
              </button>

              <div className="relative space-y-2.5 flex-1">
                {HERO_FEATURES.map((f) => (
                  <div key={f} className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#00d47e" }} />
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.8)" }}>{f}</span>
                  </div>
                ))}
              </div>
              <p
                className="text-[10.5px] italic mt-3 pt-3 relative"
                style={{ color: "rgba(255,255,255,0.45)", borderTop: "1px dashed rgba(255,255,255,0.15)" }}
              >
                {t("paywallModal.moreFeatures")}
              </p>
            </div>

            {/* Duo card */}
            <div
              className="rounded-2xl border p-5 flex flex-col relative overflow-hidden"
              style={{ background: "linear-gradient(135deg, #0d1020 0%, #111827 100%)", borderColor: "rgba(99,102,241,0.4)" }}
            >
              <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at top right, rgba(99,102,241,0.07) 0%, transparent 60%)" }} />

              <div className="flex items-center gap-2 mb-1 relative">
                <span className="text-lg">👫</span>
                <p className="text-lg font-black text-white">{t("pricingModal.duoPlan")}</p>
                <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}>
                  {t("pricingModal.new")}
                </span>
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
                <p className="text-[10px] mb-3 relative" style={{ color: "rgba(255,255,255,0.4)" }}>{t("pricingModal.billedMonthly")}</p>
              )}

              <button
                onClick={handleDuoCheckout}
                disabled={duoLoading}
                className="relative w-full py-2.5 rounded-xl text-sm font-black transition-all mb-5"
                style={{ background: duoLoading ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8" }}
              >
                {duoLoading ? t("pricingModal.redirecting") : t("pricingModal.hireDuoPlan")}
              </button>

              <div className="relative space-y-2.5 flex-1">
                {DUO_FEATURES.map((f) => (
                  <div key={f} className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#818cf8" }} />
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Trust row */}
          <div className="flex items-center justify-center gap-4 px-6 py-5">
            {[t("paywallModal.cancelAnytime"), t("paywallModal.securePayment"), t("paywallModal.freeTrial")].map((item) => (
              <span key={item} className="flex items-center gap-1 text-[10px]" style={{ color: "var(--dim)" }}>
                <Check className="w-2.5 h-2.5" style={{ color: "#00d47e" }} />
                {item}
              </span>
            ))}
          </div>

          {/* 1:1 CTA */}
          <div className="px-6 pb-6">
            <a
              href="https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl hover:opacity-80 transition-opacity"
              style={{ background: "var(--raised)" }}
            >
              <span className="text-sm">📅</span>
              <span className="text-xs font-semibold" style={{ color: "var(--accent-l)" }}>{t("paywallModal.oneOnOneCta")}</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
