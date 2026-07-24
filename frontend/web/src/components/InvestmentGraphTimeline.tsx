"use client";

import { MessageCircle, BarChart2, ShoppingCart, Trash2, Newspaper, TrendingUp, TrendingDown } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface GraphEvent {
  id?: string;
  ticker: string;
  event_type: "question" | "thesis" | "watchlist_add" | "watchlist_remove" | "market_event" | "decision";
  payload?: Record<string, any>;
  occurred_at: string;
}

const EVENT_META: Record<string, { icon: any; color: string; wash: string }> = {
  question:         { icon: MessageCircle, color: "#38bdf8", wash: "rgba(56,189,248,0.12)" },
  thesis:           { icon: BarChart2,     color: "#f59e0b", wash: "rgba(245,158,11,0.12)" },
  watchlist_add:    { icon: ShoppingCart,  color: "#a78bfa", wash: "rgba(167,139,250,0.12)" },
  watchlist_remove: { icon: Trash2,        color: "#a78bfa", wash: "rgba(167,139,250,0.12)" },
  market_event:     { icon: Newspaper,     color: "#ef4444", wash: "rgba(239,68,68,0.12)" },
  decision:         { icon: TrendingUp,    color: "#22c55e", wash: "rgba(34,197,94,0.12)" },
};

function EventLine({ ev, showTicker }: { ev: GraphEvent; showTicker?: boolean }) {
  const { t } = useTranslation();
  const meta = EVENT_META[ev.event_type] ?? EVENT_META.question;
  const Icon = ev.event_type === "decision" && ev.payload?.action === "sell" ? TrendingDown : meta.icon;
  const payload = ev.payload || {};

  let title = "";
  let detail = "";
  switch (ev.event_type) {
    case "question":
      title = t("investmentGraph.event.question");
      detail = payload.question || "";
      break;
    case "thesis":
      title = t("investmentGraph.event.thesis");
      detail = payload.margin_of_safety_pct != null
        ? t("investmentGraph.event.thesisDetail", { mos: payload.margin_of_safety_pct, score: payload.composite_score ?? "—" })
        : "";
      break;
    case "watchlist_add":
      title = t("investmentGraph.event.watchlistAdd");
      break;
    case "watchlist_remove":
      title = t("investmentGraph.event.watchlistRemove");
      break;
    case "market_event":
      title = payload.kind === "earnings"
        ? (payload.beat_eps ? t("investmentGraph.event.earningsBeat") : t("investmentGraph.event.earningsMiss"))
        : t("investmentGraph.event.marketEvent");
      break;
    case "decision":
      title = payload.action === "buy" ? t("investmentGraph.event.decisionBuy") : payload.action === "sell" ? t("investmentGraph.event.decisionSell") : t("investmentGraph.event.decisionOther");
      detail = payload.notes || "";
      break;
  }

  return (
    <div className="flex items-start gap-3 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: meta.wash }}>
        <Icon className="w-4 h-4" style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: "var(--text)" }}>{title}</span>
          {showTicker && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--raised)", color: "var(--muted)" }}>
              {ev.ticker}
            </span>
          )}
        </div>
        {detail && <p className="text-xs mt-0.5 truncate" style={{ color: "var(--sub)" }}>{detail}</p>}
      </div>
      <span className="text-[10px] shrink-0" style={{ color: "var(--dim)" }}>
        {ev.occurred_at ? new Date(ev.occurred_at).toLocaleDateString("es-MX") : ""}
      </span>
    </div>
  );
}

interface Props {
  events: GraphEvent[];
  loading?: boolean;
  showTicker?: boolean;
  emptyLabel?: string;
}

export default function InvestmentGraphTimeline({ events, loading, showTicker, emptyLabel }: Props) {
  const { t } = useTranslation();
  if (loading) {
    return <p className="text-xs text-center py-8" style={{ color: "var(--muted)" }}>{t("investmentGraph.loading")}</p>;
  }
  if (!events.length) {
    return <p className="text-xs text-center py-8" style={{ color: "var(--muted)" }}>{emptyLabel ?? t("investmentGraph.empty")}</p>;
  }
  return (
    <div>
      {events.map((ev, i) => (
        <EventLine key={ev.id ?? i} ev={ev} showTicker={showTicker} />
      ))}
    </div>
  );
}
