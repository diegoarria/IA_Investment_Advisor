"use client";

// Universal (ticker-agnostic) dev-only prototype route — Nuvos Radar 2.0,
// Fase 5 ("Entender la valuación"). NOT linked from any real navigation,
// NOT a production route. Diego, 2026-11-15.
//
// Fase 5 is valuation-only now (Diego, 2026-11-15: split the risk subset
// out into its own phase, VigilarRiesgosPreview/riesgos-a-vigilar) — this
// route no longer needs any editorial-content fetch at all, only the real
// financial-diagnostic data Valuación itself already consumes.

import { use, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { screenerApi } from "@/lib/api";
import { isFullDiagnostic, type CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";
import { EntenderValuacionPreview } from "@/components/subvaluadas/EntenderValuacionPreview";
import { DegradedTickerCard } from "@/components/subvaluadas/DegradedTickerCard";

export default function EntenderValuacionPreviewPage({ params }: { params: Promise<{ ticker: string }> }) {
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
      {data && isFullDiagnostic(data) && <EntenderValuacionPreview data={data} />}
      {data && !isFullDiagnostic(data) && <DegradedTickerCard data={data} ticker={ticker} />}
    </div>
  );
}
