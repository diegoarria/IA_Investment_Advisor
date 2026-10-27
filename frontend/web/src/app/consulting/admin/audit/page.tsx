"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/consulting/AdminShell";
import { consultingAdminApi } from "@/lib/api";

interface AuditEntry { id: string; actor: string; action: string; enrollment_id: string | null; detail: string | null; created_at: string }

const ACTION_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  report_published: { label: "Reporte publicado", bg: "rgba(85,138,66,.12)", fg: "#3E6B30" },
  session_closed: { label: "Sesión cerrada", bg: "rgba(14,30,58,.07)", fg: "#0E1E3A" },
  payment_status_changed: { label: "Pago actualizado", bg: "rgba(199,168,107,.15)", fg: "#B3915A" },
  private_note_added: { label: "Nota agregada", bg: "rgba(14,30,58,.06)", fg: "#5B6477" },
  staff_role_changed: { label: "Permiso cambiado", bg: "rgba(185,74,55,.1)", fg: "#B94A37" },
  enrollment_created: { label: "Inscripción creada", bg: "rgba(85,138,66,.12)", fg: "#3E6B30" },
};

function AuditInner() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consultingAdminApi.auditLog(200)
      .then((res) => setEntries(res.data.entries))
      .catch((err) => setError(err?.response?.status === 403 ? "Solo administradores del programa pueden ver la auditoría." : "No pudimos cargar el historial."));
  }, []);

  return (
    <>
      <div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 26, margin: 0 }}>Auditoría</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--c-ink-soft)" }}>Cada cambio administrativo queda registrado — quién, qué y cuándo.</p>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Fecha", "Quién", "Acción", "Detalle"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 10.5, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 700, borderBottom: "1px solid var(--c-line-strong)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries === null ? (
              <tr><td colSpan={4} style={{ padding: 24, color: "var(--c-ink-soft)" }}>Cargando…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 24, color: "var(--c-ink-soft)" }}>Sin cambios registrados todavía.</td></tr>
            ) : entries.map((e) => {
              const a = ACTION_LABEL[e.action] ?? { label: e.action, bg: "rgba(14,30,58,.06)", fg: "#5B6477" };
              return (
                <tr key={e.id} style={{ borderBottom: "1px solid var(--c-line)" }}>
                  <td style={{ padding: "13px 14px", color: "var(--c-ink-soft)", whiteSpace: "nowrap" }}>{new Date(e.created_at).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                  <td style={{ padding: "13px 14px", fontWeight: 600, color: "var(--c-navy)" }}>{e.actor}</td>
                  <td style={{ padding: "13px 14px" }}><span style={{ display: "inline-flex", height: 22, padding: "0 9px", borderRadius: 3, fontSize: 11, fontWeight: 600, background: a.bg, color: a.fg, whiteSpace: "nowrap" }}>{a.label}</span></td>
                  <td style={{ padding: "13px 14px", color: "var(--c-ink-soft)" }}>{e.detail ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function AdminAuditPage() {
  return <AdminShell><AuditInner /></AdminShell>;
}
