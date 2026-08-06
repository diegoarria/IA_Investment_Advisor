import { market as marketApi } from "@/lib/api";
import { useCachedFetch } from "@/lib/useCachedFetch";

const LOCAL_FALLBACK: Record<string, number> = {
  MXN: 18.5, EUR: 0.92, GBP: 0.79, CAD: 1.38, ARS: 1150, BRL: 5.7,
  COP: 4200, CLP: 960, PEN: 3.75, JPY: 155, AUD: 1.55, CHF: 0.89,
  NZD: 1.68, INR: 83.5, CNY: 7.25, HKD: 7.82, SGD: 1.35, TRY: 32.5,
  ZAR: 18.8, SEK: 10.6, NOK: 10.8, DKK: 6.85, PLN: 4.05, KRW: 1360,
};

// Fetch live FX rate (USD -> currency) — open.er-api.com (primary) → frankfurter → hardcoded fallback.
// Fase 4, Incremento 13 — now built on the shared useCachedFetch hook
// (this was the original stale-while-revalidate precedent it's modeled
// on); behavior is unchanged, just formalized.
export function useFxRate(currency: string): number {
  const { data } = useCachedFetch<number>({
    key: `nuvos_fx_${currency}`,
    enabled: currency !== "USD",
    refreshIntervalMs: 60 * 60 * 1000, // refresh every hour
    fetcher: () =>
      marketApi.getFxRate(currency)
        .then((r) => {
          const rate = r.data?.rate;
          if (rate && rate > 0) return rate;
          if (LOCAL_FALLBACK[currency]) return LOCAL_FALLBACK[currency];
          throw new Error(`No FX rate available for ${currency}`);
        })
        .catch((err) => {
          if (LOCAL_FALLBACK[currency]) return LOCAL_FALLBACK[currency];
          throw err;
        }),
    isEmpty: (rate) => !(rate > 0),
  });

  if (currency === "USD") return 1;
  return data && data > 0 ? data : 1;
}
