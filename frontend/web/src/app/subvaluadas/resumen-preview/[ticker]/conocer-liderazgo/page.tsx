"use client";

// Universal (ticker-agnostic) dev-only prototype route — Nuvos Radar 2.0,
// Fase 3 ("Conocer a quienes dirigen"). NOT linked from any real
// navigation, NOT a production route. Diego, 2026-11-15.
//
// Diego, 2026-11-17: all 5 pilots (GOOGL/COST/JPM/NVDA/MCD) are now
// published+is_current in Supabase (migration 126 added a nullable
// `leadership` column to company_qualitative_content, 2026-11-16) — the
// earlier local-fixture special case for exactly those 5 was removed.
// Every ticker now goes through the real public editorial endpoint, which
// only ever returns published+current content or null. Local fixtures
// remain in previewContent/leadership/*.json for tests/explicit dev use
// only — never auto-loaded by this routing logic anymore.

import { use, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { screenerApi, qualitativeContentApi } from "@/lib/api";
import { isFullDiagnostic, type CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";
import { ConocerLiderazgoPreview } from "@/components/subvaluadas/ConocerLiderazgoPreview";
import { DegradedTickerCard } from "@/components/subvaluadas/DegradedTickerCard";

import msftLeadership from "@/lib/previewContent/leadership/msft.json";
import amznLeadership from "@/lib/previewContent/leadership/amzn.json";
import vLeadership from "@/lib/previewContent/leadership/v.json";
import metaLeadership from "@/lib/previewContent/leadership/meta.json";
import meliLeadership from "@/lib/previewContent/leadership/meli.json";

const COHORTE_2_LEADERSHIP: Record<string, unknown> = {
  MSFT: msftLeadership,
  AMZN: amznLeadership,
  V: vLeadership,
  META: metaLeadership,
  MELI: meliLeadership,
};


export default function ConocerLiderazgoPreviewPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = use(params);
  const ticker = rawTicker.toUpperCase();
  const { i18n } = useTranslation();
  const [data, setData] = useState<CompanyDiagnosticData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leadership, setLeadership] = useState<unknown | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setLeadership(null);

    screenerApi
      .companyDiagnosticPublic(ticker, "dev-preview-local", i18n.language)
      .then((res) => {
        if (!cancelled) setData(res.data as CompanyDiagnosticData);
      })
      .catch(() => {
        if (!cancelled) setError(`No se pudo cargar el diagnóstico financiero real de ${ticker}.`);
      });

    const local = COHORTE_2_LEADERSHIP[ticker];
    if (local) {
      setLeadership(local);
    } else {
      qualitativeContentApi
        .get(ticker)
        .then((res) => {
          if (cancelled) return;
          const body = res.data as { leadership?: unknown } | null;
          if (body?.leadership) setLeadership(body.leadership);
        })
        .catch(() => {
          /* No leadership research yet for this ticker — honest empty state, never a blocker. */
        });
    }

    return () => {
      cancelled = true;
    };
  }, [ticker, i18n.language]);

  return (
    <div className="h-screen overflow-y-auto px-4 py-8" style={{ background: "var(--bg)" }}>
      {error && <p className="text-center text-sm" style={{ color: "#ef4444" }}>{error}</p>}
      {!data && !error && (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--muted)" }} />
        </div>
      )}
      {data && isFullDiagnostic(data) && (
        <ConocerLiderazgoPreview data={data} leadership={leadership as Parameters<typeof ConocerLiderazgoPreview>[0]["leadership"]} />
      )}
      {data && !isFullDiagnostic(data) && <DegradedTickerCard data={data} ticker={ticker} />}
    </div>
  );
}
