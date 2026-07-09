"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PricingModal from "@/components/PricingModal";
import { useSubscriptionStore, useAuthStore } from "@/lib/store";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
import {
  Brain, BarChart2, TrendingUp, Shield, Zap, BookOpen,
  GraduationCap, Bell, Calendar, RefreshCw, Target,
  Check, ArrowRight, Sparkles, FileText,
} from "lucide-react";

function getSubscriptionFeatures(t: TFunction) {
  const free = t("products.free", { returnObjects: true }) as string[];
  const premium = t("products.premium", { returnObjects: true }) as string[];
  const freeIcons = [Brain, BarChart2, TrendingUp, Bell, BookOpen, GraduationCap, Brain];
  const premiumIcons = [Brain, Calendar, Shield, Sparkles, FileText, TrendingUp, Bell, RefreshCw, GraduationCap, BarChart2, Zap, Target];
  return {
    free: free.map((text, i) => ({ icon: freeIcons[i], text })),
    premium: premium.map((text, i) => ({ icon: premiumIcons[i], text })),
  };
}

function getDuoPlan(t: TFunction) {
  return {
    icon: "🌍",
    title: t("products.duoPlanTitle"),
    price: "$19.99",
    priceNote: t("products.duoPlanPriceNote"),
  };
}

function getDuoPlanFeatures(t: TFunction): string[] {
  return t("products.duoPlanFeatures", { returnObjects: true }) as string[];
}

function getOneTimeProducts(t: TFunction) {
  const items = t("products.oneTimeProducts", { returnObjects: true }) as {
    title: string; features: string[]; note?: string;
  }[];
  const meta = [
    { icon: "📊", price_free: "$34.99 USD", price_premium: "$19.99 USD", offer: "annual_report", variant: "default" },
    { icon: "📱", price_free: "$149 USD", price_premium: "$99 USD", offer: "session", variant: "default" },
    { icon: "📦", price_premium: "$247 USD", offer: "session", variant: "bundle" },
    { icon: "🔬", price_free: "$19.99 USD", price_premium: "$9.99 USD", offer: "deep_research", variant: "default" },
  ];
  return items.map((item, i) => ({ ...item, ...meta[i], available: true }));
}

function getComingSoon(t: TFunction) {
  const items = t("products.comingSoon", { returnObjects: true }) as { title: string; description: string }[];
  const icons = ["🔗", "📈"];
  return items.map((item, i) => ({ ...item, icon: icons[i] }));
}

