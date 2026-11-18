"use client";

// Universal (ticker-agnostic) dev-only prototype route — Nuvos Radar 2.0,
// Fase 6 ("Riesgos a vigilar"), split out of the former combined Fase 5.
// NOT linked from any real navigation, NOT a production route.
//
// Diego, 2026-11-17: all 5 pilots are now published+is_current in
// Supabase, so the earlier local-fixture special case was removed. Every
// ticker goes through the real public editorial endpoint, which only ever
// returns published+current content or null. Local fixtures remain in
// previewContent/*.json for tests/explicit dev use only.

import { use, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { screenerApi, qualitativeContentApi } from "@/lib/api";
import { isFullDiagnostic, type CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";
import { VigilarRiesgosPreview } from "@/components/subvaluadas/VigilarRiesgosPreview";
import { type QualitativeContentDraft } from "@/components/subvaluadas/ResumenPreview";
import { DegradedTickerCard } from "@/components/subvaluadas/DegradedTickerCard";

import msftDraft from "@/lib/previewContent/msft.json";
import amznDraft from "@/lib/previewContent/amzn.json";
import vDraft from "@/lib/previewContent/v.json";
import metaDraft from "@/lib/previewContent/meta.json";
import meliDraft from "@/lib/previewContent/meli.json";

const COHORTE_2_LOCAL: Record<string, { business_model_summary?: string; moat?: unknown[]; risks?: unknown[] }> = {
  MSFT: msftDraft,
  AMZN: amznDraft,
  V: vDraft,
  META: metaDraft,
  MELI: meliDraft,
};


export default function VigilarRiesgosPreviewPage({ params }: { params: Promise<{ ticker: string }> }) {
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

    const local = COHORTE_2_LOCAL[ticker];
    if (local) {
      setEditorial({
        ticker,
        review_status: "draft",
        is_current: false,
        business_model_summary: local.business_model_summary ?? "",
        moat: (local.moat ?? []) as QualitativeContentDraft["moat"],
        risks: (local.risks ?? []) as QualitativeContentDraft["risks"],
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
          /* Editorial read failure never blocks the financial ficha — the
             real-world normal case for any ticker without a published
             editorial version yet (no longer special-cased: every ticker,
             including the 5 pilots, now goes through this same real public
             endpoint, 2026-11-17). */
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
      {data && isFullDiagnostic(data) && <VigilarRiesgosPreview data={data} editorial={editorial} />}
      {data && !isFullDiagnostic(data) && <DegradedTickerCard data={data} ticker={ticker} />}
    </div>
  );
}
