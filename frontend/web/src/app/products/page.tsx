"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import dynamic from "next/dynamic";
// Fase 4, Incremento 13 (Cierre, Parte M) — modal-gated, safe to split out.
const PricingModal = dynamic(() => import("@/components/PricingModal"), { ssr: false });
import { useSubscriptionStore, useAuthStore, hasPremiumAccess } from "@/lib/store";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { upsells, billing } from "@/lib/api";
import EmbeddedCheckout, { type CheckoutSummary } from "@/components/EmbeddedCheckout";
import { useBillingPricing, fmtMxn } from "@/lib/pricing";
import { setReturnTo } from "@/lib/returnTo";
import {
  Brain, BarChart2, TrendingUp, Shield, Zap, BookOpen,
  GraduationCap, Bell, Calendar, RefreshCw, Target, Search,
  Check, ArrowRight, Sparkles, FileText,
  Award, Leaf, Gem, CheckCircle2, ShieldCheck, Users, Tag, Clock, Smartphone, Package, PhoneCall, Link2,
  type LucideIcon,
} from "lucide-react";

function getSubscriptionFeatures(t: TFunction) {
  const free = t("products.free", { returnObjects: true }) as string[];
  const premium = t("products.premium", { returnObjects: true }) as string[];
  const freeIcons = [Brain, BarChart2, TrendingUp, Bell, BookOpen, GraduationCap, Brain, Search];
  const premiumIcons = [Brain, Calendar, Shield, Sparkles, FileText, TrendingUp, Bell, RefreshCw, GraduationCap, BarChart2, Zap, Target, Search];
  return {
    free: free.map((text, i) => ({ icon: freeIcons[i], text })),
    premium: premium.map((text, i) => ({ icon: premiumIcons[i], text })),
  };
}

function getDuoPlan(t: TFunction) {
  return {
    title: t("products.duoPlanTitle"),
    price: "$23.99",
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
  const meta: { icon: LucideIcon; price_free?: string; price_premium: string; offer: string; variant: string }[] = [
    { icon: Smartphone, price_free: "$149 USD", price_premium: "$99 USD", offer: "session", variant: "default" },
    { icon: Package, price_premium: "$247 USD", offer: "session", variant: "bundle" },
    { icon: PhoneCall, price_premium: "$20 USD", offer: "broker_call", variant: "default" },
  ];
  return items.map((item, i) => ({ ...item, ...meta[i], available: true }));
}

function getComingSoon(t: TFunction) {
  const items = t("products.comingSoon", { returnObjects: true }) as { title: string; description: string }[];
  const icons: LucideIcon[] = [Link2, TrendingUp];
  return items.map((item, i) => ({ ...item, icon: icons[i] }));
}

// Products — redesigned 2026-09-28 (Diego: "más atractivo, más llamativo,
// manteniendo estándar de marca"), same as mobile. Same copy, prices and
// checkout flows; line icons instead of emoji, gradient plan cards.
function SectionTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-5">
      <span className="w-8 h-8 rounded-[10px] flex items-center justify-center" style={{ background: "rgba(0,185,109,0.12)" }}>
        <Icon className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
      </span>
      <h2 className="text-[21px] font-extrabold tracking-[-0.4px]" style={{ color: "var(--text)" }}>{title}</h2>
    </div>
  );
}

function FeatureRow({ text, tint, textColor, muted, small }: { text: string; tint: string; textColor: string; muted?: boolean; small?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="w-[19px] h-[19px] rounded-full border flex items-center justify-center shrink-0 mt-px"
            style={{ background: muted ? "transparent" : `color-mix(in srgb, ${tint} 18%, transparent)`, borderColor: muted ? `color-mix(in srgb, ${tint} 40%, transparent)` : "transparent" }}>
        <Check className="w-3 h-3" style={{ color: tint }} strokeWidth={3} />
      </span>
      <span className={small ? "text-[13px] leading-5" : "text-sm leading-5"} style={{ color: textColor }}>{text}</span>
    </div>
  );
}

