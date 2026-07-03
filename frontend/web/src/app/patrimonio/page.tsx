"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PremiumBadge from "@/components/PremiumBadge";
import StockAvatar from "@/components/StockAvatar";
import PersonalizedMessageBanner from "@/components/PersonalizedMessageBanner";
import { market as marketApi } from "@/lib/api";
import { usePortfolioStore } from "@/lib/portfolioStore";
import { useFxRate } from "@/lib/useFxRate";
import { useWatchlistStore } from "@/lib/store";
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
      <p className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
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
  const router = useRouter();
  const { positions, portfolioCurrency } = usePortfolioStore();
  const fxRate = useFxRate(portfolioCurrency);

  const totalValueUSD = positions.reduce((sum, pos) => {
    const p = prices[pos.ticker]?.price ?? pos.avgPrice;
    return sum + pos.shares * p;
  }, 0);
  const totalValue = totalValueUSD * fxRate;

  const totalCost = positions.reduce((sum, pos) => sum + pos.shares * pos.avgPrice, 0) * fxRate;
  const totalGain = totalValue - totalCost;
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
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          label={`Valor Total · ${portfolioCurrency}`}
          value={fmtMoney(totalValue, portfolioCurrency)}
        />
        <SummaryCard
          label="Ganancia Día"
          value={fmtMoney(dayGain, portfolioCurrency)}
          sub={fmtPct(dayGainPctFinal)}
          positive={dayGain >= 0}
        />
        <SummaryCard
          label="Ganancia Total"
          value={fmtMoney(totalGain, portfolioCurrency)}
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
            Posiciones ({positions.length})
          </h3>
          {loading && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>Actualizando...</span>
          )}
        </div>

        {positions.length === 0 ? (
          <div className="py-12 text-center">
            <BarChart2 size={32} className="mx-auto mb-2 opacity-30" style={{ color: "var(--muted)" }} />
            <p className="text-sm" style={{ color: "var(--muted)" }}>No tienes posiciones aún</p>
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
                      {pos.shares} acciones · ${pos.avgPrice.toFixed(2)} promedio
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm" style={{ color: "var(--text)" }}>
                      {fmtMoney(currentValue, portfolioCurrency)}
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
                        {fmtPct(dayChangePct)} hoy
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
        Ver portafolio completo <ArrowRight size={16} />
      </button>
    </div>
  );
}

// ─── Watchlist Tab ───────────────────────────────────────────────────────────

function WatchlistTab({ prices, loading }: { prices: PriceMap; loading: boolean }) {
  const router = useRouter();
  const { items } = useWatchlistStore();
  const { portfolioCurrency } = usePortfolioStore();
  const fxRate = useFxRate(portfolioCurrency);

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <h3 className="font-bold text-sm" style={{ color: "var(--text)" }}>
            Watchlist ({items.length})
          </h3>
          {loading && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>Actualizando...</span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="py-12 text-center">
            <Eye size={32} className="mx-auto mb-2 opacity-30" style={{ color: "var(--muted)" }} />
            <p className="text-sm" style={{ color: "var(--muted)" }}>Tu watchlist está vacía</p>
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
        Ver watchlist completa <ArrowRight size={16} />
      </button>
    </div>
  );
}

// ─── Simulador Tab ───────────────────────────────────────────────────────────

function SimuladorTab({ prices, loading }: { prices: PriceMap; loading: boolean }) {
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
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Valor Total" value={fmtMoney(totalValue)} />
        <SummaryCard label="Efectivo" value={fmtMoney(cash)} />
        <SummaryCard
          label="Ganancia"
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
            Posiciones Paper ({positions.length})
          </h3>
          {loading && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>Actualizando...</span>
          )}
        </div>

        {positions.length === 0 ? (
          <div className="py-12 text-center">
            <Wallet size={32} className="mx-auto mb-2 opacity-30" style={{ color: "var(--muted)" }} />
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              No tienes posiciones paper. ¡Empieza a practicar!
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
                      {pos.shares} acciones · ${pos.avgPrice.toFixed(2)} promedio
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
        Abrir simulador completo <ArrowRight size={16} />
      </button>
    </div>
  );
}

// ─── Main Content ────────────────────────────────────────────────────────────

const TABS = [
  { id: "portfolio", label: "Portafolio" },
  { id: "watchlist", label: "Watchlist" },
  { id: "simulador", label: "Simulador" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function PatrimonioContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [prices, setPrices] = useState<PriceMap>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  const rawTab = searchParams.get("tab") as TabId | null;
  const activeTab: TabId = rawTab && TABS.some((t) => t.id === rawTab) ? rawTab : "portfolio";

  const { positions: portfolioPositions } = usePortfolioStore();
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
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        {/* Sticky Header */}
        <div
          className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between border-b shrink-0"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Mi dinero
            </p>
            <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
              Patrimonio
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <PremiumBadge />
          </div>
        </div>

        <PersonalizedMessageBanner className="mx-6 mt-3" />

        {/* Investor Progress Engine entry point */}
        <div className="px-6 pt-3 shrink-0">
          <button
            onClick={() => router.push("/progress")}
            className="w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-opacity hover:opacity-85"
            style={{ background: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.25)" }}
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(0,168,94,0.12)" }}>
              <TrendingUp className="w-4.5 h-4.5" style={{ color: "var(--accent-l)" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold" style={{ color: "var(--text)" }}>Tu evolución como inversionista</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>Hitos, patrimonio y decisiones que evitaron errores</p>
            </div>
            <ArrowRight className="w-4 h-4 shrink-0" style={{ color: "var(--accent-l)" }} />
          </button>
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
