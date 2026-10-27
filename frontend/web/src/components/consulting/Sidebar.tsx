"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { auth } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

const NAV = [
  { href: "/consulting/dashboard", label: "Dashboard", icon: "home" },
  { href: "/consulting/program", label: "Mi Programa", icon: "flag" },
  { href: "/consulting/sessions", label: "Mis Sesiones", icon: "calendar" },
  { href: "/consulting/assignments", label: "Mis Entregas", icon: "clipboard" },
  { href: "/consulting/progress", label: "Mi Progreso", icon: "chart" },
  { href: "/consulting/resources", label: "Recursos", icon: "book" },
] as const;

const SECONDARY = [
  { href: "/consulting/final-project", label: "Proyecto Final", icon: "flag" },
  { href: "/consulting/graduation", label: "Graduación", icon: "award" },
] as const;

function Icon({ name }: { name: string }) {
  const common = {
    width: 18, height: 18, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "home": return <svg {...common}><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9" /></svg>;
    case "flag": return <svg {...common}><path d="M5 3v18" /><path d="M5 4h12l-2.5 4 2.5 4H5" /></svg>;
    case "calendar": return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>;
    case "clipboard": return <svg {...common}><rect x="6" y="4" width="12" height="17" rx="1.5" /><path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1Z" /><path d="M9 11h6M9 14h6M9 17h3" /></svg>;
    case "chart": return <svg {...common}><path d="M5 19V10M12 19V5M19 19v-7" /></svg>;
    case "book": return <svg {...common}><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11l2 2h5.5A1.5 1.5 0 0 1 20 7.5v11A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5Z" /></svg>;
    case "award": return <svg {...common}><circle cx="12" cy="9" r="5" /><path d="M9 13.5 7 21l5-3 5 3-2-7.5" /></svg>;
    default: return null;
  }
}

export default function ConsultingSidebar({ name, initials }: { name?: string; initials?: string }) {
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
      flex: "0 0 280px", background: "var(--c-navy)", minHeight: "100vh",
      padding: "40px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 28,
    }}>
      <Link href="/consulting/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        <div style={{
          width: 32, height: 32, borderRadius: 3, background: "var(--c-champagne)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-serif)", fontWeight: 600, color: "var(--c-navy)", fontSize: 17,
        }}>N</div>
        <div>
          <div style={{ fontFamily: "var(--font-serif)", color: "var(--c-ivory)", fontSize: 16, lineHeight: 1.1 }}>My Nuvos</div>
          <div style={{ fontSize: 10, color: "rgba(250,247,241,.5)", letterSpacing: ".06em", textTransform: "uppercase" }}>Nuvos Consulting</div>
        </div>
      </Link>

      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map(({ href, label, icon }) => {
          const active = pathname?.startsWith(href);
          return (
            <Link key={href} href={href} style={{
              display: "flex", alignItems: "center", gap: 12, height: 44, padding: "0 16px",
              borderRadius: 4, fontSize: 14, fontWeight: 500, textDecoration: "none",
              color: active ? "var(--c-champagne)" : "rgba(250,247,241,.72)",
              background: active ? "rgba(199,168,107,0.14)" : "transparent",
            }}>
              <Icon name={icon} />{label}
            </Link>
          );
        })}
      </nav>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 2, paddingTop: 16, borderTop: "1px solid rgba(250,247,241,.12)" }}>
        {SECONDARY.map(({ href, label, icon }) => {
          const active = pathname?.startsWith(href);
          return (
            <Link key={href} href={href} style={{
              display: "flex", alignItems: "center", gap: 12, height: 44, padding: "0 16px",
              borderRadius: 4, fontSize: 14, fontWeight: 500, textDecoration: "none",
              color: active ? "var(--c-champagne)" : "rgba(250,247,241,.72)",
              background: active ? "rgba(199,168,107,0.14)" : "transparent",
            }}>
              <Icon name={icon} />{label}
            </Link>
          );
        })}
      </div>

      <Link href="/consulting/profile" style={{
        display: "flex", alignItems: "center", gap: 10, paddingTop: 16,
        borderTop: "1px solid rgba(250,247,241,.12)", textDecoration: "none",
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%", background: "rgba(250,247,241,.12)",
          display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-ivory)", fontSize: 13, fontWeight: 600,
        }}>{initials ?? "—"}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-ivory)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name ?? "Mi cuenta"}</div>
          <div style={{ fontSize: 11, color: "rgba(250,247,241,.5)" }}>Ver perfil</div>
        </div>
      </Link>

      <button onClick={handleLogout} style={{
        background: "none", border: "none", color: "rgba(250,247,241,.4)", fontSize: 12.5,
        fontWeight: 600, textAlign: "left", cursor: "pointer", padding: 0,
      }}>Cerrar sesión</button>
    </aside>
  );
}
