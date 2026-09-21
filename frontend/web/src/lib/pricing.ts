"use client";

import { useEffect, useState } from "react";
import { billing } from "@/lib/api";

// What this user will actually be charged (see GET /billing/pricing): MXN amounts
// for Mexico or when Adaptive Pricing is on (MXN is the base price), else USD.
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
};

let cached: Promise<BillingPricing> | null = null;

/** Fetched once per page load and shared by every price on screen. Falls back to USD on any error. */
export function useBillingPricing(): BillingPricing {
  const [pricing, setPricing] = useState<BillingPricing>({ currency: "usd" });
  useEffect(() => {
    let alive = true;
    if (!cached) cached = billing.getPricing().then((r) => r.data as BillingPricing).catch(() => ({ currency: "usd" }));
    cached.then((p) => { if (alive) setPricing(p); });
    return () => { alive = false; };
  }, []);
  return pricing;
}

export const fmtMxn = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
