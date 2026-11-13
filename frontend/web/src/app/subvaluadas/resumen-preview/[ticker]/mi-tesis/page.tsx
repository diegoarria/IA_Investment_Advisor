"use client";

// Universal (ticker-agnostic) dev-only prototype route — Nuvos Radar
// "Mi tesis" tab. NOT linked from any real navigation, NOT a production
// route. Diego, 2026-11-12.
//
// Unlike Resumen/Valuación/Riesgos, this tab has no dependency on the
// qualitative-editorial-content system (`company_qualitative_content`) —
// it's the user's own input, not Nuvos editorial content — so there's no
// local-fixture-vs-public-endpoint branching here, only the same real,
// public, no-auth company-diagnostic call Resumen/Valuación/Riesgos already
// use for the shared header (name/ticker/sector/price) and TabNav.

import { use, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { screenerApi } from "@/lib/api";
import { isFullDiagnostic, type CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";
import { MiTesisPreview } from "@/components/subvaluadas/MiTesisPreview";
import { DegradedTickerCard } from "@/components/subvaluadas/DegradedTickerCard";

export default function MiTesisPreviewPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = use(params);
  const ticker = rawTicker.toUpperCase();
  const { i18n } = useTranslation();
  const [data, setData] = useState<CompanyDiagnosticData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);

    screenerApi
      .companyDiagnosticPublic(ticker, "dev-preview-local", i18n.language)
      .then((res) => {
        if (!cancelled) setData(res.data as CompanyDiagnosticData);
      })
      .catch(() => {
        if (!cancelled) setError(`No se pudo cargar el diagnóstico financiero real de ${ticker}.`);
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
      {data && isFullDiagnostic(data) && <MiTesisPreview data={data} />}
      {data && !isFullDiagnostic(data) && <DegradedTickerCard data={data} ticker={ticker} />}
    </div>
  );
}
