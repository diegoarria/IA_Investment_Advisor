"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X, ChevronRight, Lock } from "lucide-react";
import { useSubscriptionStore, useProfileStore } from "@/lib/store";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

function getSections(t: TFunction) {
  return [
    {
      emoji: "🤖",
      title: t("nuvosGuide.s1Title"),
      subtitle: t("nuvosGuide.s1Subtitle"),
      description: t("nuvosGuide.s1Description"),
      cta: t("nuvosGuide.s1Cta"),
      href: "/chat",
      tip: t("nuvosGuide.s1Tip"),
      premium: false,
    },
    {
      emoji: "💼",
      title: t("nuvosGuide.s2Title"),
      subtitle: t("nuvosGuide.s2Subtitle"),
      description: t("nuvosGuide.s2Description"),
      cta: t("nuvosGuide.s2Cta"),
      href: "/portfolio",
      tip: t("nuvosGuide.s2Tip"),
      premium: false,
    },
    {
      emoji: "👀",
      title: t("nuvosGuide.s3Title"),
      subtitle: t("nuvosGuide.s3Subtitle"),
      description: t("nuvosGuide.s3Description"),
      cta: t("nuvosGuide.s3Cta"),
      href: "/watchlist",
      tip: t("nuvosGuide.s3Tip"),
      premium: false,
    },
    {
      emoji: "📚",
      title: t("nuvosGuide.s4Title"),
      subtitle: t("nuvosGuide.s4Subtitle"),
      description: t("nuvosGuide.s4Description"),
      cta: t("nuvosGuide.s4Cta"),
      href: "/academy",
      tip: t("nuvosGuide.s4Tip"),
      premium: false,
    },
    {
      emoji: "🎬",
      title: t("nuvosGuide.s5Title"),
      subtitle: t("nuvosGuide.s5Subtitle"),
      description: t("nuvosGuide.s5Description"),
      cta: t("nuvosGuide.s5Cta"),
      href: "/feed",
      tip: t("nuvosGuide.s5Tip"),
      premium: false,
    },
    {
      emoji: "🧮",
      title: t("nuvosGuide.s6Title"),
      subtitle: t("nuvosGuide.s6Subtitle"),
      description: t("nuvosGuide.s6Description"),
      cta: t("nuvosGuide.s6Cta"),
      href: "/patrimonio",
      tip: t("nuvosGuide.s6Tip"),
      premium: false,
    },
    {
      emoji: "📊",
      title: t("nuvosGuide.s7Title"),
      subtitle: t("nuvosGuide.s7Subtitle"),
      description: t("nuvosGuide.s7Description"),
      cta: t("nuvosGuide.s7Cta"),
      href: null as string | null,
      tip: null as string | null,
      premium: true,
    },
    {
      emoji: "🔬",
      title: t("nuvosGuide.s8Title"),
      subtitle: t("nuvosGuide.s8Subtitle"),
      description: t("nuvosGuide.s8Description"),
      cta: t("nuvosGuide.s8Cta"),
      href: null as string | null,
      tip: null as string | null,
      premium: true,
    },
    {
      emoji: "📥",
      title: t("nuvosGuide.s9Title"),
      subtitle: t("nuvosGuide.s9Subtitle"),
      description: t("nuvosGuide.s9Description"),
      cta: t("nuvosGuide.s9Cta"),
      href: null as string | null,
      tip: null as string | null,
      premium: true,
    },
    {
      emoji: "📈",
      title: t("nuvosGuide.s10Title"),
      subtitle: t("nuvosGuide.s10Subtitle"),
      description: t("nuvosGuide.s10Description"),
      cta: t("nuvosGuide.s10Cta"),
      href: null as string | null,
      tip: null as string | null,
      premium: true,
    },
  ];
}

