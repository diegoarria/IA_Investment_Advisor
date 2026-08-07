"use client";

import { useTranslation } from "react-i18next";
import { Calculator } from "lucide-react";
import StockAvatar from "@/components/StockAvatar";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";

export interface DiscoverCandidate {
  ticker: string;
  company_name: string | null;
  price: number;
  fair_value: number;
  pct: number;
  verdict: "undervalued" | "overvalued" | "fair";
}

function _verdictStyle(verdict: DiscoverCandidate["verdict"]): { bg: string; fg: string } {
  if (verdict === "undervalued") return { bg: "rgba(34,197,94,0.12)", fg: "#16803d" };
  if (verdict === "overvalued") return { bg: "rgba(232,131,122,0.18)", fg: "#b3462f" };
  return { bg: "var(--raised)", fg: "var(--sub)" };
}

// Real "Descubre más" pattern — a grid of 4 clickable candidate cards that
// hard-navigate to that ticker's own /subvaluadas detail. Originally built
// inside ValuationBacktestPanel.tsx (bottom of every ticker page); extracted
// here so OpportunitiesListPanel can reuse the exact same component instead
// of a second implementation drifting out of sync with this one.
export function DiscoverMorePanel({ candidates }: { candidates: DiscoverCandidate[] }) {
  const { t } = useTranslation();

  // Full navigation, not router.push — /subvaluadas only reads its
  // `?ticker=` search param once, at mount (see page.tsx), so pushing a new
  // value while already on this page would silently leave the old ticker
  // displayed. A hard navigation is the simple, correct fix for this one
  // same-page-to-same-page link, without touching that page's existing
  // (separately tested) search-param-handling logic.
  const goToTicker = (ticker: string) => {
    window.location.href = `/subvaluadas?ticker=${encodeURIComponent(ticker)}`;
  };

  return (
    <div className="mt-8">
      <SectionHeader title={t("subvaluadas.backtest.discoverMore")} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        {candidates.slice(0, 4).map((c) => {
          const { bg, fg } = _verdictStyle(c.verdict);
          return (
            <button key={c.ticker} onClick={() => goToTicker(c.ticker)} className="text-left transition-all duration-200 hover:opacity-90">
              <Card padding="p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black truncate" style={{ color: "var(--text)" }}>{c.ticker}</p>
                    <p className="text-[10.5px] truncate" style={{ color: "var(--muted)" }}>{c.company_name ?? c.ticker}</p>
                  </div>
                  <div className="shrink-0"><StockAvatar ticker={c.ticker} size="sm" /></div>
                </div>
                <div className="flex items-center gap-1.5 pt-3 border-t mb-3" style={{ borderColor: "var(--border)" }}>
                  <Calculator className="w-3 h-3 shrink-0" style={{ color: "var(--muted)" }} />
                  <span className="text-[10px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.backtest.dcfValue")}</span>
                  <span className="text-[12.5px] font-bold tabular-nums ml-auto" style={{ color: "var(--text)" }}>${c.fair_value.toFixed(2)}</span>
                </div>
                <div className="text-center text-[11px] font-bold rounded-lg px-2 py-2" style={{ background: bg, color: fg }}>
                  {t(`subvaluadas.backtest.verdict.${c.verdict}`, { pct: c.pct.toFixed(0) })}
                </div>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
