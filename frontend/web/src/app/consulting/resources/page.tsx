"use client";

import { useEffect, useState } from "react";
import ConsultingShell from "@/components/consulting/Shell";
import { consultingApi } from "@/lib/api";

interface Resource { id: string; type: string; title: string; storage_path: string | null }

const TYPE_LABEL: Record<string, string> = { lectura: "Lectura", video: "Video", plantilla: "Plantilla", caso_estudio: "Caso de estudio" };

function ResourcesInner() {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consultingApi.resources()
      .then((res) => setResources(res.data.resources))
      .catch(() => setError("No pudimos cargar los recursos ahora mismo."));
  }, []);

  const open = async (r: Resource) => {
    if (!r.storage_path) return;
    try {
      const res = await consultingApi.signedUrl(r.storage_path);
      if (res.data.url) window.open(res.data.url, "_blank", "noopener,noreferrer");
    } catch {
      setError("No se pudo abrir el recurso. Intenta de nuevo.");
    }
  };

  return (
    <>
      <div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 30, margin: 0 }}>Recursos</h1>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--c-ink-soft)" }}>Material de apoyo de tu módulo actual.</p>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      {resources === null ? (
        <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Cargando…</p>
      ) : resources.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Tu coach aún no ha agregado recursos para este módulo.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 16 }}>
          {resources.map((r) => (
            <button key={r.id} onClick={() => open(r)} disabled={!r.storage_path} style={{
              textAlign: "left", background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4,
              padding: 22, display: "flex", flexDirection: "column", gap: 14, cursor: r.storage_path ? "pointer" : "default",
            }}>
              <span style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600 }}>
                {TYPE_LABEL[r.type] ?? r.type}
              </span>
              <span style={{ fontSize: 15.5, fontWeight: 600, color: "var(--c-navy)", lineHeight: 1.4 }}>{r.title}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default function ConsultingResourcesPage() {
  return <ConsultingShell><ResourcesInner /></ConsultingShell>;
}
