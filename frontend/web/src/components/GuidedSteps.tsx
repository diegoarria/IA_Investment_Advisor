"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, X, BookOpen, MessageSquare, PieChart, Eye, Bell, Gamepad2, User } from "lucide-react";
import { getUserLevel } from "@/lib/userLevel";
import { useProfileStore } from "@/lib/store";

type PageKey = "chat" | "learn" | "portfolio" | "watchlist" | "notifications" | "arena" | "profile";

const GUIDE: Record<PageKey, {
  icon: React.ReactNode;
  title: string;
  what: string;
  todo: string;
  tip: string;
  nextPage: string | null;
  nextLabel: string | null;
}> = {
  chat: {
    icon: <MessageSquare className="w-5 h-5" />,
    title: "Tu mentor de inversiones",
    what: "Este chat con IA te explica cualquier concepto financiero en español y a tu nivel. Puedes preguntarle sobre empresas, cómo empezar, o qué hacer con tu dinero.",
    todo: "Escribe tu primera pregunta. Sugerencia: \"¿Por dónde empiezo a invertir con $500 dólares?\"",
    tip: "No hay preguntas tontas aquí. Cuanto más le cuentes sobre tus metas, mejor te guiará.",
    nextPage: "/learn",
    nextLabel: "Siguiente: Aprendizaje →",
  },
  learn: {
    icon: <BookOpen className="w-5 h-5" />,
    title: "Tu biblioteca financiera",
    what: "Aquí aprendes los conceptos clave de inversión en 30 segundos cada uno. La IA te los explica con ejemplos reales y sin tecnicismos.",
    todo: "Toca cualquier tema con la etiqueta \"Para ti\". Recomendados: Capitalización de Mercado, CETES o Diversificación.",
    tip: "No necesitas aprenderlo todo hoy. Con 2–3 temas por día, en un mes sabrás más que la mayoría.",
    nextPage: "/portfolio",
    nextLabel: "Siguiente: Portafolio →",
  },
  portfolio: {
    icon: <PieChart className="w-5 h-5" />,
    title: "El centro de mando de tus inversiones",
    what: "Aquí registras tus acciones y la app calcula en tiempo real cuánto ganaste o perdiste, y cómo te va contra el mercado (S&P 500).",
    todo: "Toca el botón \"+\" para agregar una posición, o importa una captura de pantalla de tu broker — la IA detecta todo automáticamente.",
    tip: "Si no tienes acciones todavía, agrega Apple (AAPL) con precio de compra de $1 para ver cómo funciona la pantalla.",
    nextPage: "/watchlist",
    nextLabel: "Siguiente: Watchlist →",
  },
  watchlist: {
    icon: <Eye className="w-5 h-5" />,
    title: "Tu lista de seguimiento",
    what: "Aquí guardas empresas que te interesan pero aún no compraste. La app te avisa si suben, bajan o tienen noticias importantes.",
    todo: "Busca 2–3 empresas que conozcas (Apple, Tesla, FEMSA) y agrégalas con el botón \"+\". Luego observa cómo se mueven.",
    tip: "Seguir empresas sin dinero real durante 3–6 meses es la mejor forma de desarrollar tu criterio de inversión.",
    nextPage: "/notifications",
    nextLabel: "Siguiente: Notificaciones →",
  },
  notifications: {
    icon: <Bell className="w-5 h-5" />,
    title: "Tus alertas personalizadas",
    what: "La app te avisa cuando tus posiciones se mueven significativamente, hay noticias relevantes para tus acciones, o el mercado hace algo importante.",
    todo: "Revisa las alertas que ya tienes. Si tienes posiciones en portafolio, deberías ver movimientos aquí. Activa las notificaciones push si no lo has hecho.",
    tip: "No es ruido genérico — cada alerta está filtrada a lo que tienes tú en tu portafolio y watchlist.",
    nextPage: "/arena",
    nextLabel: "Siguiente: Play →",
  },
  arena: {
    icon: <Gamepad2 className="w-5 h-5" />,
    title: "El simulador de decisiones reales",
    what: "Aquí practicas tomar decisiones de inversión en escenarios históricos reales — sin arriesgar dinero. Después ves exactamente qué habría pasado.",
    todo: "Toca \"Simulador\" y responde el escenario. No hay respuesta incorrecta — el objetivo es aprender qué habría hecho el mercado.",
    tip: "Los mejores inversores practican antes de usar dinero real. Buffett decía: la educación es la mejor inversión.",
    nextPage: "/profile",
    nextLabel: "Último paso: Mi Perfil →",
  },
  profile: {
    icon: <User className="w-5 h-5" />,
    title: "Tu perfil de inversor",
    what: "Aquí la app aprende sobre ti: cuánto riesgo toleras, tu horizonte de tiempo y qué tan activo quieres ser. Eso personaliza todo lo demás.",
    todo: "Revisa tu nivel de conocimiento abajo y ajústalo. Conforme aprendas más, actualízalo para que la app se adapte contigo.",
    tip: "Tu perfil no es permanente. Evoluciona a medida que tú evolucionas como inversor.",
    nextPage: null,
    nextLabel: null,
  },
};