export default function ProductsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const SUBSCRIPTION_FEATURES = getSubscriptionFeatures(t);
  const pricing = useBillingPricing();
  const mxnPremium = pricing.currency === "mxn" && pricing.monthly != null && pricing.yearly != null;
  const mxnDuo = pricing.currency === "mxn" && pricing.duo_monthly != null && pricing.duo_yearly != null;
  const DUO_PLAN = getDuoPlan(t);
  if (mxnDuo) {
    DUO_PLAN.price = fmtMxn(pricing.duo_monthly!);
    DUO_PLAN.priceNote = t("products.duoPlanPriceNoteMxn", { yearly: fmtMxn(pricing.duo_yearly!) });
  }
  const DUO_PLAN_FEATURES = getDuoPlanFeatures(t);
  const ONE_TIME_PRODUCTS = getOneTimeProducts(t);
  // Sessions: show the price Stripe will actually charge (MXN) once every session price is configured.
  if (pricing.currency === "mxn" && pricing.session_free != null && pricing.session_premium != null && pricing.session_bundle != null) {
    const sess = ONE_TIME_PRODUCTS.find((p) => p.offer === "session" && p.variant === "default");
    const pack = ONE_TIME_PRODUCTS.find((p) => p.offer === "session" && p.variant === "bundle");
    if (sess) { sess.price_free = `${fmtMxn(pricing.session_free)} MXN`; sess.price_premium = `${fmtMxn(pricing.session_premium)} MXN`; }
    if (pack) pack.price_premium = `${fmtMxn(pricing.session_bundle)} MXN`;
  }
  // Broker-onboarding call: one price for everyone (no free/premium split here).
  if (pricing.currency === "mxn" && pricing.broker_call != null) {
    const call = ONE_TIME_PRODUCTS.find((p) => p.offer === "broker_call");
    if (call) call.price_premium = `${fmtMxn(pricing.broker_call)} MXN`;
  }
  const COMING_SOON = getComingSoon(t);
  const { tier: subTier, isTrialPremium, hasFetchedStatus } = useSubscriptionStore();
  const { isAuthenticated } = useAuthStore();
  // Bug fix (2026-08-12): missing isTrialPremium meant a user inside their
  // 30-day trial showed as not-premium on this exact page — same class of
  // bug found across ~8 places before this app consolidated onto
  // is_premium_active() server-side; this one frontend spot slipped through.
  const isPremium = hasPremiumAccess({ tier: subTier, isTrialPremium, hasFetchedStatus });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  // Diego, 2026-09-15: card entry happens INSIDE a modal (Stripe Elements)
  // instead of redirecting to a Stripe-hosted page.
  const [checkoutOffer, setCheckoutOffer] = useState<{ offer: string; variant: string } | null>(null);

  // Deep link from the Friday 1:1-call email: /products?open=session opens the
  // session checkout directly, on phone or desktop. Not signed in on this
  // device -> remember the destination, send to login, and login brings the
  // user straight back here (lib/returnTo). The 1s wait lets the persisted
  // auth store finish hydrating so a logged-in user is never bounced to login.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("open") !== "session") return;
    const timer = setTimeout(() => {
      if (!useAuthStore.getState().isAuthenticated) {
        setReturnTo("/products?open=session");
        router.push("/");
        return;
      }
      setCheckoutOffer({ offer: "session", variant: "default" });
      window.history.replaceState(null, "", "/products");
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCheckout(offer: string, variant: string) {
    if (!isAuthenticated) { router.push("/login"); return; }
    setCheckoutOffer({ offer, variant });
  }

  // Diego, 2026-09-15: "quiero agregarle este resumen del pedido similar a
  // los productos con sus respectivos productos" — same order-summary card
  // PricingModal's checkout already shows, built from this exact product's
  // own listing entry so it always matches what the user just clicked.
  const checkoutProduct = checkoutOffer
    ? ONE_TIME_PRODUCTS.find((p) => p.offer === checkoutOffer.offer && p.variant === checkoutOffer.variant)
    : null;
  const checkoutSummary: CheckoutSummary | undefined = checkoutProduct
    ? {
        planName: checkoutProduct.title,
        priceLabel: (isPremium ? checkoutProduct.price_premium : checkoutProduct.price_free) ?? checkoutProduct.price_premium ?? "",
        priceSuffix: "",
        dueTodayLabel: (isPremium ? checkoutProduct.price_premium : checkoutProduct.price_free) ?? checkoutProduct.price_premium ?? "",
        features: checkoutProduct.features,
        accentColor: "#00d47e",
      }
    : undefined;

  function handleCheckoutSuccess(paymentIntentId?: string) {
    if (!checkoutOffer) return;
    const { offer } = checkoutOffer;
    setCheckoutOffer(null);
    const target = offer === "family_plan"
      ? "/upsell-success?offer=family_plan"
      : `/upsell-success?offer=${offer}${paymentIntentId ? `&payment_intent=${paymentIntentId}` : ""}`;
    router.push(target);
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-12">

            {/* Intro hero */}
            <div className="relative overflow-hidden rounded-[26px] border p-7 sm:p-9"
                 style={{ borderColor: "rgba(0,185,109,0.3)", background: "linear-gradient(135deg, rgba(0,185,109,0.18) 0%, rgba(0,185,109,0.04) 50%, var(--card) 100%), var(--card)" }}>
              <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full"
                   style={{ background: "radial-gradient(circle, rgba(0,232,135,0.18), transparent 70%)" }} />
              <div className="relative">
                <span className="w-11 h-11 rounded-[13px] flex items-center justify-center mb-4" style={{ background: "var(--accent)" }}>
                  <Sparkles className="w-5 h-5 text-white" />
                </span>
                <h1 className="text-[28px] sm:text-[34px] font-extrabold tracking-[-0.8px] leading-tight" style={{ color: "var(--text)" }}>{t("products.title")}</h1>
                <p className="text-[15px] mt-2 max-w-xl leading-relaxed" style={{ color: "var(--sub)" }}>{t("products.subtitle")}</p>
              </div>
            </div>

            {/* ── Suscripción ─────────────────────────────────────────────── */}
            <section>
              <SectionTitle icon={Award} title={t("products.subscriptionTitle")} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
                {/* Free */}
                <div className="rounded-[24px] border p-6 flex flex-col" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-[12px] flex items-center justify-center" style={{ background: "rgba(0,185,109,0.10)" }}>
                      <Leaf className="w-[18px] h-[18px]" style={{ color: "var(--accent-l)" }} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-lg font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("products.freeName")}</p>
                      <p className="text-xs" style={{ color: "var(--muted)" }}>{t("products.freeDesc")}</p>
                    </div>
                  </div>
                  <p className="mt-5 flex items-baseline gap-1.5">
                    <span className="text-[40px] font-extrabold tracking-[-1.4px] leading-none" style={{ color: "var(--text)" }}>$0</span>
                    <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>{t("products.freePerMonth")}</span>
                  </p>
                  {!isPremium && (
                    <div className="mt-5 text-center text-[13px] font-bold py-3 rounded-[14px] border" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--sub)" }}>
                      {t("products.currentPlan")}
                    </div>
                  )}
                  <div className="h-px my-5" style={{ background: "var(--border)" }} />
                  <div className="space-y-3">
                    {SUBSCRIPTION_FEATURES.free.map((f, i) => (
                      <FeatureRow key={i} text={f.text} tint="var(--sub)" textColor="var(--sub)" muted />
                    ))}
                  </div>
                </div>

                {/* Premium */}
                <div className="rounded-[24px] border p-6 relative overflow-hidden flex flex-col"
                     style={{ background: "linear-gradient(135deg, #0F3326 0%, #0A1C1D 55%, #080E16 100%)", borderColor: "rgba(0,212,126,0.45)", boxShadow: "0 22px 50px -24px rgba(0,212,126,0.55)" }}>
                  <div aria-hidden className="pointer-events-none absolute -top-24 -right-20 w-72 h-72 rounded-full"
                       style={{ background: "radial-gradient(circle, rgba(0,232,135,0.2), transparent 70%)" }} />
                  <div className="relative flex items-center gap-3">
                    <span className="w-10 h-10 rounded-[12px] flex items-center justify-center" style={{ background: "#00D47E" }}>
                      <Gem className="w-[18px] h-[18px]" style={{ color: "#06120D" }} />
                    </span>
                    <p className="flex-1 text-lg font-extrabold tracking-tight text-white">{t("products.premiumName")}</p>
                    {isPremium && (
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-extrabold px-2.5 py-1 rounded-full border"
                            style={{ background: "rgba(0,212,126,0.18)", borderColor: "rgba(0,212,126,0.45)", color: "#00D47E" }}>
                        <CheckCircle2 className="w-3 h-3" />{t("products.yourPlan")}
                      </span>
                    )}
                  </div>
                  <p className="relative mt-5 flex items-baseline gap-1.5">
                    <span className="text-[40px] font-extrabold tracking-[-1.4px] leading-none text-white">{mxnPremium ? fmtMxn(pricing.monthly!) : "$14.99"}</span>
                    <span className="text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>{t("products.premiumPriceUnit")}</span>
                  </p>
                  <p className="relative text-xs mt-1.5" style={{ color: "rgba(255,255,255,0.55)" }}>{mxnPremium ? t("products.premiumPriceNoteMxn", { monthly: fmtMxn(pricing.monthly!), yearly: fmtMxn(pricing.yearly!) }) : t("products.premiumPriceNote")}</p>

                  {!isPremium ? (
                    <button
                      onClick={() => setShowPricing(true)}
                      className="relative mt-5 w-full py-3 rounded-[14px] text-sm font-extrabold transition-all hover:opacity-90 hover:-translate-y-0.5 inline-flex items-center justify-center gap-1.5"
                      style={{ background: "#00D47E", color: "#06120D", boxShadow: "0 10px 24px -10px rgba(0,212,126,0.7)" }}
                    >
                      {t("products.claimFirstMonth")}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <div className="relative mt-5 inline-flex items-center justify-center gap-1.5 text-[13px] font-bold py-3 rounded-[14px] border"
                         style={{ background: "rgba(0,212,126,0.12)", borderColor: "rgba(0,212,126,0.35)", color: "#00D47E" }}>
                      <ShieldCheck className="w-4 h-4" />{t("products.active")}
                    </div>
                  )}

                  <div className="relative h-px my-5" style={{ background: "rgba(255,255,255,0.1)" }} />
                  <div className="relative space-y-3">
                    {SUBSCRIPTION_FEATURES.premium.map((f, i) => (
                      <FeatureRow key={i} text={f.text} tint="#00D47E" textColor="rgba(255,255,255,0.88)" />
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* ── Duo Plan ────────────────────────────────────────────────── */}
            <section>
              <SectionTitle icon={Users} title={t("products.duoPlanTitle")} />
              <div className="rounded-[24px] border p-6 sm:p-7 relative overflow-hidden"
                   style={{ background: "linear-gradient(135deg, #1E2256 0%, #11142E 55%, #0A0C1C 100%)", borderColor: "rgba(129,140,248,0.45)", boxShadow: "0 22px 50px -26px rgba(129,140,248,0.6)" }}>
                <div aria-hidden className="pointer-events-none absolute -top-24 -right-20 w-72 h-72 rounded-full"
                     style={{ background: "radial-gradient(circle, rgba(129,140,248,0.22), transparent 70%)" }} />
                <div className="relative grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-[12px] flex items-center justify-center" style={{ background: "#818CF8" }}>
                        <Users className="w-[18px] h-[18px]" style={{ color: "#0B0E22" }} />
                      </span>
                      <p className="text-lg font-extrabold tracking-tight text-white">{DUO_PLAN.title}</p>
                      <span className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full border"
                            style={{ background: "rgba(129,140,248,0.18)", borderColor: "rgba(129,140,248,0.45)", color: "#A5B4FC" }}>{t("products.duoPlanNew")}</span>
                    </div>
                    <p className="mt-5 flex items-baseline gap-1.5">
                      <span className="text-[40px] font-extrabold tracking-[-1.4px] leading-none text-white">{DUO_PLAN.price}</span>
                      <span className="text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>{t("products.duoPlanPerMonth")}</span>
                    </p>
                    <p className="text-xs mt-1.5" style={{ color: "rgba(255,255,255,0.55)" }}>{DUO_PLAN.priceNote}</p>
                    <button
                      onClick={() => setShowPricing(true)}
                      className="mt-5 w-full py-3 rounded-[14px] text-sm font-extrabold transition-all hover:opacity-90 hover:-translate-y-0.5 inline-flex items-center justify-center gap-1.5"
                      style={{ background: "#818CF8", color: "#0B0E22", boxShadow: "0 10px 24px -10px rgba(129,140,248,0.7)" }}
                    >
                      {t("products.hireDuoPlan")} <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-3 md:pl-8 md:border-l" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
                    {DUO_PLAN_FEATURES.map((f, i) => (
                      <FeatureRow key={i} text={f} tint="#A5B4FC" textColor="rgba(255,255,255,0.88)" />
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* ── Productos individuales ───────────────────────────────────── */}
            <section>
              <SectionTitle icon={Zap} title={t("products.oneTimeProductsTitle")} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {ONE_TIME_PRODUCTS.map((p, i) => {
                  const Icon = p.icon;
                  const featured = p.variant === "bundle";
                  return (
                    <div key={i} className="relative rounded-[22px] border p-5 flex flex-col overflow-hidden transition-all hover:-translate-y-0.5 hover:border-[var(--accent)]"
                         style={{
                           background: featured ? "linear-gradient(160deg, rgba(0,185,109,0.14), var(--card) 60%), var(--card)" : "var(--card)",
                           borderColor: featured ? "rgba(0,185,109,0.4)" : "var(--border)",
                         }}>
                      <span className="w-12 h-12 rounded-[14px] border flex items-center justify-center" style={{ background: "rgba(0,185,109,0.10)", borderColor: "rgba(0,185,109,0.25)" }}>
                        <Icon className="w-[22px] h-[22px]" style={{ color: "var(--accent-l)" }} />
                      </span>
                      <p className="text-[17px] font-extrabold tracking-tight mt-4 leading-snug" style={{ color: "var(--text)" }}>{p.title}</p>

                      <div className="flex items-baseline gap-2 mt-3 flex-wrap">
                        {p.price_premium && (
                          <span className="text-[28px] font-extrabold tracking-[-0.8px] leading-none" style={{ color: "var(--accent-l)" }}>{p.price_premium}</span>
                        )}
                      </div>
                      {p.price_free && (
                        <span className="text-xs mt-1.5" style={{ color: "var(--muted)" }}>
                          {t("products.freeLabel")} <strong style={{ color: "var(--sub)" }}>{p.price_free}</strong>
                        </span>
                      )}
                      {p.note && (
                        <span className="self-start inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border mt-2.5"
                              style={{ background: "rgba(0,185,109,0.10)", borderColor: "rgba(0,185,109,0.3)", color: "var(--accent-l)" }}>
                          <Tag className="w-3 h-3" />{p.note}
                        </span>
                      )}

                      <div className="h-px my-4" style={{ background: "var(--border)" }} />
                      <div className="space-y-2.5 flex-1">
                        {p.features.map((f, fi) => (
                          <FeatureRow key={fi} text={f} tint="var(--accent-l)" textColor="var(--sub)" small />
                        ))}
                      </div>

                      <button
                        onClick={() => handleCheckout(p.offer, p.variant ?? "default")}
                        className="mt-5 w-full py-3 rounded-[14px] text-sm font-extrabold transition-all hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                        style={{ background: "var(--accent)", color: "#fff" }}
                      >
                        {t("products.viewDetails")} <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── Próximamente ─────────────────────────────────────────────── */}
            <section>
              <SectionTitle icon={Clock} title={t("products.comingSoonTitle")} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {COMING_SOON.map((p, i) => {
                  const Icon = p.icon;
                  return (
                    <div key={i} className="rounded-[20px] border border-dashed p-5 flex items-start gap-3.5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      <span className="w-11 h-11 rounded-[13px] border flex items-center justify-center shrink-0" style={{ background: "rgba(129,140,248,0.12)", borderColor: "rgba(129,140,248,0.3)" }}>
                        <Icon className="w-5 h-5" style={{ color: "#818CF8" }} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="text-[15px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{p.title}</h3>
                          <span className="text-[10.5px] font-extrabold px-2.5 py-0.5 rounded-full border" style={{ background: "rgba(129,140,248,0.12)", borderColor: "rgba(129,140,248,0.35)", color: "#818CF8" }}>{t("products.comingSoonBadge")}</span>
                        </div>
                        <p className="text-[13px]" style={{ color: "var(--sub)", lineHeight: 1.55 }}>{p.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

          </div>
        </main>
      </div>

      <PricingModal visible={showPricing} onClose={() => setShowPricing(false)} />

      {checkoutOffer && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
          {/* No maxHeight/scroll here used to mean a tall checkout form
              (card fields + billing address) was simply clipped by the
              viewport with no way to reach the rest of it — confirmed
              2026-09-15 from a real screenshot of this exact flow. Same
              fix as UpsellModal/PricingModal's checkout branches. */}
          <div
            className={`w-full rounded-2xl shadow-2xl overflow-y-auto ${checkoutSummary ? "max-w-2xl" : "max-w-md"}`}
            style={{ background: "var(--bg)", border: "1px solid var(--border)", maxHeight: "90vh", minHeight: 0, WebkitOverflowScrolling: "touch" }}
          >
            <div className="pt-5">
              <EmbeddedCheckout
                createIntent={() => checkoutOffer.offer === "broker_call"
                  ? billing.createEmbeddedBrokerCall(pricing.currency === "mxn" && pricing.broker_call != null ? "mxn" : "usd").then((r) => r.data)
                  : upsells.checkoutEmbedded(checkoutOffer.offer, checkoutOffer.variant, "products_page").then((r) => r.data)}
                adaptive={checkoutOffer.offer === "broker_call" ? undefined : {
                  createSession: () => upsells.checkoutAdaptive(checkoutOffer.offer, checkoutOffer.variant, "products_page").then((r) => r.data),
                }}
                returnUrl={`${window.location.origin}/upsell-success?offer=${checkoutOffer.offer}`}
                onBack={() => setCheckoutOffer(null)}
                onSuccess={handleCheckoutSuccess}
                summary={checkoutSummary}
                payCtaLabel={checkoutOffer.offer === "session" || checkoutOffer.offer === "broker_call" ? t("pricingModal.payCtaSession") : undefined}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