export default function NuvosGuide() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { tier } = useSubscriptionStore();
  const { profile } = useProfileStore();

  const isAuthPage = !pathname || pathname === "/" || pathname.startsWith("/auth") || pathname === "/onboarding" || pathname === "/join";
  if (isAuthPage) return null;
  if (tier === "premium") return null;

  const SECTIONS = getSections(t);
  const freeSections    = SECTIONS.filter((s) => !s.premium);
  const premiumSections = SECTIONS.filter((s) => s.premium);

  const handleCta = (section: typeof SECTIONS[0]) => {
    if (section.premium) {
      router.push("/profile");
    } else if (section.href) {
      router.push(section.href);
    }
    setOpen(false);
    setActive(null);
  };

  return (
    <>
      {/* Floating button — icon-only circular FAB on mobile (small footprint,
          much less likely to sit on top of a page's own bottom content since
          this is `fixed` and doesn't know what's scrolled underneath it);
          the full labeled pill only appears from `sm` up, where screens are
          wide enough that a corner pill rarely collides with anything. */}
      <button
        onClick={() => setOpen(true)}
        aria-label={t("nuvosGuide.floatingButton")}
        className="fixed bottom-6 right-6 z-40 flex items-center justify-center sm:justify-start gap-0 sm:gap-2 w-12 h-12 sm:w-auto sm:h-auto p-0 sm:px-4 sm:py-3 rounded-full sm:rounded-2xl shadow-2xl font-bold text-sm transition-all hover:scale-105 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #22c55e, #16a34a)",
          color: "#000",
          boxShadow: "0 4px 24px rgba(34,197,94,0.4)",
        }}
      >
        <span className="text-base">🗺️</span>
        <span className="hidden sm:inline">{t("nuvosGuide.floatingButton")}</span>
      </button>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex" onClick={() => { setOpen(false); setActive(null); }}>
          {/* Backdrop */}
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }} />

          {/* Drawer */}
          <div
            className="absolute right-0 top-0 h-full w-full max-w-md flex flex-col"
            style={{ background: "var(--card)", borderLeft: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <div>
                <p className="font-black text-base" style={{ color: "var(--text)" }}>{t("nuvosGuide.drawerTitle")}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{t("nuvosGuide.drawerSubtitle")}</p>
              </div>
              <button onClick={() => { setOpen(false); setActive(null); }} className="p-1.5 rounded-xl hover:opacity-70">
                <X className="w-5 h-5" style={{ color: "var(--muted)" }} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">

              {/* Free features */}
              <p className="text-[10px] font-bold uppercase tracking-widest px-1 mb-3" style={{ color: "var(--dim)" }}>
                {t("nuvosGuide.freeTierAvailable")}
              </p>

              {freeSections.map((s, i) => (
                <div key={i}>
                  <button
                    onClick={() => setActive(active === i ? null : i)}
                    className="w-full flex items-center gap-3 p-3.5 rounded-2xl text-left transition-all hover:opacity-90"
                    style={{
                      background: active === i ? "rgba(34,197,94,0.08)" : "var(--raised)",
                      border: `1px solid ${active === i ? "rgba(34,197,94,0.3)" : "var(--border)"}`,
                    }}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                         style={{ background: "var(--card)" }}>
                      {s.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{s.title}</p>
                      <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{s.subtitle}</p>
                    </div>
                    <ChevronRight
                      className="w-4 h-4 shrink-0 transition-transform"
                      style={{ color: "var(--dim)", transform: active === i ? "rotate(90deg)" : "none" }}
                    />
                  </button>

                  {active === i && (
                    <div className="mx-1 px-4 py-4 rounded-b-2xl space-y-3 -mt-1"
                         style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.15)", borderTop: "none" }}>
                      <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>{s.description}</p>

                      {s.tip && (
                        <div className="text-xs px-3 py-2 rounded-xl italic"
                             style={{ background: "var(--raised)", color: "var(--muted)" }}>
                          💡 {s.tip}
                        </div>
                      )}
                      <button
                        onClick={() => handleCta(s)}
                        className="w-full py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90"
                        style={{ background: "#22c55e", color: "#000" }}
                      >
                        {s.cta} →
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {/* Premium teaser */}
              <p className="text-[10px] font-bold uppercase tracking-widest px-1 mt-5 mb-3" style={{ color: "var(--dim)" }}>
                {t("nuvosGuide.premiumTeaser")}
              </p>

              {premiumSections.map((s, i) => {
                const idx = freeSections.length + i;
                return (
                  <div key={idx}>
                    <button
                      onClick={() => setActive(active === idx ? null : idx)}
                      className="w-full flex items-center gap-3 p-3.5 rounded-2xl text-left transition-all hover:opacity-90"
                      style={{
                        background: active === idx ? "rgba(245,158,11,0.08)" : "var(--raised)",
                        border: `1px solid ${active === idx ? "rgba(245,158,11,0.3)" : "var(--border)"}`,
                        opacity: 0.85,
                      }}
                    >
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 relative"
                           style={{ background: "var(--card)" }}>
                        {s.emoji}
                        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                             style={{ background: "#f59e0b" }}>
                          <Lock className="w-2.5 h-2.5" style={{ color: "#000" }} />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{s.title}</p>
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                                style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                            {t("nuvosGuide.premiumBadge")}
                          </span>
                        </div>
                        <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{s.subtitle}</p>
                      </div>
                      <ChevronRight
                        className="w-4 h-4 shrink-0 transition-transform"
                        style={{ color: "var(--dim)", transform: active === idx ? "rotate(90deg)" : "none" }}
                      />
                    </button>

                    {active === idx && (
                      <div className="mx-1 px-4 py-4 rounded-b-2xl space-y-3 -mt-1"
                           style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)", borderTop: "none" }}>
                        <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>{s.description}</p>
                        <button
                          onClick={() => handleCta(s)}
                          className="w-full py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90"
                          style={{ background: "linear-gradient(90deg,#f59e0b,#f97316)", color: "#000" }}
                        >
                          {t("nuvosGuide.activatePremiumCta")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Bottom CTA */}
              <div className="pt-2 pb-4">
                <button
                  onClick={() => { router.push("/profile"); setOpen(false); }}
                  className="w-full py-3.5 rounded-2xl text-sm font-black transition-all hover:opacity-90"
                  style={{ background: "linear-gradient(90deg,#f59e0b,#f97316)", color: "#000" }}
                >
                  {t("nuvosGuide.bottomCta")}
                </button>
                <p className="text-center text-xs mt-2" style={{ color: "var(--dim)" }}>
                  {t("nuvosGuide.bottomSubCta")}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
