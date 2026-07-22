"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Loader2, Lock, FileBarChart, Search, X, TrendingUp, TrendingDown, AlertTriangle, ThumbsUp, ThumbsDown, Target, Sparkles } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PaywallModal from "@/components/PaywallModal";
import StockAvatar from "@/components/StockAvatar";
import { earningsApi } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";
import { usePortfolioStore } from "@/lib/portfolioStore";
import { useWatchlistStore } from "@/lib/store";

interface EarningsSegment {
  name: string;
  metric: string;
  value: string;
  note: string | null;
}

interface GuidanceChange {
  status: "raised" | "lowered" | "maintained" | "unknown";
  old_range: string | null;
  new_range: string | null;
  note: string | null;
}

interface EarningsAnalysisData {
  headline: string;
  positives: string[];
  negatives: string[];
  segments: EarningsSegment[];
  guidance_change: GuidanceChange | null;
  why_stock_moved: string;
  thesis_impact: string;
  rating_out_of_10: number | null;
  rating_reasoning: string;
  portfolio_note: string | null;
}

interface EarningsData {
  symbol: string;
  name: string;
  current_price: number | null;
  eps_actual: number | null;
  eps_estimate: number | null;
  revenue_actual: number | null;
  revenue_estimate: number | null;
  fiscal_quarter: number | null;
  fiscal_year: number | null;
  fiscal_label: string;
}

interface EarningsAnalysisResponse {
  symbol: string;
  structured_analysis: EarningsAnalysisData;
  earnings_data: EarningsData;
}

interface RecentReporter {
  ticker: string;
  event_date: string | null;
  eps_estimate: number | null;
  eps_actual: number | null;
  revenue_estimate: string | null;
  revenue_actual: string | null;
}

