"use client";

// Fase 4, Incremento 4 — Comparaciones (Parte D). A visual (bar chart, not
// a table) comparison against real peers — reuses Fase 2's Peer Comparison
// Engine data (nifData.peer_comparison, already fetched by this page) and
// the company's own real metrics (business_quality pillar's data bucket).
// Row-building logic lives in src/lib/peerComparison.ts (pure, unit
// tested); this file is purely presentational.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, SectionHeader } from "@/components/ui";
import { buildRows, METRICS, type CompanyComparisonMetrics, type MetricKey } from "@/lib/peerComparison";
import type { NifPeerComparisonData } from "./shared";

export type { CompanyComparisonMetrics };

export function PeerComparisonChart({
  ticker, companyMetrics, peerComparison,
}: {
  ticker: string;
  companyMetrics: CompanyComparisonMetrics;
  peerComparison: NifPeerComparisonData | null;
}) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<MetricKey>("quality_score");

  if (!peerComparison || peerComparison.quality_score_percentile === null) return null;

  const rows = buildRows(ticker, companyMetrics, peerComparison.peer_quality_scores, metric);
  const maxValue = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const activeMetric = METRICS.find((m) => m.key === metric)!;

  return (
    <Card className="mb-6">
      <SectionHeader
        title={t("subvaluadas.comparisons.title")}
        subtitle={t("subvaluadas.comparisons.subtitle", {
          rank: peerComparison.quality_score_rank, count: peerComparison.peer_count + 1,
        })}
      />

      <div className="flex flex-wrap gap-1.5 mb-4" role="tablist" aria-label={t("subvaluadas.comparisons.title")}>
        {METRICS.map((m) => {
          const active = m.key === metric;
          return (
            <button
              key={m.key}
              role="tab"
              aria-selected={active}
              onClick={() => setMetric(m.key)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors"
              style={{ background: active ? "var(--accent)" : "var(--raised)", color: active ? "#0A0F1A" : "var(--muted)" }}
            >
              {t(m.labelKey)}
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.ticker} className="flex items-center gap-2">
            <span
              className="text-[11px] font-bold w-14 shrink-0 truncate"
              style={{ color: row.isCompany ? "var(--accent-l)" : "var(--sub)" }}
            >
              {row.ticker}
            </span>
            <div className="flex-1 h-4 rounded" style={{ background: "var(--raised)" }}>
              <div
                className="h-full rounded"
                style={{
                  width: `${Math.max(2, (Math.abs(row.value) / maxValue) * 100)}%`,
                  background: row.isCompany ? "var(--accent)" : "var(--border-s, var(--border))",
                }}
              />
            </div>
            <span
              className="text-[11px] font-bold tabular-nums w-14 text-right shrink-0"
              style={{ color: row.isCompany ? "var(--accent-l)" : "var(--muted)" }}
            >
              {row.value.toFixed(1)}{activeMetric.suffix}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[10px]" style={{ color: "var(--muted)" }}>
        {t("subvaluadas.comparisons.footnote")}
      </p>
    </Card>
  );
}
