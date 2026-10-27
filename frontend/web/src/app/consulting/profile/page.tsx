"use client";

import ConsultingShell, { useConsultingMe } from "@/components/consulting/Shell";

const ROLE_LABEL: Record<string, string> = { student: "Alumno", instructor: "Instructor", program_admin: "Administrador del programa" };
const STATUS_LABEL: Record<string, string> = { active: "Activa", graduated: "Graduada", withdrawn: "Retirada" };

function ProfileInner() {
  const me = useConsultingMe();
  const initials = (me.email || "?").slice(0, 2).toUpperCase();

  return (
    <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{
          width: 64, height: 64, borderRadius: "50%", background: "var(--c-navy)", display: "flex",
          alignItems: "center", justifyContent: "center", color: "var(--c-ivory)", fontSize: 21, fontWeight: 600,
        }}>{initials}</div>
        <div>
          <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 24, margin: 0 }}>{me.email}</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--c-ink-soft)" }}>{ROLE_LABEL[me.role] ?? me.role}</p>
        </div>
      </div>

      {me.enrollment && (
        <section>
          <h3 style={{ fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600, margin: "0 0 14px" }}>Tu inscripción</h3>
          <div style={{ background: "var(--c-paper)", border: "1px solid var(--c-line)", borderRadius: 4, padding: 28, display: "flex", gap: 40, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--c-ink-soft)", fontWeight: 600 }}>Estado</div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--c-navy)", marginTop: 6 }}>{STATUS_LABEL[me.enrollment.status] ?? me.enrollment.status}</div>
            </div>
          </div>
        </section>
      )}

      <p style={{ fontSize: 12.5, color: "var(--c-ink-soft)" }}>
        Para cambios de correo, contraseña o información del programa, escríbenos a admisiones@nuvosai.com.
      </p>
    </div>
  );
}

export default function ConsultingProfilePage() {
  return <ConsultingShell><ProfileInner /></ConsultingShell>;
}
