"use client";

import { useEffect, useState, useMemo } from "react";
import { Loader2, Lock, BookMarked } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PaywallModal from "@/components/PaywallModal";
import { screenerApi } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";

interface UndervaluedResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  intrinsic_value_base: number | null;
  margin_of_safety_pct: number | null;
  thesis_scores: Record<string, number> | null;
}

export default function SubvaluadasPage() {
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [results, setResults] = useState<UndervaluedResult[]>([]);
  const [generatedAt, setGeneratedAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [sectorFilter, setSectorFilter] = useState<string>("Todos");

  useEffect(() => {
    if (!isPremium) return;
    setLoading(true);
    screenerApi.getUndervalued(undefined, 30)
      .then((res) => {
        setResults(res.data?.results || []);
        setGeneratedAt(res.data?.generated_at || 0);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [isPremium]);

  const sectors = useMemo(() => {
    const unique = Array.from(new Set(results.map((r) => r.sector).filter(Boolean))) as string[];
    return ["Todos", ...unique.sort()];
  }, [results]);

  const filtered = sectorFilter === "Todos" ? results : results.filter((r) => r.sector === sectorFilter);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2 mb-1">
              <BookMarked className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
                Acciones Subvaluadas (DCF)
              </h1>
            </div>
            <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
              Todas las candidatas con margen de seguridad positivo real, calculadas con el mismo motor de valor
              intrínseco de Mentor IA sobre el universo curado — actualizado semanalmente.
              {generatedAt > 0 && (
                <> Última actualización: {new Date(generatedAt * 1000).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}.</>
              )}
            </p>

            {!isPremium ? (
              <div className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(0,168,94,0.1)" }}>
                  <Lock className="w-7 h-7" style={{ color: "var(--accent-l)" }} />
                </div>
                <h2 className="font-bold text-base mb-2" style={{ color: "var(--text)" }}>Exclusivo Premium</h2>
                <p className="text-sm mb-5 max-w-sm mx-auto" style={{ color: "var(--muted)" }}>
                  El screener de acciones subvaluadas usa el motor real de DCF — disponible solo para usuarios Premium.
                </p>
                <button onClick={() => setPaywallOpen(true)}
                        className="px-6 py-2.5 rounded-xl text-sm font-bold text-white"
                        style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                  Desbloquear Premium
                </button>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} />
              </div>
            ) : results.length === 0 ? (
              <div className="rounded-2xl border p-8 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Todavía no hay datos del screener semanal — vuelve más tarde.
                </p>
              </div>
            ) : (
              <>
                {sectors.length > 2 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {sectors.map((s) => (
                      <button key={s} onClick={() => setSectorFilter(s)}
                              className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                              style={{
                                borderColor: sectorFilter === s ? "var(--accent)" : "var(--border)",
                                background: sectorFilter === s ? "rgba(0,168,94,0.1)" : "var(--raised)",
                                color: sectorFilter === s ? "var(--accent-l)" : "var(--sub)",
                              }}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  {filtered.map((u, i) => (
                    <div key={u.ticker} className="px-4 py-3 flex items-center justify-between gap-3"
                         style={{ background: "var(--card)", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate" style={{ color: "var(--text)" }}>
                          {u.ticker} {u.company_name ? `· ${u.company_name}` : ""}
                        </p>
                        <p className="text-[11px]" style={{ color: "var(--dim)" }}>
                          Precio ${u.price} · Valor intrínseco ${u.intrinsic_value_base} · {u.sector || "N/D"} ·
                          {" "}Business Quality {u.thesis_scores?.business_quality ?? "N/D"}/100
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-black px-2 py-1 rounded-lg"
                            style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
                        +{u.margin_of_safety_pct}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason="Screener de acciones subvaluadas" />
    </div>
  );
}
