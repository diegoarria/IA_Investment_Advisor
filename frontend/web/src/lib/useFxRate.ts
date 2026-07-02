import { useEffect, useState } from "react";
import { market as marketApi } from "@/lib/api";

const LOCAL_FALLBACK: Record<string, number> = {
  MXN: 18.5, EUR: 0.92, GBP: 0.79, CAD: 1.38, ARS: 1150, BRL: 5.7,
  COP: 4200, CLP: 960, PEN: 3.75, JPY: 155, AUD: 1.55, CHF: 0.89,
  NZD: 1.68, INR: 83.5, CNY: 7.25, HKD: 7.82, SGD: 1.35, TRY: 32.5,
  ZAR: 18.8, SEK: 10.6, NOK: 10.8, DKK: 6.85, PLN: 4.05, KRW: 1360,
};

// Fetch live FX rate (USD -> currency) — open.er-api.com (primary) → frankfurter → hardcoded fallback.
// Caches last-known-good rate in localStorage so the UI never shows a stale 1.0 on reload.
export function useFxRate(currency: string): number {
  const [fxRate, setFxRate] = useState(1);

  useEffect(() => {
    if (currency === "USD") { setFxRate(1); return; }
    const lsKey = `nuvos_fx_${currency}`;
    const stored = typeof window !== "undefined" ? parseFloat(localStorage.getItem(lsKey) ?? "") : NaN;
    if (!isNaN(stored) && stored > 0) setFxRate(stored);
    const fetchRate = () => {
      marketApi.getFxRate(currency)
        .then((r) => {
          const rate = r.data?.rate;
          if (rate && rate > 0) {
            setFxRate(rate);
            if (typeof window !== "undefined") localStorage.setItem(lsKey, String(rate));
          } else if (LOCAL_FALLBACK[currency]) {
            setFxRate(LOCAL_FALLBACK[currency]);
          }
        })
        .catch(() => {
          if (!isNaN(stored) && stored > 0) return; // already applied stored
          if (LOCAL_FALLBACK[currency]) setFxRate(LOCAL_FALLBACK[currency]);
        });
    };
    fetchRate();
    const interval = setInterval(fetchRate, 60 * 60 * 1000); // refresh every hour
    return () => clearInterval(interval);
  }, [currency]);

  return fxRate;
}
