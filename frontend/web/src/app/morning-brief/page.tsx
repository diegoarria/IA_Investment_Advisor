"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Loader2, TrendingUp, TrendingDown, Newspaper, CalendarClock, Lock } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import StockAvatar from "@/components/StockAvatar";
import PaywallModal from "@/components/PaywallModal";
import { morningBriefFullApi } from "@/lib/api";

interface TopMover { ticker: string; change_pct: number; impact_usd: number; }
interface NewsItem { ticker: string; headline: string; category: string | null; }
interface EventItem { time_et: string | null; label: string; impact: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW"; type: string; }
interface MorningBriefData {
  is_premium: true;
  portfolio_value: number;
  change_usd: number | null;
  change_pct: number | null;
  sp500_change_pct: number | null;
  top_mover: TopMover | null;
  news: NewsItem[];
  events: EventItem[];
}
interface MorningBriefTeaser {
  is_premium: false;
  portfolio_value: number;
  change_usd: number | null;
  change_pct: number | null;
  news_count: number;
  events_count: number;
}

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const IMPACT_DOT: Record<string, string> = { VERY_HIGH: "🔴", HIGH: "🔴", MEDIUM: "🟡", LOW: "⚪" };

export default function MorningBriefPage() {
  const { t } = useTranslation();
  const router = useRouter();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [data, setData] = useState<MorningBriefData | MorningBriefTeaser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    morningBriefFullApi.get()
      .then((res) => setData(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const isUp = (data?.change_usd ?? 0) >= 0;
  const isPremiumData = data?.is_premium === true;
  const sp500Up = ((isPremiumData ? data.sp500_change_pct : null) ?? 0) >= 0;

  return (
    <div className="flex h-screen" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <main className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} /></div>
          ) : error || !data ? (
            <div className="p-8 text-center">
              <p className="text-sm" style={{ color: "var(--muted)" }}>{t("morningBrief.empty")}</p>
            </div>
          ) : (
            <>
              <div className="px-5 pt-5 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
                <span className="text-xs font-black" style={{ color: "#00d47e" }}>🧠 {t("morningBrief.title")}</span>
              </div>

              <div className="p-5 space-y-4">
                {/* 1. Portafolio vs S&P */}
                <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>
                    {t("morningBrief.portfolioLabel")}
                  </p>
                  <p className="text-2xl font-black" style={{ color: "var(--text)" }}>{fmtUsd(data.portfolio_value)}</p>
                  {data.change_usd !== null && data.change_pct !== null && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {isUp ? <TrendingUp className="w-3.5 h-3.5" style={{ color: "#00d47e" }} /> : <TrendingDown className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />}
                      <span className="text-xs font-bold" style={{ color: isUp ? "#00d47e" : "#ef4444" }}>
                        {isUp ? "+" : ""}{fmtUsd(data.change_usd)} ({isUp ? "+" : ""}{data.change_pct}%)
                      </span>
                    </div>
                  )}
                  {isPremiumData && data.sp500_change_pct !== null && (
                    <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
                      S&P 500: <span style={{ color: sp500Up ? "#00d47e" : "#ef4444", fontWeight: 700 }}>{sp500Up ? "+" : ""}{data.sp500_change_pct}%</span>
                    </p>
                  )}
                </div>

                {isPremiumData ? (
                  <>
                    {/* 2. Lo más importante para TU portafolio */}
                    {data.top_mover && (
                      <div>
                        <p className="text-[11px] font-bold mb-1.5" style={{ color: "var(--text)" }}>🏆 {t("morningBrief.topMoverLabel")}</p>
                        <button
                          onClick={() => router.push(`/subvaluadas?ticker=${data.top_mover!.ticker}`)}
                          className="w-full rounded-2xl border p-3 flex items-center gap-3 text-left"
                          style={{ borderColor: "var(--border)", background: "var(--card)" }}
                        >
                          <StockAvatar ticker={data.top_mover.ticker} size="sm" />
                          <div className="flex-1">
                            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{data.top_mover.ticker}</p>
                            <p className="text-[11px]" style={{ color: data.top_mover.change_pct >= 0 ? "#00d47e" : "#ef4444" }}>
                              {data.top_mover.change_pct >= 0 ? "+" : ""}{data.top_mover.change_pct}% · {fmtUsd(data.top_mover.impact_usd)} {t("morningBrief.impactLabel")}
                            </p>
                          </div>
                        </button>
                      </div>
                    )}

                    {/* 3. Noticias importantes */}
                    {data.news.length > 0 && (
                      <div>
                        <p className="text-[11px] font-bold mb-1.5 flex items-center gap-1.5" style={{ color: "var(--text)" }}>
                          <Newspaper className="w-3.5 h-3.5" /> {t("morningBrief.newsLabel")}
                        </p>
                        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                          {data.news.map((n, i) => (
                            <div key={i} className="px-3 py-2.5 flex gap-2.5" style={{ background: "var(--card)", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                              <span className="text-[10px] font-black shrink-0 mt-0.5" style={{ color: "var(--accent-l)" }}>{n.ticker}</span>
                              <p className="text-[12px] leading-snug" style={{ color: "var(--text)" }}>{n.headline}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 4/5. Hoy — eventos, con prioridad */}
                    {data.events.length > 0 && (
                      <div>
                        <p className="text-[11px] font-bold mb-1.5 flex items-center gap-1.5" style={{ color: "var(--text)" }}>
                          <CalendarClock className="w-3.5 h-3.5" /> {t("morningBrief.watchTodayLabel")}
                        </p>
                        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                          {data.events.map((e, i) => (
                            <div key={i} className="px-3 py-2 flex items-center gap-2" style={{ background: "var(--card)", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                              <span className="text-[13px]">{IMPACT_DOT[e.impact] || "⚪"}</span>
                              <span className="text-[11px] font-bold shrink-0" style={{ color: "var(--muted)" }}>{e.time_et || "—"}</span>
                              <span className="text-[12px]" style={{ color: "var(--text)" }}>{e.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Free: real counts, no content — Diego's Aug 16 §6 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border p-3 flex items-center gap-2.5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                        <Newspaper className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
                        <div>
                          <p className="text-lg font-black" style={{ color: "var(--text)" }}>{data.news_count}</p>
                          <p className="text-[10px]" style={{ color: "var(--muted)" }}>{t("morningBrief.teaserNewsLabel")}</p>
                        </div>
                      </div>
                      <div className="rounded-2xl border p-3 flex items-center gap-2.5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                        <CalendarClock className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
                        <div>
                          <p className="text-lg font-black" style={{ color: "var(--text)" }}>{data.events_count}</p>
                          <p className="text-[10px]" style={{ color: "var(--muted)" }}>{t("morningBrief.teaserEventsLabel")}</p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setPaywallOpen(true)}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm"
                      style={{ background: "var(--raised)", color: "var(--muted)" }}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      {t("morningBrief.premiumCta")}
                    </button>
                  </>
                )}
              </div>

              <div className="px-5 pb-5">
                <button
                  onClick={() => router.push("/portfolio")}
                  className="w-full py-3 rounded-2xl font-black text-sm"
                  style={{ background: "#00d47e", color: "#000" }}
                >
                  {t("morningBrief.seeFullPortfolio")}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
      {!isPremiumData && data && (
        <PaywallModal
          visible={paywallOpen}
          onClose={() => setPaywallOpen(false)}
          reason={t("morningBrief.premiumReason", { newsCount: data.news_count, eventsCount: data.events_count })}
        />
      )}
    </div>
  );
}
