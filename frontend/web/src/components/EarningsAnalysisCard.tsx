"use client";

import { useTranslation } from "react-i18next";
import { TrendingUp, TrendingDown, Target, ThumbsUp, ThumbsDown, Sparkles } from "lucide-react";
import StockAvatar from "@/components/StockAvatar";

export interface EarningsSegment {
  name: string;
  metric: string;
  value: string;
  note: string | null;
}

export interface GuidanceChange {
  status: "raised" | "lowered" | "maintained" | "unknown";
  old_range: string | null;
  new_range: string | null;
  note: string | null;
}

export interface EarningsAnalysisData {
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

export interface EarningsData {
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

export interface EarningsAnalysisResponse {
  symbol: string;
  structured_analysis: EarningsAnalysisData;
  earnings_data: EarningsData;
}

export interface RecentReporter {
  ticker: string;
  event_date: string | null;
  eps_estimate: number | null;
  eps_actual: number | null;
  revenue_estimate: number | null;
  revenue_actual: number | null;
}

export function fmtMoney(v: number | null): string {
  if (v === null || v === undefined) return "N/D";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(2)}`;
}

export function BeatMissBadge({ actual, estimate }: { actual: number | null; estimate: number | null }) {
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

export function RatingBadge({ rating }: { rating: number | null }) {
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

export function GuidanceCallout({ g }: { g: GuidanceChange | null }) {
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

export function SegmentsList({ segments }: { segments: EarningsSegment[] }) {
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

export function EarningsAnalysisCard({ result }: { result: EarningsAnalysisResponse }) {
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
