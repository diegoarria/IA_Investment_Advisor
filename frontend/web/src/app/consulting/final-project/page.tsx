"use client";

import { useEffect, useRef, useState } from "react";
import ConsultingShell from "@/components/consulting/Shell";
import { consultingApi } from "@/lib/api";

interface FinalProject { id: string; title: string | null; summary: string | null; status: string; due_at: string | null }

const STATUS_LABEL: Record<string, string> = { proposed: "Propuesta", in_progress: "En desarrollo", submitted: "Entregado", reviewed: "Revisado" };

function FinalProjectInner() {
  const [project, setProject] = useState<FinalProject | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = () => {
    consultingApi.finalProject()
      .then((res) => setProject(res.data))
      .catch(() => setError("No pudimos cargar tu proyecto final ahora mismo."));
  };

  useEffect(load, []);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      await consultingApi.submitFinalProject(file);
      load();
    } catch {
      setError("No se pudo subir el avance. Intenta de nuevo.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ maxWidth: 860, display: "flex", flexDirection: "column", gap: 32 }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600 }}>Proyecto Final</div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 28, margin: "8px 0 0" }}>
          {project?.title || "Tu proyecto de cierre del programa"}
        </h1>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      {project === undefined ? (
        <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Cargando…</p>
      ) : project === null ? (
        <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>
          Tu Proyecto Final aún no ha sido configurado por tu coach — se habilita en la fase de cierre del programa.
        </p>
      ) : (
        <>
          <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 28, display: "flex", gap: 40, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600 }}>Estado</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--c-navy)", marginTop: 6 }}>{STATUS_LABEL[project.status] ?? project.status}</div>
            </div>
            {project.due_at && (
              <div>
                <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600 }}>Entrega</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--c-navy)", marginTop: 6 }}>
                  {new Date(project.due_at).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                </div>
              </div>
            )}
          </div>

          {project.summary && (
            <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 28 }}>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: "var(--c-ink-soft)" }}>{project.summary}</p>
            </div>
          )}

          <div>
            <input ref={fileInput} type="file" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <button onClick={() => fileInput.current?.click()} disabled={uploading} style={{
              height: 42, padding: "0 20px", borderRadius: 4, fontSize: 13.5, fontWeight: 600, border: "none", cursor: "pointer",
              background: "var(--c-navy)", color: "var(--c-ivory)", opacity: uploading ? 0.6 : 1,
            }}>
              {uploading ? "Subiendo…" : "Subir avance"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ConsultingFinalProjectPage() {
  return <ConsultingShell><FinalProjectInner /></ConsultingShell>;
}
