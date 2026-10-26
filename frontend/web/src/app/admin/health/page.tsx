"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, History, Activity, Search, AlertTriangle, RefreshCw, Radio } from "lucide-react";
import { useAuthStore } from "@/lib/store";
import { adminApi } from "@/lib/api";

const ADMIN_UID = "86961402-9072-4670-9f73-b2aa91930b04";

interface AuditEntry {
  id: string;
  user_id: string;
  email: string | null;
  actor: string;
  tier: string | null;
  source: string | null;
  premium_until: string | null;
  reason: string | null;
  created_at: string;
}

interface NotifCounts {
  sent: number; failed: number; skipped: number; delivered: number;
}

interface SystemEvent {
  id: string;
  event_type: string;
  detail: string | null;
  user_id: string | null;
  created_at: string;
}

interface HealthData {
  generated_at: string;
  notifications_today: {
    total: number;
    by_category: Record<string, NotifCounts>;
    categories_with_problems: Record<string, NotifCounts>;
  };
  system_events_today: {
    total: number;
    by_type: Record<string, number>;
    recent: SystemEvent[];
  };
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });

function actorLabel(actor: string): { label: string; color: string } {
  if (actor.startsWith("admin:")) return { label: `Admin (${actor.slice(6)})`, color: "#818CF8" };
  if (actor.startsWith("admin_resync:")) return { label: `Resync manual (${actor.slice(13)})`, color: "#f59e0b" };
  if (actor.startsWith("stripe_webhook:")) return { label: `Stripe: ${actor.slice(15)}`, color: "#00e887" };
  if (actor === "stripe_self_heal") return { label: "Stripe (self-heal automático)", color: "#00e887" };
  if (actor.startsWith("duo_")) return { label: `Plan Duo (${actor})`, color: "#60a5fa" };
  return { label: actor, color: "var(--muted)" };
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  broker_sync_failed: "Sync de broker (Plaid/IOL/IBKR) falló",
  arthur_fallback: "Arthur usó respuesta genérica (modelo principal falló)",
  arthur_total_failure: "Arthur falló por completo (usuario vio error)",
  price_alert_why_failed: "Alerta de precio: no se pudo generar el motivo (Claude/Perplexity falló)",
};

