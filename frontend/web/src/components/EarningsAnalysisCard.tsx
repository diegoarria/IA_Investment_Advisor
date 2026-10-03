"use client";

import { useTranslation } from "react-i18next";
import {
  TrendingUp, TrendingDown, Target, CheckCircle2, XCircle, Sparkles, Compass, Activity, Briefcase, Info, Layers,
} from "lucide-react";
import StockAvatar from "@/components/StockAvatar";

// Earnings' own accent, same "one color per tool" convention as Nuvos Radar.
export const EARNINGS_COLOR = "#0ea5e9";
const UP = "#22c55e";
const DOWN = "#ef4444";

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
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(2)}`;
}

export function fmtEps(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "N/D";
  return `$${Number(v).toFixed(2)}`;
}

/** % the actual came in above (+) or below (−) the estimate. */
export function surprisePct(actual: number | null, estimate: number | null): number | null {
  if (actual === null || estimate === null || actual === undefined || estimate === undefined) return null;
  if (!estimate) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

export function fmtReportDate(iso: string | null, lang: string): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "en" ? "en-US" : "es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export function BeatMissBadge({ actual, estimate }: { actual: number | null; estimate: number | null }) {
  const { t } = useTranslation();
  if (actual === null || estimate === null || actual === undefined || estimate === undefined) return null;
  const beat = actual >= estimate;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap"
          style={{ background: beat ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.12)", color: beat ? UP : DOWN }}>
      {beat ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {beat ? t("earnings.beat") : t("earnings.miss")}
    </span>
  );
}

function ratingTone(n: number) {
  return n >= 8 ? { color: UP, key: "strong" } : n >= 6 ? { color: "#84cc16", key: "good" } : n >= 4 ? { color: "#f59e0b", key: "mixed" } : { color: DOWN, key: "weak" };
}

/** Normalized rating or null — never trust the payload's type before doing math on it. */
function ratingValue(rating: number | null): number | null {
  const n = typeof rating === "number" ? rating : Number(rating);
  if (rating === null || rating === undefined || Number.isNaN(n)) return null;
  return Math.max(0, Math.min(10, n));
}

export function RatingBadge({ rating }: { rating: number | null }) {
  const { t } = useTranslation();
  const n = ratingValue(rating);
  if (n === null) return null;
  const tone = ratingTone(n);
  const R = 30, C = 2 * Math.PI * R;
  return (
    <div className="flex flex-col items-center shrink-0">
      <div className="relative w-[76px] h-[76px]">
        <svg viewBox="0 0 76 76" className="w-full h-full -rotate-90">
          <circle cx="38" cy="38" r={R} fill="none" stroke="var(--raised)" strokeWidth="7" />
          <circle cx="38" cy="38" r={R} fill="none" stroke={tone.color} strokeWidth="7" strokeLinecap="round"
                  strokeDasharray={`${(n / 10) * C} ${C}`} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-black tabular-nums leading-none" style={{ color: "var(--text)" }}>{n.toFixed(1)}</span>
          <span className="text-[9px] font-bold mt-0.5" style={{ color: "var(--muted)" }}>/10</span>
        </div>
      </div>
      <span className="text-[10px] font-extrabold mt-1.5 uppercase tracking-wide" style={{ color: tone.color }}>
        {t(`earnings.rating.${tone.key}`)}
      </span>
    </div>
  );
}

/** One key number from the report: actual vs estimate, with the surprise. */
export function MetricTile({ label, actual, estimate, format }: {
  label: string; actual: number | null; estimate: number | null; format: (v: number | null) => string;
}) {
  const { t } = useTranslation();
  const s = surprisePct(actual, estimate);
  const beat = s !== null && s >= 0;
  const max = Math.max(Math.abs(actual ?? 0), Math.abs(estimate ?? 0)) || 1;
  return (
    <div className="flex-1 min-w-0 rounded-2xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-[1px]" style={{ color: "var(--muted)" }}>{label}</p>
        <BeatMissBadge actual={actual} estimate={estimate} />
      </div>
      <p className="text-[26px] font-black tabular-nums tracking-tight mt-2 leading-none" style={{ color: "var(--text)" }}>{format(actual)}</p>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[11px] font-semibold tabular-nums" style={{ color: "var(--muted)" }}>
          {t("earnings.metrics.estimate", { value: format(estimate) })}
        </span>
        {s !== null && (
          <span className="text-[11px] font-extrabold tabular-nums" style={{ color: beat ? UP : DOWN }}>
            {s >= 0 ? "+" : ""}{s.toFixed(1)}%
          </span>
        )}
      </div>
      {actual !== null && estimate !== null && (
        <div className="mt-3 space-y-1.5">
          {[
            { k: "actual", v: actual, c: beat ? UP : DOWN },
            { k: "estimate", v: estimate, c: "var(--dim)" },
          ].map((row) => (
            <div key={row.k} className="flex items-center gap-2">
              <span className="w-14 text-[9px] font-bold uppercase tracking-wide shrink-0" style={{ color: "var(--muted)" }}>
                {t(`earnings.metrics.${row.k}Short`)}
              </span>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--raised)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.max(4, (Math.abs(row.v) / max) * 100)}%`, background: row.c }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ icon: Icon, children, color }: { icon: typeof Info; children: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4" style={{ color: color ?? EARNINGS_COLOR }} />
      <p className="text-[11px] font-black uppercase tracking-[1px]" style={{ color: "var(--muted)" }}>{children}</p>
    </div>
  );
}

