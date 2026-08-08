"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, ChevronDown } from "lucide-react";
import { screenerApi } from "@/lib/api";
import StockAvatar from "@/components/StockAvatar";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";

interface ConfidenceMeter {
  score: number | null;
  label: string | null;
  stars: number | null;
}

interface OpportunityCandidate {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  margin_of_safety_pct: number | null;
  market_cap: number | null;
  confidence_meter: ConfidenceMeter | null;
  featured: boolean;
}

type SortKey = "mos_desc" | "mos_asc" | "market_cap_desc" | "market_cap_asc" | "confidence_desc" | "confidence_asc";

const SORTERS: Record<SortKey, (a: OpportunityCandidate, b: OpportunityCandidate) => number> = {
  mos_desc: (a, b) => (b.margin_of_safety_pct ?? -Infinity) - (a.margin_of_safety_pct ?? -Infinity),
  mos_asc: (a, b) => (a.margin_of_safety_pct ?? Infinity) - (b.margin_of_safety_pct ?? Infinity),
  market_cap_desc: (a, b) => (b.market_cap ?? -Infinity) - (a.market_cap ?? -Infinity),
  market_cap_asc: (a, b) => (a.market_cap ?? Infinity) - (b.market_cap ?? Infinity),
  confidence_desc: (a, b) => (b.confidence_meter?.score ?? -Infinity) - (a.confidence_meter?.score ?? -Infinity),
  confidence_asc: (a, b) => (a.confidence_meter?.score ?? Infinity) - (b.confidence_meter?.score ?? Infinity),
};

function fmtMarketCap(v: number | null): string {
  if (!v) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

function confidenceColor(score: number | null): string {
  if (score === null) return "var(--muted)";
  if (score >= 70) return "#22c55e";
  if (score >= 45) return "#f59e0b";
  return "#ef4444";
}

const PAGE_SIZE = 24;

// The Oportunidades landing panel — a real, browsable list across the full
// S&P 500 (see undervalued_screener_service.py's `browse` mode), not just
// the ~5/sector "featured" picks. Sits above the single-ticker search on
// /subvaluadas so "Oportunidades" is a screener first, a search second.
export function OpportunitiesListPanel() {
  const { t, i18n } = useTranslation();
  const [candidates, setCandidates] = useState<OpportunityCandidate[]>([]);
  const [generatedAt, setGeneratedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sector, setSector] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("mos_desc");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    screenerApi.getUndervalued(undefined, 500, i18n.language, true)
      .then((res) => {
        if (cancelled) return;
        setCandidates(res.data?.results || []);
        setGeneratedAt(res.data?.generated_at || 0);
      })
      .catch(() => { if (!cancelled) setCandidates([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [i18n.language]);

  const sectors = useMemo(() => {
    const set = new Set<string>();
    candidates.forEach((c) => c.sector && set.add(c.sector));
    return Array.from(set).sort();
  }, [candidates]);

  const filtered = useMemo(() => {
    let list = candidates;
    if (sector) list = list.filter((c) => c.sector === sector);
    return [...list].sort(SORTERS[sortKey]);
  }, [candidates, sector, sortKey]);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [sector, sortKey]);

  const goToTicker = (ticker: string) => {
    window.location.href = `/subvaluadas?ticker=${encodeURIComponent(ticker)}`;
  };

  return (
    <div className="mb-8">
      <SectionHeader
        title={t("subvaluadas.opportunities.title")}
        subtitle={
          t("subvaluadas.opportunities.subtitle") +
          (generatedAt > 0 ? " " + t("subvaluadas.opportunities.updated", {
            date: new Date(generatedAt * 1000).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long" }),
          }) : "")
        }
      />

      {!loading && candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative">
            <select
              value={sector}
              onChange={(e) => {
                const next = e.target.value;
                setSector(next);
                // Entering a sector is a "show me everything here, biggest
                // first" action — auto-switch to market-cap-desc so the
                // user doesn't have to configure two dropdowns to get that.
                // Clearing back to "all sectors" returns to the default
                // best-opportunities-first sort.
                setSortKey(next ? "market_cap_desc" : "mos_desc");
              }}
              className="appearance-none text-xs font-medium rounded-lg pl-3 pr-7 py-2 border outline-none"
              style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--text)" }}
            >
              <option value="">{t("subvaluadas.opportunities.sectorAll")}</option>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--muted)" }} />
          </div>
          <div className="relative">
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="appearance-none text-xs font-medium rounded-lg pl-3 pr-7 py-2 border outline-none"
              style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--text)" }}
            >
              {(Object.keys(SORTERS) as SortKey[]).map((k) => (
                <option key={k} value={k}>{t(`subvaluadas.opportunities.sort.${k}`)}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--muted)" }} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
          <p className="text-xs" style={{ color: "var(--muted)" }}>{t("subvaluadas.opportunities.loading")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <p className="text-xs" style={{ color: "var(--muted)" }}>{t("subvaluadas.opportunities.empty")}</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.slice(0, visibleCount).map((c) => {
              const conf = c.confidence_meter;
              const mos = c.margin_of_safety_pct;
              return (
                <button key={c.ticker} onClick={() => goToTicker(c.ticker)} className="text-left transition-all duration-200 hover:opacity-90">
                  <Card padding="p-4">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="shrink-0"><StockAvatar ticker={c.ticker} size="sm" /></div>
                        <div className="min-w-0">
                          <p className="text-sm font-black truncate" style={{ color: "var(--text)" }}>{c.ticker}</p>
                          <p className="text-[10.5px] truncate" style={{ color: "var(--muted)" }}>{c.company_name ?? c.sector ?? ""}</p>
                        </div>
                      </div>
                      {c.price !== null && (
                        <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: "var(--text)" }}>${c.price.toFixed(2)}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                      <div>
                        <p className="text-[9.5px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.opportunities.marginOfSafety")}</p>
                        <p className="text-[13px] font-black tabular-nums" style={{ color: "#22c55e" }}>{mos !== null ? `+${mos.toFixed(0)}%` : "—"}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9.5px]" style={{ color: "var(--muted)" }}>{fmtMarketCap(c.market_cap)}</p>
                        {conf?.score !== null && conf?.score !== undefined && (
                          <p className="text-[11px] font-bold tabular-nums" style={{ color: confidenceColor(conf.score) }}>
                            {t("subvaluadas.opportunities.confidence")}: {conf.score}
                          </p>
                        )}
                      </div>
                    </div>
                  </Card>
                </button>
              );
            })}
          </div>
          {visibleCount < filtered.length && (
            <div className="flex justify-center mt-4">
              <button
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                className="text-xs font-bold px-4 py-2 rounded-lg border"
                style={{ borderColor: "var(--border)", color: "var(--sub)" }}
              >
                {t("subvaluadas.opportunities.seeMore")} ({filtered.length - visibleCount})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
