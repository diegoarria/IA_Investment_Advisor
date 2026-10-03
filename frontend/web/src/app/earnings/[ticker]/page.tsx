"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Loader2, Lock, ChevronLeft, AlertTriangle, RefreshCw } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PaywallModal from "@/components/PaywallModal";
import StockAvatar from "@/components/StockAvatar";
import { EarningsAnalysisCard, EARNINGS_COLOR, type EarningsAnalysisResponse } from "@/components/EarningsAnalysisCard";
import { earningsApi } from "@/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "@/lib/store";
import { useCombinedPositions } from "@/lib/portfolioStore";

export default function EarningsTickerPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useParams<{ ticker: string }>();
  const ticker = (params?.ticker || "").toString().toUpperCase();
  const sub = useSubscriptionStore();
  const isPremium = hasPremiumAccess(sub);
  // Combined across every portfolio, not just the active one (2026-08-21
  // multi-portfolio audit) — a position held in a non-active broker
  // portfolio was invisible here before.
  const positions = useCombinedPositions();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EarningsAnalysisResponse | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isPremium || !ticker) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    // Sum shares (and weight-average cost) across every lot for this ticker
    // — it can appear more than once, either as multiple buy lots within one
    // portfolio or the same stock held in two different broker portfolios.
    const lots = positions.filter((p) => p.ticker === ticker);
    const totalShares = lots.reduce((sum, p) => sum + p.shares, 0);
    const avgPrice = totalShares > 0
      ? lots.reduce((sum, p) => sum + p.avgPrice * p.shares, 0) / totalShares
      : 0;
    earningsApi.getAnalysis(ticker, totalShares, avgPrice, i18n.language)
      .then((res) => setResult(res.data))
      .catch((err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(detail || t("earnings.search.error"));
      })
      .finally(() => setLoading(false));
  }, [isPremium, ticker, i18n.language, reloadKey]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="max-w-2xl mx-auto pb-12">
            <button onClick={() => router.push("/earnings")}
                    className="flex items-center gap-1 text-[12px] font-extrabold mb-4 rounded-full px-3 py-1.5 border"
                    style={{ color: "var(--sub)", borderColor: "var(--border)", background: "var(--card)" }}>
              <ChevronLeft className="w-3.5 h-3.5" />
              {t("earnings.backToList")}
            </button>

            {!isPremium ? (
              <div className="rounded-[20px] border p-7 flex flex-col items-center text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: EARNINGS_COLOR + "1A" }}>
                  <Lock className="w-7 h-7" style={{ color: EARNINGS_COLOR }} />
                </div>
                <h2 className="font-black text-[17px] mb-2" style={{ color: "var(--text)" }}>{t("earnings.premiumGate.title")}</h2>
                <p className="text-[13px] leading-[19px] mb-5 max-w-sm" style={{ color: "var(--muted)" }}>{t("earnings.premiumGate.desc")}</p>
                <button onClick={() => setPaywallOpen(true)} className="px-6 py-2.5 rounded-[14px] text-[13px] font-extrabold text-white" style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                  {t("earnings.premiumGate.cta")}
                </button>
              </div>
            ) : loading ? (
              <div className="space-y-3.5">
                <div className="relative overflow-hidden rounded-3xl p-5 border" style={{ background: EARNINGS_COLOR + "14", borderColor: EARNINGS_COLOR + "33" }}>
                  <div className="flex items-center gap-3">
                    <StockAvatar ticker={ticker} size="md" />
                    <div>
                      <p className="text-[22px] font-black tracking-tight" style={{ color: "var(--text)" }}>{ticker}</p>
                      <p className="flex items-center gap-1.5 text-[13px] mt-0.5" style={{ color: "var(--sub)" }}>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: EARNINGS_COLOR }} />
                        {t("earnings.loading")}
                      </p>
                    </div>
                  </div>
                </div>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-2xl border p-5 animate-pulse" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <div className="h-3 w-28 rounded mb-3" style={{ background: "var(--raised)" }} />
                    <div className="h-2.5 w-full rounded mb-2" style={{ background: "var(--raised)" }} />
                    <div className="h-2.5 w-4/5 rounded" style={{ background: "var(--raised)" }} />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="rounded-[20px] border p-7 flex flex-col items-center gap-3 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <AlertTriangle className="w-6 h-6" style={{ color: "#f59e0b" }} />
                <p className="text-[13px] leading-[19px]" style={{ color: "var(--sub)" }}>{error}</p>
                <button onClick={() => setReloadKey((k) => k + 1)} className="flex items-center gap-1.5 rounded-[14px] px-4 py-2.5 text-[13px] font-extrabold text-white" style={{ background: EARNINGS_COLOR }}>
                  <RefreshCw className="w-3.5 h-3.5" />{t("earnings.retry")}
                </button>
              </div>
            ) : result ? (
              <EarningsAnalysisCard result={result} />
            ) : null}
          </div>
        </div>
      </div>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("earnings.premiumGate.paywallReason")} />
    </div>
  );
}
