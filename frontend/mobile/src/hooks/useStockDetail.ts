import { useState, useEffect, useCallback } from "react";
import { marketApi } from "../lib/api";

// ─── Types (mirror del backend /api/market/stock-detail) ─────────────────────

export interface StockProfile {
  name: string;
  sector?: string;
  industry?: string;
  description?: string;
  employees?: number;
  website?: string;
  country?: string;
  city?: string;
  exchange?: string;
  market_cap?: number;
  current_price?: number;
  currency?: string;
  open?: number;
  day_high?: number;
  day_low?: number;
  prev_close?: number;
  volume?: number;
  pe_ratio?: number;
  forward_pe?: number;
  peg_ratio?: number;
  pb_ratio?: number;
  eps?: number;
  forward_eps?: number;
  dividend_yield?: number;
  dividend_rate?: number;
  beta?: number;
  week_52_high?: number;
  week_52_low?: number;
  sma_50?: number;
  sma_200?: number;
  return_on_equity?: number;
  return_on_assets?: number;
  profit_margins?: number;
  gross_margins?: number;
  debt_to_equity?: number;
  current_ratio?: number;
  free_cashflow?: number;
  revenue_growth?: number;
  earnings_growth?: number;
  target_mean?: number;
  target_low?: number;
  target_high?: number;
  recommendation?: string;
  number_of_analysts?: number;
}

export interface FinancialPeriod {
  period: string;
  "Total Revenue"?:                          number | null;
  "Gross Profit"?:                           number | null;
  "Operating Income"?:                       number | null;
  "EBITDA"?:                                 number | null;
  "Net Income"?:                             number | null;
  "Total Assets"?:                           number | null;
  "Current Assets"?:                         number | null;
  "Total Liabilities Net Minority Interest"?: number | null;
  "Stockholders Equity"?:                    number | null;
  "Total Debt"?:                             number | null;
  "Operating Cash Flow"?:                    number | null;
  "Free Cash Flow"?:                         number | null;
  "Capital Expenditure"?:                    number | null;
}

export interface Financials {
  income:   { annual: FinancialPeriod[] };
  balance:  { annual: FinancialPeriod[] };
  cashflow: { annual: FinancialPeriod[] };
  source?: string;
}

export interface Ratings {
  strong_buy: number;
  buy: number;
  hold: number;
  sell: number;
  strong_sell: number;
}

export interface Analyst {
  ratings: Ratings;
  price_target: {
    mean?: number | null;
    low?: number | null;
    high?: number | null;
    current?: number | null;
  };
  n_analysts?: number;
  recommendation?: string;
}

export interface StockDetail {
  profile:    StockProfile;
  financials: Financials;
  analyst:    Analyst;
  score?:     StockScore;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

// ─── Stock Score ──────────────────────────────────────────────────────────────

export interface CategoryScore {
  key: string;
  name: string;
  score: number;
}

export interface StockScore {
  overall_score: number;
  grade: string;
  signal: string;
  verdict_short: string;
  verdict_long: string;
  categories: CategoryScore[];
}

export function useStockDetail(ticker: string) {
  const [data, setData]       = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const load = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(false);
    try {
      const res = await marketApi.getStockDetail(ticker, true);
      if (res.data?.profile) {
        setData(res.data as StockDetail);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
}

export function useStockScore(ticker: string) {
  const [data, setData]       = useState<StockScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const load = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(false);
    try {
      const res = await marketApi.getStockScore(ticker);
      if (res.data?.overall_score != null) {
        setData(res.data as StockScore);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error };
}