export function GuidanceCallout({ g }: { g: GuidanceChange | null }) {
  const { t } = useTranslation();
  if (!g || g.status === "unknown") return null;
  const color = g.status === "raised" ? UP : g.status === "lowered" ? DOWN : "var(--sub)";
  const Icon = g.status === "raised" ? TrendingUp : g.status === "lowered" ? TrendingDown : Compass;
  return (
    <div className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <SectionLabel icon={Compass}>{t("earnings.sections.guidance")}</SectionLabel>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
             style={{ background: g.status === "raised" ? "rgba(34,197,94,0.12)" : g.status === "lowered" ? "rgba(239,68,68,0.12)" : "var(--raised)" }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold" style={{ color }}>{t(`earnings.guidance.${g.status}`)}</p>
          {(g.old_range || g.new_range) && (
            <p className="text-[13px] mt-1 tabular-nums" style={{ color: "var(--sub)" }}>
              {g.old_range && <span className="line-through mr-2" style={{ color: "var(--muted)" }}>{g.old_range}</span>}
              {g.new_range && <span className="font-bold">{g.new_range}</span>}
            </p>
          )}
          {g.note && <p className="text-[13px] leading-[19px] mt-1.5" style={{ color: "var(--sub)" }}>{g.note}</p>}
        </div>
      </div>
    </div>
  );
}

export function SegmentsList({ segments }: { segments: EarningsSegment[] }) {
  const { t } = useTranslation();
  if (segments.length === 0) {
    return <p className="text-[13px]" style={{ color: "var(--muted)" }}>{t("earnings.segments.none")}</p>;
  }
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
      {segments.map((s, i) => (
        <div key={i} className="flex items-center justify-between gap-3 px-4 py-3"
             style={{ background: i % 2 ? "var(--raised)" : "transparent", borderTop: i ? "1px solid var(--border)" : undefined }}>
          <div className="min-w-0">
            <p className="text-[13px] font-bold truncate" style={{ color: "var(--text)" }}>{s.name}</p>
            {s.note && <p className="text-[11px] leading-4 mt-0.5" style={{ color: "var(--muted)" }}>{s.note}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-[14px] font-black tabular-nums" style={{ color: "var(--text)" }}>{s.value}</p>
            <p className="text-[10px] font-semibold" style={{ color: "var(--muted)" }}>{s.metric}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function PointList({ items, tone }: { items: string[]; tone: "up" | "down" }) {
  const Icon = tone === "up" ? CheckCircle2 : XCircle;
  const color = tone === "up" ? UP : DOWN;
  return (
    <ul className="space-y-2.5">
      {items.map((p, i) => (
        <li key={i} className="flex gap-2.5 items-start">
          <Icon className="w-4 h-4 mt-[2px] shrink-0" style={{ color }} />
          <span className="text-[13px] leading-[19px]" style={{ color: "var(--sub)" }}>{p}</span>
        </li>
      ))}
    </ul>
  );
}

export function EarningsAnalysisCard({ result }: { result: EarningsAnalysisResponse }) {
  const { t } = useTranslation();
  const { structured_analysis: rawAnalysis, earnings_data: d } = result;
  // Defense in depth — the backend sanitizes these to arrays, but a render
  // must never trust an external API payload's shape enough to call
  // `.map()`/`.length` on it unchecked.
  const a = {
    ...rawAnalysis,
    positives: Array.isArray(rawAnalysis.positives) ? rawAnalysis.positives : [],
    negatives: Array.isArray(rawAnalysis.negatives) ? rawAnalysis.negatives : [],
    segments: Array.isArray(rawAnalysis.segments) ? rawAnalysis.segments : [],
  };
  const rating = ratingValue(a.rating_out_of_10);

  return (
    <div className="space-y-3.5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl p-5 border" style={{ background: EARNINGS_COLOR + "14", borderColor: EARNINGS_COLOR + "33" }}>
        <div className="absolute w-[240px] h-[240px] rounded-full -top-[120px] -right-[80px] pointer-events-none" style={{ background: EARNINGS_COLOR + "22" }} />
        <div className="relative flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black tracking-[1.4px] mb-2.5" style={{ color: EARNINGS_COLOR }}>{t("earnings.hero.eyebrow")}</p>
            <div className="flex items-center gap-3">
              <StockAvatar ticker={d.symbol} size="md" />
              <div className="min-w-0">
                <h1 className="text-[22px] font-black tracking-tight leading-[26px] truncate" style={{ color: "var(--text)" }}>{d.name || d.symbol}</h1>
                <p className="text-[12px] font-bold mt-0.5" style={{ color: "var(--muted)" }}>{d.symbol}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3.5">
              {d.fiscal_label && (
                <span className="rounded-full px-2.5 py-1 border text-[11px] font-bold" style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--sub)" }}>
                  {d.fiscal_label}
                </span>
              )}
              {d.current_price !== null && d.current_price !== undefined && (
                <span className="rounded-full px-2.5 py-1 border text-[11px] font-bold tabular-nums" style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--sub)" }}>
                  {t("earnings.hero.price", { value: fmtEps(d.current_price) })}
                </span>
              )}
            </div>
          </div>
          {rating !== null && <RatingBadge rating={rating} />}
        </div>
        {a.headline && (
          <p className="relative text-[15px] font-semibold leading-[22px] mt-4 pt-4 border-t" style={{ color: "var(--text)", borderColor: EARNINGS_COLOR + "33" }}>
            {a.headline}
          </p>
        )}
      </div>

      {/* Key numbers */}
      <p className="text-xs font-black tracking-wide uppercase pt-1" style={{ color: "var(--muted)" }}>{t("earnings.sections.keyNumbers")}</p>
      <div className="flex flex-col sm:flex-row gap-2.5">
        <MetricTile label={t("earnings.metrics.eps")} actual={d.eps_actual} estimate={d.eps_estimate} format={fmtEps} />
        <MetricTile label={t("earnings.metrics.revenue")} actual={d.revenue_actual} estimate={d.revenue_estimate} format={fmtMoney} />
      </div>

      {/* Positives / negatives */}
      {(a.positives.length > 0 || a.negatives.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {a.positives.length > 0 && (
            <div className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)", borderTop: `3px solid ${UP}` }}>
              <SectionLabel icon={TrendingUp} color={UP}>{t("earnings.sections.positives")}</SectionLabel>
              <PointList items={a.positives} tone="up" />
            </div>
          )}
          {a.negatives.length > 0 && (
            <div className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)", borderTop: `3px solid ${DOWN}` }}>
              <SectionLabel icon={TrendingDown} color={DOWN}>{t("earnings.sections.negatives")}</SectionLabel>
              <PointList items={a.negatives} tone="down" />
            </div>
          )}
        </div>
      )}

      <GuidanceCallout g={a.guidance_change} />

      {/* Segments */}
      <div className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <SectionLabel icon={Layers}>{t("earnings.sections.segments")}</SectionLabel>
        <SegmentsList segments={a.segments} />
      </div>

      {a.why_stock_moved && (
        <div className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <SectionLabel icon={Activity}>{t("earnings.sections.whyMoved")}</SectionLabel>
          <p className="text-[14px] leading-[21px]" style={{ color: "var(--sub)" }}>{a.why_stock_moved}</p>
        </div>
      )}

      {a.thesis_impact && (
        <div className="rounded-2xl border p-5" style={{ background: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.25)" }}>
          <SectionLabel icon={Target} color="var(--accent-l)">{t("earnings.sections.thesisImpact")}</SectionLabel>
          <p className="text-[14px] leading-[21px]" style={{ color: "var(--sub)" }}>{a.thesis_impact}</p>
        </div>
      )}

      {a.portfolio_note && (
        <div className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <SectionLabel icon={Briefcase}>{t("earnings.sections.portfolioNote")}</SectionLabel>
          <p className="text-[14px] leading-[21px]" style={{ color: "var(--sub)" }}>{a.portfolio_note}</p>
        </div>
      )}

      {rating !== null && a.rating_reasoning && (
        <div className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <SectionLabel icon={Sparkles} color={ratingTone(rating).color}>{t("earnings.sections.ratingReasoning")}</SectionLabel>
          <p className="text-[14px] leading-[21px]" style={{ color: "var(--sub)" }}>{a.rating_reasoning}</p>
        </div>
      )}

      <div className="flex gap-2 px-1 pt-1">
        <Info className="w-[15px] h-[15px] shrink-0 mt-px" style={{ color: "var(--muted)" }} />
        <p className="text-[11px] leading-4" style={{ color: "var(--muted)" }}>{t("earnings.disclaimer")}</p>
      </div>
    </div>
  );
}
