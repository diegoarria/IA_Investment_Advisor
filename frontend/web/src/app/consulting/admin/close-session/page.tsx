"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AdminShell from "@/components/consulting/AdminShell";
import { consultingAdminApi } from "@/lib/api";

interface Competency { id: string; name: string }

const input: React.CSSProperties = { fontFamily: "var(--font-sans)", fontSize: 13.5, borderRadius: 4, border: "1px solid var(--c-line-strong)", padding: "10px 12px", boxSizing: "border-box", width: "100%", background: "var(--c-paper)", color: "var(--c-ink)" };
const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--c-navy)", display: "block", marginBottom: 6 };

function CloseSessionInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const enrollmentId = searchParams.get("enrollment_id") ?? "";

  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [topics, setTopics] = useState("");
  const [objectivesMet, setObjectivesMet] = useState("");
  const [strengths, setStrengths] = useState("");
  const [growthAreas, setGrowthAreas] = useState("");
  const [competencyId, setCompetencyId] = useState("");
  const [competencyLevel, setCompetencyLevel] = useState("solido");
  const [exerciseTitle, setExerciseTitle] = useState("");
  const [exerciseDueAt, setExerciseDueAt] = useState("");
  const [nextSessionAt, setNextSessionAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enrollmentId) return;
    consultingAdminApi.competencies(enrollmentId).then((res) => setCompetencies(res.data.competencies)).catch(() => {});
  }, [enrollmentId]);

  if (!enrollmentId) {
    return (
      <>
        <Link href="/consulting/admin" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-ink-soft)" }}>← Volver a Participantes</Link>
        <p style={{ fontSize: 14, color: "#B94A37" }}>Falta indicar el participante — entra desde su expediente.</p>
      </>
    );
  }

  const handleSubmit = async () => {
    if (!topics.trim() || !objectivesMet.trim()) {
      setError("Completa al menos temas cubiertos y objetivos alcanzados.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await consultingAdminApi.closeSession({
        enrollment_id: enrollmentId,
        scheduled_at: new Date().toISOString(),
        topics, objectives_met: objectivesMet, strengths, growth_areas: growthAreas,
        competency_id: competencyId || undefined,
        competency_level: competencyId ? competencyLevel : undefined,
        exercise_title: exerciseTitle || undefined,
        exercise_due_at: exerciseDueAt || undefined,
        next_session_at: nextSessionAt || undefined,
      });
      router.push(`/consulting/admin/reports/${res.data.id}`);
    } catch {
      setError("No se pudo registrar la sesión. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ width: "100%", maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>
      <Link href={`/consulting/admin/participants/${enrollmentId}`} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-ink-soft)" }}>← Volver al expediente</Link>

      <div>
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--c-champagne-2)", fontWeight: 600 }}>Cierre de sesión · toma menos de 5 minutos</div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 26, marginTop: 8 }}>Registrar sesión</h1>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        <div><label style={label}>Temas cubiertos</label><textarea style={{ ...input, resize: "vertical" }} rows={2} value={topics} onChange={(e) => setTopics(e.target.value)} /></div>
        <div><label style={label}>Objetivos alcanzados</label><textarea style={{ ...input, resize: "vertical" }} rows={2} value={objectivesMet} onChange={(e) => setObjectivesMet(e.target.value)} /></div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div><label style={label}>Fortalezas observadas</label><textarea style={{ ...input, resize: "vertical" }} rows={3} value={strengths} onChange={(e) => setStrengths(e.target.value)} /></div>
          <div><label style={label}>Áreas por reforzar</label><textarea style={{ ...input, resize: "vertical" }} rows={3} value={growthAreas} onChange={(e) => setGrowthAreas(e.target.value)} /></div>
        </div>

        <div>
          <label style={label}>Calificación por competencia (opcional)</label>
          <div style={{ display: "flex", gap: 10 }}>
            <select style={input} value={competencyId} onChange={(e) => setCompetencyId(e.target.value)}>
              <option value="">Sin calificar hoy</option>
              {competencies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {competencyId && (
              <select style={{ ...input, maxWidth: 180 }} value={competencyLevel} onChange={(e) => setCompetencyLevel(e.target.value)}>
                <option value="inicial">Inicial</option>
                <option value="en_desarrollo">En desarrollo</option>
                <option value="solido">Sólido</option>
                <option value="dominado">Dominado</option>
              </select>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div><label style={label}>Ejercicio asignado (opcional)</label><input style={input} value={exerciseTitle} onChange={(e) => setExerciseTitle(e.target.value)} /></div>
          <div><label style={label}>Fecha de entrega</label><input type="date" style={input} value={exerciseDueAt} onChange={(e) => setExerciseDueAt(e.target.value)} /></div>
        </div>

        <div><label style={label}>Próxima sesión (opcional)</label><input type="datetime-local" style={input} value={nextSessionAt} onChange={(e) => setNextSessionAt(e.target.value)} /></div>
      </div>

      <button onClick={handleSubmit} disabled={submitting} style={{
        height: 44, borderRadius: 4, fontSize: 13.5, fontWeight: 600, border: "none", cursor: "pointer",
        background: "var(--c-navy)", color: "var(--c-ivory)", opacity: submitting ? 0.7 : 1,
      }}>
        {submitting ? "Generando…" : "Generar borrador del Session Report"}
      </button>
      <p style={{ margin: "-14px 0 0", fontSize: 11.5, color: "var(--c-ink-soft)", textAlign: "center" }}>
        Lo revisas antes de que se publique en el portal del alumno — nada se envía automáticamente.
      </p>
    </div>
  );
}

export default function AdminCloseSessionPage() {
  return (
    <AdminShell>
      <Suspense>
        <CloseSessionInner />
      </Suspense>
    </AdminShell>
  );
}
