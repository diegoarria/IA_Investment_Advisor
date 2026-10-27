"use client";

import { useEffect, useRef, useState } from "react";
import ConsultingShell from "@/components/consulting/Shell";
import { consultingApi } from "@/lib/api";

interface Assignment { id: string; title: string; description: string | null; due_offset_days: number | null }
interface Submission { id: string; assignment_id: string; submitted_at: string; feedback: string | null }

function AssignmentsInner() {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = () => {
    consultingApi.assignments()
      .then((res) => { setAssignments(res.data.assignments); setSubmissions(res.data.submissions ?? []); })
      .catch(() => setError("No pudimos cargar tus entregas ahora mismo."));
  };

  useEffect(load, []);

  const handleFile = async (assignmentId: string, file: File) => {
    setUploadingId(assignmentId);
    try {
      await consultingApi.submitAssignment(assignmentId, file);
      load();
    } catch {
      setError("No se pudo subir el archivo. Intenta de nuevo.");
    } finally {
      setUploadingId(null);
    }
  };

  const byAssignment = new Map(submissions.map((s) => [s.assignment_id, s]));
  const pending = (assignments ?? []).filter((a) => !byAssignment.has(a.id));
  const submitted = (assignments ?? []).filter((a) => byAssignment.has(a.id));

  return (
    <>
      <div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 30, margin: 0 }}>Mis Entregas</h1>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--c-ink-soft)" }}>Ejercicios prácticos entre sesiones.</p>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      <section>
        <h3 style={{ fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600, margin: "0 0 14px" }}>Pendientes</h3>
        {assignments === null ? (
          <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Cargando…</p>
        ) : pending.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Estás al día — sin entregas pendientes.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {pending.map((a) => (
              <div key={a.id} style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 24, display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 280 }}>
                  <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 17, color: "var(--c-navy)", margin: 0 }}>{a.title}</h3>
                  {a.description && <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--c-ink-soft)", lineHeight: 1.6, maxWidth: 480 }}>{a.description}</p>}
                </div>
                <div>
                  <input ref={(el) => { fileInputs.current[a.id] = el; }} type="file" style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(a.id, f); }} />
                  <button onClick={() => fileInputs.current[a.id]?.click()} disabled={uploadingId === a.id} style={{
                    height: 42, padding: "0 18px", borderRadius: 4, fontSize: 13.5, fontWeight: 600, border: "none", cursor: "pointer",
                    background: "var(--c-navy)", color: "var(--c-ivory)", opacity: uploadingId === a.id ? 0.6 : 1,
                  }}>
                    {uploadingId === a.id ? "Subiendo…" : "Subir entrega"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 style={{ fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600, margin: "0 0 14px" }}>Entregadas</h3>
        {submitted.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Aún no has entregado nada.</p>
        ) : (
          <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: "4px 24px" }}>
            {submitted.map((a) => {
              const sub = byAssignment.get(a.id)!;
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 20, padding: "18px 0", borderBottom: "1px solid var(--c-line)" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--c-navy)" }}>{a.title}</div>
                    <div style={{ fontSize: 12.5, color: "var(--c-ink-soft)", marginTop: 2 }}>
                      Entregado el {new Date(sub.submitted_at).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}
                    </div>
                  </div>
                  <span style={{
                    display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 3, fontSize: 11, fontWeight: 600,
                    background: sub.feedback ? "rgba(85,138,66,.12)" : "rgba(14,30,58,.06)", color: sub.feedback ? "#3E6B30" : "var(--c-ink-soft)",
                  }}>{sub.feedback ? "Con feedback" : "En revisión"}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

export default function ConsultingAssignmentsPage() {
  return <ConsultingShell><AssignmentsInner /></ConsultingShell>;
}
