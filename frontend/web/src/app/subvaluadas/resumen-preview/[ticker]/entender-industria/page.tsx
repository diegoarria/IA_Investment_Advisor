"use client";

// Universal (ticker-agnostic) dev-only prototype route — Nuvos Radar 2.0,
// Fase 4 ("Entender la industria"). NOT linked from any real navigation,
// NOT a production route. Diego, 2026-11-15.
//
// Diego, 2026-11-17: all 5 pilots (GOOGL/COST/JPM/NVDA/MCD) are now
// published+is_current in Supabase (migration 126 added a nullable
// `industry` column to company_qualitative_content, 2026-11-16) — the
// earlier local-fixture special case for exactly those 5 was removed.
// Every ticker now goes through the real public editorial endpoint, which
// only ever returns published+current content or null. Local fixtures
// remain in previewContent/industry/*.json for tests/explicit dev use
// only — never auto-loaded by this routing logic anymore.

import { use, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { screenerApi, qualitativeContentApi } from "@/lib/api";
import { isFullDiagnostic, type CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";
import { EntenderIndustriaPreview } from "@/components/subvaluadas/EntenderIndustriaPreview";
import { DegradedTickerCard } from "@/components/subvaluadas/DegradedTickerCard";

import msftIndustry from "@/lib/previewContent/industry/msft.json";
import amznIndustry from "@/lib/previewContent/industry/amzn.json";
import vIndustry from "@/lib/previewContent/industry/v.json";
import metaIndustry from "@/lib/previewContent/industry/meta.json";
import meliIndustry from "@/lib/previewContent/industry/meli.json";

const COHORTE_2_INDUSTRY: Record<string, unknown> = {
  MSFT: msftIndustry,
  AMZN: amznIndustry,
  V: vIndustry,
  META: metaIndustry,
  MELI: meliIndustry,
};


export default function EntenderIndustriaPreviewPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = use(params);
  const ticker = rawTicker.toUpperCase();
  const { i18n } = useTranslation();
  const [data, setData] = useState<CompanyDiagnosticData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [industry, setIndustry] = useState<unknown | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setIndustry(null);

    screenerApi
      .companyDiagnosticPublic(ticker, "dev-preview-local", i18n.language)
      .then((res) => {
        if (!cancelled) setData(res.data as CompanyDiagnosticData);
      })
      .catch(() => {
        if (!cancelled) setError(`No se pudo cargar el diagnóstico financiero real de ${ticker}.`);
      });

    const local = COHORTE_2_INDUSTRY[ticker];
    if (local) {
      setIndustry(local);
    } else {
      qualitativeContentApi
        .get(ticker)
        .then((res) => {
          if (cancelled) return;
          const body = res.data as { industry?: unknown } | null;
          if (body?.industry) setIndustry(body.industry);
        })
        .catch(() => {
          /* No industry research yet for this ticker — honest empty state, never a blocker. */
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
        <EntenderIndustriaPreview data={data} industry={industry as Parameters<typeof EntenderIndustriaPreview>[0]["industry"]} />
      )}
      {data && !isFullDiagnostic(data) && <DegradedTickerCard data={data} ticker={ticker} />}
    </div>
  );
}
