"use client";

import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users, Bell, Wrench, ShieldCheck } from "lucide-react";
import { useAuthStore } from "@/lib/store";

const ADMIN_UID = "86961402-9072-4670-9f73-b2aa91930b04";

const NAV = [
  { href: "/admin/overview", label: "Negocio", icon: LayoutDashboard },
  { href: "/admin/users", label: "Usuarios", icon: Users },
  { href: "/admin/notifications", label: "Notificaciones", icon: Bell },
  { href: "/admin/diagnostics", label: "Diagnósticos", icon: Wrench },
];

// Diego, 2026-10-26: these 4 pages used to have zero navigation between
// them — you had to already know all 4 URLs by heart. This sidebar is the
// single shared shell every /admin/* page now renders inside, so there's
// one consistent place to jump between Negocio/Usuarios/Notificaciones/
// Diagnósticos instead of editing the address bar.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { userId } = useAuthStore();

  return (
    <div className="h-screen flex" style={{ background: "var(--bg)" }}>
      <aside
        className="w-56 shrink-0 h-screen flex flex-col py-5 px-3 border-r"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        <button
          onClick={() => router.push("/admin/overview")}
          className="flex items-center gap-2 px-2 mb-6 text-left"
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--accent)" }}
          >
            <ShieldCheck className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <p className="text-sm font-black leading-tight" style={{ color: "var(--text)" }}>Nuvos Admin</p>
            <p className="text-[11px] leading-tight" style={{ color: "var(--muted)" }}>Panel interno</p>
          </div>
        </button>

        <nav className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname?.startsWith(href);
            return (
              <button
                key={href}
                onClick={() => router.push(href)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold text-left transition-colors"
                style={
                  active
                    ? { background: "var(--accent)", color: "#fff" }
                    : { background: "transparent", color: "var(--muted)" }
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto px-2 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
          <p className="text-[10px]" style={{ color: "var(--dim)" }}>
            {userId === ADMIN_UID ? "Sesión de admin activa" : "Verificando acceso…"}
          </p>
        </div>
      </aside>

      <main className="flex-1 min-w-0 h-screen overflow-hidden">
        {children}
      </main>
    </div>
  );
}
