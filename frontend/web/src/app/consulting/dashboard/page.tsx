"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ConsultingShell, { useConsultingMe } from "@/components/consulting/Shell";
import { consultingApi } from "@/lib/api";

interface Module { id: string; order_index: number; title: string; description: string | null }
interface Session { id: string; scheduled_at: string; status: string; agenda: string | null }
interface Assignment { id: string; title: string; description: string | null; due_offset_days: number | null }
interface Submission { id: string; assignment_id: string }

function DashboardInner() {
  const me = useConsultingMe();
  const [modules, setModules] = useState<Module[] | null>(null);
  const [currentModuleId, setCurrentModuleId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      consultingApi.program(),
      consultingApi.sessions(),
      consultingApi.assignments(),
    ]).then(([programRes, sessionsRes, assignmentsRes]) => {
      if (programRes.status === "fulfilled") {
        setModules(programRes.value.data.modules);
        setCurrentModuleId(programRes.value.data.current_module_id);
      } else {
        setError("No pudimos cargar tu programa ahora mismo.");
      }
      if (sessionsRes.status === "fulfilled") setSessions(sessionsRes.value.data.sessions);
      if (assignmentsRes.status === "fulfilled") {
        setAssignments(assignmentsRes.value.data.assignments);
        setSubmissions(assignmentsRes.value.data.submissions);
      }
    });
  }, []);

  const currentModule = modules?.find((m) => m.id === currentModuleId) ?? null;
  const totalModules = modules?.length ?? 0;
  const currentIndex = currentModule ? modules!.findIndex((m) => m.id === currentModuleId) : -1;

  const nextSession = sessions
    ?.filter((s) => s.status === "scheduled")
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0] ?? null;

  const submittedIds = new Set((submissions ?? []).map((s) => s.assignment_id));
  const nextAssignment = assignments?.find((a) => !submittedIds.has(a.id)) ?? null;

  const firstName = (me.email ?? "").split("@")[0];

  return (
    <>
      <div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 30, margin: 0 }}>
          Bienvenida, {firstName || "de vuelta"}.
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--c-ink-soft)" }}>
          {new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      {/* Dónde estás */}
      <section style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 32, display: "flex", flexDirection: "column", gap: 18 }}>
        {currentModule ? (
          <>
            <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600 }}>
              Fase actual · módulo {currentIndex + 1} de {totalModules}
            </div>
            <h2 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 24, maxWidth: 640, lineHeight: 1.3, margin: 0 }}>
              {currentModule.title}
            </h2>
            {currentModule.description && (
              <p style={{ margin: 0, fontSize: 14, color: "var(--c-ink-soft)", maxWidth: 600, lineHeight: 1.6 }}>{currentModule.description}</p>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
              <div style={{ display: "flex", gap: 4 }}>
                {modules!.map((m, i) => (
                  <div key={m.id} style={{ width: 40, height: 5, borderRadius: 3, background: i <= currentIndex ? "var(--c-champagne)" : "var(--c-line-strong)" }} />
                ))}
              </div>
              <Link href="/consulting/program" style={{ fontSize: 13, fontWeight: 600, color: "var(--c-navy)" }}>Ver mi programa completo →</Link>
            </div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 14, color: "var(--c-ink-soft)" }}>
            Aún no te hemos asignado un módulo activo. Tu coach lo configura al iniciar el programa.
          </p>
        )}
      </section>

      {/* Qué sigue */}
      <section>
        <h3 style={{ fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600, margin: "0 0 16px" }}>Qué sigue</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 20 }}>
          <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 28, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600 }}>Próxima sesión</div>
            {nextSession ? (
              <>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 600, color: "var(--c-navy)" }}>
                    {new Date(nextSession.scheduled_at).toLocaleString("es-MX", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>
                {nextSession.agenda && <p style={{ margin: 0, fontSize: 13.5, color: "var(--c-ink-soft)", lineHeight: 1.5 }}>{nextSession.agenda}</p>}
                <Link href={`/consulting/sessions/${nextSession.id}`} style={{ alignSelf: "flex-start", marginTop: 4, fontSize: 13.5, fontWeight: 600, color: "var(--c-navy)", border: "1px solid var(--c-line-strong)", borderRadius: 4, padding: "9px 16px" }}>
                  Ver detalle de la sesión
                </Link>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--c-ink-soft)" }}>No tienes sesiones agendadas por ahora.</p>
            )}
          </div>

          <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 28, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600 }}>Próxima entrega</div>
            {nextAssignment ? (
              <>
                <div style={{ fontSize: 17, fontWeight: 600, color: "var(--c-navy)" }}>{nextAssignment.title}</div>
                {nextAssignment.description && <p style={{ margin: 0, fontSize: 13.5, color: "var(--c-ink-soft)", lineHeight: 1.5 }}>{nextAssignment.description}</p>}
                <Link href="/consulting/assignments" style={{ alignSelf: "flex-start", marginTop: 4, fontSize: 13.5, fontWeight: 600, color: "var(--c-navy)", border: "1px solid var(--c-line-strong)", borderRadius: 4, padding: "9px 16px" }}>
                  Ir a mis entregas
                </Link>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--c-ink-soft)" }}>Estás al día — sin entregas pendientes.</p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

export default function ConsultingDashboardPage() {
  return (
    <ConsultingShell>
      <DashboardInner />
    </ConsultingShell>
  );
}
