"use client";

import { useEffect, useState } from "react";
import ConsultingShell, { useConsultingMe } from "@/components/consulting/Shell";
import { consultingApi } from "@/lib/api";

interface Graduation { id: string; completed_at: string | null; certificate_storage_path: string | null }

function GraduationInner() {
  const me = useConsultingMe();
  const [grad, setGrad] = useState<Graduation | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consultingApi.graduation()
      .then((res) => setGrad(res.data))
      .catch(() => setError("No pudimos cargar tu información de graduación ahora mismo."));
  }, []);

  if (error) return <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>;
  if (grad === undefined) return <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Cargando…</p>;

  if (!grad || !grad.completed_at) {
    return (
      <section style={{ textAlign: "center", maxWidth: 520, margin: "20px auto 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--c-ivory-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink-soft)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 24, margin: 0 }}>
          Tu graduación se desbloquea al completar el programa
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--c-ink-soft)", lineHeight: 1.6 }}>
          Cuando tu Proyecto Final y tu evaluación final queden listos, tu certificado aparece aquí automáticamente.
        </p>
      </section>
    );
  }

  return (
    <section style={{
      background: "var(--c-navy)", border: "1px solid var(--c-navy)", borderRadius: 4, padding: 48, textAlign: "center",
      position: "relative", overflow: "hidden", maxWidth: 720, margin: "0 auto",
    }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 85% 15%, rgba(199,168,107,0.16), transparent 55%)" }} />
      <div style={{ position: "relative" }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--c-champagne)" strokeWidth={1.4} style={{ margin: "0 auto 18px" }}>
          <circle cx="12" cy="9" r="5" /><path d="M9 13.5 7 21l5-3 5 3-2-7.5" />
        </svg>
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(250,247,241,.5)", fontWeight: 600 }}>Nuvos Consulting certifica que</div>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 30, color: "var(--c-ivory)", margin: "10px 0", fontWeight: 500 }}>{me.email}</h2>
        <p style={{ margin: 0, fontSize: 14.5, color: "rgba(250,247,241,.7)" }}>completó el Programa Ejecutivo de Liderazgo</p>
        <p style={{ margin: "24px 0 0", fontSize: 13, color: "rgba(250,247,241,.45)" }}>
          {new Date(grad.completed_at).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>
    </section>
  );
}

export default function ConsultingGraduationPage() {
  return <ConsultingShell><GraduationInner /></ConsultingShell>;
}
