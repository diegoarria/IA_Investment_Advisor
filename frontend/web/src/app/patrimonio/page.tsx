"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PremiumBadge from "@/components/PremiumBadge";
import BalanceVisibilityToggle from "@/components/BalanceVisibilityToggle";
import ExplainButton from "@/components/ExplainButton";
import StockAvatar from "@/components/StockAvatar";
import { market as marketApi, cashHoldings as cashHoldingsApi, dividends as dividendsApi } from "@/lib/api";
import { useCombinedPositions, useCombinedCurrency } from "@/lib/portfolioStore";
import { useFxRate } from "@/lib/useFxRate";
import { useWatchlistStore, useBalanceVisibilityStore } from "@/lib/store";
import { usePaperStore, PAPER_INITIAL_CASH } from "@/lib/paperStore";
import { TrendingUp, TrendingDown, ArrowRight, Wallet, Eye, BarChart2 } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface PriceData {
  price: number | null;
  change_pct: number;
  currency?: string;
  name?: string;
}

type PriceMap = Record<string, PriceData>;

// ─── Helpers ────────────────────────────────────────────────────────────────

const CURRENCY_SYM: Record<string, string> = {
  USD: "$", MXN: "$", ARS: "$", CLP: "$", COP: "$", CAD: "$",
  EUR: "€", GBP: "£", BRL: "R$", JPY: "¥", CHF: "Fr",
};

