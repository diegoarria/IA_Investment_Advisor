"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Lock, FileBarChart, ChevronRight, Info, Briefcase, CalendarDays, CloudOff, RefreshCw } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PaywallModal from "@/components/PaywallModal";
import StockAvatar from "@/components/StockAvatar";
import {
  BeatMissBadge, fmtMoney, fmtEps, fmtReportDate, surprisePct, EARNINGS_COLOR, type RecentReporter,
} from "@/components/EarningsAnalysisCard";
import { earningsApi } from "@/lib/api";
import { useSubscriptionStore, hasPremiumAccess } from "@/lib/store";
import { useCombinedPositions } from "@/lib/portfolioStore";
import { useWatchlistStore } from "@/lib/store";

const UP = "#22c55e";
const DOWN = "#ef4444";

function MetricCell({ label, actual, estimate, format }: {
  label: string; actual: number | null; estimate: number | null; format: (v: number | null) => string;
}) {
  const { t } = useTranslation();
  const s = surprisePct(actual, estimate);
  return (
    <div className="flex-1 min-w-0 rounded-xl px-3 py-2.5" style={{ background: "var(--raised)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-black uppercase tracking-[1px] truncate" style={{ color: "var(--muted)" }}>{label}</span>
        <BeatMissBadge actual={actual} estimate={estimate} />
      </div>
      <p className="text-[17px] font-black tabular-nums mt-1 leading-tight" style={{ color: "var(--text)" }}>{format(actual)}</p>
      <p className="text-[11px] tabular-nums mt-0.5" style={{ color: "var(--muted)" }}>
        {t("earnings.metrics.estimate", { value: format(estimate) })}
        {s !== null && (
          <span className="font-extrabold ml-1.5" style={{ color: s >= 0 ? UP : DOWN }}>{s >= 0 ? "+" : ""}{s.toFixed(1)}%</span>
        )}
      </p>
    </div>
  );
}

function ReporterCard({ r, owned, onClick }: { r: RecentReporter; owned: boolean; onClick: () => void }) {
  const { t, i18n } = useTranslation();
  const date = fmtReportDate(r.event_date, i18n.language);
  return (
    <button onClick={onClick}
            className="w-full text-left rounded-[20px] border p-4 transition-colors hover:border-[color:var(--accent-l)]"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center gap-3">
        <StockAvatar ticker={r.ticker} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[17px] font-black tracking-tight" style={{ color: "var(--text)" }}>{r.ticker}</p>
            {owned && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)" }}>
                <Briefcase className="w-2.5 h-2.5" />{t("earnings.list.owned")}
              </span>
            )}
          </div>
          {date && (
            <p className="flex items-center gap-1 text-[12px] mt-0.5" style={{ color: "var(--muted)" }}>
              <CalendarDays className="w-3 h-3" />{t("earnings.list.reportedOn", { date })}
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-3.5">
        <MetricCell label={t("earnings.metrics.eps")} actual={r.eps_actual} estimate={r.eps_estimate} format={fmtEps} />
        <MetricCell label={t("earnings.metrics.revenue")} actual={r.revenue_actual} estimate={r.revenue_estimate} format={fmtMoney} />
      </div>
      <div className="flex items-center justify-end gap-0.5 pt-3 mt-3.5 border-t" style={{ borderColor: "var(--border)" }}>
        <span className="text-xs font-extrabold" style={{ color: EARNINGS_COLOR }}>{t("earnings.list.viewAnalysis")}</span>
        <ChevronRight className="w-3.5 h-3.5" style={{ color: EARNINGS_COLOR }} />
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-[20px] border p-4 animate-pulse" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full" style={{ background: "var(--raised)" }} />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-20 rounded" style={{ background: "var(--raised)" }} />
          <div className="h-2.5 w-32 rounded" style={{ background: "var(--raised)" }} />
        </div>
      </div>
      <div className="flex gap-2 mt-3.5">
        <div className="flex-1 h-[68px] rounded-xl" style={{ background: "var(--raised)" }} />
        <div className="flex-1 h-[68px] rounded-xl" style={{ background: "var(--raised)" }} />
      </div>
    </div>
  );
}

export default function EarningsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const sub = useSubscriptionStore();
  const isPremium = hasPremiumAccess(sub);
  // Combined across every portfolio, not just the active one — a ticker
  // "you own" for earnings-alert purposes shouldn't depend on which
  // portfolio tab happens to be selected (2026-08-21 multi-portfolio audit).
  const positions = useCombinedPositions();
  const watchlistItems = useWatchlistStore((s) => s.items);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const [reporters, setReporters] = useState<RecentReporter[]>([]);
  const [loadingReporters, setLoadingReporters] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const ownedSet = useMemo(() => new Set(positions.map((p) => p.ticker)), [positions]);
  const symbols = useMemo(() => {
    const port = positions.map((p) => p.ticker);
    const watch = watchlistItems.map((w) => w.ticker);
    return Array.from(new Set([...port, ...watch])).filter(Boolean);
  }, [positions, watchlistItems]);

  useEffect(() => {
    if (!isPremium || symbols.length === 0) { setReporters([]); return; }
    setLoadingReporters(true);
    setLoadFailed(false);
    earningsApi.getRecentReporters(symbols)
      .then((res) => setReporters(res.data?.reporters || []))
      .catch(() => setLoadFailed(true))
      .finally(() => setLoadingReporters(false));
  }, [isPremium, symbols.join(","), reloadKey]);

  const openTicker = (ticker: string) => {
    if (!ticker.trim()) return;
    router.push(`/earnings/${ticker.trim().toUpperCase()}`);
  };

  // Owned positions first, then most recent report.
  const sorted = useMemo(() => [...reporters].sort((a, b) => {
    const ao = ownedSet.has(a.ticker) ? 0 : 1, bo = ownedSet.has(b.ticker) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (b.event_date ?? "").localeCompare(a.event_date ?? "");
  }), [reporters, ownedSet]);

  const stats = useMemo(() => {
    const epsKnown = reporters.filter((r) => r.eps_actual !== null && r.eps_estimate !== null);
    const revKnown = reporters.filter((r) => r.revenue_actual !== null && r.revenue_estimate !== null);
    return {
      count: reporters.length,
      epsBeat: epsKnown.filter((r) => (r.eps_actual as number) >= (r.eps_estimate as number)).length,
      epsKnown: epsKnown.length,
      revBeat: revKnown.filter((r) => (r.revenue_actual as number) >= (r.revenue_estimate as number)).length,
      revKnown: revKnown.length,
    };
  }, [reporters]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="max-w-2xl mx-auto space-y-3.5 pb-12">
            {/* Hero */}
            <div className="relative overflow-hidden rounded-3xl p-5 border" style={{ background: EARNINGS_COLOR + "14", borderColor: EARNINGS_COLOR + "33" }}>
              <div className="absolute w-[220px] h-[220px] rounded-full -top-[110px] -right-[70px] pointer-events-none" style={{ background: EARNINGS_COLOR + "22" }} />
              <div className="relative">
                <div className="w-11 h-11 rounded-[14px] flex items-center justify-center mb-3.5" style={{ background: EARNINGS_COLOR }}>
                  <FileBarChart className="w-[22px] h-[22px] text-white" />
                </div>
                <p className="text-[10px] font-black tracking-[1.4px] mb-1" style={{ color: EARNINGS_COLOR }}>{t("earnings.hero.eyebrow")}</p>
                <h1 className="text-[22px] font-black tracking-tight leading-[27px]" style={{ color: "var(--text)" }}>{t("earnings.title")}</h1>
                <p className="text-[13px] leading-[19px] mt-1.5" style={{ color: "var(--sub)" }}>{t("earnings.hero.subtitle")}</p>
                {isPremium && symbols.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3.5">
                    <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-[11px] font-bold" style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--sub)" }}>
                      <Briefcase className="w-3 h-3" style={{ color: EARNINGS_COLOR }} />{t("earnings.hero.tracking", { count: symbols.length })}
                    </span>
                  </div>
                )}
              </div>
            </div>

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
            ) : symbols.length === 0 ? (
              <div className="rounded-[20px] border p-7 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <p className="text-[13px] leading-[19px]" style={{ color: "var(--muted)" }}>{t("earnings.list.noSymbols")}</p>
              </div>
            ) : loadingReporters ? (
              <div className="space-y-2.5">
                <SkeletonCard /><SkeletonCard /><SkeletonCard />
              </div>
            ) : loadFailed ? (
              <div className="rounded-[20px] border p-7 flex flex-col items-center gap-3 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <CloudOff className="w-6 h-6" style={{ color: "var(--muted)" }} />
                <p className="text-[13px] leading-[19px]" style={{ color: "var(--muted)" }}>{t("earnings.list.loadError")}</p>
                <button onClick={() => setReloadKey((k) => k + 1)} className="flex items-center gap-1.5 rounded-[14px] px-4 py-2.5 text-[13px] font-extrabold text-white" style={{ background: EARNINGS_COLOR }}>
                  <RefreshCw className="w-3.5 h-3.5" />{t("earnings.retry")}
                </button>
              </div>
            ) : reporters.length === 0 ? (
              <div className="rounded-[20px] border p-7 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <p className="text-[13px] leading-[19px]" style={{ color: "var(--muted)" }}>{t("earnings.recentReporters.empty")}</p>
              </div>
            ) : (
              <>
                <div className="flex gap-2.5">
                  {[
                    { value: String(stats.count), label: t("earnings.stats.reported"), color: "var(--text)" },
                    { value: stats.epsKnown ? `${stats.epsBeat}/${stats.epsKnown}` : "—", label: t("earnings.stats.beatEps"), color: stats.epsKnown && stats.epsBeat >= stats.epsKnown / 2 ? UP : "var(--text)" },
                    { value: stats.revKnown ? `${stats.revBeat}/${stats.revKnown}` : "—", label: t("earnings.stats.beatRevenue"), color: stats.revKnown && stats.revBeat >= stats.revKnown / 2 ? UP : "var(--text)" },
                  ].map((st) => (
                    <div key={st.label} className="flex-1 rounded-2xl border py-3 px-1 flex flex-col items-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      <span className="text-xl font-black tabular-nums" style={{ color: st.color }}>{st.value}</span>
                      <span className="text-[10px] font-bold mt-0.5 text-center" style={{ color: "var(--muted)" }}>{st.label}</span>
                    </div>
                  ))}
                </div>

                <p className="text-xs font-black tracking-wide uppercase pt-1" style={{ color: "var(--muted)" }}>{t("earnings.recentReporters.label")}</p>
                <div className="space-y-2.5">
                  {sorted.map((r) => (
                    <ReporterCard key={r.ticker} r={r} owned={ownedSet.has(r.ticker)} onClick={() => openTicker(r.ticker)} />
                  ))}
                </div>
              </>
            )}

            <div className="flex gap-2 px-1 pt-1">
              <Info className="w-[15px] h-[15px] shrink-0 mt-px" style={{ color: "var(--muted)" }} />
              <p className="text-[11px] leading-4" style={{ color: "var(--muted)" }}>{t("earnings.disclaimer")}</p>
            </div>
          </div>
        </div>
      </div>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("earnings.premiumGate.paywallReason")} />
    </div>
  );
}
