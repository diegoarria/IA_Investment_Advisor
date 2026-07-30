import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { marketApi } from "./api";

const LOCAL_FALLBACK: Record<string, number> = {
  MXN: 18.5, EUR: 0.92, GBP: 0.79, CAD: 1.38, ARS: 1150, BRL: 5.7,
  COP: 4200, CLP: 960, PEN: 3.75, JPY: 155, AUD: 1.55, CHF: 0.89,
  NZD: 1.68, INR: 83.5, CNY: 7.25, HKD: 7.82, SGD: 1.35, TRY: 32.5,
  ZAR: 18.8, SEK: 10.6, NOK: 10.8, DKK: 6.85, PLN: 4.05, KRW: 1360,
};

/**
 * Live USD→currency exchange rate, refreshed hourly, cached in AsyncStorage
 * so the UI shows the last-known-good rate immediately on reload instead of
 * flashing 1 (USD) while the network call is in flight.
 *
 * Extracted from portfolio.tsx (previously the only screen that actually
 * multiplied values by this rate) into a shared hook — home.tsx and
 * patrimonio.tsx were showing the user's chosen currency as a label without
 * ever converting the underlying (USD) numbers, so every dollar amount on
 * those two screens was silently wrong for any non-USD currency. Every
 * screen displaying portfolio totals in the user's currency must use this
 * same hook so they can't drift apart again.
 */
export function useFxRate(currency: string): number {
  const [fxRate, setFxRate] = useState(1);

  useEffect(() => {
    if (currency === "USD") { setFxRate(1); return; }
    const asKey = `nuvos_fx_${currency}`;
    // Apply last-known-good rate immediately
    AsyncStorage.getItem(asKey).then((val) => {
      const stored = parseFloat(val ?? "");
      if (!isNaN(stored) && stored > 0) setFxRate(stored);
    }).catch(() => {});
    const fetchRate = () => {
      marketApi.getFxRate(currency)
        .then((r) => {
          const rate = r.data?.rate;
          if (rate && rate > 0) {
            setFxRate(rate);
            AsyncStorage.setItem(asKey, String(rate)).catch(() => {});
          } else if (LOCAL_FALLBACK[currency]) {
            setFxRate(LOCAL_FALLBACK[currency]);
          }
        })
        .catch(() => {
          if (LOCAL_FALLBACK[currency]) setFxRate(LOCAL_FALLBACK[currency]);
        });
    };
    fetchRate();
    const interval = setInterval(fetchRate, 60 * 60 * 1000); // refresh every hour
    return () => clearInterval(interval);
  }, [currency]);

  return fxRate;
}