function fmtMoney(n: number, currency = "USD"): string {
  const sym = CURRENCY_SYM[currency] ?? "$";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(2)}M`;
  return `${sign}${sym}${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  return (
    <div
      className="rounded-xl p-4 border"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p className="text-2xl font-black tracking-tight whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: "var(--text)" }}>
        {value}
      </p>
      {sub && (
        <p
          className="text-sm font-semibold mt-1"
          style={{ color: positive === undefined ? "var(--muted)" : positive ? "#10b981" : "#ef4444" }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

// ─── Portfolio Tab ───────────────────────────────────────────────────────────

function PortfolioTab({ prices, loading }: { prices: PriceMap; loading: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  // Combined across every portfolio, not just the active one — net worth
  // previously only reflected whichever portfolio tab happened to be
  // selected (2026-08-21 multi-portfolio audit). See Home page's identical
  // comment for why portfolioCurrency comes from useCombinedCurrency
  // (falls back to USD when portfolios disagree on currency, instead of
  // applying one portfolio's FX rate to money that isn't in that currency).
  const rawPositions = useCombinedPositions();
  const portfolioCurrency = useCombinedCurrency();
  const fxRate = useFxRate(portfolioCurrency);
  const { hidden: balanceHidden } = useBalanceVisibilityStore();
  const mask = (s: string) => (balanceHidden ? "••••••" : s);

  // One row per ticker, combining every purchase lot — `rawPositions` keeps each
  // purchase as its own row internally (for the lots panel on /portfolio), but this
  // summary list should never show the same company twice.
  const positions = useMemo(() => {
    const map = new Map<string, { id: string; ticker: string; name?: string; shares: number; avgPrice: number }>();
    for (const p of rawPositions) {
      const existing = map.get(p.ticker);
      if (existing) {
        const newShares = existing.shares + p.shares;
        const newCost = existing.avgPrice * existing.shares + p.avgPrice * p.shares;
        existing.shares = newShares;
        existing.avgPrice = newShares > 0 ? newCost / newShares : 0;
      } else {
        map.set(p.ticker, { id: p.ticker, ticker: p.ticker, name: p.name, shares: p.shares, avgPrice: p.avgPrice });
      }
    }
    return Array.from(map.values());
  }, [rawPositions]);

  const totalValueUSD = positions.reduce((sum, pos) => {
    const p = prices[pos.ticker]?.price ?? pos.avgPrice;
    return sum + pos.shares * p;
  }, 0);
  const stocksValue = totalValueUSD * fxRate;

  // Cash held outside stock positions (CETES, bank, bonds, other) and
  // dividends actually paid (forward-tracking only, recorded by worker.py
  // the day they're paid — see migrations/054_dividend_income.sql) both
  // count toward the total shown here, alongside stock positions.
  const [cashTotalUSD, setCashTotalUSD] = useState(0);
  const [dividendTotalUSD, setDividendTotalUSD] = useState(0);
  const CASH_APPROX_TO_USD: Record<string, number> = { MXN: 18.5, EUR: 0.92, GBP: 0.79, CAD: 1.38, BRL: 5.7, JPY: 155, AUD: 1.55, CHF: 0.89 };
  useEffect(() => {
    cashHoldingsApi.list().then((res) => {
      const holdings = res.data?.holdings ?? [];
      const usd = holdings.reduce((sum: number, c: { amount: number; currency: string; accrued_amount?: number }) => {
        const amt = c.accrued_amount ?? c.amount;
        if (c.currency === "USD") return sum + amt;
        return sum + amt / (CASH_APPROX_TO_USD[c.currency] ?? 1);
      }, 0);
      setCashTotalUSD(usd);
    }).catch(() => {});
    dividendsApi.getIncome().then((res) => setDividendTotalUSD(res.data?.total ?? 0)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const totalValue = stocksValue + cashTotalUSD * fxRate + dividendTotalUSD * fxRate;

  const totalCost = positions.reduce((sum, pos) => sum + pos.shares * pos.avgPrice, 0) * fxRate;
  const totalGain = stocksValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  const { dayGain: dayGainUSD, dayPrev } = positions.reduce((acc, pos) => {
    const pr = prices[pos.ticker];
    if (!pr?.price) return acc;
    const cp = pr.change_pct ?? 0;
    const prevPrice = cp !== -100 ? pr.price / (1 + cp / 100) : pr.price;
    return {
      dayGain: acc.dayGain + pos.shares * (pr.price - prevPrice),
      dayPrev: acc.dayPrev + pos.shares * prevPrice,
    };
  }, { dayGain: 0, dayPrev: 0 });
  const dayGain = dayGainUSD * fxRate;
  const dayGainPctFinal = dayPrev > 0 ? (dayGainUSD / dayPrev) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExplainButton
          screen="patrimonio_portfolio"
          context={{
            total_value: totalValue,
            day_gain_pct: dayGainPctFinal,
            total_gain_pct: totalGainPct,
            position_count: positions.length,
            cash_total: cashTotalUSD > 0 ? cashTotalUSD * fxRate : null,
            dividend_income_received: dividendTotalUSD > 0 ? dividendTotalUSD * fxRate : null,
            currency: portfolioCurrency,
          }}
        />
      </div>
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          label={t("patrimonio.portfolio.totalValueLabel", { currency: portfolioCurrency })}
          value={mask(fmtMoney(totalValue, portfolioCurrency))}
        />
        <SummaryCard
          label={t("patrimonio.portfolio.dayGainLabel")}
          value={mask(fmtMoney(dayGain, portfolioCurrency))}
          sub={fmtPct(dayGainPctFinal)}
          positive={dayGain >= 0}
        />
        <SummaryCard
          label={t("patrimonio.portfolio.totalGainLabel")}
          value={mask(fmtMoney(totalGain, portfolioCurrency))}
          sub={fmtPct(totalGainPct)}
          positive={totalGain >= 0}
        />
      </div>

      {/* Positions List */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <h3 className="font-bold text-sm" style={{ color: "var(--text)" }}>
            {t("patrimonio.portfolio.positionsCount", { count: positions.length })}
          </h3>
          {loading && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>{t("patrimonio.common.updating")}</span>
          )}
        </div>

        {positions.length === 0 ? (
          <div className="py-12 text-center">
            <BarChart2 size={32} className="mx-auto mb-2 opacity-30" style={{ color: "var(--muted)" }} />
            <p className="text-sm" style={{ color: "var(--muted)" }}>{t("patrimonio.portfolio.empty")}</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {positions.map((pos) => {
              const pr = prices[pos.ticker];
              const currentPrice = pr?.price ?? pos.avgPrice;
              const currentValue = pos.shares * currentPrice * fxRate;
              const cost = pos.shares * pos.avgPrice * fxRate;
              const gainAbs = currentValue - cost;
              const gainPct = cost > 0 ? (gainAbs / cost) * 100 : 0;
              const dayChangePct = pr?.change_pct ?? 0;
              const positive = gainAbs >= 0;

              return (
                <div key={pos.id} className="px-4 py-3 flex items-center gap-3">
                  <StockAvatar ticker={pos.ticker} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{pos.ticker}</p>
                    <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
                      {t("patrimonio.portfolio.sharesAvg", { shares: pos.shares, avgPrice: pos.avgPrice.toFixed(2) })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm" style={{ color: "var(--text)" }}>
                      {mask(fmtMoney(currentValue, portfolioCurrency))}
                    </p>
                    <div className="flex items-center justify-end gap-1">
                      {positive ? (
                        <TrendingUp size={11} style={{ color: "#10b981" }} />
                      ) : (
                        <TrendingDown size={11} style={{ color: "#ef4444" }} />
                      )}
                      <span className="text-xs font-semibold" style={{ color: positive ? "#10b981" : "#ef4444" }}>
                        {fmtPct(gainPct)}
                      </span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>·</span>
                      <span
                        className="text-xs"
                        style={{ color: dayChangePct >= 0 ? "#10b981" : "#ef4444" }}
                      >
                        {fmtPct(dayChangePct)} {t("patrimonio.common.today")}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button
        onClick={() => router.push("/portfolio")}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-opacity hover:opacity-80"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        {t("patrimonio.portfolio.viewFull")} <ArrowRight size={16} />
      </button>
    </div>
  );
}

// ─── Watchlist Tab ───────────────────────────────────────────────────────────

function WatchlistTab({ prices, loading }: { prices: PriceMap; loading: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { items } = useWatchlistStore();
  const portfolioCurrency = useCombinedCurrency();
  const fxRate = useFxRate(portfolioCurrency);

  return (
    <div className="space-y-4">
      {/* Was missing here — ExplainButton previously only rendered inside
          PortfolioTab, so it silently disappeared on this sub-tab entirely
          (Diego: "quiero que verifiquen que... funcionen SIEMPRE en todas
          las pantallas"). Same pattern as PortfolioTab, own tab-appropriate
          context instead of reusing portfolio totals that don't apply here. */}
      <div className="flex justify-end">
        <ExplainButton
          screen="patrimonio_watchlist"
          context={{
            watchlist_count: items.length,
            watchlist: items.slice(0, 15).map((item) => ({
              ticker: item.ticker,
              name: item.name,
              price: prices[item.ticker]?.price ?? null,
              change_pct: prices[item.ticker]?.change_pct ?? null,
            })),
          }}
        />
      </div>
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <h3 className="font-bold text-sm" style={{ color: "var(--text)" }}>
            {t("patrimonio.watchlist.itemsCount", { count: items.length })}
          </h3>
          {loading && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>{t("patrimonio.common.updating")}</span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="py-12 text-center">
            <Eye size={32} className="mx-auto mb-2 opacity-30" style={{ color: "var(--muted)" }} />
            <p className="text-sm" style={{ color: "var(--muted)" }}>{t("patrimonio.watchlist.empty")}</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((item) => {
              const pr = prices[item.ticker];
              const price = pr?.price ?? null;
              const changePct = pr?.change_pct ?? 0;
              const positive = changePct >= 0;

              return (
                <div key={item.ticker} className="px-4 py-3 flex items-center gap-3">
                  <StockAvatar ticker={item.ticker} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{item.ticker}</p>
                    <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{item.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm" style={{ color: "var(--text)" }}>
                      {price !== null ? fmtMoney(price * fxRate, portfolioCurrency) : "—"}
                    </p>
                    <div className="flex items-center justify-end gap-1">
                      {positive ? (
                        <TrendingUp size={11} style={{ color: "#10b981" }} />
                      ) : (
                        <TrendingDown size={11} style={{ color: "#ef4444" }} />
                      )}
                      <span className="text-xs font-semibold" style={{ color: positive ? "#10b981" : "#ef4444" }}>
                        {fmtPct(changePct)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button
        onClick={() => router.push("/watchlist")}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-opacity hover:opacity-80"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        {t("patrimonio.watchlist.viewFull")} <ArrowRight size={16} />
      </button>
    </div>
  );
}

// ─── Simulador Tab ───────────────────────────────────────────────────────────

function SimuladorTab({ prices, loading }: { prices: PriceMap; loading: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { cash, positions } = usePaperStore();

  const positionsValue = positions.reduce((sum, pos) => {
    const p = prices[pos.ticker]?.price ?? pos.avgPrice;
    return sum + pos.shares * p;
  }, 0);

  const totalValue = cash + positionsValue;
  const gain = totalValue - PAPER_INITIAL_CASH;

  return (
    <div className="space-y-4">
      {/* Was missing here too — see WatchlistTab's comment above. */}
      <div className="flex justify-end">
        <ExplainButton
          screen="patrimonio_simulador"
          context={{
            paper_trading: true,
            total_value: totalValue,
            cash: cash,
            gain_vs_initial: gain,
            gain_vs_initial_pct: (gain / PAPER_INITIAL_CASH) * 100,
            position_count: positions.length,
          }}
        />
      </div>
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label={t("patrimonio.simulator.totalValueLabel")} value={fmtMoney(totalValue)} />
        <SummaryCard label={t("patrimonio.simulator.cashLabel")} value={fmtMoney(cash)} />
        <SummaryCard
          label={t("patrimonio.simulator.gainLabel")}
          value={fmtMoney(gain)}
          sub={fmtPct((gain / PAPER_INITIAL_CASH) * 100)}
          positive={gain >= 0}
        />
      </div>

      {/* Paper Positions */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <h3 className="font-bold text-sm" style={{ color: "var(--text)" }}>
            {t("patrimonio.simulator.positionsCount", { count: positions.length })}
          </h3>
          {loading && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>{t("patrimonio.common.updating")}</span>
          )}
        </div>

        {positions.length === 0 ? (
          <div className="py-12 text-center">
            <Wallet size={32} className="mx-auto mb-2 opacity-30" style={{ color: "var(--muted)" }} />
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {t("patrimonio.simulator.empty")}
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {positions.map((pos) => {
              const pr = prices[pos.ticker];
              const currentPrice = pr?.price ?? pos.avgPrice;
              const currentValue = pos.shares * currentPrice;
              const cost = pos.shares * pos.avgPrice;
              const gainAbs = currentValue - cost;
              const gainPct = cost > 0 ? (gainAbs / cost) * 100 : 0;
              const positive = gainAbs >= 0;

              return (
                <div key={pos.id} className="px-4 py-3 flex items-center gap-3">
                  <StockAvatar ticker={pos.ticker} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{pos.ticker}</p>
                    <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
                      {t("patrimonio.portfolio.sharesAvg", { shares: pos.shares, avgPrice: pos.avgPrice.toFixed(2) })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm" style={{ color: "var(--text)" }}>
                      {fmtMoney(currentValue)}
                    </p>
                    <span className="text-xs font-semibold" style={{ color: positive ? "#10b981" : "#ef4444" }}>
                      {fmtPct(gainPct)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button
        onClick={() => router.push("/paper")}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-opacity hover:opacity-80"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        {t("patrimonio.simulator.openFull")} <ArrowRight size={16} />
      </button>
    </div>
  );
}

// ─── Main Content ────────────────────────────────────────────────────────────

const TAB_IDS = ["portfolio", "watchlist", "simulador"] as const;

type TabId = (typeof TAB_IDS)[number];

function getTabs(t: TFunction): { id: TabId; label: string }[] {
  return [
    { id: "portfolio", label: t("patrimonio.tabs.portfolio") },
    { id: "watchlist", label: t("patrimonio.tabs.watchlist") },
    { id: "simulador", label: t("patrimonio.tabs.simulator") },
  ];
}

function PatrimonioContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [prices, setPrices] = useState<PriceMap>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  const TABS = getTabs(t);
  const rawTab = searchParams.get("tab") as TabId | null;
  const activeTab: TabId = rawTab && TABS.some((tab) => tab.id === rawTab) ? rawTab : "portfolio";

  const portfolioPositions = useCombinedPositions();
  const { items: watchItems } = useWatchlistStore();
  const { positions: paperPositions } = usePaperStore();

  // Fetch prices on mount + refresh every 30s
  useEffect(() => {
    const allTickers = [
      ...portfolioPositions.map((p) => p.ticker),
      ...watchItems.map((w) => w.ticker),
      ...paperPositions.map((p) => p.ticker),
    ];
    const unique = [...new Set(allTickers)];
    if (unique.length === 0) return;

    const fetchPrices = (initial = false) => {
      if (initial) setPricesLoading(true);
      marketApi
        .getPrices(unique)
        .then((res) => { if (res?.data) setPrices(res.data as PriceMap); })
        .catch(() => {})
        .finally(() => { if (initial) setPricesLoading(false); });
    };

    fetchPrices(true);
    const id = setInterval(() => fetchPrices(false), 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setTab(id: TabId) {
    router.push(`/patrimonio?tab=${id}`);
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        {/* Sticky Header */}
        <div
          className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between border-b shrink-0"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        >
          {/* pl-9 clears AppSidebar's floating mobile menu button (fixed
              top-1.5 left-1.5, ~34px wide) on mobile widths. */}
          <div className="pl-9 lg:pl-0">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              {t("patrimonio.header.eyebrow")}
            </p>
            <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
              {t("patrimonio.header.title")}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <BalanceVisibilityToggle />
            <PremiumBadge />
          </div>
        </div>

        {/* Sub-tab Bar */}
        <div
          className="flex gap-1 px-6 py-2 border-b shrink-0"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: activeTab === tab.id ? "var(--accent)" : "transparent",
                color: activeTab === tab.id ? "#fff" : "var(--muted)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto scrollbar-thin p-4">
            {activeTab === "portfolio" && (
              <PortfolioTab prices={prices} loading={pricesLoading} />
            )}
            {activeTab === "watchlist" && (
              <WatchlistTab prices={prices} loading={pricesLoading} />
            )}
            {activeTab === "simulador" && (
              <SimuladorTab prices={prices} loading={pricesLoading} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default function PatrimonioPage() {
  return (
    <Suspense fallback={null}>
      <PatrimonioContent />
    </Suspense>
  );
}
