"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, Search, User, Wallet, Star, TrendingUp } from "lucide-react";
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

const fmtUSD = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function AdminUserLookupPage() {
  const router = useRouter();
  const { userId, isAuthenticated } = useAuthStore();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!userId || !isAuthenticated) return;
    if (userId !== ADMIN_UID) router.push("/");
  }, [userId, isAuthenticated, router]);

  const handleSearch = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    try {
      const res = await adminApi.getUserSnapshot(email.trim());
      setSnapshot(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "No se pudo cargar el perfil.");
    } finally {
      setLoading(false);
    }
  };

  if (userId && userId !== ADMIN_UID) return null;

  return (
    <div className="h-screen overflow-y-auto p-6" style={{ background: "var(--bg)" }}>
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text)" }}>Ver perfil de usuario</h1>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Vista de solo lectura — busca por correo para ver el perfil completo de cualquier cuenta.
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
                <p style={{ color: "var(--text)" }}><b>Plan:</b> {snapshot.profile.subscription_tier ?? "free"}</p>
                <p style={{ color: "var(--text)" }}><b>Trial desde:</b> {snapshot.profile.trial_started_at?.slice(0, 10) ?? "—"}</p>
                <p style={{ color: "var(--text)" }}><b>Estilo inversión:</b> {snapshot.profile.investing_style ?? "—"}</p>
                <p style={{ color: "var(--text)" }}><b>Nivel:</b> {snapshot.profile.knowledge_level ?? "—"}</p>
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
      </div>
    </div>
  );
}
