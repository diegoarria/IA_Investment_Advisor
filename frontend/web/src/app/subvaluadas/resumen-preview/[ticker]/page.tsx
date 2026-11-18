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
// Editorial (qualitative) content comes exclusively from the real public
// production path: `qualitativeContentApi.get(ticker)` — backend's public,
// no-auth GET /api/qualitative-content/{ticker}, which returns ONLY
// published+is_current content (business_model_summary/moat/risks/
// leadership/industry together, since migration 126 added the latter two
// as columns on the same row), or null (never an error) when none exists
// yet. Diego, 2026-11-17: the 5 pilots (GOOGL/COST/JPM/NVDA/MCD) are now
// genuinely published — the earlier local-fixture special case for them
// was removed, so this route no longer distinguishes "pilot" from
// "regular" ticker. A failure reading this endpoint never blocks the
// financial diagnostic from rendering — same resilience discipline as the
// rest of this codebase (screener.py's own "editorial read failure must
// never block the ficha" rule, mirrored here client-side). Local fixtures
// remain in previewContent/*.json for tests/explicit dev use only — never
// auto-loaded by this routing logic anymore.

import { use, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { screenerApi, qualitativeContentApi } from "@/lib/api";
import { isFullDiagnostic, type CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";
import { ResumenPreview, type QualitativeContentDraft } from "@/components/subvaluadas/ResumenPreview";
import { DegradedTickerCard } from "@/components/subvaluadas/DegradedTickerCard";
import msftDraft from "@/lib/previewContent/msft.json";
import amznDraft from "@/lib/previewContent/amzn.json";
import vDraft from "@/lib/previewContent/v.json";
import metaDraft from "@/lib/previewContent/meta.json";
import meliDraft from "@/lib/previewContent/meli.json";
import msftLeadership from "@/lib/previewContent/leadership/msft.json";
import amznLeadership from "@/lib/previewContent/leadership/amzn.json";
import vLeadership from "@/lib/previewContent/leadership/v.json";
import metaLeadership from "@/lib/previewContent/leadership/meta.json";
import meliLeadership from "@/lib/previewContent/leadership/meli.json";
import msftIndustry from "@/lib/previewContent/industry/msft.json";
import amznIndustry from "@/lib/previewContent/industry/amzn.json";
import vIndustry from "@/lib/previewContent/industry/v.json";
import metaIndustry from "@/lib/previewContent/industry/meta.json";
import meliIndustry from "@/lib/previewContent/industry/meli.json";

// Cohorte 2 (2026-11-17): real researched content, not yet written to
// Supabase — same two-stage local-preview pattern the first cohort used
// before publication. Does not affect how the first cohort or any other
// ticker is served (those always hit the real endpoint, unchanged).
const COHORTE_2_LOCAL: Record<string, { business_model_summary?: string; moat?: unknown[]; risks?: unknown[] }> = { MSFT: msftDraft, AMZN: amznDraft, V: vDraft, META: metaDraft, MELI: meliDraft };
const COHORTE_2_LEADERSHIP: Record<string, unknown> = { MSFT: msftLeadership, AMZN: amznLeadership, V: vLeadership, META: metaLeadership, MELI: meliLeadership };
const COHORTE_2_INDUSTRY: Record<string, unknown> = { MSFT: msftIndustry, AMZN: amznIndustry, V: vIndustry, META: metaIndustry, MELI: meliIndustry };

export default function ResumenPreviewPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = use(params);
  const ticker = rawTicker.toUpperCase();
  const { i18n } = useTranslation();
  const [data, setData] = useState<CompanyDiagnosticData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorial, setEditorial] = useState<QualitativeContentDraft | null>(null);
  const [leadership, setLeadership] = useState<unknown | null>(null);
  const [industry, setIndustry] = useState<unknown | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setEditorial(null);
    setLeadership(null);
    setIndustry(null);

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
      const localLeadership = COHORTE_2_LEADERSHIP[ticker];
      const localIndustry = COHORTE_2_INDUSTRY[ticker];
      if (localLeadership) setLeadership(localLeadership);
      if (localIndustry) setIndustry(localIndustry);
    } else {
      qualitativeContentApi
        .get(ticker)
        .then((res) => {
          if (cancelled) return;
          const body = res.data as { business_model_summary?: string; moat?: unknown[]; risks?: unknown[]; leadership?: unknown; industry?: unknown } | null;
          if (body) {
            setEditorial({
              ticker,
              review_status: "published",
              is_current: true,
              business_model_summary: body.business_model_summary ?? "",
              moat: (body.moat ?? []) as QualitativeContentDraft["moat"],
              risks: (body.risks ?? []) as QualitativeContentDraft["risks"],
            });
            if (body.leadership) setLeadership(body.leadership);
            if (body.industry) setIndustry(body.industry);
          }
        })
        .catch(() => {
          /* Editorial read failure never blocks the financial ficha — the
             real-world normal case for any ticker without a published
             editorial version yet. */
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
          Prototipo interno — Nuevo Resumen de Nuvos Radar
        </p>
      </div>
      {error && <p className="text-center text-sm" style={{ color: "#ef4444" }}>{error}</p>}
      {!data && !error && (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--muted)" }} />
        </div>
      )}
      {data && isFullDiagnostic(data) && (
        <ResumenPreview
          data={data}
          editorial={editorial}
          leadership={leadership as Parameters<typeof ResumenPreview>[0]["leadership"]}
          industry={industry as Parameters<typeof ResumenPreview>[0]["industry"]}
        />
      )}
      {data && !isFullDiagnostic(data) && <DegradedTickerCard data={data} ticker={ticker} />}
    </div>
  );
}
