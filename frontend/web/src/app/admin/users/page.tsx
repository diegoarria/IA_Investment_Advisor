"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, Search, User, Wallet, TrendingUp, ShieldCheck, Users as UsersIcon, RefreshCw, AlertTriangle } from "lucide-react";
import { useAuthStore } from "@/lib/store";
import { adminApi } from "@/lib/api";

const ADMIN_UID = "86961402-9072-4670-9f73-b2aa91930b04";

interface Snapshot {
  user_id: string;
  email: string;
  profile: Record<string, any>;
  positions: { ticker: string; shares?: number; avgPrice?: number }[];
  watchlist: { ticker: string; name?: string }[];
  progress: Record<string, any>;
}

interface UserRow {
  user_id: string;
  email: string | null;
  name: string | null;
  raw_tier: string;
  effective_tier: "premium" | "free";
  is_trial: boolean;
  is_paying: boolean;
  subscription_source: string | null;
  has_stripe_customer: boolean;
  premium_until: string | null;
  portfolio_positions: number;
  portfolio_imported: boolean;
  broker_name: string | null;
  watchlist_count: number;
  push_enabled: boolean;
  notifications_sent_30d: number;
  created_at: string | null;
}

const fmtUSD = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

// Mirrors backend's MANUAL_PREMIUM_DURATIONS_DAYS — the only durations
// the admin panel offers, by design (Diego: "solo estas").
const PREMIUM_DURATIONS: { value: string; label: string }[] = [
  { value: "none", label: "Sin vencimiento" },
  { value: "30d", label: "30 días" },
  { value: "60d", label: "60 días" },
  { value: "90d", label: "90 días" },
  { value: "120d", label: "120 días" },
  { value: "1y", label: "1 año" },
];

// A raw tier of "premium" that is_premium_active() would now reject (an
// expired premium_until that never got refreshed by a renewal webhook —
// exactly the bug found 2026-10-26, affecting Diego's own account plus 2
// other real Stripe payers, all three lapsing right around the Railway
// security incident). Surfacing this in the table is the whole point —
// the raw "Plan: premium" column alone is what hid this the first time.
function isLapsed(u: UserRow): boolean {
  return u.raw_tier === "premium" && u.effective_tier === "free";
}

// Mirrors backend app/core/subscription.py::is_premium_active — needed
// here because showing raw `profile.subscription_tier` alone (what this
// panel used to do) is EXACTLY what hid the 2026-10-26 bug: it read
// "premium" even for an account whose premium_until had already passed.
function snapshotIsActive(p: Record<string, any>): boolean {
  const tier = p.subscription_tier || "free";
  if (tier === "premium" || tier === "pro") {
    if (p.premium_until) {
      const until = new Date(p.premium_until).getTime();
      if (!Number.isNaN(until)) return until > Date.now();
    }
    return true;
  }
  if (p.trial_started_at) {
    const started = new Date(p.trial_started_at).getTime();
    if (!Number.isNaN(started) && (Date.now() - started) / 86400000 < 30) return true;
  }
  if (p.streak_bonus_premium_until) {
    const bonusEnd = new Date(p.streak_bonus_premium_until).getTime();
    if (!Number.isNaN(bonusEnd) && bonusEnd > Date.now()) return true;
  }
  return false;
}

