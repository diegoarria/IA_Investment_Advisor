"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookMarked, Loader2, MessageCircle, BarChart2, Newspaper } from "lucide-react";
import { graphApi } from "@/lib/api";
import PremiumToolLocked from "@/components/PremiumToolLocked";
import InvestmentGraphTimeline, { type GraphEvent } from "@/components/InvestmentGraphTimeline";

interface Metrics {
  total_theses: number;
  opinion_reversals: number;
  analyzed_never_bought: number;
  avg_deliberation_days: number | null;
  longest_conviction_ticker: string | null;
  longest_conviction_days: number | null;
  thesis_accuracy_pct: number | null;
  thesis_accuracy_sample_size: number;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
      <p className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>{label}</p>
      <p className="text-lg font-black" style={{ color: "var(--text)" }}>{value}</p>
    </div>
  );
}

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
}

export default function InvestmentGraphSection({ isPremium, onUpgrade }: Props) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<GraphEvent[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isPremium) return;
    setLoading(true);
    Promise.all([graphApi.getGlobalTimeline(50), graphApi.getMetrics()])
      .then(([tl, m]) => {
        setEvents(tl.data?.timeline ?? []);
        setMetrics(m.data ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isPremium]);

  if (!isPremium) {
    return (
      <PremiumToolLocked
        title={t("investmentGraph.sectionTitle")}
        tagline={t("investmentGraph.companyTabLabel")}
        description={t("investmentGraph.emptyCompany")}
        icon={BookMarked}
        color="#38bdf8"
        benefits={[
          { icon: MessageCircle, text: t("investmentGraph.event.question") },
          { icon: BarChart2,     text: t("investmentGraph.event.thesis") },
          { icon: Newspaper,     text: t("investmentGraph.event.marketEvent") },
        ]}
        onUnlock={onUpgrade}
      />
    );
  }

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "rgba(56,189,248,0.3)", background: "var(--card)" }}>
      <div className="h-1" style={{ background: "linear-gradient(90deg,#38bdf8,#0284c7)" }} />
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(56,189,248,0.15)" }}>
            <BookMarked className="w-4 h-4" style={{ color: "#38bdf8" }} />
          </div>
          <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{t("investmentGraph.sectionTitle")}</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "#38bdf8" }} /></div>
        ) : (
          <>
            {metrics && (
              <div className="grid grid-cols-3 gap-2">
                <MetricCard label={t("investmentGraph.metrics.totalTheses")} value={String(metrics.total_theses)} />
                <MetricCard label={t("investmentGraph.metrics.opinionReversals")} value={String(metrics.opinion_reversals)} />
                <MetricCard label={t("investmentGraph.metrics.analyzedNeverBought")} value={String(metrics.analyzed_never_bought)} />
                <MetricCard label={t("investmentGraph.metrics.avgDeliberationDays")} value={metrics.avg_deliberation_days != null ? `${metrics.avg_deliberation_days}d` : "—"} />
                <MetricCard label={t("investmentGraph.metrics.longestConviction")} value={metrics.longest_conviction_ticker ?? "—"} />
                <MetricCard label={t("investmentGraph.metrics.thesisAccuracy")} value={metrics.thesis_accuracy_pct != null ? `${metrics.thesis_accuracy_pct}%` : "—"} />
              </div>
            )}
            <InvestmentGraphTimeline events={events} showTicker />
          </>
        )}
      </div>
    </div>
  );
}
