"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { auth } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

const NAV = [
  { href: "/consulting/admin", label: "Participantes", icon: "users" },
  { href: "/consulting/admin/calendar", label: "Calendario", icon: "calendar" },
  { href: "/consulting/admin/audit", label: "Auditoría", icon: "clock" },
  { href: "/consulting/admin/permissions", label: "Permisos", icon: "shield" },
] as const;

function Icon({ name }: { name: string }) {
  const c = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6 } as const;
  switch (name) {
    case "users": return <svg {...c}><circle cx="9" cy="8" r="3" /><path d="M4 20c.8-3 2.5-4.5 5-4.5s4.2 1.5 5 4.5" /><circle cx="17" cy="9" r="2.3" /><path d="M14.5 15c.4-1.7 1.4-2.5 2.5-2.5 1.6 0 2.8 1.2 3.3 3.3" /></svg>;
    case "calendar": return <svg {...c}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>;
    case "clock": return <svg {...c}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></svg>;
    case "shield": return <svg {...c}><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6Z" /></svg>;
    case "plus": return <svg {...c} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
    default: return null;
  }
}

export default function AdminSidebar({ name, isAdmin }: { name?: string; isAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const handleLogout = async () => {
    try { await auth.logout(); } catch { /* cookie clears server-side regardless */ }
    await clearAuth();
    router.replace("/consulting");
  };

  return (
    <aside style={{
      flex: "0 0 260px", background: "var(--c-navy)", minHeight: "100vh",
      padding: "36px 22px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 26,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 3, background: "var(--c-champagne)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-serif)", fontWeight: 600, color: "var(--c-navy)", fontSize: 15 }}>N</div>
        <div>
          <div style={{ fontFamily: "var(--font-serif)", color: "#FAF7F1", fontSize: 15, lineHeight: 1.1 }}>Nuvos Consulting</div>
          <div style={{ fontSize: 10, color: "rgba(250,247,241,.5)", letterSpacing: ".06em", textTransform: "uppercase" }}>Panel Admin</div>
        </div>
      </div>

      {isAdmin && (
        <Link href="/consulting/admin/new-enrollment" style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, height: 40,
          borderRadius: 4, fontSize: 13, fontWeight: 600, background: "var(--c-navy)", color: "var(--c-ivory)",
          border: "1px solid var(--c-champagne)", textDecoration: "none",
        }}>
          <Icon name="plus" /> Nuevo alumno
        </Link>
      )}

      <nav style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13.5 }}>
        {NAV.map(({ href, label, icon }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} style={{
              display: "flex", alignItems: "center", gap: 12, height: 42, padding: "0 16px", borderRadius: 4,
              textDecoration: "none", color: active ? "var(--c-champagne)" : "rgba(250,247,241,.72)",
              background: active ? "rgba(199,168,107,0.14)" : "transparent",
            }}>
              <Icon name={icon} />{label}
            </Link>
          );
        })}
      </nav>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10, paddingTop: 16, borderTop: "1px solid rgba(250,247,241,.12)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(250,247,241,.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FAF7F1", fontSize: 12, fontWeight: 600 }}>
            {(name ?? "??").slice(0, 2).toUpperCase()}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#FAF7F1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        </div>
        <button onClick={handleLogout} style={{ background: "none", border: "none", color: "rgba(250,247,241,.4)", fontSize: 12, fontWeight: 600, textAlign: "left", cursor: "pointer", padding: 0 }}>
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