export default function ProductsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const SUBSCRIPTION_FEATURES = getSubscriptionFeatures(t);
  const DUO_PLAN = getDuoPlan(t);
  const DUO_PLAN_FEATURES = getDuoPlanFeatures(t);
  const ONE_TIME_PRODUCTS = getOneTimeProducts(t);
  const COMING_SOON = getComingSoon(t);
  const { tier: subTier } = useSubscriptionStore();
  const { token } = useAuthStore();
  const isPremium = subTier === "premium";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  async function handleCheckout(offer: string, variant: string) {
    if (!token) { router.push("/login"); return; }
    setCheckoutLoading(offer + variant);
    try {
      const res = await fetch(`${API}/api/upsells/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ offer, variant, trigger_source: "products_page" }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } finally {
      setCheckoutLoading(null);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-10">

            {/* Header */}
            <div>
              <h1 className="text-2xl font-black mb-1" style={{ color: "var(--text)" }}>{t("products.title")}</h1>
              <p className="text-sm" style={{ color: "var(--muted)" }}>{t("products.subtitle")}</p>
            </div>

            {/* ── Suscripción ─────────────────────────────────────────────── */}
            <section>
              <h2 className="text-base font-black mb-4" style={{ color: "var(--text)" }}>{t("products.subscriptionTitle")}</h2>

              <div className="grid grid-cols-2 gap-4">
                {/* Free */}
                <div className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <p className="text-base font-black mb-0.5" style={{ color: "var(--text)" }}>{t("products.freeName")}</p>
                  <p className="text-2xl font-black mb-1" style={{ color: "var(--text)" }}>$0 <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>{t("products.freePerMonth")}</span></p>
                  <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>{t("products.freeDesc")}</p>
                  {!isPremium && (
                    <div className="text-center text-xs font-bold py-2 px-3 rounded-xl mb-4" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                      {t("products.currentPlan")}
                    </div>
                  )}
                  <div className="space-y-2.5">
                    {SUBSCRIPTION_FEATURES.free.map((f, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--muted)" }} />
                        <span className="text-xs" style={{ color: "var(--muted)" }}>{f.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Premium */}
                <div className="rounded-2xl border p-5 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0a1a10 0%, #0d1f15 100%)", borderColor: "rgba(0,212,126,0.4)" }}>
                  <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at top right, rgba(0,212,126,0.08) 0%, transparent 60%)" }} />

                  <div className="relative flex items-center justify-between mb-0.5">
                    <p className="text-base font-black text-white">{t("products.premiumName")}</p>
                    {isPremium && (
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(0,212,126,0.2)", color: "#00d47e" }}>{t("products.yourPlan")}</span>
                    )}
                  </div>
                  <div className="relative flex items-baseline gap-1 mb-1">
                    <span className="text-xl line-through" style={{ color: "rgba(255,255,255,0.3)" }}>$12.99</span>
                    <span className="text-2xl font-black text-white">$0</span>
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>{t("products.firstMonth")}</span>
                  </div>
                  <p className="relative text-[10px] mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>{t("products.premiumPriceNote")}</p>

                  {!isPremium ? (
                    <button
                      onClick={() => setShowPricing(true)}
                      className="relative w-full py-2 rounded-xl text-xs font-black mb-4 transition-all hover:opacity-90"
                      style={{ background: "#00d47e", color: "#000" }}
                    >
                      {t("products.claimFirstMonth")}
                    </button>
                  ) : (
                    <div className="relative text-center text-xs font-bold py-2 px-3 rounded-xl mb-4" style={{ background: "rgba(0,212,126,0.15)", color: "#00d47e" }}>
                      {t("products.active")}
                    </div>
                  )}

                  <div className="relative space-y-2.5">
                    {SUBSCRIPTION_FEATURES.premium.map((f, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#00d47e" }} />
                        <span className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>{f.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* ── Duo Plan ────────────────────────────────────────────────── */}
            <section>
              <h2 className="text-base font-black mb-4" style={{ color: "var(--text)" }}>{t("products.duoPlanTitle")}</h2>
              <div className="rounded-2xl border p-5 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0d1020 0%, #111827 100%)", borderColor: "rgba(99,102,241,0.4)" }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at top right, rgba(99,102,241,0.07) 0%, transparent 60%)" }} />

                <div className="relative flex items-center gap-2 mb-0.5">
                  <span className="text-xl">{DUO_PLAN.icon}</span>
                  <p className="text-base font-black text-white">{DUO_PLAN.title}</p>
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}>{t("products.duoPlanNew")}</span>
                </div>
                <p className="relative text-2xl font-black text-white mb-1">
                  {DUO_PLAN.price} <span className="text-sm font-normal" style={{ color: "rgba(255,255,255,0.5)" }}>{t("products.duoPlanPerMonth")}</span>
                </p>
                <p className="relative text-[10px] mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>{DUO_PLAN.priceNote}</p>

                <button
                  onClick={() => setShowPricing(true)}
                  className="relative w-full py-2 rounded-xl text-xs font-black mb-4 transition-all hover:opacity-90 flex items-center justify-center gap-1"
                  style={{ background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8" }}
                >
                  {t("products.hireDuoPlan")} <ArrowRight className="w-3 h-3" />
                </button>

                <div className="relative space-y-2.5">
                  {DUO_PLAN_FEATURES.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#818cf8" }} />
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ── Productos individuales ───────────────────────────────────── */}
            <section>
              <h2 className="text-base font-black mb-4" style={{ color: "var(--text)" }}>{t("products.oneTimeProductsTitle")}</h2>
              <div className="space-y-3">
                {ONE_TIME_PRODUCTS.map((p, i) => (
                  <div key={i} className="rounded-2xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xl">{p.icon}</span>
                      <p className="text-base font-black" style={{ color: "var(--text)" }}>{p.title}</p>
                    </div>

                    <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                      {p.price_premium && (
                        <span className="text-2xl font-black" style={{ color: "#00d47e" }}>{p.price_premium}</span>
                      )}
                      {p.price_free && (
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          {t("products.freeLabel")} <strong style={{ color: "var(--sub)" }}>{p.price_free}</strong>
                        </span>
                      )}
                    </div>
                    {p.note && (
                      <span className="inline-block text-[10px] px-2 py-0.5 rounded-full mb-4" style={{ background: "rgba(0,212,126,0.08)", color: "#00d47e" }}>{p.note}</span>
                    )}

                    <button
                      onClick={() => p.offer === "deep_research" ? router.push("/research") : handleCheckout(p.offer, p.variant ?? "default")}
                      disabled={checkoutLoading === p.offer + (p.variant ?? "default")}
                      className={`w-full py-2 rounded-xl text-xs font-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1 ${p.note ? "" : "mb-4"}`}
                      style={{ background: "#00d47e", color: "#000" }}
                    >
                      {checkoutLoading === p.offer + (p.variant ?? "default") ? "..." : <>{t("products.viewDetails")} <ArrowRight className="w-3 h-3" /></>}
                    </button>
                    {p.note && <div className="mb-4" />}

                    <div className="space-y-2.5">
                      {p.features.map((f, fi) => (
                        <div key={fi} className="flex items-start gap-2">
                          <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#00d47e" }} />
                          <span className="text-xs" style={{ color: "var(--muted)" }}>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Próximamente ─────────────────────────────────────────────── */}
            <section>
              <h2 className="text-base font-black mb-4" style={{ color: "var(--text)" }}>{t("products.comingSoonTitle")}</h2>
              <div className="space-y-3">
                {COMING_SOON.map((p, i) => (
                  <div key={i} className="rounded-2xl border p-5 opacity-60" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <div className="flex items-start gap-3">
                      <span className="text-xl">{p.icon}</span>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-black" style={{ color: "var(--text)" }}>{p.title}</h3>
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>{t("products.comingSoonBadge")}</span>
                        </div>
                        <p className="text-xs" style={{ color: "var(--muted)", lineHeight: 1.55 }}>{p.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

          </div>
        </main>
      </div>

      <PricingModal visible={showPricing} onClose={() => setShowPricing(false)} />
    </div>
  );
}
