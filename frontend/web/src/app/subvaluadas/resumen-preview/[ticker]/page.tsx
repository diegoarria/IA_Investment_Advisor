"use client";

// Universal (ticker-agnostic) dev-only prototype route — Nuvos Radar
// "Resumen" redesign. NOT linked from any real navigation, NOT a production
// route in spirit. Diego, 2026-11-12: "Entiende primero. Profundiza cuando
// quieras" — generalized from the GOOGL-only prototype per his explicit
// "universalizar por ticker" directive on the same date.
//
// Financial data: REAL, fetched live from the existing PUBLIC (guest)
// company-diagnostic endpoint for WHATEVER ticker is in the URL — same
// real data the authenticated ficha uses, just the no-login path. Never
// fabricated, never hardcoded to one company.
//
// Editorial (qualitative) content has TWO distinct sources, and the ticker
// decides which one applies — never both:
//   1. The 5 pilot tickers (GOOGL/COST/JPM/NVDA/MCD) still have DRAFT-only
//      content in Supabase (review_status='draft', never published). For
//      exactly these 5, this dev route reads a LOCAL, validated JSON
//      fixture (frontend/web/src/lib/previewContent/<ticker>.json) instead
//      of calling the real editorial endpoint — so the still-private draft
//      content is viewable here without ever becoming reachable by a real
//      user through the public API.
//   2. Every OTHER ticker goes through the REAL production path:
//      `qualitativeContentApi.get(ticker)` — backend's public, no-auth
//      GET /api/qualitative-content/{ticker}, which returns ONLY
//      published+is_current content, or null (never an error) when none
//      exists yet. Since nothing is published platform-wide right now,
//      this correctly returns null for all ~922 non-pilot tickers — the
//      real, honest, no-editorial-yet state this screen must handle
//      gracefully (not an error, not a blocked financial ficha).
// A failure reading EITHER editorial source never blocks the financial
// diagnostic from rendering — same resilience discipline as the rest of
// this codebase (screener.py's own "editorial read failure must never
// block the ficha" rule, mirrored here client-side).

import { use, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { screenerApi, qualitativeContentApi } from "@/lib/api";
import { isFullDiagnostic, type CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";
import { ResumenPreview, type QualitativeContentDraft } from "@/components/subvaluadas/ResumenPreview";
import { DegradedTickerCard } from "@/components/subvaluadas/DegradedTickerCard";

// Exactly the 5 pilot tickers whose editorial content is still a private
// draft — everyone else goes through the real public endpoint. Keeping this
// list here (route-level, dev-only) rather than inside ResumenPreview itself
// keeps the reusable component free of any ticker-specific branching.
const _LOCAL_DRAFT_TICKERS: Record<string, () => Promise<{ default: QualitativeContentDraft }>> = {
  GOOGL: () => import("@/lib/previewContent/googl_v3.json") as unknown as Promise<{ default: QualitativeContentDraft }>,
  COST: () => import("@/lib/previewContent/cost.json") as unknown as Promise<{ default: QualitativeContentDraft }>,
  JPM: () => import("@/lib/previewContent/jpm.json") as unknown as Promise<{ default: QualitativeContentDraft }>,
  NVDA: () => import("@/lib/previewContent/nvda.json") as unknown as Promise<{ default: QualitativeContentDraft }>,
  MCD: () => import("@/lib/previewContent/mcd.json") as unknown as Promise<{ default: QualitativeContentDraft }>,
};

export default function ResumenPreviewPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = use(params);
  const ticker = rawTicker.toUpperCase();
  const { i18n } = useTranslation();
  const [data, setData] = useState<CompanyDiagnosticData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorial, setEditorial] = useState<QualitativeContentDraft | null>(null);
  const [editorialSource, setEditorialSource] = useState<"local-draft" | "public" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setEditorial(null);
    setEditorialSource(null);

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
          if (!cancelled) {
            setEditorial(mod.default);
            setEditorialSource("local-draft");
          }
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
            setEditorialSource("public");
          }
        })
        .catch(() => {
          /* Editorial read failure never blocks the financial ficha — this
             is the real-world normal case today (925 of 927 tickers have
             no published editorial yet), not an error. */
        });
    }

    return () => {
      cancelled = true;
    };
  }, [ticker, i18n.language]);

  return (
    <div className="h-screen overflow-y-auto px-4 py-8" style={{ background: "var(--bg)" }}>
      <div className="max-w-[1180px] mx-auto mb-4 text-center">
        <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Prototipo interno — Nuevo Resumen de Nuvos Radar{editorialSource === "local-draft" ? " (vista previa de borrador local)" : ""}
        </p>
      </div>
      {error && <p className="text-center text-sm" style={{ color: "#ef4444" }}>{error}</p>}
      {!data && !error && (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--muted)" }} />
        </div>
      )}
      {data && isFullDiagnostic(data) && <ResumenPreview data={data} editorial={editorial} />}
      {data && !isFullDiagnostic(data) && <DegradedTickerCard data={data} ticker={ticker} />}
    </div>
  );
}
