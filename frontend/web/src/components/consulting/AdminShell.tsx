"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { consultingApi } from "@/lib/api";
import AdminSidebar from "./AdminSidebar";

interface AdminMe {
  user_id: string;
  email: string | null;
  role: "student" | "instructor" | "program_admin";
}

const AdminMeContext = createContext<AdminMe | null>(null);

/** Read the current staff identity from inside a page wrapped in
 * <AdminShell>. role is "instructor" or "program_admin" — "student"
 * never reaches a page that calls this (AdminShell redirects it away). */
export function useAdminMe(): AdminMe {
  const ctx = useContext(AdminMeContext);
  if (!ctx) throw new Error("useAdminMe() must be called inside <AdminShell>");
  return ctx;
}

const V = { bg: "#FAF7F1", navy: "#0E1E3A", ink: "#16213C", inkSoft: "#5B6477" };

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: V.bg, color: V.ink, textAlign: "center", padding: 24 }}>
      <div style={{ maxWidth: 380 }}>{children}</div>
    </div>
  );
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { userId, isAuthenticated, authRestoring } = useAuthStore();
  const router = useRouter();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "denied" | "error">("loading");

  useEffect(() => {
    if (authRestoring) return;
    if (!isAuthenticated || !userId) {
      router.replace("/consulting");
      return;
    }
    let cancelled = false;
    consultingApi.me()
      .then((res) => {
        if (cancelled) return;
        if (res.data.role === "student") {
          setStatus("denied");
        } else {
          setMe(res.data);
          setStatus("ready");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(err?.response?.status === 403 ? "denied" : "error");
      });
    return () => { cancelled = true; };
  }, [userId, isAuthenticated, authRestoring, router]);

  if (status === "loading" || authRestoring) {
    return <CenteredState><p style={{ fontSize: 14, color: V.inkSoft }}>Cargando panel admin…</p></CenteredState>;
  }
  if (status === "denied") {
    return (
      <CenteredState>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: V.navy, margin: "0 0 10px" }}>No tienes acceso al panel admin</h1>
        <p style={{ fontSize: 14, color: V.inkSoft, lineHeight: 1.6, margin: 0 }}>Este panel es solo para instructores y administradores del programa.</p>
      </CenteredState>
    );
  }
  if (status === "error") {
    return (
      <CenteredState>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: V.navy, margin: "0 0 10px" }}>No pudimos cargar el panel</h1>
        <p style={{ fontSize: 14, color: V.inkSoft, lineHeight: 1.6, margin: 0 }}>Intenta recargar la página.</p>
      </CenteredState>
    );
  }

  return (
    <AdminMeContext.Provider value={me}>
      {/* html,body are overflow:hidden globally — without this wrapper's
          own height:100vh + overflowY:auto, any admin page taller than
          the viewport (the participants table, the expediente) was
          simply unreachable, no scrollbar anywhere. */}
      <div style={{ height: "100vh", overflowY: "auto", background: V.bg }}>
        <div style={{ width: "100%", maxWidth: 1680, margin: "0 auto", minHeight: "100vh", display: "flex", flexWrap: "wrap", background: V.bg }}>
          <AdminSidebar name={me!.email ?? undefined} isAdmin={me!.role === "program_admin"} />
          <main style={{ flex: "999 1 560px", minWidth: 0, padding: "40px 44px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 24 }}>
            {children}
          </main>
        </div>
      </div>
    </AdminMeContext.Provider>
  );
}
