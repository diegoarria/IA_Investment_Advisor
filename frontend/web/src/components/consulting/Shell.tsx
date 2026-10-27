"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { consultingApi } from "@/lib/api";
import ConsultingSidebar from "./Sidebar";

interface Enrollment {
  id: string;
  cohort_id: string;
  instructor_id: string | null;
  status: string;
  current_module_id: string | null;
}

interface ConsultingMe {
  user_id: string;
  email: string | null;
  role: "student" | "instructor" | "program_admin";
  enrollment: Enrollment | null;
}

const ConsultingMeContext = createContext<ConsultingMe | null>(null);

/** Read the current MY NUVOS identity from inside a page wrapped in
 * <ConsultingShell> — never fetches on its own, always comes from the
 * Shell's single GET /consulting/me call. */
export function useConsultingMe(): ConsultingMe {
  const ctx = useContext(ConsultingMeContext);
  if (!ctx) throw new Error("useConsultingMe() must be called inside <ConsultingShell>");
  return ctx;
}

const V = {
  bg: "#FAF7F1", ivory2: "#F2ECDF", paper: "#FFFFFF", navy: "#0E1E3A",
  champagne: "#C7A86B", ink: "#16213C", inkSoft: "#5B6477",
};

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: V.bg, fontFamily: "var(--font-sans, system-ui)", color: V.ink, textAlign: "center", padding: 24,
    }}>
      <div style={{ maxWidth: 360 }}>{children}</div>
    </div>
  );
}

export default function ConsultingShell({ children }: { children: React.ReactNode }) {
  const { userId, isAuthenticated, authRestoring } = useAuthStore();
  const router = useRouter();
  const [me, setMe] = useState<ConsultingMe | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "no_access" | "error">("loading");

  useEffect(() => {
    if (authRestoring) return;
    if (!isAuthenticated || !userId) {
      router.replace("/consulting");
      return;
    }
    let cancelled = false;
    consultingApi.me()
      .then((res) => { if (!cancelled) { setMe(res.data); setStatus("ready"); } })
      .catch((err) => {
        if (cancelled) return;
        setStatus(err?.response?.status === 403 ? "no_access" : "error");
      });
    return () => { cancelled = true; };
  }, [userId, isAuthenticated, authRestoring, router]);

  if (status === "loading" || authRestoring) {
    return <CenteredState><p style={{ fontSize: 14, color: V.inkSoft }}>Cargando tu programa…</p></CenteredState>;
  }

  if (status === "no_access") {
    return (
      <CenteredState>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: V.navy, margin: "0 0 10px" }}>
          Esta cuenta no tiene acceso a MY NUVOS
        </h1>
        <p style={{ fontSize: 14, color: V.inkSoft, lineHeight: 1.6, margin: 0 }}>
          Si crees que esto es un error, escríbenos a admisiones@nuvosai.com.
        </p>
      </CenteredState>
    );
  }

  if (status === "error") {
    return (
      <CenteredState>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: V.navy, margin: "0 0 10px" }}>
          No pudimos cargar tu información
        </h1>
        <p style={{ fontSize: 14, color: V.inkSoft, lineHeight: 1.6, margin: 0 }}>
          Intenta recargar la página. Si el problema continúa, escríbenos a admisiones@nuvosai.com.
        </p>
      </CenteredState>
    );
  }

  const initials = (me!.email || "?").slice(0, 2).toUpperCase();

  return (
    <ConsultingMeContext.Provider value={me}>
      {/* html,body are overflow:hidden globally (the investing app's own
          pages each scroll internally) — without this wrapper's own
          height:100vh + overflowY:auto, any /consulting page taller than
          the viewport was simply unreachable, no scrollbar anywhere. */}
      <div style={{ height: "100vh", overflowY: "auto", background: V.bg }}>
        <div style={{ width: "100%", maxWidth: 1440, margin: "0 auto", minHeight: "100vh", display: "flex", flexWrap: "wrap", background: V.bg }}>
          <ConsultingSidebar name={me!.email ?? undefined} initials={initials} />
          <main style={{ flex: "999 1 560px", minWidth: 0, padding: 56, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 32 }}>
            {children}
          </main>
        </div>
      </div>
    </ConsultingMeContext.Provider>
  );
}
