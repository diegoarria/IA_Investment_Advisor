"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Users, Crown, TrendingDown, Activity, Lock } from "lucide-react";
import { useAuthStore } from "@/lib/store";
import { adminApi } from "@/lib/api";

const ADMIN_UID = "86961402-9072-4670-9f73-b2aa91930b04";

interface UserMetrics {
  total_users: number;
  premium_count: number;
  manual_comp_count: number;
  trialing_count: number;
  free_count: number;
  signups_last_7d: number;
  signups_last_30d: number;
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
  top_events_last_7d?: { event: string; count: number }[];
}

interface Overview {
  generated_at: string;
  users: UserMetrics;
  stripe: StripeMetrics;
  posthog: PosthogMetrics;
}

const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const fmtUSD = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Card({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center gap-1.5 mb-2" style={{ color: "var(--muted)" }}>
        {icon}
        <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-2xl font-black" style={{ color: "var(--text)" }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{sub}</p>}
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !isAuthenticated) return;
    if (userId !== ADMIN_UID) router.push("/");
  }, [userId, isAuthenticated, router]);

  const load = useCallback(async (forceRefresh: boolean) => {
    forceRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await adminApi.businessOverview(forceRefresh);
      setData(res.data);
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

  if (userId && userId !== ADMIN_UID) return null;

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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card label="Total" value={fmtNum(data.users.total_users)} icon={<Users className="w-3.5 h-3.5" />} />
                <Card label="Premium" value={fmtNum(data.users.premium_count)}
                      sub={data.users.manual_comp_count ? `${data.users.manual_comp_count} manual` : undefined}
                      icon={<Crown className="w-3.5 h-3.5" />} />
                <Card label="En trial" value={fmtNum(data.users.trialing_count)} />
                <Card label="Free" value={fmtNum(data.users.free_count)} />
                <Card label="Nuevos (7d)" value={fmtNum(data.users.signups_last_7d)} />
                <Card label="Nuevos (30d)" value={fmtNum(data.users.signups_last_30d)} />
              </div>
            </section>

            {/* Stripe */}
            <section className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Ingresos (Stripe)</p>
              {data.stripe.available ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card label="MRR" value={fmtUSD(data.stripe.mrr_usd)} />
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

            {/* PostHog */}
            <section className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Uso del producto (PostHog)</p>
              {data.posthog.available ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Card label="Activos hoy (DAU)" value={fmtNum(data.posthog.dau)} icon={<Activity className="w-3.5 h-3.5" />} />
                    <Card label="Activos 7 días (WAU)" value={fmtNum(data.posthog.wau)} />
                    <Card label="Activos 30 días (MAU)" value={fmtNum(data.posthog.mau)} />
                  </div>
                  {!!data.posthog.top_events_last_7d?.length && (
                    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                      <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>Eventos más frecuentes (7 días)</p>
                      <div className="space-y-1.5">
                        {data.posthog.top_events_last_7d.map((e, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span style={{ color: "var(--text)" }}>{e.event}</span>
                            <span style={{ color: "var(--muted)" }}>{fmtNum(e.count)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : <NotConfigured what="PostHog" />}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