export default function AdminHealthPage() {
  const router = useRouter();
  const { userId, isAuthenticated } = useAuthStore();
  const [tab, setTab] = useState<"audit" | "health">("audit");

  const [email, setEmail] = useState("");
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string | null>(null);

  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !isAuthenticated) return;
    if (userId !== ADMIN_UID) router.push("/");
  }, [userId, isAuthenticated, router]);

  const loadAudit = useCallback(async (targetEmail?: string) => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const res = await adminApi.subscriptionAuditLog(targetEmail || undefined, 200);
      setEntries(res.data.entries);
    } catch (err: any) {
      setAuditError(err?.response?.data?.detail ?? "No se pudo cargar el historial.");
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const res = await adminApi.systemHealth();
      setHealth(res.data);
    } catch (err: any) {
      setHealthError(err?.response?.data?.detail ?? "No se pudo cargar la salud del sistema.");
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userId !== ADMIN_UID) return;
    loadAudit();
    loadHealth();
  }, [userId, loadAudit, loadHealth]);

  if (userId && userId !== ADMIN_UID) return null;

  const problemCats = health ? Object.entries(health.notifications_today.categories_with_problems) : [];
  const eventTypes = health ? Object.entries(health.system_events_today.by_type) : [];

  return (
    <div className="h-screen overflow-y-auto p-6" style={{ background: "var(--bg)" }}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text)" }}>Salud del sistema</h1>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Quién cambió el plan de cada usuario y cuándo, y qué falló hoy — sin tener que bucear en Railway.
          </p>
        </div>

        <div className="flex gap-1.5 p-1 rounded-xl w-fit" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <button
            onClick={() => setTab("audit")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
            style={tab === "audit" ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)" }}
          >
            <History className="w-3.5 h-3.5" /> Cambios de plan
          </button>
          <button
            onClick={() => setTab("health")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
            style={tab === "health" ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)" }}
          >
            <Activity className="w-3.5 h-3.5" /> Salud del sistema hoy
          </button>
        </div>

        {tab === "audit" && (
          <section className="space-y-3">
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadAudit(email)}
                placeholder="Filtrar por correo (vacío = todos)"
                className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
              />
              <button
                onClick={() => loadAudit(email)}
                disabled={auditLoading}
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-white flex items-center gap-1.5"
                style={{ background: "var(--accent)" }}
              >
                {auditLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Buscar
              </button>
              {email && (
                <button
                  onClick={() => { setEmail(""); loadAudit(); }}
                  className="px-3 py-2.5 rounded-xl text-xs font-bold"
                  style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
                >
                  Limpiar
                </button>
              )}
            </div>

            {auditError && <p className="text-sm" style={{ color: "#f87171" }}>{auditError}</p>}
            {auditLoading && !entries && <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--accent)" }} />}

            {entries && (
              <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                {entries.length === 0 ? (
                  <p className="text-sm p-4" style={{ color: "var(--muted)" }}>Sin cambios registrados todavía.</p>
                ) : (
                  <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["Fecha", "Usuario", "Quién/qué lo cambió", "Plan", "Vence", "Razón"].map((h) => (
                          <th key={h} className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--muted)" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => {
                        const a = actorLabel(e.actor);
                        return (
                          <tr key={e.id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--muted)" }}>{fmtDate(e.created_at)}</td>
                            <td className="px-3 py-2.5 truncate max-w-[160px]" style={{ color: "var(--text)" }}>{e.email || e.user_id.slice(0, 8)}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap font-bold" style={{ color: a.color }}>{a.label}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--text)" }}>{e.tier ?? "—"}{e.source ? ` (${e.source})` : ""}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--muted)" }}>{e.premium_until ? e.premium_until.slice(0, 10) : "—"}</td>
                            <td className="px-3 py-2.5" style={{ color: "var(--muted)" }}>{e.reason ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </section>
        )}

        {tab === "health" && (
          <section className="space-y-5">
            <div className="flex items-center justify-between">
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {health && <>Actualizado: {new Date(health.generated_at).toLocaleTimeString("es-MX")}</>}
              </p>
              <button
                onClick={loadHealth}
                disabled={healthLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
                style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
              >
                {healthLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Refrescar
              </button>
            </div>

            {healthError && <p className="text-sm" style={{ color: "#f87171" }}>{healthError}</p>}
            {healthLoading && !health && <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--accent)" }} />}

            {health && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Notificaciones hoy</p>
                    <p className="text-2xl font-black" style={{ color: "var(--text)" }}>{health.notifications_today.total}</p>
                  </div>
                  <div className="rounded-xl border p-4" style={{ borderColor: problemCats.length ? "#f59e0b" : "var(--border)", background: "var(--card)" }}>
                    <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Categorías con fallos</p>
                    <p className="text-2xl font-black" style={{ color: problemCats.length ? "#f59e0b" : "var(--text)" }}>{problemCats.length}</p>
                  </div>
                  <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Eventos de sistema hoy</p>
                    <p className="text-2xl font-black" style={{ color: "var(--text)" }}>{health.system_events_today.total}</p>
                  </div>
                  <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>Tipos distintos</p>
                    <p className="text-2xl font-black" style={{ color: "var(--text)" }}>{eventTypes.length}</p>
                  </div>
                </div>

                {problemCats.length > 0 && (
                  <div className="rounded-xl border p-4" style={{ borderColor: "#f59e0b", background: "rgba(245,158,11,0.08)" }}>
                    <p className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{ color: "#f59e0b" }}>
                      <AlertTriangle className="w-3.5 h-3.5" /> Categorías de push con fallos o skips hoy
                    </p>
                    <div className="space-y-1.5">
                      {problemCats.map(([cat, c]) => (
                        <div key={cat} className="flex items-center justify-between text-sm">
                          <span style={{ color: "var(--text)" }}>{cat}</span>
                          <span style={{ color: "var(--muted)" }}>
                            {c.sent} enviadas · <span style={{ color: "#f87171" }}>{c.failed} fallidas</span> · <span style={{ color: "#fbbf24" }}>{c.skipped} omitidas</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {problemCats.length === 0 && health.notifications_today.total > 0 && (
                  <p className="text-xs" style={{ color: "var(--muted)" }}>Sin fallos ni omisiones en ninguna categoría de push hoy.</p>
                )}

                <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <p className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                    <Radio className="w-3.5 h-3.5" /> Eventos recientes (sync de brokers, Arthur)
                  </p>
                  {health.system_events_today.recent.length === 0 ? (
                    <p className="text-sm" style={{ color: "var(--dim)" }}>Sin eventos registrados hoy — buena señal.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-96 overflow-y-auto">
                      {health.system_events_today.recent.map((ev) => (
                        <div key={ev.id} className="flex items-start justify-between gap-3 text-sm py-1" style={{ borderTop: "1px solid var(--border)" }}>
                          <div className="min-w-0 pt-1">
                            <p className="font-bold" style={{ color: ev.event_type === "arthur_total_failure" ? "#f87171" : "#f59e0b" }}>
                              {EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                            </p>
                            {ev.detail && <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{ev.detail}</p>}
                          </div>
                          <span className="shrink-0 text-xs pt-1" style={{ color: "var(--muted)" }}>{fmtDate(ev.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] mt-3" style={{ color: "var(--dim)" }}>
                    Este log solo tiene datos desde que se desplegó (2026-10-26) — no hay historial anterior.
                  </p>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
