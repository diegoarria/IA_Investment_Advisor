"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminShell from "@/components/consulting/AdminShell";
import { consultingAdminApi } from "@/lib/api";

interface Cohort { id: string; name: string; consulting_programs: { name: string } | null }
interface TeamMember { user_id: string; email: string | null; role: string }

const input: React.CSSProperties = { fontFamily: "var(--font-sans)", fontSize: 13.5, height: 42, borderRadius: 4, border: "1px solid var(--c-line-strong)", padding: "0 12px", boxSizing: "border-box", width: "100%", background: "var(--c-paper)", color: "var(--c-ink)" };
const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--c-navy)", display: "block", marginBottom: 6 };

function NewEnrollmentInner() {
  const router = useRouter();
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [paymentPlan, setPaymentPlan] = useState("monthly");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consultingAdminApi.cohorts().then((res) => { setCohorts(res.data.cohorts); if (res.data.cohorts[0]) setCohortId(res.data.cohorts[0].id); }).catch(() => {});
    consultingAdminApi.team().then((res) => setTeam(res.data.team.filter((t: TeamMember) => t.role === "instructor"))).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!fullName.trim() || !email.trim() || !cohortId) {
      setError("Completa nombre, correo y cohorte.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await consultingAdminApi.createEnrollment({
        full_name: fullName.trim(), email: email.trim(), company: company || undefined,
        role_title: roleTitle || undefined, cohort_id: cohortId, instructor_id: instructorId || undefined,
        payment_plan: paymentPlan,
      });
      if (!res.data.invite_sent) {
        setError("La inscripción se creó, pero no se pudo enviar la invitación por correo automáticamente — compártele el acceso manualmente.");
      } else {
        router.push("/consulting/admin");
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "No se pudo crear la inscripción.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ width: "100%", maxWidth: 520, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <Link href="/consulting/admin" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-ink-soft)" }}>← Volver a Participantes</Link>

      <div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 24, margin: 0 }}>Nuevo alumno</h1>
        <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--c-ink-soft)" }}>Crea la inscripción — se genera automáticamente una invitación por correo.</p>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 28, display: "flex", flexDirection: "column", gap: 18 }}>
        <div><label style={label}>Nombre completo</label><input style={input} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre y apellido" /></div>
        <div><label style={label}>Correo</label><input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@empresa.com" /></div>
        <div><label style={label}>Empresa</label><input style={input} value={company} onChange={(e) => setCompany(e.target.value)} /></div>
        <div><label style={label}>Rol</label><input style={input} value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} /></div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={label}>Cohorte</label>
            <select style={input} value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
              {cohorts.length === 0 && <option value="">Sin cohortes creadas</option>}
              {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.consulting_programs ? ` — ${c.consulting_programs.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Instructor</label>
            <select style={input} value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
              <option value="">Sin asignar</option>
              {team.map((t) => <option key={t.user_id} value={t.user_id}>{t.email}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label style={label}>Plan de pago</label>
          <select style={input} value={paymentPlan} onChange={(e) => setPaymentPlan(e.target.value)}>
            <option value="monthly">Pagos mensuales</option>
            <option value="one_time">Pago único</option>
          </select>
        </div>
      </div>

      <button onClick={handleSubmit} disabled={submitting} style={{ height: 44, borderRadius: 4, fontSize: 13.5, fontWeight: 600, border: "none", cursor: "pointer", background: "var(--c-navy)", color: "var(--c-ivory)", opacity: submitting ? 0.7 : 1 }}>
        {submitting ? "Creando…" : "Crear inscripción y enviar invitación"}
      </button>
    </div>
  );
}

export default function AdminNewEnrollmentPage() {
  return <AdminShell><NewEnrollmentInner /></AdminShell>;
}
