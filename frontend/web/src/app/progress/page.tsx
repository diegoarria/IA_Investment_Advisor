"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp, Lock, Loader2, Trophy, ShieldCheck, Calendar, X } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import PaywallModal from "@/components/PaywallModal";
import { progressApi } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";

interface ProgressSummary {
  days_using_nuvos?: number;
  inception_date?: string;
  days_since_first_investment?: number;
  total_operations?: number;
  capital_invested?: number;
  current_patrimonio?: number;
  cumulative_return_pct?: number;
  cumulative_return_amount?: number;
  best_year?: { year: number; pct: number };
  worst_year?: { year: number; pct: number };
  consecutive_months_contributing?: number;
}

interface Milestone {
  event_type: string;
  title: string;
  description?: string;
  occurred_at: string;
  milestone_key: string;
}

interface DecisionThatHelped {
  key: string;
  title: string;
  description: string;
}

const fmtUSD = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function ProgressPage() {
  const router = useRouter();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywall] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ProgressSummary>({});
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [decisions, setDecisions] = useState<DecisionThatHelped[]>([]);

  useEffect(() => {
    if (!isPremium) return;
    setLoading(true);
    Promise.all([
      progressApi.getSummary(),
      progressApi.getMilestones(),
      progressApi.getDecisionsThatHelped(),
    ])
      .then(([s, m, d]) => {
        setSummary(s.data.summary || {});
        setMilestones(m.data.milestones || []);
        setDecisions(d.data.decisions || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isPremium]);

  const metrics: { label: string; value: string }[] = [];
  if (summary.days_since_first_investment !== undefined) {
    metrics.push({ label: "Desde tu primera inversión", value: `${summary.days_since_first_investment} días` });
  }
  if (summary.days_using_nuvos !== undefined) {
    metrics.push({ label: "Tiempo usando Nuvos", value: `${summary.days_using_nuvos} días` });
  }
  if (summary.total_operations !== undefined) {
    metrics.push({ label: "Operaciones realizadas", value: `${summary.total_operations}` });
  }
  if (summary.capital_invested !== undefined) {
    metrics.push({ label: "Capital invertido", value: fmtUSD(summary.capital_invested) });
  }
  if (summary.current_patrimonio !== undefined) {
    metrics.push({ label: "Patrimonio actual", value: fmtUSD(summary.current_patrimonio) });
  }
  if (summary.cumulative_return_pct !== undefined) {
    const sign = summary.cumulative_return_pct >= 0 ? "+" : "";
    metrics.push({ label: "Retorno acumulado", value: `${sign}${summary.cumulative_return_pct}%` });
  }
  if (summary.best_year) {
    metrics.push({ label: `Mejor año (${summary.best_year.year})`, value: `+${summary.best_year.pct}%` });
  }
  if (summary.worst_year) {
    const sign = summary.worst_year.pct >= 0 ? "+" : "";
    metrics.push({ label: `Año más difícil (${summary.worst_year.year})`, value: `${sign}${summary.worst_year.pct}%` });
  }
  if (summary.consecutive_months_contributing !== undefined) {
    metrics.push({ label: "Meses seguidos aportando", value: `${summary.consecutive_months_contributing}` });
  }

  const hasAnyData = metrics.length > 0 || milestones.length > 0 || decisions.length > 0;

  if (!isPremium) {
    return (
      <div className="flex h-screen" style={{ background: "var(--bg)" }}>
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex justify-end mb-2">
              <button onClick={() => router.back()}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
                      style={{ background: "var(--raised)", color: "var(--muted)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="rounded-2xl border p-10 text-center"
                 style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                   style={{ background: "rgba(0,168,94,0.1)" }}>
                <Lock className="w-8 h-8" style={{ color: "var(--accent-l)" }} />
              </div>
              <h2 className="font-bold text-lg mb-2" style={{ color: "var(--text)" }}>Tu evolución como inversionista</h2>
              <p className="text-sm max-w-sm mx-auto mb-5" style={{ color: "var(--muted)" }}>
                Nuvos guarda tu historia completa como inversor — hitos, patrimonio, decisiones que evitaron errores. Entre más tiempo te quedes, más vale.
              </p>
              <button onClick={() => setPaywall(true)}
                      className="px-6 py-2.5 rounded-xl text-sm font-bold text-white"
                      style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                Activar Premium
              </button>
            </div>
          </div>
        </main>
        <PaywallModal visible={paywallOpen} onClose={() => setPaywall(false)} />
      </div>
    );
  }

  return (
    <div className="flex h-screen" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--text)" }}>
                <TrendingUp className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
                Tu evolución como inversionista
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                Todo respaldado por tus datos reales — nunca inventamos progreso
              </p>
            </div>
            <button onClick={() => router.back()}
                    className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
                    style={{ background: "var(--raised)", color: "var(--muted)" }}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
            </div>
          ) : !hasAnyData ? (
            <div className="text-center py-16">
              <TrendingUp className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--muted)", opacity: 0.4 }} />
              <p className="text-sm" style={{ color: "var(--muted)" }}>Aún estamos construyendo tu historial.</p>
              <p className="text-xs mt-1" style={{ color: "var(--dim)" }}>Sigue invirtiendo y usando Nuvos — tu evolución aparecerá aquí.</p>
            </div>
          ) : (
            <>
              {/* Summary metrics */}
              {metrics.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {metrics.map((m) => (
                    <div key={m.label} className="rounded-xl border p-3.5"
                         style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                      <p className="text-[10px] font-semibold mb-1" style={{ color: "var(--muted)" }}>{m.label}</p>
                      <p className="text-lg font-black" style={{ color: "var(--text)" }}>{m.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Milestones */}
              {milestones.length > 0 && (
                <div>
                  <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                    <Trophy className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} /> HITOS
                  </p>
                  <div className="space-y-2">
                    {milestones.map((ms) => (
                      <div key={ms.milestone_key} className="flex items-start gap-3 p-3 rounded-xl border"
                           style={{ borderColor: "rgba(245,158,11,0.2)", background: "rgba(245,158,11,0.05)" }}>
                        <Trophy className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{ms.title}</p>
                          {ms.description && (
                            <p className="text-xs mt-0.5" style={{ color: "var(--sub)" }}>{ms.description}</p>
                          )}
                        </div>
                        <p className="text-[10px] shrink-0 flex items-center gap-1" style={{ color: "var(--dim)" }}>
                          <Calendar className="w-3 h-3" />
                          {new Date(ms.occurred_at).toLocaleDateString("es-MX")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Decisions that helped */}
              {decisions.length > 0 && (
                <div>
                  <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                    <ShieldCheck className="w-3.5 h-3.5" style={{ color: "#22c55e" }} /> DECISIONES QUE EVITARON ERRORES COSTOSOS
                  </p>
                  <div className="space-y-2">
                    {decisions.map((d) => (
                      <div key={d.key} className="flex items-start gap-3 p-3 rounded-xl border"
                           style={{ borderColor: "rgba(34,197,94,0.2)", background: "rgba(34,197,94,0.05)" }}>
                        <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#22c55e" }} />
                        <div>
                          <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{d.title}</p>
                          <p className="text-xs mt-0.5" style={{ color: "var(--sub)" }}>{d.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
