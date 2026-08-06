"use client";

// Fase 4, Incremento 5 — Timeline interactiva (Parte F). Presentational
// only — sorting logic lives in src/lib/companyTimeline.ts. Same visual
// language (icon + wash circle, title/date line) as InvestmentGraphTimeline,
// but a separate component since the event vocabulary is genuinely
// different (company-objective events, not per-user activity) — see
// companyTimeline.ts's module docstring for why.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Users, GitMerge, GitBranch, Rocket, Layers, Scale, Target,
  TrendingDown, TrendingUp, RefreshCw, Circle, type LucideIcon,
} from "lucide-react";
import { Card, SectionHeader } from "@/components/ui";
import { sortTimelineEventsDesc, type CompanyTimelineEvent } from "@/lib/companyTimeline";

const EVENT_META: Record<string, { icon: LucideIcon; color: string; wash: string }> = {
  ceo_change:      { icon: Users,        color: "#38bdf8", wash: "rgba(56,189,248,0.12)" },
  ma:              { icon: GitMerge,     color: "#a78bfa", wash: "rgba(167,139,250,0.12)" },
  spinoff:         { icon: GitBranch,    color: "#a78bfa", wash: "rgba(167,139,250,0.12)" },
  product_launch:  { icon: Rocket,       color: "#22c55e", wash: "rgba(34,197,94,0.12)" },
  new_segment:     { icon: Layers,       color: "#22c55e", wash: "rgba(34,197,94,0.12)" },
  regulatory:      { icon: Scale,        color: "#ef4444", wash: "rgba(239,68,68,0.12)" },
  guidance_change: { icon: Target,       color: "#f59e0b", wash: "rgba(245,158,11,0.12)" },
  margin_shift:    { icon: TrendingDown, color: "#ef4444", wash: "rgba(239,68,68,0.12)" },
  revenue_shift:   { icon: TrendingUp,   color: "#f59e0b", wash: "rgba(245,158,11,0.12)" },
  strategy_change: { icon: RefreshCw,    color: "#38bdf8", wash: "rgba(56,189,248,0.12)" },
  other:           { icon: Circle,       color: "var(--muted)", wash: "var(--raised)" },
};

const INITIAL_VISIBLE = 8;

function EventLine({ event }: { event: CompanyTimelineEvent }) {
  const { t } = useTranslation();
  const meta = EVENT_META[event.event_type] ?? EVENT_META.other;
  const Icon = meta.icon;
  const dateStr = event.event_date ?? event.created_at;
  return (
    <div className="flex items-start gap-3 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: meta.wash }}>
        <Icon className="w-4 h-4" style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold" style={{ color: "var(--text)" }}>{event.headline}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--raised)", color: "var(--muted)" }}>
            {t(`subvaluadas.timeline.eventTypes.${event.event_type}`, { defaultValue: event.event_type })}
          </span>
        </div>
      </div>
      <span className="text-[10px] shrink-0" style={{ color: "var(--dim)" }}>
        {dateStr ? new Date(dateStr).toLocaleDateString() : ""}
      </span>
    </div>
  );
}

export function CompanyTimeline({ events, loading }: { events: CompanyTimelineEvent[]; loading?: boolean }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const sorted = sortTimelineEventsDesc(events);
  const visible = showAll ? sorted : sorted.slice(0, INITIAL_VISIBLE);

  return (
    <Card className="mb-6">
      <SectionHeader title={t("subvaluadas.timeline.title")} subtitle={t("subvaluadas.timeline.subtitle")} />
      {loading ? (
        <p className="text-xs text-center py-8" style={{ color: "var(--muted)" }}>{t("subvaluadas.timeline.loading")}</p>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-center py-8" style={{ color: "var(--muted)" }}>{t("subvaluadas.timeline.empty")}</p>
      ) : (
        <>
          <div>
            {visible.map((event, i) => <EventLine key={event.id ?? i} event={event} />)}
          </div>
          {sorted.length > INITIAL_VISIBLE && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="mt-3 text-[11px] font-bold underline underline-offset-2"
              style={{ color: "var(--accent-l)" }}
            >
              {showAll ? t("subvaluadas.timeline.showLess") : t("subvaluadas.timeline.showAll", { count: sorted.length })}
            </button>
          )}
        </>
      )}
    </Card>
  );
}
