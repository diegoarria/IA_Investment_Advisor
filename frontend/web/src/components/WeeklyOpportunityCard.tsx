"use client";

import { useTranslation } from "react-i18next";
import StockAvatar from "@/components/StockAvatar";

// Diego, 2026-09-24: "mejores el diseño x10000, agregues logos de las
// empresas, nombres, tickers, escenarios pesimistas, base y optimista."
// Shared by /screener (the full page) and WeeklyScreenerCard (the modal in
// Portafolio) so both surfaces of "el único" Screener Semanal render the
// exact same real numbers, the exact same way — never two different-
// looking cards for the same 5 picks.
export interface WeeklyOpportunity {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  intrinsic_value_base: number | null;
  intrinsic_value_conservative: number | null;
  intrinsic_value_optimistic: number | null;
  margin_of_safety_pct: number | null;
  thesis_scores: Record<string, number> | null;
}

function fmt(v: number | null | undefined): string {
  return v != null ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—";
}

export default function WeeklyOpportunityCard({ pick, rank }: { pick: WeeklyOpportunity; rank: number }) {
  const { t } = useTranslation();
  const mos = pick.margin_of_safety_pct;
  const bq = pick.thesis_scores?.business_quality;
  const hasScenarios = pick.intrinsic_value_conservative != null || pick.intrinsic_value_optimistic != null;

  return (
    <div className="p-3.5" style={{ background: "var(--card)" }}>
      {/* Header: logo, ticker/name, margin of safety */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-black w-3.5 text-center shrink-0" style={{ color: "var(--dim)" }}>{rank}</span>
        <StockAvatar ticker={pick.ticker} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-black text-sm" style={{ color: "var(--text)" }}>{pick.ticker}</span>
            {pick.company_name && (
              <span className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{pick.company_name}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {pick.sector && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--raised)", color: "var(--muted)" }}>
                {pick.sector}
              </span>
            )}
            {bq != null && (
              <span className="text-[9px] font-semibold" style={{ color: "var(--sub)" }}>
                Business Quality {bq}/100
              </span>
            )}
          </div>
        </div>
        {mos != null && (
          <span className="shrink-0 text-xs font-black px-2.5 py-1.5 rounded-xl"
                style={{ background: "rgba(34,197,94,0.14)", color: "#22c55e" }}>
            +{mos.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Current price + 3 scenarios */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--dim)" }}>
            {t("weeklyOpportunityCard.priceNow")}
          </p>
          <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{fmt(pick.price)}</p>
        </div>
        {hasScenarios ? (
          <div className="flex-1 grid grid-cols-3 gap-1.5 max-w-[70%]">
            <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "var(--raised)" }}>
              <p className="text-[8px] font-bold uppercase tracking-wide truncate" style={{ color: "#f87171" }}>
                {t("subvaluadas.scenarios.pessimistic")}
              </p>
              <p className="text-[11px] font-bold" style={{ color: "var(--text)" }}>{fmt(pick.intrinsic_value_conservative)}</p>
            </div>
            <div className="rounded-lg px-2 py-1.5 text-center border" style={{ background: "rgba(0,168,94,0.08)", borderColor: "rgba(0,168,94,0.3)" }}>
              <p className="text-[8px] font-bold uppercase tracking-wide truncate" style={{ color: "var(--accent-l)" }}>
                {t("subvaluadas.scenarios.base")}
              </p>
              <p className="text-[11px] font-black" style={{ color: "var(--accent-l)" }}>{fmt(pick.intrinsic_value_base)}</p>
            </div>
            <div className="rounded-lg px-2 py-1.5 text-center" style={{ background: "var(--raised)" }}>
              <p className="text-[8px] font-bold uppercase tracking-wide truncate" style={{ color: "#4ade80" }}>
                {t("subvaluadas.scenarios.optimistic")}
              </p>
              <p className="text-[11px] font-bold" style={{ color: "var(--text)" }}>{fmt(pick.intrinsic_value_optimistic)}</p>
            </div>
          </div>
        ) : (
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--dim)" }}>
              {t("weeklyOpportunityCard.intrinsicValue")}
            </p>
            <p className="text-sm font-bold" style={{ color: "var(--accent-l)" }}>{fmt(pick.intrinsic_value_base)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
