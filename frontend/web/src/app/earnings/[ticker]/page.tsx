"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Loader2, Lock, ChevronLeft, AlertTriangle } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PaywallModal from "@/components/PaywallModal";
import { EarningsAnalysisCard, type EarningsAnalysisResponse } from "@/components/EarningsAnalysisCard";
import { earningsApi } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";
import { useCombinedPositions } from "@/lib/portfolioStore";

export default function EarningsTickerPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useParams<{ ticker: string }>();
  const ticker = (params?.ticker || "").toString().toUpperCase();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;
  // Combined across every portfolio, not just the active one (2026-08-21
  // multi-portfolio audit) — a position held in a non-active broker
  // portfolio was invisible here before.
  const positions = useCombinedPositions();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EarningsAnalysisResponse | null>(null);

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
  }, [isPremium, ticker, i18n.language]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="max-w-2xl mx-auto">
            <button onClick={() => router.push("/earnings")} className="flex items-center gap-1 text-xs font-bold mb-4" style={{ color: "var(--muted)" }}>
              <ChevronLeft className="w-4 h-4" />
              {t("earnings.title")}
            </button>

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
            ) : loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} />
              </div>
            ) : error ? (
              <div className="rounded-xl p-3 flex gap-2 items-start" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "#ef4444" }} />
                <p className="text-xs font-medium" style={{ color: "#ef4444" }}>{error}</p>
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
