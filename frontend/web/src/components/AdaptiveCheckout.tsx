"use client";

// Premium checkout with Stripe Adaptive Pricing (Checkout Session, ui_mode
// "elements"): the customer sees and pays in their local currency, at a rate
// Stripe guarantees for 24h. Stripe REQUIRES the Currency Selector Element to
// be shown. Adaptive Pricing isn't available on the PaymentIntents API the
// legacy EmbeddedCheckout uses, hence this separate component.
//
// If the Checkout Session can't be created (feature off, Stripe error, ...)
// `onFallback` is called and the caller renders the legacy EmbeddedCheckout —
// paying must never be blocked by this newer path.

import { useEffect, useState } from "react";
import {
  CheckoutElementsProvider, PaymentElement, CurrencySelectorElement, useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { Loader2, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "@/lib/store";
import { OrderSummary, stripePromise, getAppearance, type CheckoutSummary } from "./EmbeddedCheckout";

function Form({ onBack, summary, payCtaLabel }: { onBack: () => void; summary?: Omit<CheckoutSummary, "priceLabel" | "dueTodayLabel">; payCtaLabel?: string }) {
  const { t } = useTranslation();
  const state = useCheckoutElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.type === "loading") {
    return <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#00d47e" }} /></div>;
  }
  if (state.type === "error") {
    return <p className="text-sm" style={{ color: "#ef4444" }}>{state.error.message}</p>;
  }

  const { checkout } = state;
  const total = checkout.total.total.amount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    // Redirects to the session's return_url on success; only returns here on an immediate error.
    const result = await checkout.confirm();
    if (result.type === "error") {
      setError(result.error.message ?? t("pricingModal.paymentError"));
      setSubmitting(false);
    }
  };

  return (
    <div className={summary ? "grid sm:grid-cols-[minmax(0,1fr)_260px] gap-5" : ""}>
      <form onSubmit={handleSubmit} className="order-last sm:order-first">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs font-bold mb-4" style={{ color: "var(--muted)" }}>
          <ArrowLeft className="w-3.5 h-3.5" /> {t("common.back")}
        </button>

        <div className="mb-4"><CurrencySelectorElement /></div>

        <p className="text-xs font-bold mb-2" style={{ color: "var(--sub)" }}>{t("pricingModal.payWith")}</p>
        <PaymentElement />

        {error && <p className="text-xs mt-3" style={{ color: "#ef4444" }}>{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 rounded-xl text-sm font-black mt-5 flex items-center justify-center gap-2"
          style={{ background: submitting ? "rgba(0,212,126,0.5)" : "#00d47e", color: "#000" }}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {submitting ? t("pricingModal.processing") : (payCtaLabel ?? t("pricingModal.payCta"))}
        </button>
        <p className="text-center text-[10px] mt-4" style={{ color: "var(--dim)" }}>{t("pricingModal.securePaymentNote")}</p>
      </form>
      {/* The total comes straight from Stripe, in whatever currency the customer selected. */}
      {summary && <OrderSummary summary={{ ...summary, priceLabel: total, dueTodayLabel: total }} />}
    </div>
  );
}

export default function AdaptiveCheckout({
  createSession, onBack, onFallback, summary, payCtaLabel,
}: {
  /** Creates the Checkout Session server-side; a rejection (404 = not offered for this product, 5xx, ...) triggers `onFallback`. */
  createSession: () => Promise<{ client_secret: string }>;
  onBack: () => void;
  onFallback: () => void;
  summary?: Omit<CheckoutSummary, "priceLabel" | "dueTodayLabel">;
  payCtaLabel?: string;
}) {
  const theme = useThemeStore((s) => s.theme);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!stripePromise) { onFallback(); return; }
    createSession()
      .then((r) => { if (!cancelled) setClientSecret(r.client_secret); })
      .catch(() => { if (!cancelled) onFallback(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!stripePromise || !clientSecret) {
    return <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#00d47e" }} /></div>;
  }
  return (
    <div className="px-6 pb-6">
      <CheckoutElementsProvider
        stripe={stripePromise}
        options={{ clientSecret, elementsOptions: { appearance: getAppearance(theme) }, adaptivePricing: { allowed: true } }}
      >
        <Form onBack={onBack} summary={summary} payCtaLabel={payCtaLabel} />
      </CheckoutElementsProvider>
    </div>
  );
}
