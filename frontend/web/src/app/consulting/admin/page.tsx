"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/consulting/AdminShell";
import { consultingAdminApi } from "@/lib/api";

interface Participant {
  enrollment_id: string;
  user_id: string;
  full_name: string;
  company: string | null;
  created_at: string | null;
  status: string;
  sessions_completed: number;
  next_session_at: string | null;
  pending_assignments: number;
  payment_status: string | null;
  last_interaction: string | null;
  alerts: string[];
}

const ALERT_LABEL: Record<string, string> = {
  payment_overdue: "Pago",
  inactivity_risk: "Riesgo",
  no_session_scheduled: "Sin agendar",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}
function relativeDays(iso: string | null) {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "hoy";
  if (days === 1) return "hace 1 día";
  return `hace ${days} días`;
}

function PaymentBadge({ status }: { status: string | null }) {
  if (status === "atrasado") return <span style={{ display: "inline-flex", height: 22, padding: "0 9px", borderRadius: 3, fontSize: 11, fontWeight: 600, background: "rgba(185,74,55,.12)", color: "#B94A37", alignItems: "center" }}>Pago atrasado</span>;
  if (status === "pendiente") return <span style={{ display: "inline-flex", height: 22, padding: "0 9px", borderRadius: 3, fontSize: 11, fontWeight: 600, background: "rgba(199,168,107,.15)", color: "var(--c-champagne-2)", alignItems: "center" }}>Pago pendiente</span>;
  return <span style={{ display: "inline-flex", height: 22, padding: "0 9px", borderRadius: 3, fontSize: 11, fontWeight: 600, background: "rgba(85,138,66,.12)", color: "#3E6B30", alignItems: "center" }}>Al día</span>;
}

function ParticipantsInner() {
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "alerts">("all");

  useEffect(() => {
    consultingAdminApi.participants()
      .then((res) => setParticipants(res.data.participants))
      .catch(() => setError("No pudimos cargar la lista de participantes."));
  }, []);

  const withAlerts = (participants ?? []).filter((p) => p.alerts.length > 0);
  const shown = filter === "alerts" ? withAlerts : (participants ?? []);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 26, margin: 0 }}>Participantes</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--c-ink-soft)" }}>
            {participants ? `${participants.length} participantes · ${withAlerts.length} con alertas` : "Cargando…"}
          </p>
        </div>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setFilter("all")} style={{
          height: 30, padding: "0 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
          background: filter === "all" ? "var(--c-navy)" : "transparent", color: filter === "all" ? "var(--c-ivory)" : "var(--c-ink-soft)",
          border: `1px solid ${filter === "all" ? "var(--c-navy)" : "var(--c-line-strong)"}`,
        }}>Todos ({participants?.length ?? 0})</button>
        <button onClick={() => setFilter("alerts")} style={{
          height: 30, padding: "0 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
          background: filter === "alerts" ? "#B94A37" : "transparent", color: filter === "alerts" ? "#fff" : "#B94A37",
          border: "1px solid rgba(185,74,55,.4)",
        }}>Con alertas ({withAlerts.length})</button>
      </div>

      <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Participante", "Inscripción", "Sesiones", "Próxima sesión", "Pendientes", "Pagos", "Última interacción", "Alertas"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 10.5, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 700, borderBottom: "1px solid var(--c-line-strong)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {participants === null ? (
              <tr><td colSpan={8} style={{ padding: 24, color: "var(--c-ink-soft)" }}>Cargando…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 24, color: "var(--c-ink-soft)" }}>Sin participantes todavía — usa "Nuevo alumno" para dar de alta al primero.</td></tr>
            ) : shown.map((p) => (
              <tr key={p.enrollment_id} style={{ borderBottom: "1px solid var(--c-line)" }}>
                <td style={{ padding: 14 }}>
                  <Link href={`/consulting/admin/participants/${p.enrollment_id}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--c-navy)", color: "#FAF7F1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                      {p.full_name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--c-navy)" }}>{p.full_name}</div>
                      <div style={{ fontSize: 11, color: "var(--c-ink-soft)" }}>{p.company ?? "—"}</div>
                    </div>
                  </Link>
                </td>
                <td style={{ padding: 14, color: "var(--c-ink-soft)", whiteSpace: "nowrap" }}>{fmtDate(p.created_at)}</td>
                <td style={{ padding: 14 }}>{p.sessions_completed}</td>
                <td style={{ padding: 14, whiteSpace: "nowrap", color: p.next_session_at ? "var(--c-ink)" : "#B94A37", fontWeight: p.next_session_at ? 400 : 600 }}>
                  {p.next_session_at ? new Date(p.next_session_at).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "Sin agendar"}
                </td>
                <td style={{ padding: 14 }}>{p.pending_assignments}</td>
                <td style={{ padding: 14 }}><PaymentBadge status={p.payment_status} /></td>
                <td style={{ padding: 14, color: "var(--c-ink-soft)", whiteSpace: "nowrap" }}>{relativeDays(p.last_interaction)}</td>
                <td style={{ padding: 14 }}>
                  {p.alerts.length === 0 ? "—" : (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {p.alerts.map((a) => (
                        <span key={a} style={{ display: "inline-flex", height: 20, padding: "0 8px", borderRadius: 3, fontSize: 10.5, fontWeight: 600, background: "rgba(185,74,55,.12)", color: "#B94A37", alignItems: "center", whiteSpace: "nowrap" }}>
                          {ALERT_LABEL[a] ?? a}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function AdminParticipantsPage() {
  return <AdminShell><ParticipantsInner /></AdminShell>;
}
