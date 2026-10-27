"use client";

import { useEffect, useState } from "react";
import ConsultingShell, { useConsultingMe } from "@/components/consulting/Shell";
import { consultingApi } from "@/lib/api";

interface Module { id: string; order_index: number; title: string; description: string | null }
interface Cohort { id: string; name: string; starts_at: string; ends_at: string | null }

function ProgramInner() {
  const me = useConsultingMe();
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [currentModuleId, setCurrentModuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consultingApi.program()
      .then((res) => {
        setCohort(res.data.cohort);
        setModules(res.data.modules ?? []);
        setCurrentModuleId(res.data.current_module_id);
      })
      .catch(() => setError("No pudimos cargar tu programa ahora mismo."));
  }, []);

  const currentIndex = modules.findIndex((m) => m.id === currentModuleId);

  return (
    <>
      <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600 }}>
        {cohort?.name ?? "Tu programa"}
      </div>
      <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 30, margin: "4px 0 0" }}>Mi Programa</h1>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      {modules.length === 0 && !error && (
        <p style={{ fontSize: 14, color: "var(--c-ink-soft)" }}>Tu recorrido aún no tiene módulos configurados.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column" }}>
        {modules.map((m, i) => {
          const done = i < currentIndex;
          const current = i === currentIndex;
          return (
            <div key={m.id} style={{ display: "flex", gap: 28 }}>
              <div style={{ flex: "0 0 44px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{
                  width: current ? 16 : 12, height: current ? 16 : 12, borderRadius: "50%", marginTop: current ? 4 : 6,
                  background: current ? "var(--c-champagne)" : done ? "var(--c-navy)" : "var(--c-paper)",
                  border: done || current ? "none" : "2px solid var(--c-line-strong)",
                  boxShadow: current ? "0 0 0 4px rgba(199,168,107,.2)" : "none",
                }} />
                {i < modules.length - 1 && <div style={{ width: 1, flex: 1, background: "var(--c-line-strong)", marginTop: 4 }} />}
              </div>
              <div style={{ flex: 1, paddingBottom: 36 }}>
                <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: current ? "var(--c-champagne-2)" : "var(--c-ink-soft)", fontWeight: 600 }}>
                  Módulo {i + 1}{current ? " — en curso" : ""}
                </div>
                <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 19, margin: "6px 0", color: done || current ? "var(--c-navy)" : "var(--c-ink-soft)" }}>{m.title}</h3>
                {m.description && <p style={{ margin: 0, fontSize: 13.5, color: "var(--c-ink-soft)", lineHeight: 1.6, maxWidth: 480 }}>{m.description}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function ConsultingProgramPage() {
  return <ConsultingShell><ProgramInner /></ConsultingShell>;
}
