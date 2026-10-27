"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ConsultingShell from "@/components/consulting/Shell";
import { consultingApi } from "@/lib/api";

interface Session { id: string; scheduled_at: string; status: string; agenda: string | null }

function SessionRow({ s }: { s: Session }) {
  const d = new Date(s.scheduled_at);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "18px 0", borderBottom: "1px solid var(--c-line)" }}>
      <div style={{ flex: "0 0 120px" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-navy)" }}>{d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}</div>
        <div style={{ fontSize: 12.5, color: "var(--c-ink-soft)" }}>{d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })}</div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--c-navy)" }}>{s.agenda || "Sesión 1:1"}</div>
      </div>
      <span style={{
        display: "inline-flex", alignItems: "center", height: 22, padding: "0 10px", borderRadius: 3, fontSize: 11, fontWeight: 600,
        background: s.status === "scheduled" ? "rgba(199,168,107,.15)" : "rgba(14,30,58,.06)",
        color: s.status === "scheduled" ? "var(--c-champagne-2)" : "var(--c-ink-soft)",
      }}>{s.status === "scheduled" ? "Agendada" : s.status === "completed" ? "Completada" : "Cancelada"}</span>
      <Link href={`/consulting/sessions/${s.id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--c-navy)", border: "1px solid var(--c-line-strong)", borderRadius: 4, padding: "8px 16px" }}>
        Ver detalle
      </Link>
    </div>
  );
}

function SessionsInner() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consultingApi.sessions()
      .then((res) => setSessions(res.data.sessions))
      .catch(() => setError("No pudimos cargar tus sesiones ahora mismo."));
  }, []);

  const upcoming = (sessions ?? []).filter((s) => s.status === "scheduled").sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const past = (sessions ?? []).filter((s) => s.status !== "scheduled").sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));

  return (
    <>
      <div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 30, margin: 0 }}>Mis Sesiones</h1>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--c-ink-soft)" }}>Tu calendario de acompañamiento 1:1.</p>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      <section>
        <h3 style={{ fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600, margin: "0 0 14px" }}>Próximas</h3>
        <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: "4px 24px" }}>
          {sessions === null ? (
            <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)", padding: "18px 0" }}>Cargando…</p>
          ) : upcoming.length === 0 ? (
            <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)", padding: "18px 0" }}>No tienes sesiones próximas agendadas.</p>
          ) : upcoming.map((s) => <SessionRow key={s.id} s={s} />)}
        </div>
      </section>

      <section>
        <h3 style={{ fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600, margin: "0 0 14px" }}>Historial</h3>
        <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: "4px 24px" }}>
          {sessions === null ? null : past.length === 0 ? (
            <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)", padding: "18px 0" }}>Aún no tienes sesiones pasadas.</p>
          ) : past.map((s) => <SessionRow key={s.id} s={s} />)}
        </div>
      </section>
    </>
  );
}

export default function ConsultingSessionsPage() {
  return <ConsultingShell><SessionsInner /></ConsultingShell>;
}
