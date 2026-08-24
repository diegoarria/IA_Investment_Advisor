"use client";

// "Vs. tu sector" — Diego's request (2026-08-21): a raw metric like
// "ROIC 39.7%" means nothing to someone who doesn't already know what's
// normal for that industry. Same real-peer-median discipline as
// CompanyDiagnosticCompetitorTable ("Duelo de Titanes") right below this
// in the Quality pillar — same table/duel-card visual language — except
// against the MEDIAN of several real same-industry peers instead of one
// named competitor. `delta`/`deltaLabel` are precomputed server-side
// (company_diagnostic_service._sector_delta), never guessed here from the
// formatted strings.

import { useTranslation } from "react-i18next";
import { RaisedBlock } from "@/components/ui/Card";
import type { SectorComparison } from "@/lib/types/companyDiagnostic";

const _DELTA_COLOR: Record<string, string> = {
  up: "#4FA695",
  down: "#DD6E63",
  flat: "var(--muted)",
};

function DeltaBadge({ delta, label }: { delta: SectorComparison["rows"][number]["delta"]; label: string }) {
  const color = delta ? _DELTA_COLOR[delta] : "var(--muted)";
  return (
    <span
      className="inline-flex items-center text-[11px] font-black px-2 py-0.5 rounded-lg ml-1.5 align-middle tabular-nums"
      style={{ color, background: delta === "flat" || !delta ? "var(--card)" : `${color}22` }}
    >
      {label}
    </span>
  );
}

export function CompanyDiagnosticSectorComparison({ comparison, ticker }: { comparison: SectorComparison; ticker: string }) {
  const { t } = useTranslation();
  const { sector, peerCount, peerTickers, rows, insight } = comparison;

  return (
    <div>
      <p className="text-[12.5px] mb-3.5 leading-relaxed" style={{ color: "var(--muted)" }}>
        {t("companyDiagnostic.pillars.quality.sectorComparisonSubtitle", { count: peerCount, sector, peers: peerTickers.slice(0, 4).join(", ") })}
      </p>

      {/* >=640px: real table */}
      <div className="hidden sm:block overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr style={{ background: "var(--card)" }}>
              <th className="px-3.5 py-2.5 text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}></th>
              <th className="px-3.5 py-2.5 text-[12px] font-bold uppercase tracking-wide text-right" style={{ color: "#4FA695" }}>{ticker}</th>
              <th className="px-3.5 py-2.5 text-[12px] font-bold uppercase tracking-wide text-right" style={{ color: "var(--muted)" }}>
                {t("companyDiagnostic.pillars.quality.sectorMedian")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.metricName} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="px-3.5 py-3 text-[14px] font-bold" style={{ color: "var(--text)" }}>{row.metricName}</td>
                <td className="px-3.5 py-3 text-[14.5px] font-black tabular-nums text-right" style={{ color: "#4FA695" }}>
                  {row.companyValue}
                  <DeltaBadge delta={row.delta} label={row.deltaLabel} />
                </td>
                <td className="px-3.5 py-3 text-[14.5px] tabular-nums text-right" style={{ color: "var(--sub)" }}>{row.sectorValue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* <640px: stacked duel cards, same pattern CompanyDiagnosticCompetitorTable uses */}
      <div className="sm:hidden space-y-2.5">
        {rows.map((row) => (
          <RaisedBlock key={row.metricName} style={{ background: "var(--card)" }}>
            <p className="text-[13px] font-bold mb-2" style={{ color: "var(--muted)" }}>{row.metricName}</p>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "#4FA695" }}>{ticker}</p>
                <p className="text-[15px] font-black tabular-nums" style={{ color: "var(--text)" }}>
                  {row.companyValue}
                  <DeltaBadge delta={row.delta} label={row.deltaLabel} />
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  {t("companyDiagnostic.pillars.quality.sectorMedian")}
                </p>
                <p className="text-[15px] font-bold tabular-nums" style={{ color: "var(--sub)" }}>{row.sectorValue}</p>
              </div>
            </div>
          </RaisedBlock>
        ))}
      </div>

      <div className="mt-3.5 rounded-xl p-3.5" style={{ background: "#4FA69518", border: "1px solid #4FA69555" }}>
        <p className="text-[10.5px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "#4FA695" }}>
          {t("companyDiagnostic.pillars.quality.sectorInsightLabel")}
        </p>
        <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--text)" }}>{insight}</p>
      </div>
    </div>
  );
}
