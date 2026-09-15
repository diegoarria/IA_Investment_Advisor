"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Users, Crown, TrendingDown, Activity, Lock, DollarSign, Trash2, Plus } from "lucide-react";
import { useAuthStore } from "@/lib/store";
import { adminApi } from "@/lib/api";
import { Sparkline, type SparklinePoint } from "@/components/ui";

const ADMIN_UID = "86961402-9072-4670-9f73-b2aa91930b04";

interface UserMetrics {
  total_users?: number;
  premium_count?: number;
  manual_comp_count?: number;
  trialing_count?: number;
  free_count?: number;
  signups_last_7d?: number;
  signups_last_30d?: number;
  error?: string;
}

interface StripeMetrics {
  available: boolean;
  reason?: string;
  mrr_usd?: number;
  active_subscriptions?: number;
  trialing_subscriptions?: number;
  cancellations_last_30d?: number;
  churn_rate_pct_30d?: number;
  recent_cancellations?: { customer_id: string; email: string | null; canceled_at: number; plan_amount: number }[];
}

interface PosthogMetrics {
  available: boolean;
  reason?: string;
  dau?: number | null;
  wau?: number | null;
  mau?: number | null;
  wau_pct_of_total?: number;
  stickiness_pct?: number | null;
  top_custom_events_last_7d?: { event: string; count: number }[];
  automatic_events_last_7d?: number | null;
  top_pages_last_7d?: { path: string; count: number }[];
}

interface OperatingCost {
  id: string;
  name: string;
  monthly_usd: number;
  notes?: string | null;
}

interface CostsMetrics {
  llm_usd_30d: number | null;
  stripe_fees_usd_30d: number | null;
  fixed_costs: { items: OperatingCost[]; total_monthly_usd: number };
  total_cost_usd_30d: number | null;
  margin_usd: number | null;
  margin_pct: number | null;
}

interface Overview {
  generated_at: string;
  users: UserMetrics;
  stripe: StripeMetrics;
  posthog: PosthogMetrics;
  costs: CostsMetrics;
}

interface HistoryRow {
  snapshot_date: string;
  total_users: number;
  premium_count: number;
  mrr_usd: number | null;
  wau: number | null;
  margin_usd: number | null;
  margin_pct: number | null;
}

const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const fmtUSD = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function series(history: HistoryRow[], key: keyof HistoryRow): SparklinePoint[] {
  return history.map((h) => ({
    date: new Date(h.snapshot_date + "T00:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" }),
    value: h[key] as number | null,
  }));
}

function Card({
  label, value, sub, icon, trend, formatTrend,
}: {
  label: string; value: string; sub?: string; icon?: React.ReactNode;
  trend?: SparklinePoint[]; formatTrend?: (v: number) => string;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center gap-1.5 mb-2" style={{ color: "var(--muted)" }}>
        {icon}
        <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-2xl font-black" style={{ color: "var(--text)" }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{sub}</p>}
      {trend && trend.length >= 2 && (
        <div className="mt-2">
          <Sparkline data={trend} height={32} formatValue={formatTrend} />
        </div>
      )}
    </div>
  );
}

function NotConfigured({ what }: { what: string }) {
  return (
    <div className="rounded-xl border p-4 flex items-center gap-2" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <Lock className="w-4 h-4" style={{ color: "var(--muted)" }} />
      <p className="text-sm" style={{ color: "var(--muted)" }}>{what} no está configurado todavía (falta la API key en el backend).</p>
    </div>
  );
}

