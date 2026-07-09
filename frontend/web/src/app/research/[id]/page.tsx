"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Download, ArrowLeft, Loader2 } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import { researchApi } from "@/lib/api";

interface Block { type: string; data: unknown }
interface Report { id: string; title: string; companies: string[]; blocks: Block[]; created_at: string }

function BlockContent({ data }: { data: unknown }) {
  if (typeof data === "string") {
    return <p className="text-sm leading-relaxed" style={{ color: "var(--sub)" }}>{data}</p>;
  }
  if (Array.isArray(data)) {
    return (
      <ul className="space-y-1.5">
        {data.map((item, i) => (
          <li key={i} className="text-sm flex items-start gap-2" style={{ color: "var(--sub)" }}>
            <span style={{ color: "var(--accent-l)" }}>•</span>
            <span>{typeof item === "string" ? item : JSON.stringify(item)}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (data && typeof data === "object") {
    return (
      <div className="space-y-3">
        {Object.entries(data as Record<string, unknown>).map(([key, value]) => (
          <div key={key}>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
              {key.replace(/_/g, " ")}
            </p>
            <BlockContent data={value} />
          </div>
        ))}
      </div>
    );
  }
  return null;
}

const BLOCK_TITLES: Record<string, string> = {
  executive_summary: "Resumen Ejecutivo",
  business_overview: "Visión General del Negocio",
  recent_changes: "Cambios Recientes",
  business_model: "Modelo de Negocio",
  competitive_advantages: "Ventajas Competitivas",
  industry_analysis: "Análisis de la Industria",
  competitor_comparison: "Comparación con Competidores",
  financial_analysis: "Análisis Financiero",
  management_evaluation: "Evaluación de la Gerencia",
  risk_analysis: "Análisis de Riesgos",
  catalysts: "Catalizadores",
  valuation: "Valuación",
  historical_performance: "Desempeño Histórico",
  portfolio_compatibility: "Compatibilidad con tu Portafolio",
  alternative_ideas: "Ideas Alternativas",
  investment_thesis: "Tesis de Inversión",
  key_takeaways: "Puntos Clave",
  sources: "Fuentes",
};

export default function ResearchReportPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!id) return;
    researchApi.getReport(id)
      .then((res) => setReport(res.data))
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDownload = async () => {
    if (!report) return;
    setDownloading(true);
    try {
      const res = await researchApi.downloadPdf(report.id);
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nuvos-deep-research-${report.id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
    setDownloading(false);
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="max-w-2xl mx-auto">
            <button onClick={() => router.push("/research")}
                    className="flex items-center gap-1.5 text-xs mb-4 transition-opacity hover:opacity-70"
                    style={{ color: "var(--muted)" }}>
              <ArrowLeft className="w-3.5 h-3.5" /> {t("research.report.backToHistory")}
            </button>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
              </div>
            ) : !report ? (
              <p className="text-sm text-center py-20" style={{ color: "var(--muted)" }}>{t("research.report.notFound")}</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 mb-6">
                  <div>
                    <h1 className="text-2xl font-black tracking-tight mb-1" style={{ color: "var(--text)" }}>{report.title}</h1>
                    {report.companies?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {report.companies.map((c) => (
                          <span key={c} className="text-xs font-bold px-2 py-0.5 rounded-lg"
                                style={{ background: "var(--raised)", color: "var(--sub)" }}>{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={handleDownload} disabled={downloading}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors hover:border-[var(--accent)]"
                          style={{ borderColor: "var(--border)", color: "var(--sub)", background: "var(--raised)" }}>
                    {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    {t("research.report.downloadPdf")}
                  </button>
                </div>

                <div className="space-y-6">
                  {report.blocks?.map((block, i) => (
                    <div key={i} className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      <h2 className="text-sm font-black uppercase tracking-wide mb-3" style={{ color: "var(--accent-l)" }}>
                        {BLOCK_TITLES[block.type] ?? block.type.replace(/_/g, " ")}
                      </h2>
                      <BlockContent data={block.data} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
