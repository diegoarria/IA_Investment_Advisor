"use client";

import { useEffect, useState } from "react";
import ConsultingShell from "@/components/consulting/Shell";
import { consultingApi } from "@/lib/api";

interface Assessment { id: string; competency_id: string; level: string; observation: string | null; assessed_at: string }

const LEVEL_LABEL: Record<string, string> = { inicial: "Inicial", en_desarrollo: "En desarrollo", solido: "Sólido", dominado: "Dominado" };
const LEVEL_STEPS: Record<string, number> = { inicial: 1, en_desarrollo: 2, solido: 3, dominado: 4 };

function ProgressInner() {
  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consultingApi.progress()
      .then((res) => setAssessments(res.data.assessments))
      .catch(() => setError("No pudimos cargar tu progreso ahora mismo."));
  }, []);

  return (
    <>
      <div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 30, margin: 0 }}>Mi Progreso</h1>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--c-ink-soft)", maxWidth: 560, lineHeight: 1.6 }}>
          Un seguimiento cualitativo de cómo evoluciona tu criterio como inversionista, con la lectura directa de tu mentor.
        </p>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      {assessments === null ? (
        <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Cargando…</p>
      ) : assessments.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>
          Tu mentor todavía no ha registrado evaluaciones de competencias — aparecen aquí después de tus primeras sesiones.
        </p>
      ) : (
        <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: "6px 28px" }}>
          {assessments.map((a, i) => (
            <div key={a.id} style={{ display: "flex", gap: 24, padding: "22px 0", borderBottom: i < assessments.length - 1 ? "1px solid var(--c-line)" : "none", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                {a.observation && <p style={{ margin: 0, fontSize: 13.5, color: "var(--c-ink-soft)", lineHeight: 1.5, maxWidth: 420 }}>{a.observation}</p>}
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--c-ink-soft)" }}>
                  {new Date(a.assessed_at).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, minWidth: 140 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--c-champagne-2)" }}>{LEVEL_LABEL[a.level] ?? a.level}</span>
                <div style={{ display: "flex", gap: 3 }}>
                  {[1, 2, 3, 4].map((step) => (
                    <i key={step} style={{ display: "block", width: 22, height: 5, borderRadius: 3, background: step <= (LEVEL_STEPS[a.level] ?? 0) ? "var(--c-champagne)" : "var(--c-line-strong)" }} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function ConsultingProgressPage() {
  return <ConsultingShell><ProgressInner /></ConsultingShell>;
}
