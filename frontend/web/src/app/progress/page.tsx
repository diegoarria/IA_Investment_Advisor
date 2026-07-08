"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { TrendingUp, Lock, Loader2, Trophy, ShieldCheck, Calendar, X, Users } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import PaywallModal from "@/components/PaywallModal";
import { progressApi, benchmarkApi } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";

interface ProgressSummary {
  days_using_nuvos?: number;
  inception_date?: string;
  days_since_first_investment?: number;
  total_operations?: number;
  capital_invested?: number;
  current_patrimonio?: number;
  cumulative_return_pct?: number;
  cumulative_return_amount?: number;
  best_year?: { year: number; pct: number };
  worst_year?: { year: number; pct: number };
  consecutive_months_contributing?: number;
}

interface Milestone {
  event_type: string;
  title: string;
  description?: string;
  occurred_at: string;
  milestone_key: string;
}

interface DecisionThatHelped {
  key: string;
  title: string;
  description: string;
}

interface BenchmarkResult {
  metric: string;
  label: string;
  your_value: number;
  percentile: number;
  cohort_size: number;
}

interface Benchmark {
  cohort_label: string;
  results: BenchmarkResult[];
}

const fmtUSD = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function ProgressPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywall] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ProgressSummary>({});
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [decisions, setDecisions] = useState<DecisionThatHelped[]>([]);
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);

  useEffect(() => {
    if (!isPremium) return;
    setLoading(true);
    Promise.all([
      progressApi.getSummary(),
      progressApi.getMilestones(),
      progressApi.getDecisionsThatHelped(),
    ])
      .then(([s, m, d]) => {
        setSummary(s.data.summary || {});
        setMilestones(m.data.milestones || []);
        setDecisions(d.data.decisions || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    benchmarkApi.getMine().then((r) => setBenchmark(r.data)).catch(() => {});
  }, [isPremium]);

  const metrics: { label: string; value: string }[] = [];
  if (summary.days_since_first_investment !== undefined) {
    metrics.push({ label: t("progress.metrics.sinceFirstInvestment"), value: t("progress.metrics.daysUnit", { count: summary.days_since_first_investment }) });
  }
  if (summary.days_using_nuvos !== undefined) {
    metrics.push({ label: t("progress.metrics.timeUsingNuvos"), value: t("progress.metrics.daysUnit", { count: summary.days_using_nuvos }) });
  }
  if (summary.total_operations !== undefined) {
    metrics.push({ label: t("progress.metrics.operationsCompleted"), value: `${summary.total_operations}` });
  }
  if (summary.capital_invested !== undefined) {
    metrics.push({ label: t("progress.metrics.capitalInvested"), value: fmtUSD(summary.capital_invested) });
  }
  if (summary.current_patrimonio !== undefined) {
    metrics.push({ label: t("progress.metrics.currentWealth"), value: fmtUSD(summary.current_patrimonio) });
  }
  if (summary.cumulative_return_pct !== undefined) {
    const sign = summary.cumulative_return_pct >= 0 ? "+" : "";
    metrics.push({ label: t("progress.metrics.cumulativeReturn"), value: `${sign}${summary.cumulative_return_pct}%` });
  }
  if (summary.best_year) {
    metrics.push({ label: t("progress.metrics.bestYear", { year: summary.best_year.year }), value: `+${summary.best_year.pct}%` });
  }
  if (summary.worst_year) {
    const sign = summary.worst_year.pct >= 0 ? "+" : "";
    metrics.push({ label: t("progress.metrics.hardestYear", { year: summary.worst_year.year }), value: `${sign}${summary.worst_year.pct}%` });
  }
  if (summary.consecutive_months_contributing !== undefined) {
    metrics.push({ label: t("progress.metrics.consecutiveMonthsContributing"), value: `${summary.consecutive_months_contributing}` });
  }

  const hasAnyData = metrics.length > 0 || milestones.length > 0 || decisions.length > 0;

  if (!isPremium) {
    return (
      <div className="flex h-screen" style={{ background: "var(--bg)" }}>
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex justify-end mb-2">
              <button onClick={() => router.back()}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
                      style={{ background: "var(--raised)", color: "var(--muted)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="rounded-2xl border p-10 text-center"
                 style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                   style={{ background: "rgba(0,168,94,0.1)" }}>
                <Lock className="w-8 h-8" style={{ color: "var(--accent-l)" }} />
              </div>
              <h2 className="font-bold text-lg mb-2" style={{ color: "var(--text)" }}>{t("progress.paywall.title")}</h2>
              <p className="text-sm max-w-sm mx-auto mb-5" style={{ color: "var(--muted)" }}>
                {t("progress.paywall.description")}
              </p>
              <button onClick={() => setPaywall(true)}
                      className="px-6 py-2.5 rounded-xl text-sm font-bold text-white"
                      style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                {t("progress.paywall.activatePremium")}
              </button>
            </div>
          </div>
        </main>
        <PaywallModal visible={paywallOpen} onClose={() => setPaywall(false)} />
      </div>
    );
  }

  return (
    <div className="flex h-screen" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--text)" }}>
                <TrendingUp className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
                {t("progress.header.title")}
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                {t("progress.header.subtitle")}
              </p>
            </div>
            <button onClick={() => router.back()}
                    className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
                    style={{ background: "var(--raised)", color: "var(--muted)" }}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
            </div>
          ) : !hasAnyData ? (
            <div className="text-center py-16">
              <TrendingUp className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--muted)", opacity: 0.4 }} />
              <p className="text-sm" style={{ color: "var(--muted)" }}>{t("progress.empty.title")}</p>
              <p className="text-xs mt-1" style={{ color: "var(--dim)" }}>{t("progress.empty.subtitle")}</p>
            </div>
          ) : (
            <>
              {/* Summary metrics */}
              {metrics.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {metrics.map((m) => (
                    <div key={m.label} className="rounded-xl border p-3.5"
                         style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                      <p className="text-[10px] font-semibold mb-1" style={{ color: "var(--muted)" }}>{m.label}</p>
                      <p className="text-lg font-black" style={{ color: "var(--text)" }}>{m.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Comparación anónima con otros inversionistas */}
              {benchmark && benchmark.results.length > 0 && (
                <div>
                  <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                    <Users className="w-3.5 h-3.5" style={{ color: "#3b82f6" }} /> {t("progress.benchmark.sectionTitle")}
                  </p>
                  <div className="space-y-2.5">
                    {benchmark.results.map((r) => (
                      <div key={r.metric} className="p-3.5 rounded-xl border"
                           style={{ borderColor: "rgba(59,130,246,0.2)", background: "rgba(59,130,246,0.05)" }}>
                        <p className="text-sm" style={{ color: "var(--text)" }}>
                          <span className="font-black">{t("progress.benchmark.youBeat", { percentile: r.percentile })}</span>{" "}
                          {t("progress.benchmark.ofInvestorsWithProfile")} <span className="font-bold">{benchmark.cohort_label}</span> {t("progress.benchmark.in")}{" "}
                          {r.label.toLowerCase()}.
                        </p>
                        <div className="h-1.5 rounded-full mt-2.5 overflow-hidden" style={{ background: "var(--border)" }}>
                          <div className="h-full rounded-full" style={{ width: `${r.percentile}%`, background: "#3b82f6" }} />
                        </div>
                        <p className="text-[10px] mt-1.5" style={{ color: "var(--dim)" }}>
                          {t("progress.benchmark.anonymousComparison", { count: r.cohort_size })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Milestones */}
              {milestones.length > 0 && (
                <div>
                  <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                    <Trophy className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} /> {t("progress.milestones.sectionTitle")}
                  </p>
                  <div className="space-y-2">
                    {milestones.map((ms) => (
                      <div key={ms.milestone_key} className="flex items-start gap-3 p-3 rounded-xl border"
                           style={{ borderColor: "rgba(245,158,11,0.2)", background: "rgba(245,158,11,0.05)" }}>
                        <Trophy className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{ms.title}</p>
                          {ms.description && (
                            <p className="text-xs mt-0.5" style={{ color: "var(--sub)" }}>{ms.description}</p>
                          )}
                        </div>
                        <p className="text-[10px] shrink-0 flex items-center gap-1" style={{ color: "var(--dim)" }}>
                          <Calendar className="w-3 h-3" />
                          {new Date(ms.occurred_at).toLocaleDateString("es-MX")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Decisions that helped */}
              {decisions.length > 0 && (
                <div>
                  <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                    <ShieldCheck className="w-3.5 h-3.5" style={{ color: "#22c55e" }} /> {t("progress.decisions.sectionTitle")}
                  </p>
                  <div className="space-y-2">
                    {decisions.map((d) => (
                      <div key={d.key} className="flex items-start gap-3 p-3 rounded-xl border"
                           style={{ borderColor: "rgba(34,197,94,0.2)", background: "rgba(34,197,94,0.05)" }}>
                        <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#22c55e" }} />
                        <div>
                          <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{d.title}</p>
                          <p className="text-xs mt-0.5" style={{ color: "var(--sub)" }}>{d.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
