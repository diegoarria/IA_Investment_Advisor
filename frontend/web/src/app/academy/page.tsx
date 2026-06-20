"use client";

import { Suspense, useState } from "react";
import TourSpotlight from "@/components/TourSpotlight";
import { useSearchParams, useRouter } from "next/navigation";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PremiumBadge from "@/components/PremiumBadge";
import { useLearnStore } from "@/lib/store";
import { BookOpen, ArrowRight, Play, Smartphone } from "lucide-react";

// ─── Category Grid ───────────────────────────────────────────────────────────

const CATEGORIES = [
  { emoji: "📚", title: "Básicos" },
  { emoji: "🏦", title: "Instrumentos" },
  { emoji: "📊", title: "Análisis" },
  { emoji: "🎯", title: "Estrategias" },
  { emoji: "🧠", title: "Psicología" },
  { emoji: "🌐", title: "Macro" },
];

// ─── Aprendizaje Tab ─────────────────────────────────────────────────────────

function AprendizajeTab() {
  const router = useRouter();
  const { streak, completedToday } = useLearnStore();

  return (
    <div className="space-y-4">
      {/* Streak Card */}
      <div
        className="rounded-xl p-5 border flex items-center gap-4"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div
          className="w-14 h-14 rounded-full flex flex-col items-center justify-center border-2 shrink-0"
          style={{
            borderColor: streak > 0 ? "#f59e0b" : "var(--border)",
            background: streak > 0 ? "#f59e0b18" : "var(--bg)",
          }}
        >
          <span className="text-2xl leading-none">{streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "✨"}</span>
          <span
            className="text-sm font-black leading-none mt-0.5"
            style={{ color: streak > 0 ? "#f59e0b" : "var(--muted)" }}
          >
            {streak}
          </span>
        </div>
        <div>
          <p className="font-black text-lg" style={{ color: "var(--text)" }}>
            {streak} {streak === 1 ? "día" : "días"} de racha
          </p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {streak > 0
              ? completedToday
                ? "¡Racha activa! Ya leíste hoy 🎉"
                : "¡Racha activa! Lee hoy para mantenerla"
              : "Lee para mantener tu racha"}
          </p>
        </div>
      </div>

      {/* Category Grid */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--muted)" }}>
          Explorar temas
        </p>
        <div className="grid grid-cols-3 gap-3">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.title}
              onClick={() => router.push("/learn")}
              className="rounded-xl p-4 border text-left transition-all hover:opacity-80 active:scale-95"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}
            >
              <span className="text-2xl block mb-2">{cat.emoji}</span>
              <p className="font-bold text-sm" style={{ color: "var(--text)" }}>
                {cat.title}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Ver todos button */}
      <button
        id="tour-start-learning"
        onClick={() => router.push("/learn")}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-opacity hover:opacity-80"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        <BookOpen size={16} />
        Ver todos los temas <ArrowRight size={16} />
      </button>
    </div>
  );
}

// ─── Videos Tab ──────────────────────────────────────────────────────────────

function VideosTab() {
  const router = useRouter();

  return (
    <div className="space-y-4">
      {/* Description Card */}
      <div
        className="rounded-xl p-5 border"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: "var(--accent)" + "22" }}
          >
            <Play size={18} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <p className="font-black" style={{ color: "var(--text)" }}>Videos de inversión</p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>Contenido corto y directo</p>
          </div>
        </div>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Aprende con videos cortos sobre inversiones, estrategias y análisis de mercado.
          Contenido curado especialmente para inversores hispanohablantes.
        </p>
      </div>

      {/* Open Feed Button */}
      <button
        onClick={() => router.push("/feed")}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-sm transition-opacity hover:opacity-80"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        <Play size={16} />
        Ver videos <ArrowRight size={16} />
      </button>

      {/* Mobile Note */}
      <div
        className="rounded-xl p-4 border flex items-start gap-3"
        style={{ background: "var(--bgRaised, var(--card))", borderColor: "var(--border)" }}
      >
        <Smartphone size={18} className="shrink-0 mt-0.5" style={{ color: "var(--muted)" }} />
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          <strong style={{ color: "var(--text)" }}>Mejor experiencia en móvil.</strong>{" "}
          Los videos son más cómodos en la app móvil de Nuvos AI, con gestos nativos y notificaciones.
        </p>
      </div>
    </div>
  );
}

// ─── Main Content ────────────────────────────────────────────────────────────

const TABS = [
  { id: "aprendizaje", label: "Aprendizaje" },
  { id: "videos", label: "Videos" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function AcademyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const rawTab = searchParams.get("tab") as TabId | null;
  const activeTab: TabId = rawTab && TABS.some((t) => t.id === rawTab) ? rawTab : "aprendizaje";
  const isTour = searchParams.get("tour") === "4";

  function setTab(id: TabId) {
    router.push(`/academy?tab=${id}`);
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        {/* Sticky Header */}
        <div
          className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between border-b shrink-0"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Aprende e invierte
            </p>
            <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
              Academy
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <PremiumBadge />
          </div>
        </div>

        {/* Sub-tab Bar */}
        <div
          className="flex gap-1 px-6 py-2 border-b shrink-0"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: activeTab === tab.id ? "var(--accent)" : "transparent",
                color: activeTab === tab.id ? "#fff" : "var(--muted)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto scrollbar-thin p-4">
            {activeTab === "aprendizaje" && <AprendizajeTab />}
            {activeTab === "videos" && <VideosTab />}
          </main>
        </div>
      </div>

      {isTour && (
        <TourSpotlight
          targetId="tour-start-learning"
          step={4}
          title="Empieza tu primera lección"
          description="Cada día hay una lección nueva. Completa 3 seguidas y arranca tu racha — tu streak se muestra en el home."
          ctaLabel="Entendido, volver al inicio ✓"
        />
      )}
    </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default function AcademyPage() {
  return (
    <Suspense fallback={null}>
      <AcademyContent />
    </Suspense>
  );
}
