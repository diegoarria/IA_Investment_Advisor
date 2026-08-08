"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Loader2, Lock, Calendar, BarChart3 } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import PaywallModal from "@/components/PaywallModal";
import StockAvatar from "@/components/StockAvatar";
import { weeklyRitualsApi } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";

interface PortfolioEvent { ticker: string; event_type: string; event_date: string; }
interface SundayPrepData {
  total_events: number;
  reporting_count: number;
  portfolio_events?: PortfolioEvent[];
}

const EVENT_LABEL: Record<string, string> = {
  earnings: "📊", ex_dividend: "📅", dividend: "💰",
};

export default function WeeklyRitualSundayPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [data, setData] = useState<SundayPrepData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    weeklyRitualsApi.getSundayPrep()
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }, []);

  const grouped = (data?.portfolio_events || []).reduce<Record<string, PortfolioEvent[]>>((acc, e) => {
    (acc[e.ticker] ||= []).push(e);
    return acc;
  }, {});

  return (
    <div className="flex h-screen" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-5">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--text)" }}>
              🔭 {t("weeklyRitual.sunday.title")}
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{t("weeklyRitual.sunday.subtitle")}</p>
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} /></div>
          ) : !data || data.total_events === 0 ? (
            <div className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <p className="text-sm" style={{ color: "var(--muted)" }}>{t("weeklyRitual.sunday.empty")}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border p-4 flex items-center gap-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <Calendar className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
                  <div>
                    <p className="text-lg font-black" style={{ color: "var(--text)" }}>{data.total_events}</p>
                    <p className="text-[10px]" style={{ color: "var(--muted)" }}>{t("weeklyRitual.sunday.eventsLabel")}</p>
                  </div>
                </div>
                <div className="rounded-2xl border p-4 flex items-center gap-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <BarChart3 className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
                  <div>
                    <p className="text-lg font-black" style={{ color: "var(--text)" }}>{data.reporting_count}</p>
                    <p className="text-[10px]" style={{ color: "var(--muted)" }}>{t("weeklyRitual.sunday.reportingLabel")}</p>
                  </div>
                </div>
              </div>

              {!isPremium ? (
                <button
                  onClick={() => setPaywallOpen(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm"
                  style={{ background: "var(--raised)", color: "var(--muted)" }}
                >
                  <Lock className="w-3.5 h-3.5" />
                  {t("weeklyRitual.sunday.premiumCta")}
                </button>
              ) : Object.keys(grouped).length > 0 ? (
                <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  {Object.entries(grouped).map(([ticker, events], i) => (
                    <button
                      key={ticker}
                      onClick={() => router.push(`/subvaluadas?ticker=${ticker}`)}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left"
                      style={{ background: "var(--card)", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}
                    >
                      <StockAvatar ticker={ticker} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{ticker}</p>
                        <p className="text-[10.5px]" style={{ color: "var(--muted)" }}>
                          {events.map((e) => `${EVENT_LABEL[e.event_type] || "•"} ${e.event_date}`).join("  ·  ")}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-center" style={{ color: "var(--muted)" }}>{t("weeklyRitual.sunday.noPortfolioEvents")}</p>
              )}
            </>
          )}
        </div>
      </main>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("weeklyRitual.sunday.paywallReason")} />
    </div>
  );
}