export default function AdminUserLookupPage() {
  const router = useRouter();
  const { userId, isAuthenticated } = useAuthStore();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [togglingPremium, setTogglingPremium] = useState(false);
  const [premiumDuration, setPremiumDuration] = useState("none");

  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [resyncingEmail, setResyncingEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !isAuthenticated) return;
    if (userId !== ADMIN_UID) router.push("/");
  }, [userId, isAuthenticated, router]);

  const loadUsers = async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await adminApi.usersList();
      setUsers(res.data.users);
    } catch (err: any) {
      setUsersError(err?.response?.data?.detail ?? "No se pudo cargar la lista de usuarios.");
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (userId !== ADMIN_UID) return;
    loadUsers();
  }, [userId]);

  const handleResync = async (targetEmail: string) => {
    setResyncingEmail(targetEmail);
    try {
      await adminApi.resyncSubscription(targetEmail);
      await loadUsers();
      if (snapshot?.email === targetEmail) {
        const res = await adminApi.getUserSnapshot(targetEmail);
        setSnapshot(res.data);
      }
    } catch (err: any) {
      setUsersError(err?.response?.data?.detail ?? "No se pudo resincronizar con Stripe.");
    } finally {
      setResyncingEmail(null);
    }
  };

  const fetchSnapshot = async (target: string) => {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    try {
      const res = await adminApi.getUserSnapshot(target.trim());
      setSnapshot(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "No se pudo cargar el perfil.");
    } finally {
      setLoading(false);
    }
  };
  const handleSearch = () => fetchSnapshot(email);
  const viewUser = (targetEmail: string) => {
    setEmail(targetEmail);
    fetchSnapshot(targetEmail);
  };

  const isManualPremium = snapshot?.profile.subscription_tier === "premium"
    && snapshot?.profile.subscription_source === "manual_comp";

  const handleTogglePremium = async () => {
    if (!snapshot) return;
    setTogglingPremium(true);
    try {
      const enable = !isManualPremium;
      const res = await adminApi.setPremium(snapshot.email, enable, premiumDuration);
      setSnapshot({
        ...snapshot,
        profile: {
          ...snapshot.profile,
          subscription_tier: enable ? "premium" : "free",
          subscription_source: enable ? "manual_comp" : null,
          premium_until: res.data.premium_until ?? null,
        },
      });
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "No se pudo cambiar el plan.");
    } finally {
      setTogglingPremium(false);
    }
  };

  if (userId && userId !== ADMIN_UID) return null;

  const lapsedCount = users?.filter(isLapsed).length ?? 0;

  return (
    <div className="h-screen overflow-y-auto p-6" style={{ background: "var(--bg)" }}>
      <div className="max-w-6xl mx-auto space-y-8">

        {/* ── Todos los usuarios ── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--text)" }}>
                <UsersIcon className="w-5 h-5" /> Todos los usuarios {users && <span style={{ color: "var(--muted)" }}>({users.length})</span>}
              </h1>
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                Plan, pago, portafolio importado y notificaciones de cada cuenta, en un solo lugar.
              </p>
            </div>
            <button
              onClick={loadUsers}
              disabled={usersLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              {usersLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refrescar
            </button>
          </div>

          {usersError && <p className="text-sm" style={{ color: "#f87171" }}>{usersError}</p>}

          {lapsedCount > 0 && (
            <div className="rounded-xl border p-3 flex items-center gap-2" style={{ borderColor: "#f59e0b", background: "rgba(245,158,11,0.08)" }}>
              <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "#f59e0b" }} />
              <p className="text-xs" style={{ color: "#f59e0b" }}>
                {lapsedCount} cuenta{lapsedCount > 1 ? "s" : ""} de Stripe con el plan vencido sin renovarse (columna Plan en amarillo) — probablemente por el incidente de Railway del 21-22 de octubre. Dale "Resync" para corregirlas desde Stripe.
              </p>
            </div>
          )}

          {usersLoading && !users && <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--accent)" }} />}

          {users && (
            <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Usuario", "Plan", "Pagando", "Portafolio", "Watchlist", "Push", "Notif. 30d", "Registrado", ""].map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--muted)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const lapsed = isLapsed(u);
                    return (
                      <tr key={u.user_id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td className="px-3 py-2.5">
                          <p className="font-bold truncate max-w-[180px]" style={{ color: "var(--text)" }}>{u.name || "—"}</p>
                          <p className="text-[11px] truncate max-w-[180px]" style={{ color: "var(--muted)" }}>{u.email}</p>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {lapsed ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.35)" }}>
                              <AlertTriangle className="w-3 h-3" /> Vencido
                            </span>
                          ) : u.effective_tier === "premium" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(0,212,126,0.12)", color: "var(--accent-l, #00e887)", border: "1px solid rgba(0,212,126,0.3)" }}>
                              {u.is_trial ? "Trial" : u.subscription_source === "manual_comp" ? "Manual" : "Premium"}
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--raised)", color: "var(--dim)", border: "1px solid var(--border)" }}>
                              Free
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5" style={{ color: u.is_paying ? "var(--text)" : "var(--dim)" }}>{u.is_paying ? "Sí" : "No"}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--text)" }}>
                          {u.portfolio_positions} pos.{u.portfolio_imported && (
                            <span className="text-[11px] ml-1" style={{ color: "var(--muted)" }}>({u.broker_name || "broker"})</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5" style={{ color: "var(--text)" }}>{u.watchlist_count}</td>
                        <td className="px-3 py-2.5" style={{ color: u.push_enabled ? "var(--text)" : "var(--dim)" }}>{u.push_enabled ? "Sí" : "No"}</td>
                        <td className="px-3 py-2.5" style={{ color: "var(--text)" }}>{u.notifications_sent_30d}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--muted)" }}>{u.created_at?.slice(0, 10) ?? "—"}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {lapsed && (
                              <button
                                onClick={() => u.email && handleResync(u.email)}
                                disabled={resyncingEmail === u.email}
                                className="text-[11px] font-bold px-2 py-1 rounded-lg flex items-center gap-1"
                                style={{ background: "#f59e0b", color: "#000" }}
                              >
                                {resyncingEmail === u.email ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                Resync
                              </button>
                            )}
                            <button
                              onClick={() => u.email && viewUser(u.email)}
                              className="text-[11px] font-bold px-2 py-1 rounded-lg"
                              style={{ background: "var(--raised)", color: "var(--text)", border: "1px solid var(--border)" }}
                            >
                              Ver
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Buscar y ver detalle de un usuario ── */}
        <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>Ver detalle de un usuario</h2>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Busca por correo (o pulsa "Ver" en la tabla de arriba) para ver el perfil completo de una cuenta.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="correo@ejemplo.com"
            className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          <button
            onClick={handleSearch}
            disabled={loading || !email.trim()}
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-white flex items-center gap-1.5"
            style={{ background: "var(--accent)" }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Buscar
          </button>
        </div>

        {error && <p className="text-sm" style={{ color: "#f87171" }}>{error}</p>}

        {snapshot && (
          <div className="space-y-4">
            {/* Perfil */}
            <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <p className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                <User className="w-3.5 h-3.5" /> PERFIL
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p style={{ color: "var(--text)" }}><b>Nombre:</b> {snapshot.profile.name ?? "—"}</p>
                <p style={{ color: "var(--text)" }}><b>Correo:</b> {snapshot.email}</p>
                <p style={{ color: "var(--text)" }}><b>País:</b> {snapshot.profile.country ?? "—"}</p>
                <p style={{ color: "var(--text)" }}><b>Riesgo:</b> {snapshot.profile.risk_tolerance ?? "—"}</p>
                <p style={{ color: "var(--text)" }}>
                  <b>Plan real (tabla):</b> {snapshot.profile.subscription_tier ?? "free"}
                  {snapshot.profile.subscription_tier === "premium" && !snapshotIsActive(snapshot.profile) && (
                    <span className="ml-1.5 text-[11px] font-bold" style={{ color: "#f59e0b" }}>⚠ vencido, premium_until ya pasó</span>
                  )}
                </p>
                <p style={{ color: "var(--text)" }}><b>Trial desde:</b> {snapshot.profile.trial_started_at?.slice(0, 10) ?? "—"}</p>
                <p style={{ color: "var(--text)" }}><b>Estilo inversión:</b> {snapshot.profile.investing_style ?? "—"}</p>
                <p style={{ color: "var(--text)" }}><b>Nivel:</b> {snapshot.profile.knowledge_level ?? "—"}</p>
              </div>
              {snapshot.profile.subscription_tier === "premium" && !snapshotIsActive(snapshot.profile) && (
                <div className="mt-3 rounded-lg border p-3 flex items-center justify-between gap-3" style={{ borderColor: "#f59e0b", background: "rgba(245,158,11,0.08)" }}>
                  <p className="text-xs" style={{ color: "#f59e0b" }}>
                    La app le muestra Free aunque este panel diga "premium" — su plan venció el {snapshot.profile.premium_until?.slice(0, 10)} y nunca se renovó.
                  </p>
                  <button
                    onClick={() => handleResync(snapshot.email)}
                    disabled={resyncingEmail === snapshot.email}
                    className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1"
                    style={{ background: "#f59e0b", color: "#000" }}
                  >
                    {resyncingEmail === snapshot.email ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Resync con Stripe
                  </button>
                </div>
              )}
              <div className="mt-4 pt-3 border-t flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: "var(--border)" }}>
                <div>
                  <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: "var(--text)" }}>
                    <ShieldCheck className="w-3.5 h-3.5" /> Premium manual
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>
                    {isManualPremium
                      ? snapshot.profile.premium_until
                        ? `Activado — vence el ${snapshot.profile.premium_until.slice(0, 10)}.`
                        : "Activado — sin vencimiento."
                      : "Apagado — el plan depende de Stripe/trial normal."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!isManualPremium && (
                    <select
                      value={premiumDuration}
                      onChange={(e) => setPremiumDuration(e.target.value)}
                      className="px-2.5 py-2 rounded-xl text-xs font-bold outline-none"
                      style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                    >
                      {PREMIUM_DURATIONS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={handleTogglePremium}
                    disabled={togglingPremium}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-white flex items-center gap-1.5"
                    style={{ background: isManualPremium ? "#dc2626" : "var(--accent)" }}
                  >
                    {togglingPremium ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {isManualPremium ? "Quitar Premium" : "Dar Premium"}
                  </button>
                </div>
              </div>
            </section>

            {/* Progreso */}
            {Object.keys(snapshot.progress).length > 0 && (
              <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <p className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                  <TrendingUp className="w-3.5 h-3.5" /> EVOLUCIÓN COMO INVERSIONISTA
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {snapshot.progress.capital_invested !== undefined && (
                    <p style={{ color: "var(--text)" }}><b>Capital invertido:</b> {fmtUSD(snapshot.progress.capital_invested)}</p>
                  )}
                  {snapshot.progress.current_patrimonio !== undefined && (
                    <p style={{ color: "var(--text)" }}><b>Patrimonio actual:</b> {fmtUSD(snapshot.progress.current_patrimonio)}</p>
                  )}
                  {snapshot.progress.cumulative_return_pct !== undefined && (
                    <p style={{ color: "var(--text)" }}><b>Retorno acumulado:</b> {snapshot.progress.cumulative_return_pct}%</p>
                  )}
                  {snapshot.progress.consecutive_months_contributing !== undefined && (
                    <p style={{ color: "var(--text)" }}><b>Meses seguidos:</b> {snapshot.progress.consecutive_months_contributing}</p>
                  )}
                </div>
              </section>
            )}

            {/* Portafolio */}
            <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <p className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                <Wallet className="w-3.5 h-3.5" /> PORTAFOLIO ({snapshot.positions.length})
              </p>
              {snapshot.positions.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--dim)" }}>Sin posiciones.</p>
              ) : (
                <div className="space-y-1">
                  {snapshot.positions.map((p, i) => (
                    <p key={i} className="text-sm" style={{ color: "var(--text)" }}>
                      {p.ticker} — {p.shares ?? "?"} acciones @ ${p.avgPrice ?? "?"}
                    </p>
                  ))}
                </div>
              )}
              <p className="text-xs font-bold mt-4 mb-2" style={{ color: "var(--muted)" }}>WATCHLIST ({snapshot.watchlist.length})</p>
              <p className="text-sm" style={{ color: "var(--text)" }}>
                {snapshot.watchlist.map((w) => w.ticker).join(", ") || "—"}
              </p>
            </section>

          </div>
        )}
        </section>
      </div>
    </div>
  );
}
