"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2, ArrowRight, AlertTriangle } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import { researchApi, upsells } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";

type View = "compose" | "plan" | "checking" | "progress" | "error";

interface Plan {
  companies: string[];
  comparison_type: string;
  needs_portfolio_personalization: boolean;
  metrics_needed: string[];
  relevant_blocks: string[];
  summary: string;
}

const EXAMPLE_PROMPTS = [
  "Analiza Amazon como inversión a 10 años considerando mi portafolio",
  "Compara Amazon, MercadoLibre y Alibaba y dime cuál encaja mejor con mi estrategia",
  "Encuentra empresas de calidad con ROIC > 20%, crecimiento de ingresos > 15% y buen flujo de caja libre",
  "¿Qué empresa de semiconductores complementaría mejor mi portafolio actual?",
  "Encuentra empresas parecidas a Costco pero con valuaciones más bajas",
];

function ResearchPageInner() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<View>("compose");
  const [requestText, setRequestText] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<string>("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedResumeRef = useRef(false);
  const [history, setHistory] = useState<{ id: string; title: string; companies: string[]; created_at: string }[]>([]);

  const price = isPremium ? 9.99 : 19.99;

  useEffect(() => {
    researchApi.listReports().then((res) => setHistory(res.data?.reports || [])).catch(() => {});
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const pollJob = useCallback((id: string) => {
    setView("progress");
    const startedAt = Date.now();
    stopPolling();
    pollRef.current = setInterval(async () => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
      try {
        const res = await researchApi.getJob(id);
        setCurrentStage(res.data.current_stage || "");
        if (res.data.status === "completed") {
          stopPolling();
          router.push(`/research/${res.data.report_id}`);
        } else if (res.data.status === "failed") {
          stopPolling();
          setError(res.data.error || t("research.progress.genericError"));
          setView("error");
        }
      } catch {
        // transient network blip — keep polling
      }
    }, 2500);
  }, [router, stopPolling, t]);

  // Resume after returning from Stripe checkout: ?job_id=...&session_id=...
  useEffect(() => {
    const resumeJobId = searchParams.get("job_id");
    const sessionId = searchParams.get("session_id");
    if (resumeJobId && sessionId && !startedResumeRef.current) {
      startedResumeRef.current = true;
      setView("checking");
      researchApi.start(resumeJobId, sessionId)
        .then(() => pollJob(resumeJobId))
        .catch((err) => {
          setError(err?.response?.data?.detail || t("research.progress.genericError"));
          setView("error");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ticker = searchParams.get("ticker");
    if (ticker) setRequestText(t("research.compose.tickerPrefill", { ticker }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleSubmitRequest = async () => {
    if (!requestText.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await researchApi.createPlan(requestText.trim());
      if (res.data?.error) { setError(res.data.error); setLoading(false); return; }
      setJobId(res.data.job_id);
      setPlan(res.data.plan);
      setView("plan");
    } catch {
      setError(t("research.compose.planError"));
    }
    setLoading(false);
  };

  const handleConfirmAndPay = async () => {
    if (!jobId) return;
    setLoading(true); setError(null);
    try {
      const res = await upsells.checkout("deep_research", isPremium ? "premium" : "free", "research_page", { job_id: jobId });
      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        setError(res.data?.error || t("research.plan.checkoutError"));
        setLoading(false);
      }
    } catch {
      setError(t("research.plan.checkoutError"));
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="max-w-2xl mx-auto">

            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
                {t("research.title")}
              </h1>
            </div>
            <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>{t("research.subtitle")}</p>

            {view === "compose" && (
              <div className="space-y-4">
                <textarea
                  value={requestText}
                  onChange={(e) => setRequestText(e.target.value)}
                  rows={4}
                  placeholder={t("research.compose.placeholder") ?? undefined}
                  className="w-full rounded-2xl border p-4 text-sm outline-none resize-none"
                  style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }}
                />
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_PROMPTS.map((p) => (
                    <button key={p} onClick={() => setRequestText(p)}
                            className="text-xs px-3 py-2 rounded-full border text-left transition-colors hover:border-[var(--accent)]"
                            style={{ borderColor: "var(--border)", color: "var(--sub)", background: "var(--raised)" }}>
                      {p}
                    </button>
                  ))}
                </div>
                {error && <p className="text-xs" style={{ color: "#ef4444" }}>{error}</p>}
                <button onClick={handleSubmitRequest} disabled={loading || !requestText.trim()}
                        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-black font-black text-sm disabled:opacity-40 transition-opacity"
                        style={{ background: "var(--accent)" }}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {t("research.compose.submit")}
                </button>

                {history.length > 0 && (
                  <div className="mt-8">
                    <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--muted)" }}>
                      {t("research.history.title")}
                    </p>
                    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                      {history.map((r) => (
                        <button key={r.id} onClick={() => router.push(`/research/${r.id}`)}
                                className="w-full text-left px-4 py-3 border-b last:border-b-0 flex items-center justify-between gap-3 transition-colors hover:bg-white/[0.03]"
                                style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                          <div className="min-w-0">
                            <p className="text-sm font-bold truncate" style={{ color: "var(--text)" }}>{r.title}</p>
                            <p className="text-[11px]" style={{ color: "var(--dim)" }}>
                              {r.companies?.join(", ")} · {new Date(r.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <ArrowRight className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {view === "plan" && plan && (
              <div className="space-y-4">
                <div className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--accent-l)" }}>
                    {t("research.plan.title")}
                  </p>
                  <p className="text-sm mb-4" style={{ color: "var(--text)" }}>{plan.summary}</p>
                  {plan.companies?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {plan.companies.map((c) => (
                        <span key={c} className="text-xs font-bold px-2 py-1 rounded-lg"
                              style={{ background: "var(--raised)", color: "var(--sub)" }}>{c}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {plan.relevant_blocks?.map((b) => (
                      <span key={b} className="text-[10px] px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(0,168,94,0.1)", color: "var(--accent-l)" }}>
                        {b.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border p-5 flex items-center justify-between"
                     style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {isPremium ? t("research.plan.premiumPrice") : t("research.plan.freePrice")}
                    </p>
                    <p className="text-2xl font-black" style={{ color: "#22c55e" }}>${price.toFixed(2)}</p>
                  </div>
                  {!isPremium && (
                    <p className="text-[11px] text-right max-w-[160px]" style={{ color: "var(--dim)" }}>
                      {t("research.plan.premiumUpsell", { price: "9.99" })}
                    </p>
                  )}
                </div>

                {error && <p className="text-xs" style={{ color: "#ef4444" }}>{error}</p>}
                <button onClick={handleConfirmAndPay} disabled={loading}
                        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-black font-black text-sm disabled:opacity-40 transition-opacity"
                        style={{ background: "var(--accent)" }}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  {t("research.plan.confirm")}
                </button>
                <button onClick={() => setView("compose")} className="w-full text-xs py-2" style={{ color: "var(--muted)" }}>
                  {t("research.plan.back")}
                </button>
              </div>
            )}

            {(view === "checking" || view === "progress") && (
              <div className="rounded-2xl border p-8 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" style={{ color: "var(--accent-l)" }} />
                <p className="text-sm font-bold mb-1" style={{ color: "var(--text)" }}>
                  {currentStage || t("research.progress.starting")}
                </p>
                <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
                  {t("research.progress.elapsed", { seconds: elapsedSec })}
                </p>
                <p className="text-[11px]" style={{ color: "var(--dim)" }}>{t("research.progress.estimate")}</p>
              </div>
            )}

            {view === "error" && (
              <div className="rounded-2xl border p-6 text-center" style={{ background: "var(--card)", borderColor: "rgba(239,68,68,0.35)" }}>
                <AlertTriangle className="w-6 h-6 mx-auto mb-2" style={{ color: "#ef4444" }} />
                <p className="text-sm mb-3" style={{ color: "var(--text)" }}>{error}</p>
                <button onClick={() => { setView("compose"); setError(null); }}
                        className="text-xs px-4 py-2 rounded-xl font-bold" style={{ background: "var(--raised)", color: "var(--sub)" }}>
                  {t("research.progress.tryAgain")}
                </button>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResearchPage() {
  return (
    <Suspense fallback={null}>
      <ResearchPageInner />
    </Suspense>
  );
}
