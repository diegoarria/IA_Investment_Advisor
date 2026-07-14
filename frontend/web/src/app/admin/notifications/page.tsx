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
  const [reportSending, setReportSending] = useState(false);
  const [reportResult, setReportResult] = useState<"sent" | "error" | null>(null);

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

  async function sendMonthlyReport(email: string, month: string) {
    setReportSending(true);
    setReportResult(null);
    try {
      const res = await fetch(`${API}/api/admin/send-monthly-report`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, month }),
      });
      // endpoint returns immediately with status:"queued" — treat as sent
      setReportResult(res.ok ? "sent" : "error");
    } catch {
      setReportResult("error");
    }
    setReportSending(false);
  }

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
    <div style={{ background: "#0f1117", color: "#fff", fontFamily: "system-ui,sans-serif", height: "100vh", overflowY: "auto" }}>
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-8">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)" }}
            >
              <Bell className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Notification Analytics</h1>
              <p style={{ color: "#6b7280", fontSize: 13 }}>Admin · Nuvos AI</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {reportResult === "sent" && <span style={{ color: "#22c55e", fontSize: 13, fontWeight: 600 }}>✓ Reporte enviado</span>}
            {reportResult === "error" && <span style={{ color: "#ef4444", fontSize: 13, fontWeight: 600 }}>✗ Error al enviar reporte</span>}
            <button
              onClick={() => sendMonthlyReport("diego.arria19@gmail.com", "Julio 2026")}
              disabled={reportSending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm"
              style={{
                background: reportSending ? "rgba(59,130,246,0.1)" : "rgba(59,130,246,0.15)",
                border: "1px solid rgba(59,130,246,0.4)",
                color: "#60a5fa",
                cursor: reportSending ? "not-allowed" : "pointer",
              }}
            >
              {reportSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart2 className="w-4 h-4" />}
              Enviar reporte Julio
            </button>
            {closeResult === "sent" && <span style={{ color: "#22c55e", fontSize: 13, fontWeight: 600 }}>✓ Push cierre enviado</span>}
            {closeResult === "error" && <span style={{ color: "#ef4444", fontSize: 13, fontWeight: 600 }}>✗ Error al enviar</span>}
            <button
              onClick={testMarketClosePush}
              disabled={closeSending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm"
              style={{
                background: closeSending ? "rgba(251,191,36,0.1)" : "rgba(251,191,36,0.12)",
                border: "1px solid rgba(251,191,36,0.35)",
                color: "#fbbf24",
                cursor: closeSending ? "not-allowed" : "pointer",
              }}
            >
              {closeSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
              Test cierre
            </button>
            {testResult === "sent" && <span style={{ color: "#22c55e", fontSize: 13, fontWeight: 600 }}>✓ Alerta enviada</span>}
            {testResult === "no_channel" && <span style={{ color: "#f59e0b", fontSize: 13, fontWeight: 600 }}>⚠ Sin canal push</span>}
            {testResult === "error" && <span style={{ color: "#ef4444", fontSize: 13, fontWeight: 600 }}>✗ Error al enviar</span>}
            <button
              onClick={sendTestAlert}
              disabled={testSending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm"
              style={{
                background: testSending ? "rgba(34,197,94,0.1)" : "rgba(34,197,94,0.15)",
                border: "1px solid rgba(34,197,94,0.4)",
                color: "#22c55e",
                cursor: testSending ? "not-allowed" : "pointer",
              }}
            >
              {testSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Probar alerta
            </button>
          </div>
        </div>

        {/* Analytics body */}
        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-green-500" />
          </div>
        )}

        {!loading && analyticsError && (
          <div
            className="rounded-2xl p-6 mb-8 text-center"
            style={{ background: "#1a1d27", border: "1px solid rgba(239,68,68,0.3)" }}
          >
            <p style={{ color: "#ef4444", fontSize: 14 }}>
              No se pudieron cargar las analíticas. Verifica que el endpoint esté disponible.
            </p>
          </div>
        )}

        {!loading && !analyticsError && (
          <>
            {/* Totals */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              {[
                { label: "Hoy",         value: totals.today, Icon: Bell },
                { label: "Esta semana", value: totals.week,  Icon: TrendingUp },
                { label: "Este mes",    value: totals.month, Icon: BarChart2 },
              ].map(({ label, value, Icon }) => (
                <div key={label} className="rounded-2xl p-5" style={{ background: "#1a1d27", border: "1px solid #2a2d3a" }}>
                  <div className="flex items-center gap-2 mb-3" style={{ color: "#22c55e" }}>
                    <Icon className="w-5 h-5" />
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#6b7280" }}>
                      {label}
                    </span>
                  </div>
                  <p style={{ fontSize: 36, fontWeight: 900, color: "#fff", margin: 0 }}>
                    {value.toLocaleString()}
                  </p>
                  <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 0" }}>enviadas</p>
                </div>
              ))}
            </div>

            {/* Open rate by category */}
            <div className="rounded-2xl overflow-hidden" style={{ background: "#1a1d27", border: "1px solid #2a2d3a" }}>
              <div className="px-5 py-4" style={{ borderBottom: "1px solid #2a2d3a" }}>
                <p style={{ color: "#22c55e", fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", margin: 0 }}>
                  Tasa de apertura por categoría — últimos 30 días
                </p>
              </div>
              <div className="p-5 space-y-4">
                {cats.length === 0 ? (
                  <p style={{ color: "#6b7280", fontSize: 14, textAlign: "center", padding: "24px 0" }}>
                    Sin datos todavía. Los datos aparecen una vez que se envían notificaciones.
                  </p>
                ) : cats.map((row) => {
                  const barColor = row.open_rate > 20 ? "#22c55e" : row.open_rate > 10 ? "#f59e0b" : "#6b7280";
                  return (
                    <div key={row.category}>
                      <div className="flex justify-between items-center mb-1.5">
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#d1d5db" }}>
                          {row.category.replace(/_/g, " ")}
                        </span>
                        <div className="flex items-center gap-3">
                          <span style={{ fontSize: 12, color: "#6b7280" }}>
                            {row.opened}/{row.sent}
                          </span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: barColor, minWidth: 44, textAlign: "right" }}>
                            {row.open_rate}%
                          </span>
                        </div>
                      </div>
                      <div style={{ height: 8, background: "#2a2d3a", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          borderRadius: 4,
                          width: `${(row.open_rate / maxRate) * 100}%`,
                          background: barColor,
                          transition: "width 0.6s ease",
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