const PAGE_ORDER: PageKey[] = ["chat", "learn", "portfolio", "watchlist", "notifications", "arena", "profile"];
const VISITED_KEY = "nuvos_visited_pages";
const DISMISSED_KEY = "nuvos_guide_dismissed";

export default function GuidedSteps({ currentPage }: { currentPage: PageKey }) {
  const { profile } = useProfileStore();
  const router = useRouter();
  const level = getUserLevel(profile);
  const [visited, setVisited] = useState<Set<PageKey>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(VISITED_KEY);
    const saved: PageKey[] = raw ? JSON.parse(raw) : [];
    const set = new Set<PageKey>(saved);
    // Mark current page as visited
    if (!set.has(currentPage)) {
      set.add(currentPage);
      localStorage.setItem(VISITED_KEY, JSON.stringify(Array.from(set)));
    }
    setVisited(set);
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
  }, [currentPage]);

  if (level !== "basico") return null;
  if (dismissed) return null;

  const guide = GUIDE[currentPage];
  const doneCount = PAGE_ORDER.filter((p) => visited.has(p)).length;
  const totalSteps = PAGE_ORDER.length;
  const isLast = !guide.nextPage;

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="mx-4 mt-3 mb-2 rounded-2xl border overflow-hidden shrink-0"
         style={{ background: "var(--card)", borderColor: "rgba(0,168,94,0.3)" }}>
      <div className="h-[3px]" style={{ background: "linear-gradient(90deg,#00a85e,#00d47e,#3ecf8e)" }} />

      {/* Header — always visible */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-2"
           style={{ borderBottom: collapsed ? "none" : "1px solid var(--border)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
               style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)" }}>
            {guide.icon}
          </div>
          <div>
            <p className="text-[11px] font-black leading-tight" style={{ color: "var(--accent-l)" }}>
              Guía paso a paso
            </p>
            <p className="text-[10px] leading-tight" style={{ color: "var(--dim)" }}>
              {doneCount}/{totalSteps} pantallas exploradas
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Progress dots */}
          <div className="flex gap-1 mr-1">
            {PAGE_ORDER.map((p) => (
              <div key={p} className="w-1.5 h-1.5 rounded-full transition-all"
                   style={{ background: visited.has(p) ? "var(--accent-l)" : p === currentPage ? "var(--accent-l)" : "var(--border)" }} />
            ))}
          </div>
          <button onClick={() => setCollapsed(!collapsed)}
                  className="text-[10px] font-bold px-2 py-1 rounded-lg transition-colors hover:bg-white/5"
                  style={{ color: "var(--muted)" }}>
            {collapsed ? "Ver" : "Minimizar"}
          </button>
          <button onClick={handleDismiss} style={{ color: "var(--dim)" }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="px-4 py-3 space-y-3">
          {/* Page title */}
          <div>
            <p className="font-black text-sm leading-tight" style={{ color: "var(--text)" }}>
              {guide.title}
            </p>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>
              {guide.what}
            </p>
          </div>

          {/* What to do now */}
          <div className="rounded-xl p-3" style={{ background: "rgba(0,168,94,0.07)", border: "1px solid rgba(0,168,94,0.2)" }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--accent-l)" }}>
              Haz esto ahora
            </p>
            <p className="text-xs leading-snug" style={{ color: "var(--sub)" }}>
              {guide.todo}
            </p>
          </div>

          {/* Tip */}
          <p className="text-[10px] leading-snug italic" style={{ color: "var(--dim)" }}>
            💡 {guide.tip}
          </p>

          {/* Next step CTA */}
          {guide.nextPage && (
            <button onClick={() => router.push(guide.nextPage!)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90"
                    style={{ background: "linear-gradient(135deg,#00a85e,#00d47e)" }}>
              {guide.nextLabel} <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          {isLast && doneCount >= totalSteps - 1 && (
            <div className="rounded-xl p-3 text-center"
                 style={{ background: "rgba(0,168,94,0.08)", border: "1px solid rgba(0,168,94,0.25)" }}>
              <p className="text-sm font-black mb-0.5" style={{ color: "var(--accent-l)" }}>🎉 ¡Ya conoces toda la app!</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>Ya puedes explorar por tu cuenta. La guía seguirá aquí si la necesitas.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
