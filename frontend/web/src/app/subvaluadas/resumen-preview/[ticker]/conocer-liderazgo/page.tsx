"use client";

// Universal (ticker-agnostic) dev-only prototype route — Nuvos Radar 2.0,
// Fase 3 ("Conocer a quienes dirigen"). NOT linked from any real
// navigation, NOT a production route. Diego, 2026-11-15.
//
// GOOGL is the only pilot with real, sourced leadership research this
// round — every other ticker gets the component's own honest empty state
// (never a copy of GOOGL's CEO/decisions/figures).

import { use, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { screenerApi } from "@/lib/api";
import { isFullDiagnostic, type CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";
import { ConocerLiderazgoPreview } from "@/components/subvaluadas/ConocerLiderazgoPreview";
import { DegradedTickerCard } from "@/components/subvaluadas/DegradedTickerCard";

const _LOCAL_LEADERSHIP_TICKERS: Record<string, () => Promise<{ default: unknown }>> = {
  GOOGL: () => import("@/lib/previewContent/leadership/googl.json"),
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

    const localLoader = _LOCAL_LEADERSHIP_TICKERS[ticker];
    if (localLoader) {
      localLoader()
        .then((mod) => {
          if (!cancelled) setLeadership(mod.default);
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
