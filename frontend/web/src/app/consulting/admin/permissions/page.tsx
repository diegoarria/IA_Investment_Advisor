"use client";

import { useEffect, useState } from "react";
import AdminShell, { useAdminMe } from "@/components/consulting/AdminShell";
import { consultingAdminApi } from "@/lib/api";

interface TeamMember { user_id: string; email: string | null; role: string; assigned_students: number }

const ROLE_LABEL: Record<string, string> = { instructor: "Instructor", program_admin: "Administrador del programa" };

function PermissionsInner() {
  const me = useAdminMe();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = () => {
    consultingAdminApi.team()
      .then((res) => setTeam(res.data.team))
      .catch((err) => setError(err?.response?.status === 403 ? "Solo administradores del programa pueden ver esta página." : "No pudimos cargar el equipo."));
  };
  useEffect(load, []);

  const changeRole = async (userId: string, role: string) => {
    setUpdating(userId);
    try {
      await consultingAdminApi.updateTeamRole(userId, role);
      load();
    } finally {
      setUpdating(null);
    }
  };

  return (
    <>
      <div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 26, margin: 0 }}>Permisos de acceso</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--c-ink-soft)" }}>Quién del equipo de Nuvos puede ver y editar qué.</p>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      <section>
        <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 15, margin: "0 0 14px" }}>Equipo</h3>
        <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: "4px 24px" }}>
          {team === null ? (
            <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)", padding: "16px 0" }}>Cargando…</p>
          ) : team.length === 0 ? (
            <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)", padding: "16px 0" }}>Sin personal registrado todavía.</p>
          ) : team.map((t, i) => (
            <div key={t.user_id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 0", borderBottom: i < team.length - 1 ? "1px solid var(--c-line)" : "none" }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--c-navy)", color: "#FAF7F1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>
                {(t.email ?? "??").slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-navy)" }}>{t.email}</div>
                <div style={{ fontSize: 12, color: "var(--c-ink-soft)" }}>{t.assigned_students} alumnos asignados</div>
              </div>
              <select
                value={t.role}
                disabled={updating === t.user_id || t.user_id === me.user_id}
                onChange={(e) => changeRole(t.user_id, e.target.value)}
                style={{ height: 34, borderRadius: 4, border: "1px solid var(--c-line-strong)", fontSize: 12.5, padding: "0 10px", background: "var(--c-paper)", color: "var(--c-navy)" }}
              >
                <option value="instructor">Instructor</option>
                <option value="program_admin">Administrador del programa</option>
              </select>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 15, margin: "0 0 14px" }}>Qué puede hacer cada rol</h3>
        <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--c-line-strong)" }}>
                <th style={{ textAlign: "left", padding: "10px 16px", fontSize: 10.5, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-ink-soft)" }}>Puede...</th>
                <th style={{ textAlign: "center", padding: "10px 16px", fontSize: 10.5, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-ink-soft)" }}>Instructor</th>
                <th style={{ textAlign: "center", padding: "10px 16px", fontSize: 10.5, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-ink-soft)" }}>Admin. del programa</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Ver sus propios alumnos asignados", "✓", "✓"],
                ["Ver alumnos de otros instructores", "—", "✓"],
                ["Cerrar sesiones y publicar reportes", "de los suyos", "de todos"],
                ["Crear/editar inscripciones y cohortes", "—", "✓"],
                ["Cambiar permisos del equipo", "—", "✓"],
              ].map(([row, i1, a1]) => (
                <tr key={row} style={{ borderBottom: "1px solid var(--c-line)" }}>
                  <td style={{ padding: "12px 16px" }}>{row}</td>
                  <td style={{ textAlign: "center", color: i1 === "—" ? "var(--c-ink-soft)" : "var(--c-ink)" }}>{i1}</td>
                  <td style={{ textAlign: "center" }}>{a1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--c-ink-soft)" }}>
          Esto refleja la regla ya implementada en el backend: un instructor solo alcanza a sus alumnos asignados, nunca los de otro instructor.
        </p>
      </section>
    </>
  );
}

export default function AdminPermissionsPage() {
  return <AdminShell><PermissionsInner /></AdminShell>;
}
