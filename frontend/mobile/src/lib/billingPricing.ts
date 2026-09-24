import { useEffect, useState } from "react";
import { billingApi } from "./api";

// What this user will actually be charged (GET /billing/pricing): MXN for
// Mexico / Adaptive Pricing, else USD. Same contract as web's lib/pricing.ts.
export type BillingPricing = {
  currency: string;
  adaptive?: boolean;
  monthly?: number;
  yearly?: number;
  duo_monthly?: number;
  duo_yearly?: number;
  session_free?: number;
  session_premium?: number;
  session_bundle?: number;
  broker_call?: number;
};

let cached: Promise<BillingPricing> | null = null;

/** Fetched once per app session and shared by every price on screen. Falls back to USD on any error. */
export function useBillingPricing(): BillingPricing {
  const [pricing, setPricing] = useState<BillingPricing>({ currency: "usd" });
  useEffect(() => {
    let alive = true;
    if (!cached) {
      cached = billingApi.getPricing()
        .then((r: any) => r.data as BillingPricing)
        .catch(() => { cached = null; return { currency: "usd" } as BillingPricing; });
    }
    cached.then((p) => { if (alive) setPricing(p); });
    return () => { alive = false; };
  }, []);
  return pricing;
}

export const fmtMxn = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
