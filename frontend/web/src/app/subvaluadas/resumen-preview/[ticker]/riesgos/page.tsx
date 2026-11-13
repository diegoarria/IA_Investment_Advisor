"use client";

// Universal (ticker-agnostic) dev-only prototype route — Nuvos Radar
// "Riesgos" tab, first functional version. NOT linked from any real
// navigation, NOT a production route. Diego, 2026-11-12.
//
// Same dual editorial-source pattern already used by the Resumen route
// (`[ticker]/page.tsx`) — copied deliberately rather than abstracted into a
// shared hook, to avoid touching that file's own data-loading logic:
//   1. The 5 pilot tickers (GOOGL/COST/JPM/NVDA/MCD) still have DRAFT-only
//      content in Supabase — this route reads the local JSON fixture for
//      exactly those 5, never the real public editorial endpoint.
//   2. Every other ticker goes through the real public endpoint
//      (`qualitativeContentApi.get`), which only ever returns
//      published+is_current content, or null. Null renders the honest
//      empty state inside RiesgosPreview, never an error.
//
// Financial data (for the header: name/ticker/sector/price, and so the
// TabNav can render) is the same real, public, no-auth company-diagnostic
// endpoint Resumen/Valuación already use.

import { use, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { screenerApi, qualitativeContentApi } from "@/lib/api";
import { isFullDiagnostic, type CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";
import { RiesgosPreview } from "@/components/subvaluadas/RiesgosPreview";
import { type QualitativeContentDraft } from "@/components/subvaluadas/ResumenPreview";
import { DegradedTickerCard } from "@/components/subvaluadas/DegradedTickerCard";

const _LOCAL_DRAFT_TICKERS: Record<string, () => Promise<{ default: QualitativeContentDraft }>> = {
  GOOGL: () => import("@/lib/previewContent/googl_v3.json") as unknown as Promise<{ default: QualitativeContentDraft }>,
  COST: () => import("@/lib/previewContent/cost.json") as unknown as Promise<{ default: QualitativeContentDraft }>,
  JPM: () => import("@/lib/previewContent/jpm.json") as unknown as Promise<{ default: QualitativeContentDraft }>,
  NVDA: () => import("@/lib/previewContent/nvda.json") as unknown as Promise<{ default: QualitativeContentDraft }>,
  MCD: () => import("@/lib/previewContent/mcd.json") as unknown as Promise<{ default: QualitativeContentDraft }>,
};

export default function RiesgosPreviewPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = use(params);
  const ticker = rawTicker.toUpperCase();
  const { i18n } = useTranslation();
  const [data, setData] = useState<CompanyDiagnosticData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorial, setEditorial] = useState<QualitativeContentDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setEditorial(null);

    screenerApi
      .companyDiagnosticPublic(ticker, "dev-preview-local", i18n.language)
      .then((res) => {
        if (!cancelled) setData(res.data as CompanyDiagnosticData);
      })
      .catch(() => {
        if (!cancelled) setError(`No se pudo cargar el diagnóstico financiero real de ${ticker}.`);
      });

    const localLoader = _LOCAL_DRAFT_TICKERS[ticker];
    if (localLoader) {
      localLoader()
        .then((mod) => {
          if (!cancelled) setEditorial(mod.default);
        })
        .catch(() => {
          /* Editorial read failure never blocks the financial ficha. */
        });
    } else {
      qualitativeContentApi
        .get(ticker)
        .then((res) => {
          if (cancelled) return;
          const body = res.data;
          if (body) {
            setEditorial({
              ticker,
              review_status: "published",
              is_current: true,
              business_model_summary: body.business_model_summary ?? "",
              moat: body.moat ?? [],
              risks: body.risks ?? [],
            });
          }
        })
        .catch(() => {
          /* Real-world normal case today: no published editorial yet. */
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
      {data && isFullDiagnostic(data) && <RiesgosPreview data={data} editorial={editorial} />}
      {data && !isFullDiagnostic(data) && <DegradedTickerCard data={data} ticker={ticker} />}
    </div>
  );
}
