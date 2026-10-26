"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Bell, TrendingUp, BarChart2, Send } from "lucide-react";
import { useAuthStore } from "@/lib/store";
import { apiBase } from "@/lib/apiBase";

const ADMIN_UID = "86961402-9072-4670-9f73-b2aa91930b04";
const API = apiBase();

interface CategoryStat {
  category: string;
  sent: number;
  opened: number;
  open_rate: number;
}

interface Analytics {
  totals: { today: number; week: number; month: number };
  open_rates_by_category: CategoryStat[];
}

export default function NotificationAnalyticsPage() {
  const router = useRouter();
  const { userId, isAuthenticated } = useAuthStore();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<"sent" | "no_channel" | "error" | null>(null);
  const [closeSending, setCloseSending] = useState(false);
  const [closeResult, setCloseResult] = useState<"sent" | "error" | null>(null);

  useEffect(() => {
    if (!userId || !isAuthenticated) return;   // wait for auth to restore
    if (userId !== ADMIN_UID) { router.push("/"); return; }
    (async () => {
      try {
        const res = await fetch(`${API}/api/notification-settings/analytics`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("forbidden");
        setAnalyticsError(false);
        setData(await res.json());
      } catch {
        setAnalyticsError(true);
      }
      setLoading(false);
    })();
  }, [userId, isAuthenticated, router]);

  async function testMarketClosePush() {
    setCloseSending(true);
    setCloseResult(null);
    try {
      const res = await fetch(`${API}/api/admin/test-market-close-push`, {
        method: "POST",
        credentials: "include",
      });
      setCloseResult(res.ok ? "sent" : "error");
    } catch {
      setCloseResult("error");
    }
    setCloseSending(false);
  }

  async function sendTestAlert() {
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/api/push/test-alert`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) { setTestResult("error"); return; }
      const json = await res.json();
      setTestResult(json.reason === "no_channel" ? "no_channel" : "sent");
    } catch {
      setTestResult("error");
    }
    setTestSending(false);
  }

  const totals = data?.totals ?? { today: 0, week: 0, month: 0 };
  const cats = data?.open_rates_by_category ?? [];
  const maxRate = Math.max(...cats.map((r) => r.open_rate), 1);

  return (
    <div className="h-screen overflow-y-auto p-6" style={{ background: "var(--bg)" }}>
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--text)" }}>Notificaciones</h1>
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              Analíticas de apertura y pruebas de envío en vivo.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {closeResult === "sent" && <span className="text-xs font-bold" style={{ color: "#34d399" }}>✓ Push cierre enviado</span>}
            {closeResult === "error" && <span className="text-xs font-bold" style={{ color: "#f87171" }}>✗ Error al enviar</span>}
            <button
              onClick={testMarketClosePush}
              disabled={closeSending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              {closeSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
              Test cierre
            </button>
            {testResult === "sent" && <span className="text-xs font-bold" style={{ color: "#34d399" }}>✓ Alerta enviada</span>}
            {testResult === "no_channel" && <span className="text-xs font-bold" style={{ color: "#fbbf24" }}>⚠ Sin canal push</span>}
            {testResult === "error" && <span className="text-xs font-bold" style={{ color: "#f87171" }}>✗ Error al enviar</span>}
            <button
              onClick={sendTestAlert}
              disabled={testSending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white"
              style={{ background: "var(--accent)" }}
            >
              {testSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Probar alerta
            </button>
          </div>
        </div>

        {/* Analytics body */}
        {loading && <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent)" }} />}

        {!loading && analyticsError && (
          <div className="rounded-xl border p-4 text-center" style={{ borderColor: "#f87171", background: "rgba(248,113,113,0.08)" }}>
            <p className="text-sm" style={{ color: "#f87171" }}>
              No se pudieron cargar las analíticas. Verifica que el endpoint esté disponible.
            </p>
          </div>
        )}

        {!loading && !analyticsError && (
          <>
            {/* Totals */}
            <section className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Enviadas</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Hoy",         value: totals.today, Icon: Bell },
                  { label: "Esta semana", value: totals.week,  Icon: TrendingUp },
                  { label: "Este mes",    value: totals.month, Icon: BarChart2 },
                ].map(({ label, value, Icon }) => (
                  <div key={label} className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <div className="flex items-center gap-1.5 mb-2" style={{ color: "var(--muted)" }}>
                      <Icon className="w-3.5 h-3.5" />
                      <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
                    </div>
                    <p className="text-2xl font-black" style={{ color: "var(--text)" }}>{value.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Open rate by category */}
            <section className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Tasa de apertura por categoría — últimos 30 días
              </p>
              <div className="rounded-xl border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                {cats.length === 0 ? (
                  <p className="text-sm text-center py-4" style={{ color: "var(--muted)" }}>
                    Sin datos todavía. Los datos aparecen una vez que se envían notificaciones.
                  </p>
                ) : cats.map((row) => {
                  const barColor = row.open_rate > 20 ? "#34d399" : row.open_rate > 10 ? "#fbbf24" : "var(--muted)";
                  return (
                    <div key={row.category}>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-sm font-bold capitalize" style={{ color: "var(--text)" }}>
                          {row.category.replace(/_/g, " ")}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs" style={{ color: "var(--muted)" }}>{row.opened}/{row.sent}</span>
                          <span className="text-sm font-bold w-11 text-right" style={{ color: barColor }}>{row.open_rate}%</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                        <div style={{
                          height: "100%", borderRadius: 4,
                          width: `${(row.open_rate / maxRate) * 100}%`,
                          background: barColor, transition: "width 0.6s ease",
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

      </div>
    </div>
  );
}
