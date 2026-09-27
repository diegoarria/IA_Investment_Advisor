"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Loader2, TrendingUp, TrendingDown, Newspaper, CalendarClock, Lock, X } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import StockAvatar from "@/components/StockAvatar";
import PaywallModal from "@/components/PaywallModal";
import { morningBriefFullApi } from "@/lib/api";

interface TopMover { ticker: string; change_pct: number; impact_usd: number; }
interface NewsItem { ticker: string; headline: string; category: string | null; }
interface EventItem { type: string; ticker: string | null; label: string; impact: string | null; }
interface MorningBriefData {
  is_premium: true;
  has_portfolio?: boolean;
  portfolio_value: number | null;
  change_usd: number | null;
  change_pct: number | null;
  sp500_change_pct: number | null;
  top_mover: TopMover | null;
  news: NewsItem[];
  events: EventItem[];
}
interface MorningBriefTeaser {
  is_premium: false;
  has_portfolio?: boolean;
  portfolio_value: number | null;
  change_usd: number | null;
  change_pct: number | null;
  news_count: number;
  events_count: number;
  top_headline: { ticker: string; headline: string } | null;
}

// Diego (2026-09-27): the Morning Brief must ALWAYS open — the backend
// now always returns a brief within ~12s; retry on our own, then offer a
// retry button instead of "no hay información".
const RETRY_DELAYS_MS = [0, 1500, 4000];
const BRIEF_TIMEOUT_MS = 45000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function MorningBriefPage() {
  const { t } = useTranslation();
  const router = useRouter();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [data, setData] = useState<MorningBriefData | MorningBriefTeaser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(false);
    for (const delay of RETRY_DELAYS_MS) {
      if (delay) await sleep(delay);
      if (seq !== loadSeq.current) return;
      try {
        const res = await morningBriefFullApi.get(BRIEF_TIMEOUT_MS);
        if (seq !== loadSeq.current) return;
        setData(res.data);
        setLoading(false);
        return;
      } catch {}
    }
    if (seq !== loadSeq.current) return;
    setError(true);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const isUp = (data?.change_usd ?? 0) >= 0;
  const isPremiumData = data?.is_premium === true;
  const hasPortfolio = data ? data.has_portfolio !== false && data.portfolio_value !== null : false;
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
              <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>{t("morningBrief.loadError")}</p>
              <button onClick={load} className="px-6 py-2.5 rounded-2xl font-black text-sm" style={{ background: "#00d47e", color: "#000" }}>
                {t("morningBrief.retry")}
              </button>
            </div>
          ) : (
            <>
              <div className="px-5 pt-5 pb-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
                <span className="text-xs font-black" style={{ color: "#00d47e" }}>🧠 {t("morningBrief.title")}</span>
                <button onClick={() => router.push("/home")} aria-label="Cerrar" className="p-1 -mr-1 rounded-full" style={{ color: "var(--muted)" }}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* 1. Portafolio vs S&P */}
                {!hasPortfolio ? (
                <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                  <p className="text-sm" style={{ color: "var(--sub)" }}>{t("morningBrief.noPortfolio")}</p>
                  {isPremiumData && data.sp500_change_pct !== null && (
                    <p className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>
                      S&P 500: <span style={{ color: sp500Up ? "#00d47e" : "#ef4444", fontWeight: 700 }}>{sp500Up ? "+" : ""}{data.sp500_change_pct}%</span>
                    </p>
                  )}
                </div>
                ) : (
                <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>
                    {t("morningBrief.portfolioLabel")}
                  </p>
                  <p className="text-2xl font-black" style={{ color: "var(--text)" }}>{fmtUsd(data.portfolio_value ?? 0)}</p>
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
                )}

                {isPremiumData && data.news.length === 0 && data.events.length === 0 && (
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{t("morningBrief.quietDay")}</p>
                )}

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
                            <div key={i} className="px-3 py-2.5" style={{ background: "var(--card)", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                              <p className="text-[12.5px] font-bold" style={{ color: "var(--text)" }}>{i + 1}. {e.label}</p>
                              {e.impact && (
                                <p className="text-[11.5px] leading-relaxed mt-1" style={{ color: "var(--sub)" }}>{e.impact}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Free: real counts, plus one unlocked finding (2026-09-17) —
                        counts alone say "you're missing something," a real
                        headline proves the brief actually has substance. */}
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
                    {data.top_headline && (
                      <div>
                        <p className="text-[11px] font-bold mb-1.5 flex items-center gap-1.5" style={{ color: "var(--text)" }}>
                          <Newspaper className="w-3.5 h-3.5" /> {t("morningBrief.newsLabel")}
                        </p>
                        <div className="rounded-2xl border overflow-hidden px-3 py-2.5 flex gap-2.5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                          <span className="text-[10px] font-black shrink-0 mt-0.5" style={{ color: "var(--accent-l)" }}>{data.top_headline.ticker}</span>
                          <p className="text-[12px] leading-snug" style={{ color: "var(--text)" }}>{data.top_headline.headline}</p>
                        </div>
                      </div>
                    )}
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
                  {t(hasPortfolio ? "morningBrief.seeFullPortfolio" : "morningBrief.addPortfolio")}
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