function fmtMoney(v: number | null): string {
  if (v === null || v === undefined) return "N/D";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(2)}`;
}

function BeatMissBadge({ actual, estimate }: { actual: number | null; estimate: number | null }) {
  const { t } = useTranslation();
  if (actual === null || estimate === null) return null;
  const beat = actual >= estimate;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
          style={{ background: beat ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.12)", color: beat ? "#22c55e" : "#ef4444" }}>
      {beat ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {beat ? t("earnings.beat") : t("earnings.miss")}
    </span>
  );
}

function RatingBadge({ rating }: { rating: number | null }) {
  if (rating === null) return null;
  const color = rating >= 8 ? "#22c55e" : rating >= 6 ? "#eab308" : rating >= 4 ? "#f59e0b" : "#ef4444";
  return (
    <div className="rounded-xl px-3 py-2 flex items-center gap-2 shrink-0" style={{ background: "var(--raised)" }}>
      <Sparkles className="w-4 h-4" style={{ color }} />
      <span className="text-lg font-black tabular-nums" style={{ color }}>{rating.toFixed(1)}</span>
      <span className="text-[10px] font-bold" style={{ color: "var(--muted)" }}>/10</span>
    </div>
  );
}

function GuidanceCallout({ g }: { g: GuidanceChange | null }) {
  const { t } = useTranslation();
  if (!g || g.status === "unknown") return null;
  const color = g.status === "raised" ? "#22c55e" : g.status === "lowered" ? "#ef4444" : "var(--muted)";
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
      <p className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>{t("earnings.sections.guidance")}</p>
      <p className="text-sm font-bold" style={{ color }}>{t(`earnings.guidance.${g.status}`)}</p>
      {(g.old_range || g.new_range) && (
        <p className="text-xs mt-0.5" style={{ color: "var(--sub)" }}>
          {g.old_range && <span className="line-through mr-1.5">{g.old_range}</span>}
          {g.new_range && <span className="font-bold">{g.new_range}</span>}
        </p>
      )}
      {g.note && <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{g.note}</p>}
    </div>
  );
}

function SegmentsList({ segments }: { segments: EarningsSegment[] }) {
  const { t } = useTranslation();
  if (segments.length === 0) {
    return <p className="text-xs italic" style={{ color: "var(--muted)" }}>{t("earnings.segments.none")}</p>;
  }
  return (
    <div className="space-y-2">
      {segments.map((s, i) => (
        <div key={i} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ background: "var(--raised)" }}>
          <div className="min-w-0">
            <p className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{s.name}</p>
            {s.note && <p className="text-[10px] truncate" style={{ color: "var(--muted)" }}>{s.note}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-black tabular-nums" style={{ color: "var(--accent-l)" }}>{s.value}</p>
            <p className="text-[9px]" style={{ color: "var(--dim)" }}>{s.metric}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function AnalysisCard({ result }: { result: EarningsAnalysisResponse }) {
  const { t } = useTranslation();
  const { structured_analysis: a, earnings_data: d } = result;
  return (
    <div className="rounded-2xl border p-4 space-y-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-3">
        <StockAvatar ticker={d.symbol} size="md" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ color: "var(--text)" }}>{d.name} <span style={{ color: "var(--muted)" }}>({d.symbol})</span></p>
          <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{d.fiscal_label}</p>
        </div>
        <RatingBadge rating={a.rating_out_of_10} />
      </div>

      <p className="text-sm font-bold leading-snug" style={{ color: "var(--text)" }}>{a.headline}</p>

      <div className="flex gap-2">
        <div className="flex-1 rounded-xl px-3 py-2" style={{ background: "var(--raised)" }}>
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>EPS</p>
            <BeatMissBadge actual={d.eps_actual} estimate={d.eps_estimate} />
          </div>
          <p className="text-sm font-black tabular-nums mt-0.5" style={{ color: "var(--text)" }}>
            ${d.eps_actual ?? "N/D"} <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>vs ${d.eps_estimate ?? "N/D"} est.</span>
          </p>
        </div>
        <div className="flex-1 rounded-xl px-3 py-2" style={{ background: "var(--raised)" }}>
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Revenue</p>
            <BeatMissBadge actual={d.revenue_actual} estimate={d.revenue_estimate} />
          </div>
          <p className="text-sm font-black tabular-nums mt-0.5" style={{ color: "var(--text)" }}>
            {fmtMoney(d.revenue_actual)} <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>vs {fmtMoney(d.revenue_estimate)} est.</span>
          </p>
        </div>
      </div>

      {(a.positives.length > 0 || a.negatives.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {a.positives.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.18)" }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ThumbsUp className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
                <p className="text-[11px] font-bold" style={{ color: "#22c55e" }}>{t("earnings.sections.positives")}</p>
              </div>
              <ul className="space-y-1">
                {a.positives.map((p, i) => <li key={i} className="text-xs" style={{ color: "var(--sub)" }}>• {p}</li>)}
              </ul>
            </div>
          )}
          {a.negatives.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ThumbsDown className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                <p className="text-[11px] font-bold" style={{ color: "#ef4444" }}>{t("earnings.sections.negatives")}</p>
              </div>
              <ul className="space-y-1">
                {a.negatives.map((n, i) => <li key={i} className="text-xs" style={{ color: "var(--sub)" }}>• {n}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <div>
        <p className="text-[9px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>{t("earnings.sections.segments")}</p>
        <SegmentsList segments={a.segments} />
      </div>

      <GuidanceCallout g={a.guidance_change} />

      {a.why_stock_moved && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>{t("earnings.sections.whyMoved")}</p>
          <p className="text-xs" style={{ color: "var(--sub)" }}>{a.why_stock_moved}</p>
        </div>
      )}

      {a.thesis_impact && (
        <div className="rounded-xl p-3 flex gap-2 items-start" style={{ background: "rgba(0,168,94,0.06)", border: "1px solid rgba(0,168,94,0.18)" }}>
          <Target className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--accent-l)" }} />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: "var(--accent-l)" }}>{t("earnings.sections.thesisImpact")}</p>
            <p className="text-xs" style={{ color: "var(--sub)" }}>{a.thesis_impact}</p>
          </div>
        </div>
      )}

      {a.portfolio_note && (
        <p className="text-xs italic" style={{ color: "var(--muted)" }}>{a.portfolio_note}</p>
      )}

      {a.rating_out_of_10 !== null && a.rating_reasoning && (
        <p className="text-[11px]" style={{ color: "var(--dim)" }}>
          <span className="font-bold" style={{ color: "var(--muted)" }}>{t("earnings.sections.ratingReasoning")}: </span>
          {a.rating_reasoning}
        </p>
      )}
    </div>
  );
}

export default function EarningsPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;
  const positions = usePortfolioStore((s) => s.positions);
  const watchlistItems = useWatchlistStore((s) => s.items);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const [reporters, setReporters] = useState<RecentReporter[]>([]);
  const [loadingReporters, setLoadingReporters] = useState(false);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [result, setResult] = useState<EarningsAnalysisResponse | null>(null);

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

  const runAnalysis = async (ticker: string) => {
    setSearching(true);
    setSearchError(null);
    setResult(null);
    try {
      const position = positions.find((p) => p.ticker === ticker.toUpperCase());
      const res = await earningsApi.getAnalysis(ticker.trim(), position?.shares || 0, position?.avgPrice || 0, i18n.language);
      setResult(res.data);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setSearchError(detail || t("earnings.search.error"));
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = () => {
    if (!query.trim() || !isPremium) return;
    runAnalysis(query.trim());
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2 mb-1">
              <FileBarChart className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>{t("earnings.title")}</h1>
            </div>

            <div className="rounded-2xl border-2 p-4 mb-5 text-center" style={{ borderColor: "#ef4444", background: "rgba(239,68,68,0.08)" }}>
              <p className="text-lg font-black tracking-tight" style={{ color: "#ef4444" }}>{t("earnings.disclaimer.title")}</p>
              <p className="text-xs mt-1" style={{ color: "var(--sub)" }}>{t("earnings.disclaimer.subtitle")}</p>
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
                <h2 className="text-sm font-bold mb-2" style={{ color: "var(--text)" }}>{t("earnings.search.label")}</h2>
                <div className="flex gap-2 mb-6">
                  <div className="flex-1 flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <Search className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      placeholder={t("earnings.search.placeholder")}
                      className="flex-1 py-2.5 text-sm bg-transparent outline-none"
                      style={{ color: "var(--text)" }}
                    />
                    {query && (
                      <button onClick={() => { setQuery(""); setResult(null); setSearchError(null); }}>
                        <X className="w-4 h-4" style={{ color: "var(--muted)" }} />
                      </button>
                    )}
                  </div>
                  <button onClick={handleSearch} disabled={searching || !query.trim()}
                          className="px-4 py-2.5 rounded-xl text-sm font-bold text-black disabled:opacity-40" style={{ background: "var(--accent)" }}>
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : t("earnings.search.button")}
                  </button>
                </div>

                {searchError && (
                  <div className="rounded-xl p-3 flex gap-2 items-start mb-4" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "#ef4444" }} />
                    <p className="text-xs font-medium" style={{ color: "#ef4444" }}>{searchError}</p>
                  </div>
                )}

                {result && (
                  <div className="mb-6">
                    <AnalysisCard result={result} />
                  </div>
                )}

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
                      <button key={r.ticker} onClick={() => runAnalysis(r.ticker)}
                              className="w-full flex items-center gap-3 rounded-xl border p-3 text-left hover:bg-white/3 transition-colors"
                              style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                        <StockAvatar ticker={r.ticker} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold" style={{ color: "var(--text)" }}>{r.ticker}</p>
                          <p className="text-[10px]" style={{ color: "var(--muted)" }}>{r.event_date}</p>
                        </div>
                        <BeatMissBadge actual={r.eps_actual} estimate={r.eps_estimate} />
                      </button>
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
