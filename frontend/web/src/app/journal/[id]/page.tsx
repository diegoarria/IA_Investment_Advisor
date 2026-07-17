"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import { journalApi } from "@/lib/api";

interface Thesis {
  id: string;
  ticker: string;
  company_name: string | null;
  price_at_creation: number | null;
  intrinsic_value_base: number | null;
  intrinsic_value_expected: number | null;
  margin_of_safety_pct: number | null;
  thesis_scores: Record<string, number> | null;
  thesis_text: string;
  created_at: string;
}

interface Review {
  price_then: number | null;
  price_now: number | null;
  intrinsic_then: number | null;
  intrinsic_now: number | null;
  review_text: string;
}

export default function JournalThesisPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [thesis, setThesis] = useState<Thesis | null>(null);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    journalApi.get(id)
      .then((res) => setThesis(res.data))
      .catch(() => setThesis(null))
      .finally(() => setLoading(false));
  }, [id]);

  const handleReview = async () => {
    if (!id) return;
    setReviewing(true);
    setReviewError(null);
    try {
      const res = await journalApi.review(id);
      setReview(res.data);
    } catch {
      setReviewError("No se pudo revisar la tesis en este momento. Intenta de nuevo.");
    }
    setReviewing(false);
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="max-w-2xl mx-auto">
            <button onClick={() => router.push("/journal")}
                    className="flex items-center gap-1.5 text-xs mb-4 transition-opacity hover:opacity-70"
                    style={{ color: "var(--muted)" }}>
              <ArrowLeft className="w-3.5 h-3.5" /> Volver al Journal
            </button>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
              </div>
            ) : !thesis ? (
              <p className="text-sm text-center py-20" style={{ color: "var(--muted)" }}>Tesis no encontrada.</p>
            ) : (
              <>
                <div className="mb-4">
                  <h1 className="text-2xl font-black tracking-tight mb-1" style={{ color: "var(--text)" }}>
                    {thesis.ticker} {thesis.company_name ? `· ${thesis.company_name}` : ""}
                  </h1>
                  <p className="text-xs" style={{ color: "var(--dim)" }}>
                    Guardada el {new Date(thesis.created_at).toLocaleDateString()} · Precio entonces ${thesis.price_at_creation ?? "N/D"}
                    {" · "}Valor intrínseco base entonces ${thesis.intrinsic_value_base ?? "N/D"}
                  </p>
                </div>

                <button onClick={handleReview} disabled={reviewing}
                        className="mb-5 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-black font-black text-xs disabled:opacity-40 transition-opacity"
                        style={{ background: "var(--accent)" }}>
                  {reviewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Revisar tesis ahora
                </button>

                {reviewError && <p className="text-xs mb-4" style={{ color: "#ef4444" }}>{reviewError}</p>}

                {review && (
                  <div className="rounded-2xl border p-5 mb-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <h2 className="text-sm font-black uppercase tracking-wide mb-3" style={{ color: "var(--accent-l)" }}>
                      Revisión de tesis
                    </h2>
                    <p className="text-xs mb-3" style={{ color: "var(--dim)" }}>
                      Precio: ${review.price_then ?? "N/D"} → ${review.price_now ?? "N/D"} · Valor intrínseco: ${review.intrinsic_then ?? "N/D"} → ${review.intrinsic_now ?? "N/D"}
                    </p>
                    <div className="text-sm leading-relaxed" style={{ color: "var(--sub)" }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{review.review_text}</ReactMarkdown>
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <h2 className="text-sm font-black uppercase tracking-wide mb-3" style={{ color: "var(--accent-l)" }}>
                    Tesis original
                  </h2>
                  <div className="text-sm leading-relaxed" style={{ color: "var(--sub)" }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{thesis.thesis_text}</ReactMarkdown>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
