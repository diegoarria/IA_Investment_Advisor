"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConsultingShell from "@/components/consulting/Shell";
import { consultingApi } from "@/lib/api";

function groupByDay(slots: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const s of slots) {
    const d = new Date(s);
    const key = d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
    (groups[key] ??= []).push(s);
  }
  return groups;
}

function BookSessionInner() {
  const router = useRouter();
  const [slots, setSlots] = useState<string[] | null>(null);
  const [hasInstructor, setHasInstructor] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<string | null>(null);

  useEffect(() => {
    consultingApi.availability()
      .then((res) => { setSlots(res.data.slots); setHasInstructor(res.data.has_instructor); })
      .catch(() => setError("No pudimos cargar los horarios disponibles."));
  }, []);

  const book = async (slot: string) => {
    setBooking(slot);
    setError(null);
    try {
      await consultingApi.bookSession(slot);
      router.push("/consulting/sessions");
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Ese horario ya no está disponible — elige otro.");
      setBooking(null);
      consultingApi.availability().then((res) => setSlots(res.data.slots)).catch(() => {});
    }
  };

  const groups = slots ? groupByDay(slots) : {};
  const days = Object.keys(groups);

  return (
    <>
      <div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: "var(--c-navy)", fontSize: 30, margin: 0 }}>Agendar sesión</h1>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--c-ink-soft)" }}>Elige un horario disponible de tu mentor en las próximas 3 semanas.</p>
      </div>

      {error && <p style={{ fontSize: 13, color: "#B94A37" }}>{error}</p>}

      {slots === null ? (
        <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Cargando…</p>
      ) : !hasInstructor ? (
        <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Todavía no tienes un mentor asignado — tu coach lo configura al iniciar el programa.</p>
      ) : days.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--c-ink-soft)" }}>Tu mentor no tiene horarios abiertos en las próximas semanas — escríbele directamente para coordinar.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {days.map((day) => (
            <div key={day}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--c-ink-soft)", textTransform: "capitalize", margin: "0 0 10px" }}>{day}</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {groups[day].map((s) => (
                  <button key={s} onClick={() => book(s)} disabled={booking === s} style={{
                    height: 40, padding: "0 16px", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: "pointer",
                    border: "1px solid var(--c-line-strong)", background: "var(--c-paper)", color: "var(--c-navy)",
                    opacity: booking === s ? 0.6 : 1,
                  }}>
                    {booking === s ? "Agendando…" : new Date(s).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function ConsultingBookSessionPage() {
  return <ConsultingShell><BookSessionInner /></ConsultingShell>;
}
