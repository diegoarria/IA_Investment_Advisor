"use client";

// Fase 4, Incremento 12 — Personalización (Parte L, see
// /Users/diegoarria/.claude/plans/stateful-painting-flurry.md). Dedicated
// settings page (mirrors /journal's pattern — a real route, not a modal)
// for the 5 personalization settings this increment adds, plus a
// shortcut to the Nivel de Detalle toggle already built in Incremento 1.
// Every setting here feeds an already-real, per-request surface — see
// src/lib/personalization.ts for exactly which one.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal, Check } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import { Card, SectionHeader, DetailLevelToggle } from "@/components/ui";
import { useAuthStore, useDetailLevelStore, usePersonalizationStore } from "@/lib/store";
import {
  DISCOUNT_RATE_METHODS, FAVORITE_METRIC_KEYS, REORDERABLE_SECTIONS,
  type DiscountRateMethod, type FavoriteMetricKey, type ReorderableSection,
} from "@/lib/personalization";

function NumberField({
  label, hint, value, onCommit, suffix = "%",
}: { label: string; hint: string; value: number | null; onCommit: (v: number | null) => void; suffix?: string }) {
  const [text, setText] = useState(value !== null ? String(value) : "");
  return (
    <div>
      <p className="text-[12.5px] font-semibold mb-1" style={{ color: "var(--text)" }}>{label}</p>
      <p className="text-[11px] mb-1.5" style={{ color: "var(--muted)" }}>{hint}</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const trimmed = text.trim();
            onCommit(trimmed === "" ? null : Number(trimmed));
          }}
          className="w-28 text-[13px] rounded-lg px-2.5 py-1.5 border bg-transparent"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        />
        <span className="text-[12px]" style={{ color: "var(--muted)" }}>{suffix}</span>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { detailLevel, setDetailLevel } = useDetailLevelStore();
  const {
    requiredReturnPct, minMarginOfSafetyPct, preferredDiscountRateMethod,
    favoriteMetrics, dashboardSectionOrder, setPersonalization,
  } = usePersonalizationStore();

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) router.push("/login");
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return null;

  const toggleFavoriteMetric = (key: FavoriteMetricKey) => {
    const next = favoriteMetrics.includes(key)
      ? favoriteMetrics.filter((k) => k !== key)
      : [...favoriteMetrics, key].slice(0, 6);
    setPersonalization({ favoriteMetrics: next });
  };

  const moveSection = (from: number, to: number) => {
    if (from === to) return;
    const next = [...dashboardSectionOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPersonalization({ dashboardSectionOrder: next as ReorderableSection[] });
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

            <div className="flex items-center gap-2.5">
              <SlidersHorizontal className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
              <div>
                <h1 className="text-2xl font-black" style={{ color: "var(--text)" }}>{t("settings.title")}</h1>
                <p className="text-sm" style={{ color: "var(--muted)" }}>{t("settings.subtitle")}</p>
              </div>
            </div>

            {/* Nivel de detalle */}
            <Card>
              <SectionHeader title={t("settings.detailLevel.title")} subtitle={t("settings.detailLevel.subtitle")} />
              <DetailLevelToggle value={detailLevel} onChange={setDetailLevel} />
            </Card>

            {/* Retorno requerido + método de tasa de descuento */}
            <Card>
              <SectionHeader title={t("settings.discountRate.title")} subtitle={t("settings.discountRate.subtitle")} />
              <div className="space-y-4">
                <NumberField
                  label={t("settings.discountRate.requiredReturnLabel")}
                  hint={t("settings.discountRate.requiredReturnHint")}
                  value={requiredReturnPct}
                  onCommit={(v) => setPersonalization({ requiredReturnPct: v })}
                />
                <div>
                  <p className="text-[12.5px] font-semibold mb-1.5" style={{ color: "var(--text)" }}>{t("settings.discountRate.methodLabel")}</p>
                  <div className="flex gap-2">
                    {DISCOUNT_RATE_METHODS.map((method: DiscountRateMethod) => (
                      <button
                        key={method}
                        onClick={() => setPersonalization({ preferredDiscountRateMethod: method })}
                        className="text-[12px] font-semibold rounded-lg px-3 py-1.5 border"
                        style={{
                          borderColor: preferredDiscountRateMethod === method ? "var(--accent-l)" : "var(--border)",
                          color: preferredDiscountRateMethod === method ? "var(--accent-l)" : "var(--muted)",
                          background: preferredDiscountRateMethod === method ? "rgba(0,168,94,0.10)" : "transparent",
                        }}
                      >
                        {t(`settings.discountRate.methods.${method}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            {/* Margen de seguridad mínimo */}
            <Card>
              <SectionHeader title={t("settings.marginOfSafety.title")} subtitle={t("settings.marginOfSafety.subtitle")} />
              <NumberField
                label={t("settings.marginOfSafety.label")}
                hint={t("settings.marginOfSafety.hint")}
                value={minMarginOfSafetyPct}
                onCommit={(v) => setPersonalization({ minMarginOfSafetyPct: v })}
              />
            </Card>

            {/* Métricas favoritas */}
            <Card>
              <SectionHeader title={t("settings.favoriteMetrics.title")} subtitle={t("settings.favoriteMetrics.subtitle")} />
              <div className="flex flex-wrap gap-2">
                {FAVORITE_METRIC_KEYS.map((key) => {
                  const active = favoriteMetrics.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleFavoriteMetric(key)}
                      className="flex items-center gap-1.5 text-[12px] font-semibold rounded-lg px-3 py-1.5 border"
                      style={{
                        borderColor: active ? "var(--accent-l)" : "var(--border)",
                        color: active ? "var(--accent-l)" : "var(--muted)",
                        background: active ? "rgba(0,168,94,0.10)" : "transparent",
                      }}
                    >
                      {active && <Check className="w-3 h-3" />}
                      {t(`settings.favoriteMetrics.keys.${key}`)}
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Orden del dashboard */}
            <Card>
              <SectionHeader title={t("settings.dashboardOrder.title")} subtitle={t("settings.dashboardOrder.subtitle")} />
              <div className="space-y-1.5">
                {dashboardSectionOrder.map((key, i) => (
                  <div
                    key={key}
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (dragIndex !== null) moveSection(dragIndex, i); setDragIndex(null); }}
                    onDragEnd={() => setDragIndex(null)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 border cursor-grab"
                    style={{ borderColor: "var(--border)", background: "var(--raised)" }}
                  >
                    <span className="text-[11px] tabular-nums" style={{ color: "var(--dim)" }}>{i + 1}</span>
                    <span className="text-[12.5px]" style={{ color: "var(--text)" }}>
                      {t(`settings.dashboardOrder.sections.${key}`)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

          </div>
        </main>
      </div>
    </div>
  );
}
