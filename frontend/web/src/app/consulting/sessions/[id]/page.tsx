"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ConsultingShell from "@/components/consulting/Shell";
import { consultingApi } from "@/lib/api";

interface Session { id: string; scheduled_at: string; status: string; mode: string; agenda: string | null; notes: string | null }

function SessionDetailInner() {
  const params = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consultingApi.session(params.id)
      .then((res) => setSession(res.data))
      .catch((err) => setError(err?.response?.status === 404 ? "Esta sesión no existe o ya no tienes acceso a ella." : "No pudimos cargar esta sesión."));
  }, [params.id]);

  if (error) {
    return (
      <>
        <Link href="/consulting/sessions" style={{ fontSize: 13, fontWeight: 600, color: "var(--c-ink-soft)" }}>← Volver a Mis Sesiones</Link>
        <p style={{ fontSize: 14, color: "#B94A37" }}>{error}</p>
      </>
    );
  }
  if (!session) return <p style={{ fontSize: 14, color: "var(--c-ink-soft)" }}>Cargando…</p>;

  const d = new Date(session.scheduled_at);

  return (
    <div style={{ maxWidth: 860, display: "flex", flexDirection: "column", gap: 28 }}>
      <Link href="/consulting/sessions" style={{ fontSize: 13, fontWeight: 600, color: "var(--c-ink-soft)" }}>← Volver a Mis Sesiones</Link>

      <div>
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600 }}>
          {d.toLocaleDateString("es-MX", { day: "numeric", month: "long" })} · {d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })}
        </div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 28, margin: "8px 0 0", maxWidth: 620 }}>
          {session.agenda || "Sesión 1:1"}
        </h1>
        <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--c-ink-soft)" }}>
          {session.status === "scheduled" ? "Próxima sesión" : session.status === "completed" ? "Sesión completada" : "Sesión cancelada"} · {session.mode}
        </p>
      </div>

      {session.notes ? (
        <div>
          <h3 style={{ fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600, margin: "0 0 14px" }}>Notas de la sesión</h3>
          <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 28 }}>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: "var(--c-ink)", whiteSpace: "pre-wrap" }}>{session.notes}</p>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>
          {session.status === "scheduled" ? "Las notas aparecen aquí después de la sesión." : "Esta sesión no tiene notas registradas."}
        </p>
      )}
    </div>
  );
}

export default function ConsultingSessionDetailPage() {
  return <ConsultingShell><SessionDetailInner /></ConsultingShell>;
}