export default function AdminBusinessOverviewPage() {
  const router = useRouter();
  const { userId, isAuthenticated } = useAuthStore();
  const [data, setData] = useState<Overview | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCostName, setNewCostName] = useState("");
  const [newCostAmount, setNewCostAmount] = useState("");
  const [savingCost, setSavingCost] = useState(false);

  useEffect(() => {
    if (!userId || !isAuthenticated) return;
    if (userId !== ADMIN_UID) router.push("/");
  }, [userId, isAuthenticated, router]);

  const load = useCallback(async (forceRefresh: boolean) => {
    forceRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const [overviewRes, historyRes] = await Promise.all([
        adminApi.businessOverview(forceRefresh),
        adminApi.businessOverviewHistory(56),
      ]);
      setData(overviewRes.data);
      setHistory(historyRes.data ?? []);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "No se pudo cargar el panel.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (userId === ADMIN_UID) load(false);
  }, [userId, load]);

  const addCost = async () => {
    if (!newCostName.trim() || !newCostAmount.trim() || isNaN(Number(newCostAmount))) return;
    setSavingCost(true);
    try {
      await adminApi.upsertOperatingCost(newCostName.trim(), Number(newCostAmount));
      setNewCostName(""); setNewCostAmount("");
      await load(true);
    } catch {
      setError("No se pudo guardar el costo. Inténtalo de nuevo.");
    } finally {
      setSavingCost(false);
    }
  };

  const removeCost = async (id: string) => {
    try {
      await adminApi.deleteOperatingCost(id);
      await load(true);
    } catch {
      setError("No se pudo eliminar el costo. Inténtalo de nuevo.");
    }
  };

  if (userId && userId !== ADMIN_UID) return null;

  const usersTrend = series(history, "total_users");
  const premiumTrend = series(history, "premium_count");
  const mrrTrend = series(history, "mrr_usd");
  // WAU% needs total_users from the SAME day's row, computed here rather
  // than stored — history only keeps raw wau/total_users per snapshot.
  const wauPctTrend: SparklinePoint[] = history.map((h) => ({
    date: new Date(h.snapshot_date + "T00:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" }),
    value: h.wau != null && h.total_users ? Math.round((h.wau / h.total_users) * 1000) / 10 : null,
  }));

  return (
    <div className="h-screen overflow-y-auto p-6" style={{ background: "var(--bg)" }}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--text)" }}>Panel de negocio</h1>
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              Usuarios, Premium, churn y uso del producto — en un solo lugar.
              {data && <> Actualizado: {new Date(data.generated_at).toLocaleString("es-MX")}</>}
            </p>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
          >
            {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refrescar
          </button>
        </div>

        {loading && <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent)" }} />}
        {error && <p className="text-sm" style={{ color: "#f87171" }}>{error}</p>}

        {data && (
          <>
            {/* Usuarios */}
            <section className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Usuarios</p>
              {data.users.error && (
                <div className="rounded-xl border p-3 flex items-center justify-between gap-3" style={{ borderColor: "#f87171", background: "rgba(248,113,113,0.08)" }}>
                  <p className="text-xs" style={{ color: "#f87171" }}>
                    No se pudo leer de la base de datos ({data.users.error}) — por eso los números de abajo salen en blanco. Reintenta en unos segundos.
                  </p>
                  <button onClick={() => load(true)} className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg" style={{ background: "#f87171", color: "#000" }}>
                    Reintentar
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card label="Total" value={fmtNum(data.users.total_users)} icon={<Users className="w-3.5 h-3.5" />} trend={usersTrend} />
                <Card label="Premium" value={fmtNum(data.users.premium_count)}
                      sub={data.users.manual_comp_count ? `${data.users.manual_comp_count} manual` : undefined}
                      icon={<Crown className="w-3.5 h-3.5" />} trend={premiumTrend} />
                <Card label="En trial" value={fmtNum(data.users.trialing_count)} />
                <Card label="Free" value={fmtNum(data.users.free_count)} />
                <Card label="Nuevos (7d)" value={fmtNum(data.users.signups_last_7d)} />
                <Card label="Nuevos (30d)" value={fmtNum(data.users.signups_last_30d)} />
              </div>
              {history.length < 2 && (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Las tendencias (líneas debajo de cada número) van a aparecer en cuanto se acumulen unos días de snapshots — corre una vez al día a las 7am ET.
                </p>
              )}
            </section>

            {/* Stripe */}
            <section className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Ingresos (Stripe)</p>
              {data.stripe.available ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card label="MRR" value={fmtUSD(data.stripe.mrr_usd)} trend={mrrTrend} formatTrend={(v) => fmtUSD(v)} />
                    <Card label="Suscripciones activas" value={fmtNum(data.stripe.active_subscriptions)} />
                    <Card label="En trial (Stripe)" value={fmtNum(data.stripe.trialing_subscriptions)} />
                    <Card label="Churn (30d)" value={`${data.stripe.churn_rate_pct_30d ?? "—"}%`}
                          sub={`${fmtNum(data.stripe.cancellations_last_30d)} cancelaciones`}
                          icon={<TrendingDown className="w-3.5 h-3.5" />} />
                  </div>
                  {!!data.stripe.recent_cancellations?.length && (
                    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                      <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>Cancelaciones recientes</p>
                      <div className="space-y-1.5">
                        {data.stripe.recent_cancellations.map((c, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span style={{ color: "var(--text)" }}>{c.email ?? c.customer_id}</span>
                            <span style={{ color: "var(--muted)" }}>
                              {new Date(c.canceled_at * 1000).toLocaleDateString("es-MX")} · ${c.plan_amount.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : <NotConfigured what="Stripe" />}
            </section>

            {/* Costos y márgenes */}
            <section className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Costos y márgenes (30 días)</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card label="Costo LLM (tokens)" value={fmtUSD(data.costs.llm_usd_30d)} icon={<DollarSign className="w-3.5 h-3.5" />} />
                <Card label="Comisiones Stripe" value={fmtUSD(data.costs.stripe_fees_usd_30d)} />
                <Card label="Costos fijos (mensual)" value={fmtUSD(data.costs.fixed_costs.total_monthly_usd)} />
                <Card label="Costo total" value={fmtUSD(data.costs.total_cost_usd_30d)} />
                <Card
                  label="Margen"
                  value={fmtUSD(data.costs.margin_usd)}
                  sub={data.costs.margin_pct != null ? `${data.costs.margin_pct}% del MRR` : undefined}
                  trend={series(history, "margin_usd")}
                  formatTrend={(v) => fmtUSD(v)}
                />
              </div>
              {data.costs.margin_usd == null && (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  El margen aparece en cuanto Stripe (MRR) esté disponible — sin MRR no hay contra qué restar los costos.
                </p>
              )}

              <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <p className="text-xs font-bold mb-3" style={{ color: "var(--muted)" }}>
                  Plataformas/APIs con plan fijo (FMP, Finnhub, fiscal.ai, Railway, Vercel, Twilio, etc.)
                </p>
                <div className="space-y-1.5 mb-3">
                  {data.costs.fixed_costs.items.length === 0 && (
                    <p className="text-xs" style={{ color: "var(--muted)" }}>Todavía no cargaste ningún costo fijo.</p>
                  )}
                  {data.costs.fixed_costs.items.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm">
                      <span style={{ color: "var(--text)" }}>{c.name}</span>
                      <div className="flex items-center gap-2">
                        <span style={{ color: "var(--muted)" }}>{fmtUSD(c.monthly_usd)}/mes</span>
                        <button onClick={() => removeCost(c.id)} title="Eliminar">
                          <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    placeholder="Nombre (ej: FMP)"
                    value={newCostName}
                    onChange={(e) => setNewCostName(e.target.value)}
                    className="flex-1 text-xs rounded-lg px-2.5 py-1.5 outline-none border"
                    style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                  />
                  <input
                    placeholder="$/mes"
                    value={newCostAmount}
                    onChange={(e) => setNewCostAmount(e.target.value)}
                    inputMode="decimal"
                    className="w-24 text-xs rounded-lg px-2.5 py-1.5 outline-none border"
                    style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                  />
                  <button
                    onClick={addCost}
                    disabled={savingCost || !newCostName.trim() || !newCostAmount.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
                    style={{ background: "var(--accent)", color: "#fff" }}
                  >
                    {savingCost ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Agregar
                  </button>
                </div>
              </div>
            </section>

            {/* PostHog */}
            <section className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Uso del producto (PostHog)</p>
              {data.posthog.available ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <Card label="Activos hoy (DAU)" value={fmtNum(data.posthog.dau)} icon={<Activity className="w-3.5 h-3.5" />} />
                    <Card label="Activos 7 días (WAU)" value={fmtNum(data.posthog.wau)} />
                    <Card label="Activos 30 días (MAU)" value={fmtNum(data.posthog.mau)} />
                    <Card
                      label="Retención semanal"
                      value={data.posthog.wau_pct_of_total != null ? `${data.posthog.wau_pct_of_total}%` : "—"}
                      sub="Meta Fase 0: 30%+"
                      trend={wauPctTrend}
                      formatTrend={(v) => `${v}%`}
                    />
                    <Card
                      label="Stickiness (DAU/MAU)"
                      value={data.posthog.stickiness_pct != null ? `${data.posthog.stickiness_pct}%` : "—"}
                      sub="Qué tan seguido vuelven los activos"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {!!data.posthog.top_custom_events_last_7d?.length && (
                      <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                        <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>Qué hace la gente (7 días)</p>
                        <div className="space-y-1.5">
                          {data.posthog.top_custom_events_last_7d.map((e, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                              <span style={{ color: "var(--text)" }}>{e.event}</span>
                              <span style={{ color: "var(--muted)" }}>{fmtNum(e.count)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {!!data.posthog.top_pages_last_7d?.length && (
                      <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                        <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>Páginas más vistas (7 días)</p>
                        <div className="space-y-1.5">
                          {data.posthog.top_pages_last_7d.map((p, i) => (
                            <div key={i} className="flex items-center justify-between text-sm gap-2">
                              <span className="truncate" style={{ color: "var(--text)" }}>{p.path}</span>
                              <span className="shrink-0" style={{ color: "var(--muted)" }}>{fmtNum(p.count)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="rounded-xl border p-4 flex flex-col justify-between" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                      <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>
                        Eventos automáticos (clicks, vistas de página, etc.)
                      </p>
                      <p className="text-lg font-black" style={{ color: "var(--text)" }}>{fmtNum(data.posthog.automatic_events_last_7d)}</p>
                      <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                        Capturados solos por PostHog ($autocapture, $pageview, etc.) — no son acciones que tú nombraste, agrupados aquí para no llenar la lista de arriba de ruido.
                      </p>
                    </div>
                  </div>
                </>
              ) : <NotConfigured what="PostHog" />}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
