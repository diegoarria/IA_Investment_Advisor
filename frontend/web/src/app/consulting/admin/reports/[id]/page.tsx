"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import AdminShell from "@/components/consulting/AdminShell";
import { consultingAdminApi } from "@/lib/api";

interface Report {
  id: string; enrollment_id: string; session_id: string; status: string;
  summary: string | null; achievements: string | null; strengths: string | null; growth_areas: string | null; next_assignment_text: string | null;
}

const textareaStyle: React.CSSProperties = { width: "100%", fontFamily: "var(--font-sans)", fontSize: 13.5, lineHeight: 1.6, borderRadius: 4, border: "1px solid var(--c-line-strong)", padding: 14, boxSizing: "border-box", resize: "vertical", background: "var(--c-paper)", color: "var(--c-ink)" };
const fieldLabel: React.CSSProperties = { fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600, display: "block", marginBottom: 8 };

function ReportReviewInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    consultingAdminApi.getReport(params.id)
      .then((res) => setReport(res.data))
      .catch(() => setError("No pudimos cargar este reporte."));
  }, [params.id]);

  const update = (field: keyof Report, value: string) => {
    setReport((r) => (r ? { ...r, [field]: value } : r));
  };

  const saveDraft = async () => {
    if (!report) return;
    setSaving(true);
    try {
      await consultingAdminApi.updateReport(report.id, {
        summary: report.summary ?? "", achievements: report.achievements ?? "",
        strengths: report.strengths ?? "", growth_areas: report.growth_areas ?? "",
        next_assignment_text: report.next_assignment_text ?? "",
      });
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!report) return;
    setPublishing(true);
    try {
      await saveDraft();
      await consultingAdminApi.publishReport(report.id);
      router.push(`/consulting/admin/participants/${report.enrollment_id}`);
    } catch {
      setError("No se pudo publicar el reporte.");
      setPublishing(false);
    }
  };

  if (error) return <p style={{ fontSize: 14, color: "#B94A37" }}>{error}</p>;
  if (!report) return <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Cargando…</p>;

  return (
    <div style={{ width: "100%", maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <Link href={`/consulting/admin/participants/${report.enrollment_id}`} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-ink-soft)" }}>← Volver al expediente</Link>

      <div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 22, padding: "0 9px", borderRadius: 3, fontSize: 11, fontWeight: 600, background: report.status === "published" ? "rgba(85,138,66,.12)" : "rgba(199,168,107,.15)", color: report.status === "published" ? "#3E6B30" : "var(--c-champagne-2)" }}>
          {report.status === "published" ? "Publicado" : "Borrador generado"}
        </span>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 24, marginTop: 10 }}>Nuvos Session Report</h1>
      </div>

      {report.status === "draft" && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--c-ink-soft)", background: "var(--c-ivory-2)", borderRadius: 4, padding: "12px 16px" }}>
          Revisa y edita libremente — nada se publica en el portal del alumno hasta que le des clic a "Publicar".
        </p>
      )}

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        <div><label style={fieldLabel}>Resumen de la sesión</label><textarea style={textareaStyle} rows={3} value={report.summary ?? ""} onChange={(e) => update("summary", e.target.value)} disabled={report.status === "published"} /></div>
        <div><label style={fieldLabel}>Logros de esta sesión</label><textarea style={textareaStyle} rows={3} value={report.achievements ?? ""} onChange={(e) => update("achievements", e.target.value)} disabled={report.status === "published"} /></div>
        <div><label style={fieldLabel}>Fortalezas observadas</label><textarea style={textareaStyle} rows={2} value={report.strengths ?? ""} onChange={(e) => update("strengths", e.target.value)} disabled={report.status === "published"} /></div>
        <div><label style={fieldLabel}>Para seguir trabajando</label><textarea style={textareaStyle} rows={2} value={report.growth_areas ?? ""} onChange={(e) => update("growth_areas", e.target.value)} disabled={report.status === "published"} /></div>
        <div><label style={fieldLabel}>Siguiente entrega</label><textarea style={textareaStyle} rows={2} value={report.next_assignment_text ?? ""} onChange={(e) => update("next_assignment_text", e.target.value)} disabled={report.status === "published"} /></div>
      </div>

      {report.status === "draft" && (
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={saveDraft} disabled={saving} style={{ flex: 1, height: 42, borderRadius: 4, fontSize: 13, fontWeight: 600, border: "1px solid var(--c-line-strong)", background: "transparent", color: "var(--c-navy)", cursor: "pointer" }}>
            {saving ? "Guardando…" : "Guardar como borrador"}
          </button>
          <button onClick={publish} disabled={publishing} style={{ flex: 1, height: 42, borderRadius: 4, fontSize: 13, fontWeight: 600, border: "none", background: "var(--c-navy)", color: "var(--c-ivory)", cursor: "pointer", opacity: publishing ? 0.7 : 1 }}>
            {publishing ? "Publicando…" : "Publicar en el portal del alumno"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminReportReviewPage() {
  return <AdminShell><ReportReviewInner /></AdminShell>;
}
