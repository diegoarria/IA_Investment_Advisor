"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Loader2, Lock, FileBarChart } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PaywallModal from "@/components/PaywallModal";
import StockAvatar from "@/components/StockAvatar";
import { BeatMissBadge, fmtMoney, type RecentReporter } from "@/components/EarningsAnalysisCard";
import { earningsApi } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";
import { usePortfolioStore } from "@/lib/portfolioStore";
import { useWatchlistStore } from "@/lib/store";

function ReporterRow({ r, onClick }: { r: RecentReporter; onClick: () => void }) {
  return (
    <button onClick={onClick}
            className="w-full flex items-center gap-3 rounded-xl border p-3 text-left hover:bg-white/3 transition-colors"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <StockAvatar ticker={r.ticker} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold" style={{ color: "var(--text)" }}>{r.ticker}</p>
        <p className="text-[10px] mb-1" style={{ color: "var(--muted)" }}>{r.event_date}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span className="text-[10px]" style={{ color: "var(--sub)" }}>
            EPS: <span className="font-bold tabular-nums">${r.eps_actual ?? "N/D"}</span> vs ${r.eps_estimate ?? "N/D"} est.
          </span>
          <span className="text-[10px]" style={{ color: "var(--sub)" }}>
            Ingresos: <span className="font-bold tabular-nums">{fmtMoney(r.revenue_actual)}</span> vs {fmtMoney(r.revenue_estimate)} est.
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1 items-end shrink-0">
        <BeatMissBadge actual={r.eps_actual} estimate={r.eps_estimate} />
        <BeatMissBadge actual={r.revenue_actual} estimate={r.revenue_estimate} />
      </div>
    </button>
  );
}

export default function EarningsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;
  const positions = usePortfolioStore((s) => s.positions);
  const watchlistItems = useWatchlistStore((s) => s.items);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const [reporters, setReporters] = useState<RecentReporter[]>([]);
  const [loadingReporters, setLoadingReporters] = useState(false);

  const symbols = useMemo(() => {
    const port = positions.map((p) => p.ticker);
    const watch = watchlistItems.map((w) => w.ticker);
    return Array.from(new Set([...port, ...watch])).filter(Boolean);
  }, [positions, watchlistItems]);

  useEffect(() => {
    if (!isPremium || symbols.length === 0) { setReporters([]); return; }
    setLoadingReporters(true);
    earningsApi.getRecentReporters(symbols)
      .then((res) => setReporters(res.data?.reporters || []))
      .catch(() => setReporters([]))
      .finally(() => setLoadingReporters(false));
  }, [isPremium, symbols.join(",")]);

  const openTicker = (ticker: string) => {
    if (!ticker.trim()) return;
    router.push(`/earnings/${ticker.trim().toUpperCase()}`);
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2 mb-5">
              <FileBarChart className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>{t("earnings.title")}</h1>
            </div>

            {!isPremium ? (
              <div className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(0,168,94,0.1)" }}>
                  <Lock className="w-7 h-7" style={{ color: "var(--accent-l)" }} />
                </div>
                <h2 className="font-bold text-base mb-2" style={{ color: "var(--text)" }}>{t("earnings.premiumGate.title")}</h2>
                <p className="text-sm mb-5 max-w-sm mx-auto" style={{ color: "var(--muted)" }}>{t("earnings.premiumGate.desc")}</p>
                <button onClick={() => setPaywallOpen(true)} className="px-6 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                  {t("earnings.premiumGate.cta")}
                </button>
              </div>
            ) : (
              <>
                <h2 className="text-sm font-bold mb-2" style={{ color: "var(--text)" }}>{t("earnings.recentReporters.label")}</h2>
                {loadingReporters ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
                  </div>
                ) : reporters.length === 0 ? (
                  <div className="rounded-2xl border p-6 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>{t("earnings.recentReporters.empty")}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {reporters.map((r) => (
                      <ReporterRow key={r.ticker} r={r} onClick={() => openTicker(r.ticker)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("earnings.premiumGate.paywallReason")} />
    </div>
  );
}
