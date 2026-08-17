"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Loader2, TrendingUp, TrendingDown, PieChart, Lock } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import PaywallModal from "@/components/PaywallModal";
import { weeklyRitualsApi } from "@/lib/api";

interface PortfolioReviewData {
  total_value: number;
  change_usd: number | null;
  change_pct: number | null;
  top_sector: string | null;
  insight: string | null;
  is_premium: boolean;
}

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function WeeklyRitualPortfolioReviewPage() {
  const { t } = useTranslation();
  const router = useRouter();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [data, setData] = useState<PortfolioReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    weeklyRitualsApi.getPortfolioReview()
      .then((res) => setData(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const isUp = (data?.change_usd ?? 0) >= 0;

  return (
    <div className="flex h-screen" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <main className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} /></div>
          ) : error || !data ? (
            <div className="p-8 text-center">
              <p className="text-sm" style={{ color: "var(--muted)" }}>{t("weeklyRitual.portfolioReview.empty")}</p>
            </div>
          ) : (
            <>
              <div className="px-5 pt-5 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
                <span className="text-xs font-black" style={{ color: "#00d47e" }}>📅 {t("weeklyRitual.portfolioReview.title")}</span>
              </div>

              <div className="p-5 space-y-4">
                {data.insight ? (
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>
                    {data.insight}
                  </p>
                ) : !data.is_premium ? (
                  <button
                    onClick={() => setPaywallOpen(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm"
                    style={{ background: "var(--raised)", color: "var(--muted)" }}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    {t("weeklyRitual.portfolioReview.premiumCta")}
                  </button>
                ) : null}

                <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>
                    {t("weeklyRitual.portfolioReview.totalValueLabel")}
                  </p>
                  <p className="text-2xl font-black" style={{ color: "var(--text)" }}>{fmtUsd(data.total_value)}</p>
                  {data.change_usd !== null && data.change_pct !== null && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {isUp ? (
                        <TrendingUp className="w-3.5 h-3.5" style={{ color: "#00d47e" }} />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                      )}
                      <span className="text-xs font-bold" style={{ color: isUp ? "#00d47e" : "#ef4444" }}>
                        {isUp ? "+" : ""}{fmtUsd(data.change_usd)} ({isUp ? "+" : ""}{data.change_pct}%)
                      </span>
                      <span className="text-[10.5px]" style={{ color: "var(--muted)" }}>
                        {t("weeklyRitual.portfolioReview.vsLastWeek")}
                      </span>
                    </div>
                  )}
                </div>

                {data.top_sector && (
                  <div className="rounded-2xl border p-4 flex items-center gap-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <PieChart className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
                    <div>
                      <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{data.top_sector}</p>
                      <p className="text-[10px]" style={{ color: "var(--muted)" }}>{t("weeklyRitual.portfolioReview.topSectorLabel")}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 pb-5">
                <button
                  onClick={() => router.push("/portfolio")}
                  className="w-full py-3 rounded-2xl font-black text-sm"
                  style={{ background: "#00d47e", color: "#000" }}
                >
                  {t("weeklyRitual.portfolioReview.seeFullPortfolio")}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
      {data && !data.is_premium && (
        <PaywallModal
          visible={paywallOpen}
          onClose={() => setPaywallOpen(false)}
          reason={t("weeklyRitual.portfolioReview.premiumReason")}
        />
      )}
    </div>
  );
}
