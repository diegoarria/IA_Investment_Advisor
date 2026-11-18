"use client";

// Universal (ticker-agnostic) dev-only prototype route — Nuvos Radar
// "Riesgos" tab, first functional version. NOT linked from any real
// navigation, NOT a production route. Diego, 2026-11-12.
//
// Diego, 2026-11-17: all 5 pilots (GOOGL/COST/JPM/NVDA/MCD) are now
// published+is_current in Supabase, so the earlier local-fixture special
// case for exactly those 5 was removed. Every ticker now goes through the
// real public endpoint (`qualitativeContentApi.get`), which only ever
// returns published+is_current content, or null. Null renders the honest
// empty state inside RiesgosPreview, never an error. Local fixtures remain
// in previewContent/*.json for tests/explicit dev use only — never
// auto-loaded here anymore.
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
        /* Editorial read failure never blocks the financial ficha — the
           real-world normal case for any ticker without a published
           editorial version yet (no longer special-cased: every ticker,
           including the 5 pilots, now goes through this same real public
           endpoint, 2026-11-17). */
      });

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
