"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import AdminShell from "@/components/consulting/AdminShell";
import { consultingAdminApi } from "@/lib/api";

interface Detail {
  enrollment: { id: string; status: string; cohort_id: string; current_module_id: string | null; created_at: string };
  profile: { full_name: string; company: string | null; role_title: string | null } | null;
  sessions: { id: string; scheduled_at: string; status: string; agenda: string | null; notes: string | null }[];
  objectives: { id: string; text: string; achieved: boolean }[];
  private_notes: { id: string; note: string; created_at: string }[];
  assignments: { id: string; title: string }[];
  submissions: { id: string; assignment_id: string; submitted_at: string; feedback: string | null }[];
  assessments: { id: string; competency_id: string; level: string; observation: string | null; assessed_at: string }[];
  attendance: { attended: number; total: number };
  payment: { status: string; plan: string; next_charge_at: string | null } | null;
  final_project: { title: string | null; status: string } | null;
  graduation: { completed_at: string | null } | null;
}

const TABS = [
  "perfil", "objetivos", "sesiones", "notas", "entregables", "rubricas", "asistencia", "pagos", "proyecto",
] as const;
type Tab = typeof TABS[number];
const TAB_LABEL: Record<Tab, string> = {
  perfil: "Perfil", objetivos: "Objetivos educativos", sesiones: "Historial de sesiones",
  notas: "Notas privadas", entregables: "Ejercicios y entregables", rubricas: "Rúbricas de competencias",
  asistencia: "Asistencia", pagos: "Estado de pagos", proyecto: "Proyecto final y graduación",
};

const card: React.CSSProperties = { background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 28 };
const eyebrow: React.CSSProperties = { fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600 };

function DetailInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("perfil");
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const load = () => {
    consultingAdminApi.participant(params.id)
      .then((res) => setDetail(res.data))
      .catch((err) => setError(err?.response?.status === 403 ? "No tienes acceso a este participante." : "No pudimos cargar este expediente."));
  };
  useEffect(load, [params.id]);

  const saveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await consultingAdminApi.addPrivateNote(params.id, noteText.trim());
      setNoteText("");
      load();
    } finally {
      setSavingNote(false);
    }
  };

  if (error) {
    return (
      <>
        <Link href="/consulting/admin" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-ink-soft)" }}>← Volver a Participantes</Link>
        <p style={{ fontSize: 14, color: "#B94A37" }}>{error}</p>
      </>
    );
  }
  if (!detail) return <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Cargando…</p>;

  const upcoming = detail.sessions.filter((s) => s.status === "scheduled").sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const initials = (detail.profile?.full_name ?? "??").slice(0, 2).toUpperCase();

  return (
    <>
      <Link href="/consulting/admin" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-ink-soft)" }}>← Volver a Participantes</Link>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--c-navy)", color: "#FAF7F1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 600 }}>{initials}</div>
          <div>
            <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 24, margin: 0 }}>{detail.profile?.full_name ?? "(sin nombre)"}</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--c-ink-soft)" }}>{[detail.profile?.role_title, detail.profile?.company].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <button
          onClick={() => router.push(`/consulting/admin/close-session?enrollment_id=${detail.enrollment.id}`)}
          style={{ height: 40, padding: "0 18px", borderRadius: 4, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: "var(--c-navy)", color: "var(--c-ivory)" }}
        >
          Cerrar sesión
        </button>
      </div>

      <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap" }}>
        <nav style={{ flex: "0 0 220px", display: "flex", flexDirection: "column", gap: 2, background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 8 }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              display: "block", width: "100%", textAlign: "left", padding: "10px 14px", borderRadius: 4, fontSize: 13, fontWeight: 600,
              border: "none", cursor: "pointer", background: tab === t ? "rgba(199,168,107,.15)" : "transparent", color: tab === t ? "var(--c-champagne-2)" : "var(--c-ink-soft)",
            }}>{TAB_LABEL[t]}</button>
          ))}
        </nav>

        <div style={{ flex: 1, minWidth: 0 }}>
          {tab === "perfil" && (
            <div style={card}>
              <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 17, margin: "0 0 18px" }}>Perfil</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 18 }}>
                <div><div style={eyebrow}>Empresa</div><div style={{ fontSize: 14, marginTop: 4 }}>{detail.profile?.company ?? "—"}</div></div>
                <div><div style={eyebrow}>Rol</div><div style={{ fontSize: 14, marginTop: 4 }}>{detail.profile?.role_title ?? "—"}</div></div>
                <div><div style={eyebrow}>Inscrito desde</div><div style={{ fontSize: 14, marginTop: 4 }}>{new Date(detail.enrollment.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}</div></div>
                <div><div style={eyebrow}>Estado</div><div style={{ fontSize: 14, marginTop: 4 }}>{detail.enrollment.status}</div></div>
              </div>
            </div>
          )}

          {tab === "objetivos" && (
            <div style={card}>
              <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 17, margin: "0 0 14px" }}>Objetivos educativos</h3>
              {detail.objectives.length === 0 ? <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Sin objetivos registrados.</p> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {detail.objectives.map((o) => (
                    <div key={o.id} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                        background: o.achieved ? "var(--c-navy)" : "transparent", border: o.achieved ? "none" : "1.5px solid var(--c-line-strong)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {o.achieved && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FAF9F5" strokeWidth={2.6}><path d="M5 13l4 4L19 7" /></svg>}
                      </div>
                      <span style={{ fontSize: 14 }}>{o.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "sesiones" && (
            <div style={{ ...card, padding: "8px 28px" }}>
              <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 17, padding: "20px 0 4px" }}>Historial de sesiones ({detail.sessions.length})</h3>
              {detail.sessions.length === 0 ? <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)", padding: "0 0 20px" }}>Sin sesiones todavía.</p> : detail.sessions.map((s, i) => (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "14px 0", borderBottom: i < detail.sessions.length - 1 ? "1px solid var(--c-line)" : "none" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--c-navy)" }}>{new Date(s.scheduled_at).toLocaleDateString("es-MX", { day: "numeric", month: "long" })} — {s.agenda || "Sesión 1:1"}</span>
                  <span style={{ fontSize: 12.5, color: s.status === "scheduled" ? "var(--c-champagne-2)" : "var(--c-ink-soft)" }}>{s.status === "completed" ? "Completada" : s.status === "scheduled" ? "Agendada" : "Cancelada"}</span>
                </div>
              ))}
            </div>
          )}

          {tab === "notas" && (
            <div style={{ ...card, display: "flex", flexDirection: "column", gap: 16 }}>
              <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 17, margin: 0 }}>Notas privadas del instructor</h3>
              <p style={{ margin: 0, fontSize: 12, color: "var(--c-ink-soft)" }}>Visibles solo para el equipo — nunca aparecen en el portal del alumno.</p>
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} placeholder="Agregar una nota…"
                style={{ width: "100%", fontFamily: "var(--font-sans)", fontSize: 13.5, borderRadius: 4, border: "1px solid var(--c-line-strong)", padding: 12, boxSizing: "border-box", resize: "vertical" }} />
              <button onClick={saveNote} disabled={savingNote || !noteText.trim()} style={{ alignSelf: "flex-start", height: 38, padding: "0 16px", borderRadius: 4, fontSize: 12.5, fontWeight: 600, border: "1px solid var(--c-line-strong)", background: "transparent", color: "var(--c-navy)", cursor: "pointer" }}>
                {savingNote ? "Guardando…" : "Guardar nota"}
              </button>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
                {detail.private_notes.length === 0 ? <p style={{ fontSize: 13, color: "var(--c-ink-soft)" }}>Sin notas todavía.</p> : detail.private_notes.map((n) => (
                  <div key={n.id} style={{ borderTop: "1px solid var(--c-line)", paddingTop: 12 }}>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>{n.note}</p>
                    <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--c-ink-soft)" }}>{new Date(n.created_at).toLocaleString("es-MX")}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "entregables" && (
            <div style={{ ...card, padding: "8px 28px" }}>
              <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 17, padding: "20px 0 4px" }}>Ejercicios y entregables</h3>
              {detail.assignments.length === 0 ? <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)", padding: "0 0 20px" }}>Sin ejercicios asignados.</p> : detail.assignments.map((a, i) => {
                const sub = detail.submissions.find((s) => s.assignment_id === a.id);
                return (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: i < detail.assignments.length - 1 ? "1px solid var(--c-line)" : "none" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--c-navy)" }}>{a.title}</span>
                    <span style={{
                      display: "inline-flex", height: 22, padding: "0 9px", borderRadius: 3, fontSize: 11, fontWeight: 600,
                      background: sub ? (sub.feedback ? "rgba(85,138,66,.12)" : "rgba(14,30,58,.06)") : "rgba(185,74,55,.12)",
                      color: sub ? (sub.feedback ? "#3E6B30" : "var(--c-ink-soft)") : "#B94A37",
                    }}>{sub ? (sub.feedback ? "Con feedback" : "Entregado") : "Pendiente"}</span>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "rubricas" && (
            <div style={{ ...card, padding: "8px 28px" }}>
              <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 17, padding: "20px 0 4px" }}>Rúbricas de competencias</h3>
              {detail.assessments.length === 0 ? <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)", padding: "0 0 20px" }}>Sin evaluaciones todavía.</p> : detail.assessments.map((a, i) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: i < detail.assessments.length - 1 ? "1px solid var(--c-line)" : "none" }}>
                  <div>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--c-navy)" }}>{a.competency_id}</span>
                    {a.observation && <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--c-ink-soft)" }}>{a.observation}</p>}
                  </div>
                  <span style={{ display: "inline-flex", height: 22, padding: "0 9px", borderRadius: 3, fontSize: 11, fontWeight: 600, background: "rgba(199,168,107,.15)", color: "var(--c-champagne-2)", whiteSpace: "nowrap" }}>{a.level}</span>
                </div>
              ))}
            </div>
          )}

          {tab === "asistencia" && (
            <div style={card}>
              <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 17, margin: "0 0 14px" }}>Registro de asistencia</h3>
              <p style={{ margin: 0, fontSize: 14, color: "var(--c-navy)", fontWeight: 600 }}>
                {detail.attendance.attended} de {detail.attendance.total} sesiones — {detail.attendance.total > 0 ? Math.round((detail.attendance.attended / detail.attendance.total) * 100) : 0}%
              </p>
            </div>
          )}

          {tab === "pagos" && (
            <div style={card}>
              <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 17, margin: "0 0 18px" }}>Estado de pagos</h3>
              {detail.payment ? (
                <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
                  <div><div style={eyebrow}>Plan</div><div style={{ fontSize: 14, marginTop: 4 }}>{detail.payment.plan === "monthly" ? "Pagos mensuales" : "Pago único"}</div></div>
                  <div><div style={eyebrow}>Estado</div><div style={{ fontSize: 14, marginTop: 4, fontWeight: 600, color: detail.payment.status === "atrasado" ? "#B94A37" : "#3E6B30" }}>{detail.payment.status === "al_dia" ? "Al día" : detail.payment.status === "atrasado" ? "Atrasado" : "Pendiente"}</div></div>
                  {detail.payment.next_charge_at && <div><div style={eyebrow}>Próximo cobro</div><div style={{ fontSize: 14, marginTop: 4 }}>{new Date(detail.payment.next_charge_at).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}</div></div>}
                </div>
              ) : <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Sin información de pago registrada.</p>}
            </div>
          )}

          {tab === "proyecto" && (
            <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 17, margin: 0 }}>Proyecto final y graduación</h3>
              {detail.final_project ? (
                <p style={{ margin: 0, fontSize: 13.5, color: "var(--c-ink-soft)" }}>{detail.final_project.title || "Sin título"} — {detail.final_project.status}</p>
              ) : <p style={{ margin: 0, fontSize: 13.5, color: "var(--c-ink-soft)" }}>Proyecto final aún no configurado.</p>}
              {detail.graduation?.completed_at ? (
                <p style={{ margin: 0, fontSize: 13.5, color: "#3E6B30", fontWeight: 600 }}>Graduado el {new Date(detail.graduation.completed_at).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}</p>
              ) : <p style={{ margin: 0, fontSize: 13.5, color: "var(--c-ink-soft)" }}>Aún no se gradúa.</p>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function AdminParticipantDetailPage() {
  return <AdminShell><DetailInner /></AdminShell>;
}
