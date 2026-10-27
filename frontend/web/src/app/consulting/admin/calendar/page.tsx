"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/consulting/AdminShell";
import { consultingAdminApi } from "@/lib/api";

interface CalendarSession { session_id: string; enrollment_id: string; scheduled_at: string; agenda: string | null; participant_name: string }
interface AvailabilityRow { weekday: number; start_time: string; end_time: string; slot_minutes: number }

const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function groupByDay(sessions: CalendarSession[]): Record<string, CalendarSession[]> {
  const groups: Record<string, CalendarSession[]> = {};
  for (const s of sessions) {
    const key = new Date(s.scheduled_at).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
    (groups[key] ??= []).push(s);
  }
  return groups;
}

function AvailabilityEditor() {
  const [rows, setRows] = useState<Record<number, { enabled: boolean; start: string; end: string }>>({});
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    consultingAdminApi.myAvailability().then((res) => {
      const next: typeof rows = {};
      for (let d = 0; d < 7; d++) next[d] = { enabled: false, start: "09:00", end: "13:00" };
      for (const a of res.data.availability as AvailabilityRow[]) {
        next[a.weekday] = { enabled: true, start: a.start_time.slice(0, 5), end: a.end_time.slice(0, 5) };
      }
      setRows(next);
    }).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const blocks = Object.entries(rows)
        .filter(([, r]) => r.enabled)
        .map(([weekday, r]) => ({ weekday: Number(weekday), start_time: `${r.start}:00`, end_time: `${r.end}:00`, slot_minutes: 50 }));
      await consultingAdminApi.setMyAvailability(blocks);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 20 }}>
      <button onClick={() => setOpen((v) => !v)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <span style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 15, color: "var(--c-navy)" }}>Mi disponibilidad semanal</span>
        <span style={{ fontSize: 12, color: "var(--c-ink-soft)" }}>{open ? "Ocultar" : "Editar"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          {WEEKDAYS.map((label, i) => {
            const r = rows[i] ?? { enabled: false, start: "09:00", end: "13:00" };
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, width: 110, fontSize: 13 }}>
                  <input type="checkbox" checked={r.enabled} onChange={(e) => setRows((prev) => ({ ...prev, [i]: { ...r, enabled: e.target.checked } }))} />
                  {label}
                </label>
                {r.enabled && (
                  <>
                    <input type="time" value={r.start} onChange={(e) => setRows((prev) => ({ ...prev, [i]: { ...r, start: e.target.value } }))}
                      style={{ fontSize: 13, height: 32, borderRadius: 4, border: "1px solid var(--c-line-strong)", padding: "0 8px" }} />
                    <span style={{ fontSize: 12, color: "var(--c-ink-soft)" }}>a</span>
                    <input type="time" value={r.end} onChange={(e) => setRows((prev) => ({ ...prev, [i]: { ...r, end: e.target.value } }))}
                      style={{ fontSize: 13, height: 32, borderRadius: 4, border: "1px solid var(--c-line-strong)", padding: "0 8px" }} />
                  </>
                )}
              </div>
            );
          })}
          <button onClick={save} disabled={saving} style={{ alignSelf: "flex-start", marginTop: 8, height: 38, padding: "0 16px", borderRadius: 4, fontSize: 12.5, fontWeight: 600, border: "none", background: "var(--c-navy)", color: "var(--c-ivory)", cursor: "pointer" }}>
            {saving ? "Guardando…" : "Guardar horarios"}
          </button>
        </div>
      )}
    </div>
  );
}

function CalendarInner() {
  const [sessions, setSessions] = useState<CalendarSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consultingAdminApi.calendar(30)
      .then((res) => setSessions(res.data.sessions))
      .catch(() => setError("No pudimos cargar el calendario."));
  }, []);

  const groups = sessions ? groupByDay(sessions) : {};
  const days = Object.keys(groups);

  return (
    <>
      <div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 26, margin: 0 }}>Calendario</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--c-ink-soft)" }}>Tus próximas sesiones agendadas en los siguientes 30 días.</p>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      <AvailabilityEditor />

      {sessions === null ? (
        <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Cargando…</p>
      ) : days.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Sin sesiones agendadas en los próximos 30 días.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {days.map((day) => (
            <div key={day}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--c-ink-soft)", textTransform: "capitalize", margin: "0 0 10px" }}>{day}</h3>
              <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: "4px 20px" }}>
                {groups[day].map((s, i) => (
                  <Link key={s.session_id} href={`/consulting/admin/participants/${s.enrollment_id}`} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0",
                    borderBottom: i < groups[day].length - 1 ? "1px solid var(--c-line)" : "none", textDecoration: "none",
                  }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--c-navy)" }}>{new Date(s.scheduled_at).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })} — {s.participant_name}</span>
                    {s.agenda && <span style={{ fontSize: 12.5, color: "var(--c-ink-soft)" }}>{s.agenda}</span>}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function AdminCalendarPage() {
  return <AdminShell><CalendarInner /></AdminShell>;
}
