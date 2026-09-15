"use client";

// Diego, 2026-09-15: "que se vea como un paywall personalizado de Nuvos...
// lo quiero para todos los productos de Nuvos" — Stripe Elements' Payment
// Element mounted inside Nuvos's own modals/pages, styled to match its
// dark/green theme, instead of redirecting to a Stripe-hosted Checkout
// page. Stripe still does 100% of the actual card handling (PCI
// compliance, tokenization) via its own iframe — only the surrounding UI
// is Nuvos's. Generic over WHICH product it's paying for — the caller
// supplies `createIntent` (however that product creates its client_secret)
// and `returnUrl` (where a 3D Secure redirect, if one is required, comes
// back to).
import { useEffect, useState } from "react";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { Elements, PaymentElement, AddressElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Loader2, ArrowLeft, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

// Plan/price recap shown alongside the payment form — same info the user
// already saw on the plan-selection cards, kept visible here instead of
// disappearing the moment they click through, so they aren't confirming a
// card charge with no price on screen (mirrors ChatGPT's checkout).
export interface CheckoutSummary {
  planName: string;
  /** Headline price (monthly-equivalent when billed yearly), e.g. "$14.99". */
  priceLabel: string;
  priceSuffix: string;
  /** e.g. "$144.99 billed annually" — only set when plan is yearly. */
  billingNote?: string;
  savingsNote?: string;
  /** What's actually charged today — the annual total on a yearly plan. */
  dueTodayLabel: string;
  features: string[];
  accentColor: string;
}

function OrderSummary({ summary }: { summary: CheckoutSummary }) {
  const { t } = useTranslation();
  return (
    <div className="order-first sm:order-last rounded-2xl border p-5 h-fit" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <p className="text-xs font-bold mb-3" style={{ color: "var(--sub)" }}>{t("pricingModal.orderSummary")}</p>
      <p className="text-base font-black mb-3" style={{ color: "var(--text)" }}>{summary.planName}</p>

      <div className="space-y-2 mb-4">
        {summary.features.slice(0, 5).map((f, i) => (
          <div key={i} className="flex items-start gap-2">
            <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: summary.accentColor }} />
            <span className="text-xs" style={{ color: "var(--muted)" }}>{f}</span>
          </div>
        ))}
      </div>

      <div className="pt-3 border-t space-y-1.5" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: "var(--muted)" }}>{summary.planName}</span>
          <span style={{ color: "var(--text)" }}>{summary.priceLabel}{summary.priceSuffix}</span>
        </div>
        {summary.billingNote && (
          <p className="text-[11px]" style={{ color: "var(--dim)" }}>{summary.billingNote}</p>
        )}
        {summary.savingsNote && (
          <p className="text-[11px]" style={{ color: summary.accentColor }}>{summary.savingsNote}</p>
        )}
        <div className="flex items-center justify-between text-sm font-black pt-2 mt-1 border-t" style={{ borderColor: "var(--border)" }}>
          <span style={{ color: "var(--text)" }}>{t("pricingModal.dueToday")}</span>
          <span style={{ color: "var(--text)" }}>{summary.dueTodayLabel}</span>
        </div>
      </div>
    </div>
  );
}

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

function CheckoutForm({
  onBack, onSuccess, returnUrl,
}: { onBack: () => void; onSuccess: (paymentIntentId?: string) => void; returnUrl: string }) {
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

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? t("pricingModal.paymentError"));
      setSubmitting(false);
      return;
    }
    onSuccess(paymentIntent?.id);
  };

  return (
    <form onSubmit={handleSubmit}>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs font-bold mb-4"
        style={{ color: "var(--muted)" }}
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {t("common.back")}
      </button>

      <p className="text-xs font-bold mb-2" style={{ color: "var(--sub)" }}>{t("pricingModal.payWith")}</p>
      <PaymentElement />

      <p className="text-xs font-bold mt-5 mb-2" style={{ color: "var(--sub)" }}>{t("pricingModal.billingAddress")}</p>
      <AddressElement options={{ mode: "billing" }} />

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
  createIntent, onBack, onSuccess, returnUrl, summary,
}: {
  /** Fetches this product's client_secret — e.g.
   * `() => billing.createEmbeddedSubscription(plan).then(r => r.data)`. */
  createIntent: () => Promise<{ client_secret?: string; error?: string }>;
  onBack: () => void;
  /** Called once payment succeeds without needing a redirect (the common
   * case). Receives the PaymentIntent id so the caller can verify/redeem
   * immediately, in-page, instead of waiting on a round-trip. */
  onSuccess: (paymentIntentId?: string) => void;
  /** Where a 3D Secure challenge (if one is required) redirects back to —
   * Stripe appends its own `payment_intent`/`redirect_status` query params
   * to whatever URL is given here. */
  returnUrl: string;
  /** Plan/price recap shown next to the form. Optional so any other
   * caller of this generic component can skip it. */
  summary?: CheckoutSummary;
}) {
  const { t } = useTranslation();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createIntent()
      .then((res) => {
        if (cancelled) return;
        if (res.client_secret) setClientSecret(res.client_secret);
        else setError(res.error || t("pricingModal.paymentError"));
      })
      .catch(() => { if (!cancelled) setError(t("pricingModal.paymentError")); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let body: React.ReactNode;
  if (!stripePromise) {
    body = <p className="text-sm" style={{ color: "#ef4444" }}>Stripe no está configurado (falta NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).</p>;
  } else if (error) {
    body = <p className="text-sm" style={{ color: "#ef4444" }}>{error}</p>;
  } else if (!clientSecret) {
    body = (
      <div className="flex justify-center py-4">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#00d47e" }} />
      </div>
    );
  } else {
    const options: StripeElementsOptions = { clientSecret, appearance: APPEARANCE };
    body = (
      <Elements stripe={stripePromise} options={options}>
        <CheckoutForm onBack={onBack} onSuccess={onSuccess} returnUrl={returnUrl} />
      </Elements>
    );
  }

  if (!summary) return <div className="px-6 pb-6">{body}</div>;

  return (
    <div className="px-6 pb-6 grid sm:grid-cols-[minmax(0,1fr)_260px] gap-5">
      <div className="order-last sm:order-first">{body}</div>
      <OrderSummary summary={summary} />
    </div>
  );
}
