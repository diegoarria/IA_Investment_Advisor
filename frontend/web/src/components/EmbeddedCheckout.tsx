"use client";

// Diego, 2026-09-15: "que se vea como un paywall personalizado de Nuvos" —
// Stripe Elements' Payment Element mounted inside Nuvos's own PricingModal,
// styled to match its dark/green theme, instead of redirecting to a
// Stripe-hosted Checkout page. Stripe still does 100% of the actual card
// handling (PCI compliance, tokenization) via its own iframe — only the
// surrounding UI is Nuvos's.
import { useEffect, useState } from "react";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Loader2, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { billing } from "@/lib/api";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

// Stripe's stock "night" theme already looks right on a dark background —
// minimal overrides only (brand green + Nuvos's font), rather than
// re-deriving every color rule by hand, which risks a field/tab ending up
// unreadable (same color as its own background) if one override doesn't
// match another.
const APPEARANCE = {
  theme: "night" as const,
  variables: {
    colorPrimary: "#00d47e",
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, sans-serif",
    borderRadius: "12px",
  },
};

function CheckoutForm({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/premium-success`,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? t("pricingModal.paymentError"));
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6 pb-6">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs font-bold mb-4"
        style={{ color: "var(--muted)" }}
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {t("common.back")}
      </button>

      <PaymentElement />

      {error && <p className="text-xs mt-3" style={{ color: "#ef4444" }}>{error}</p>}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full py-2.5 rounded-xl text-sm font-black mt-5 flex items-center justify-center gap-2"
        style={{ background: submitting ? "rgba(0,212,126,0.5)" : "#00d47e", color: "#000" }}
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {submitting ? t("pricingModal.processing") : t("pricingModal.payCta")}
      </button>

      <p className="text-center text-[10px] mt-4" style={{ color: "var(--dim)" }}>
        {t("pricingModal.securePaymentNote")}
      </p>
    </form>
  );
}

export default function EmbeddedCheckout({
  plan, onBack, onSuccess,
}: {
  plan: "monthly" | "yearly";
  onBack: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    billing.createEmbeddedSubscription(plan)
      .then((res) => { if (!cancelled) setClientSecret(res.data?.client_secret ?? null); })
      .catch(() => { if (!cancelled) setError(t("pricingModal.paymentError")); });
    return () => { cancelled = true; };
  }, [plan, t]);

  if (!stripePromise) {
    return <p className="px-6 pb-6 text-sm" style={{ color: "#ef4444" }}>Stripe no está configurado (falta NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).</p>;
  }

  if (error) {
    return <p className="px-6 pb-6 text-sm" style={{ color: "#ef4444" }}>{error}</p>;
  }

  if (!clientSecret) {
    return (
      <div className="px-6 pb-10 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#00d47e" }} />
      </div>
    );
  }

  const options: StripeElementsOptions = { clientSecret, appearance: APPEARANCE };

  return (
    <Elements stripe={stripePromise} options={options}>
      <CheckoutForm onBack={onBack} onSuccess={onSuccess} />
    </Elements>
  );
}
