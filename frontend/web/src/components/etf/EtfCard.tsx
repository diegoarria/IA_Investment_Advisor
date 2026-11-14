"use client";

// Nuvos ETF — enriched card, Fase 2B redesign. Reused by the Explorer's
// category view, discovery section, and search results — one place to
// keep "what a card looks like" consistent.

import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { ChevronRight, AlertTriangle } from "lucide-react";
import { GlowCard } from "@/components/subvaluadas/radarUi";
import { ExplainableValue } from "@/components/ui/ExplainableValue";
import StockAvatar from "@/components/StockAvatar";
// Fase 7.2 (Diego, captura real): verde de marca de la plataforma, no
// el dorado de Radar — mismo criterio ya aplicado al Portafolio
// unificado (ver PortfolioDistribution.tsx).
const GOLD = "#00e887";

export type EtfCardData = {
  ticker: string;
  name: string;
  short_description: string | null;
  has_editorial_description?: boolean;
  dominant_sector: string | null;
  expense_ratio_pct: number | null;
  cost_tier: string | null;
  etf_company: string | null;
  available?: boolean;
  reason?: string;
};

const COST_TIER_LABEL_KEY: Record<string, string> = {
  muy_bajo: "etf.detail.costs.tier.muy_bajo", bajo: "etf.detail.costs.tier.bajo",
  moderado: "etf.detail.costs.tier.moderado", alto: "etf.detail.costs.tier.alto",
};

export function EtfCardSkeleton() {
  return (
    <GlowCard className="animate-pulse">
      <div className="h-4 w-20 rounded mb-2" style={{ background: "var(--raised)" }} />
      <div className="h-3 w-full rounded mb-1.5" style={{ background: "var(--raised)" }} />
      <div className="h-3 w-3/4 rounded" style={{ background: "var(--raised)" }} />
    </GlowCard>
  );
}

export function EtfCard({ card }: { card: EtfCardData }) {
  const { t } = useTranslation();
  const router = useRouter();

  if (card.available === false) {
    return (
      <GlowCard className="opacity-70">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--muted)" }} />
          <span className="text-sm font-bold" style={{ color: "var(--text)" }}>{card.ticker}</span>
        </div>
        <p className="text-[12px]" style={{ color: "var(--sub)" }}>{t("etf.explorer.cardUnavailable")}</p>
      </GlowCard>
    );
  }

  return (
    <button onClick={() => router.push(`/etf/${card.ticker}`)} className="text-left w-full">
      <GlowCard className="h-full flex flex-col transition-transform hover:-translate-y-0.5" tint={GOLD}>
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <StockAvatar ticker={card.ticker} size="sm" />
            <div className="min-w-0">
              {/* Diego, 2026-11 (rediseño): hasta 2 líneas en vez de
                  truncar a mitad de palabra — "Vanguard Total
                  International Stock..." ya no se corta. */}
              <p className="text-[15px] font-black tracking-tight leading-snug line-clamp-2" style={{ color: "var(--text)" }}>{card.name}</p>
              <p className="text-[12px] font-semibold" style={{ color: GOLD }}>{card.ticker}</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 shrink-0 mt-1" style={{ color: "var(--muted)" }} />
        </div>
        {card.short_description && (
          <p className="text-[12.5px] leading-relaxed mb-2" style={{ color: "var(--sub)" }}>
            {card.short_description}
          </p>
        )}
        {card.dominant_sector && (
          <p className="text-[11.5px] mb-3 flex-1" style={{ color: "var(--sub)" }}>
            {t("etf.explorer.dominantSectorLabel")}: <span style={{ color: "var(--text)" }}>{card.dominant_sector}</span>
          </p>
        )}
        {!card.short_description && !card.dominant_sector && <div className="flex-1" />}
        <div className="flex items-center gap-3 text-[12px] pt-2 mt-auto" style={{ borderTop: "1px solid var(--border)" }}>
          {card.expense_ratio_pct != null && (
            <ExplainableValue label={t("etf.explorer.expenseRatioLabel")} content={{ summary: t("etf.explorer.expenseRatioExplainer") }}>
              <span style={{ color: "var(--text)" }}>
                <b>{card.expense_ratio_pct.toFixed(2)}%</b>
                {card.cost_tier && <span style={{ color: "var(--sub)" }}> · {t(COST_TIER_LABEL_KEY[card.cost_tier] || card.cost_tier)}</span>}
              </span>
            </ExplainableValue>
          )}
          {card.etf_company && (
            <span className="truncate" style={{ color: "var(--sub)" }}>{card.etf_company}</span>
          )}
        </div>
      </GlowCard>
    </button>
  );
}
