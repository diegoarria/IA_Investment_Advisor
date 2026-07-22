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
import { usePortfolioStore } from "@/lib/portfolioStore";

export default function EarningsTickerPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useParams<{ ticker: string }>();
  const ticker = (params?.ticker || "").toString().toUpperCase();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;
  const positions = usePortfolioStore((s) => s.positions);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EarningsAnalysisResponse | null>(null);

  useEffect(() => {
    if (!isPremium || !ticker) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    const position = positions.find((p) => p.ticker === ticker);
    earningsApi.getAnalysis(ticker, position?.shares || 0, position?.avgPrice || 0, i18n.language)
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
              <>
                <div className="rounded-2xl border-2 p-4 mb-5 text-center" style={{ borderColor: "#ef4444", background: "rgba(239,68,68,0.08)" }}>
                  <p className="text-lg font-black tracking-tight" style={{ color: "#ef4444" }}>{t("earnings.disclaimer.title")}</p>
                  <p className="text-xs mt-1" style={{ color: "var(--sub)" }}>{t("earnings.disclaimer.subtitle")}</p>
                </div>
                <EarningsAnalysisCard result={result} />
              </>
            ) : null}
          </div>
        </div>
      </div>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("earnings.premiumGate.paywallReason")} />
    </div>
  );
}
