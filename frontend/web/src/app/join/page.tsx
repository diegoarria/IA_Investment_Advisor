"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { ArrowRight, Users, Gift, Brain, Bell, Check, ChevronDown, RotateCcw, Sparkles, ShieldCheck } from "lucide-react";
import { setPendingReferralCode } from "@/lib/referral";
import StockAvatar from "@/components/StockAvatar";

// ─── small helpers ───────────────────────────────────────────────────────────

/** Fades/slides a block in the first time it scrolls into view. */
function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{
      opacity: shown ? 1 : 0, transform: shown ? "none" : "translateY(18px)",
      transition: `opacity .6s ease ${delay}ms, transform .6s ease ${delay}ms`,
    }}>{children}</div>
  );
}

const card: React.CSSProperties = {
  background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20,
};

// ─── demo 1: Arthur types his answer ────────────────────────────────────────

function ArthurDemo({ question, reply, replayLabel }: { question: string; reply: string; replayLabel: string }) {
  const [n, setN] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    setN(0);
    const id = setInterval(() => setN((v) => (v >= reply.length ? v : v + 2)), 22);
    return () => clearInterval(id);
  }, [reply, run]);
  const done = n >= reply.length;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[13px] font-semibold"
             style={{ background: "var(--grad-green)", color: "#03130b" }}>{question}</div>
      </div>
      <div className="flex gap-2.5 items-start">
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(167,139,250,0.16)" }}>
          <Brain className="w-4 h-4" style={{ color: "#a78bfa" }} />
        </div>
        <div className="rounded-2xl rounded-tl-md px-4 py-3 text-[13px] leading-relaxed whitespace-pre-line min-h-[120px]"
             style={{ background: "var(--card-2)", border: "1px solid var(--border)", color: "var(--text)" }}>
          {reply.slice(0, n)}{!done && <span className="jn-caret" />}
        </div>
      </div>
      {done && (
        <button onClick={() => setRun((r) => r + 1)} className="mx-auto flex items-center gap-1.5 text-[11px] font-bold" style={{ color: "var(--accent-l)" }}>
          <RotateCcw className="w-3 h-3" /> {replayLabel}
        </button>
      )}
    </div>
  );
}

// ─── demo 2: fair value, three scenarios ────────────────────────────────────

function FairValueDemo({ t }: { t: (k: string) => string }) {
  const PRICE = 100;
  const scenarios = [
    { key: "conservative", value: 84, color: "#f59e0b" },
    { key: "base", value: 108, color: "#00e887" },
    { key: "optimistic", value: 131, color: "#60a5fa" },
  ] as const;
  const [i, setI] = useState(1);
  const s = scenarios[i];
  const pos = (v: number) => `${Math.min(96, Math.max(4, ((v - 60) / (150 - 60)) * 100))}%`;
  const diff = Math.round(((s.value - PRICE) / PRICE) * 100);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {scenarios.map((sc, idx) => (
          <button key={sc.key} onClick={() => setI(idx)}
                  className="flex-1 py-2 rounded-xl text-[12px] font-black transition-all"
                  style={{
                    background: idx === i ? sc.color + "26" : "var(--card-2)",
                    border: `1px solid ${idx === i ? sc.color : "var(--border)"}`,
                    color: idx === i ? sc.color : "var(--sub)",
                  }}>
            {t(`join.demo.fair.${sc.key}`)}
          </button>
        ))}
      </div>
      <div className="relative h-16 mt-2">
        <div className="absolute left-0 right-0 top-8 h-2 rounded-full" style={{ background: "var(--border)" }} />
        <div className="absolute top-8 h-2 rounded-full transition-all duration-500"
             style={{ left: pos(Math.min(PRICE, s.value)), width: `calc(${pos(Math.max(PRICE, s.value))} - ${pos(Math.min(PRICE, s.value))})`, background: s.color, opacity: 0.55 }} />
        <div className="absolute top-3 -translate-x-1/2 text-center" style={{ left: pos(PRICE) }}>
          <div className="text-[10px] font-bold" style={{ color: "var(--sub)" }}>{t("join.demo.fair.price")}</div>
          <div className="w-3 h-3 rounded-full mx-auto mt-4 border-2" style={{ background: "var(--bg)", borderColor: "var(--text)" }} />
        </div>
        <div className="absolute -translate-x-1/2 transition-all duration-500" style={{ left: pos(s.value), top: 44 }}>
          <div className="w-3.5 h-3.5 rounded-full mx-auto -mb-0.5" style={{ background: s.color, boxShadow: `0 0 12px ${s.color}` }} />
          <div className="text-[10px] font-black whitespace-nowrap mt-2.5" style={{ color: s.color }}>{t("join.demo.fair.fairValue")}</div>
        </div>
      </div>
      <div className="rounded-xl px-4 py-3 text-center" style={{ background: s.color + "14", border: `1px solid ${s.color}44` }}>
        <span className="text-2xl font-black transition-colors" style={{ color: s.color }}>{diff >= 0 ? "+" : ""}{diff}%</span>
        <span className="text-[12px] ml-2" style={{ color: "var(--sub)" }}>{t("join.demo.fair.vsPrice")}</span>
      </div>
      <p className="text-[11px] text-center leading-relaxed" style={{ color: "var(--muted)" }}>{t("join.demo.fair.note")}</p>
    </div>
  );
}

// ─── demo 3: watchlist alerts ────────────────────────────────────────────────

function WatchlistDemo({ t }: { t: (k: string, o?: Record<string, unknown>) => string }) {
  const rows = [
    { ticker: "AAPL", name: t("join.demo.watch.a"), pct: 2.4, spark: "M0 22 L14 18 L28 20 L42 12 L56 14 L70 6 L84 8" },
    { ticker: "TSLA", name: t("join.demo.watch.b"), pct: -1.1, spark: "M0 8 L14 10 L28 6 L42 14 L56 12 L70 18 L84 20" },
    { ticker: "KO", name: t("join.demo.watch.c"), pct: 0.6, spark: "M0 16 L14 18 L28 12 L42 14 L56 10 L70 12 L84 9" },
  ];
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((v) => v + 1), 3200); return () => clearInterval(id); }, []);
  const hot = tick % rows.length;
  return (
    <div className="space-y-2.5">
      {rows.map((r, idx) => {
        const up = r.pct >= 0; const col = up ? "#00e887" : "#f43f5e";
        return (
          <div key={r.name} className="flex items-center gap-3 rounded-xl px-3.5 py-3 transition-all duration-500"
               style={{ background: "var(--card-2)", border: `1px solid ${idx === hot ? col + "88" : "var(--border)"}`, transform: idx === hot ? "scale(1.015)" : "none" }}>
            <StockAvatar ticker={r.ticker} size="md" />
            <div className="flex-1 text-[13px] font-bold" style={{ color: "var(--text)" }}>{r.name}</div>
            <svg width="84" height="28" viewBox="0 0 84 28" className="shrink-0"><path d={r.spark} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <div className="w-14 text-right text-[13px] font-black" style={{ color: col }}>{up ? "+" : ""}{r.pct}%</div>
          </div>
        );
      })}
      <p className="text-[11px] text-center" style={{ color: "var(--muted)" }}>{t("join.demo.watch.note")}</p>
      <div key={hot} className="jn-toast flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 mt-1"
           style={{ background: "rgba(0,232,135,0.08)", border: "1px solid rgba(0,232,135,0.3)" }}>
        <Bell className="w-4 h-4 shrink-0" style={{ color: "var(--accent-l)" }} />
        <span className="text-[12px] font-semibold" style={{ color: "var(--text)" }}>
          {t("join.demo.watch.alert", { name: rows[hot].name, pct: Math.abs(rows[hot].pct), dir: rows[hot].pct >= 0 ? t("join.demo.watch.up") : t("join.demo.watch.down") })}
        </span>
      </div>
    </div>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

function JoinContent() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useSearchParams();
  const ref = params.get("ref") ?? "";
  const [saved, setSaved] = useState(false);
  const tabParam = params.get("tab");
  const [tab, setTab] = useState<"arthur" | "fair" | "watch">(tabParam === "fair" || tabParam === "watch" ? tabParam : "arthur");
  const [worry, setWorry] = useState<string | null>(null);
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const [stickyOn, setStickyOn] = useState(false);

  useEffect(() => {
    if (ref) { setPendingReferralCode(ref); setSaved(true); }
  }, [ref]);

  // The referral code was just saved above (localStorage "nuvos_ref"), applied on
  // register in page.tsx's handleSubmit, on Google OAuth in auth/callback/page.tsx,
  // and as a safety net by ReferralApplyProvider — landing this on bare "/" would
  // bounce into guest mode and silently drop the referral.
  const handleJoin = () => router.push("/?auth=1");

  const tabs = [
    { id: "arthur" as const, label: t("join.demo.tabs.arthur"), icon: Brain },
    { id: "fair" as const, label: t("join.demo.tabs.fair"), icon: Sparkles },
    { id: "watch" as const, label: t("join.demo.tabs.watch"), icon: Bell },
  ];
  const worries = ["start", "risk", "choose", "time", "fees"] as const;
  const perks = t("join.gift.items", { returnObjects: true }) as string[];
  const steps = t("join.steps.items", { returnObjects: true }) as { title: string; desc: string }[];
  const faqs = t("join.faq.items", { returnObjects: true }) as { q: string; a: string }[];

  const cta = (extra = "") => (
    <button onClick={handleJoin}
            className={`jn-cta w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-black text-[15px] ${extra}`}
            style={{ background: "var(--grad-green)", color: "#03130b", boxShadow: "var(--shadow-accent)" }}>
      {t("join.createAccount")} <ArrowRight className="w-4 h-4" />
    </button>
  );

  return (
    // globals.css sets `html, body { overflow: hidden }` (the app shell scrolls inside
    // its own panes), so this page must be its own scroll container or nothing below
    // the first screen could ever be reached.
    <div className="fixed inset-0 overflow-y-auto overflow-x-hidden"
         onScroll={(e) => setStickyOn(e.currentTarget.scrollTop > 520)}
         style={{ background: "var(--bg)", color: "var(--text)", WebkitOverflowScrolling: "touch", overscrollBehaviorY: "contain" }}>
      <style>{`
        @keyframes jnFloat { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
        @keyframes jnOrb { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(30px,-20px) scale(1.12) } }
        @keyframes jnShine { 0% { transform: translateX(-120%) } 60%,100% { transform: translateX(220%) } }
        @keyframes jnBlink { 50% { opacity: 0 } }
        @keyframes jnPop { from { opacity: 0; transform: translateY(8px) scale(.97) } to { opacity: 1; transform: none } }
        .jn-caret { display:inline-block; width:2px; height:14px; margin-left:2px; vertical-align:-2px; background: var(--accent-l); animation: jnBlink .8s steps(1) infinite }
        .jn-toast { animation: jnPop .45s ease both }
        .jn-cta { position: relative; overflow: hidden; transition: transform .15s ease }
        .jn-cta:hover { transform: translateY(-2px) }
        .jn-cta:active { transform: scale(.98) }
        .jn-cta::after { content:""; position:absolute; inset:0; width:40%; background: linear-gradient(100deg, transparent, rgba(255,255,255,.45), transparent); animation: jnShine 3.2s ease-in-out infinite }
        .jn-answer { animation: jnPop .35s ease both }
        @media (prefers-reduced-motion: reduce) { .jn-cta::after, .jn-toast, .jn-answer { animation: none } }
      `}</style>

      {/* ambient background */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[640px] overflow-hidden">
        <div className="absolute -top-24 left-1/2 w-[520px] h-[520px] -translate-x-1/2 rounded-full blur-3xl opacity-40"
             style={{ background: "radial-gradient(circle, rgba(0,232,135,0.55), transparent 65%)", animation: "jnOrb 12s ease-in-out infinite" }} />
        <div className="absolute top-40 -right-24 w-[320px] h-[320px] rounded-full blur-3xl opacity-25"
             style={{ background: "radial-gradient(circle, rgba(96,165,250,0.6), transparent 65%)", animation: "jnOrb 16s ease-in-out infinite reverse" }} />
      </div>

      <div className="relative w-full max-w-xl mx-auto px-5 pt-10 pb-36 space-y-14">

        {/* HERO */}
        <header className="text-center space-y-5">
          <div className="flex justify-center" style={{ animation: "jnFloat 5s ease-in-out infinite" }}>
            <div className="relative">
              <Image src="/logo.png" alt="Nuvos AI" width={68} height={68} className="rounded-2xl object-cover" priority />
              <div className="absolute -inset-1.5 rounded-2xl blur-xl opacity-50" style={{ background: "var(--grad-green)" }} />
            </div>
          </div>

          {saved && (
            <div className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5"
                 style={{ background: "rgba(0,185,109,0.08)", borderColor: "rgba(0,185,109,0.3)" }}>
              <Users className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
              <span className="text-[11px] font-bold" style={{ color: "var(--accent-l)" }}>{t("join.inviteApplied")}</span>
              <span className="text-[11px]" style={{ color: "var(--sub)" }}>· {t("join.codeLabel")} <b className="font-mono">{ref.toUpperCase()}</b></span>
            </div>
          )}

          <h1 className="text-[30px] leading-[1.1] sm:text-4xl font-black tracking-tight">{t("join.hero.title")}</h1>
          <p className="text-[15px] leading-relaxed max-w-md mx-auto" style={{ color: "var(--sub)" }}>{t("join.hero.sub")}</p>

          <div className="inline-flex items-center gap-2.5 rounded-2xl px-5 py-3"
               style={{ background: "linear-gradient(135deg, rgba(0,185,109,0.18), rgba(0,232,135,0.06))", border: "1px solid rgba(0,232,135,0.4)", boxShadow: "var(--shadow-accent)" }}>
            <Gift className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
            <span className="text-[15px] font-black" style={{ color: "var(--accent-l)" }}>{t("join.hero.gift")}</span>
          </div>

          <div className="max-w-sm mx-auto space-y-2.5 pt-1">
            {cta()}
            <p className="text-[11.5px]" style={{ color: "var(--muted)" }}>{t("join.hero.note")}</p>
          </div>
        </header>

        {/* INTERACTIVE DEMO */}
        <Reveal>
          <section className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-black">{t("join.demo.title")}</h2>
              <p className="text-[13px] mt-1" style={{ color: "var(--sub)" }}>{t("join.demo.sub")}</p>
            </div>
            <div className="p-4 sm:p-5" style={card}>
              <div className="flex gap-1.5 p-1 rounded-2xl mb-4" style={{ background: "var(--raised)" }}>
                {tabs.map((tb) => (
                  <button key={tb.id} onClick={() => setTab(tb.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-black transition-all"
                          style={{ background: tab === tb.id ? "var(--card-2)" : "transparent", color: tab === tb.id ? "var(--accent-l)" : "var(--muted)",
                                   boxShadow: tab === tb.id ? "var(--shadow-sm)" : "none" }}>
                    <tb.icon className="w-3.5 h-3.5" /> {tb.label}
                  </button>
                ))}
              </div>
              {tab === "arthur" && <ArthurDemo question={t("join.demo.arthur.question")} reply={t("join.demo.arthur.reply")} replayLabel={t("join.demo.arthur.replay")} />}
              {tab === "fair" && <FairValueDemo t={t} />}
              {tab === "watch" && <WatchlistDemo t={t} />}
            </div>
          </section>
        </Reveal>

        {/* WHAT HOLDS YOU BACK */}
        <Reveal>
          <section className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-black">{t("join.worry.title")}</h2>
              <p className="text-[13px] mt-1" style={{ color: "var(--sub)" }}>{t("join.worry.sub")}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {worries.map((w) => (
                <button key={w} onClick={() => setWorry(worry === w ? null : w)}
                        className="px-4 py-2.5 rounded-full text-[12.5px] font-bold transition-all hover:-translate-y-0.5"
                        style={{
                          background: worry === w ? "var(--grad-green)" : "var(--card)",
                          color: worry === w ? "#03130b" : "var(--text)",
                          border: `1px solid ${worry === w ? "transparent" : "var(--border-s)"}`,
                        }}>
                  {t(`join.worry.chips.${w}`)}
                </button>
              ))}
            </div>
            {worry && (
              <div key={worry} className="jn-answer p-4 flex gap-3 items-start" style={{ ...card, borderColor: "rgba(0,232,135,0.35)" }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(0,232,135,0.12)" }}>
                  <Check className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
                </div>
                <p className="text-[13.5px] leading-relaxed">{t(`join.worry.answers.${worry}`)}</p>
              </div>
            )}
          </section>
        </Reveal>

        {/* STEPS */}
        <Reveal>
          <section className="space-y-5">
            <h2 className="text-xl font-black text-center">{t("join.steps.title")}</h2>
            <div className="space-y-3">
              {steps.map((s, idx) => (
                <div key={s.title} className="flex items-center gap-4 p-4" style={card}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[15px] font-black shrink-0"
                       style={{ background: "var(--grad-green)", color: "#03130b" }}>{idx + 1}</div>
                  <div>
                    <p className="text-[14px] font-black">{s.title}</p>
                    <p className="text-[12.5px] mt-0.5" style={{ color: "var(--sub)" }}>{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </Reveal>

        {/* WELCOME GIFT */}
        <Reveal>
          <section className="p-6 text-center space-y-4 rounded-3xl"
                   style={{ background: "linear-gradient(160deg, rgba(0,185,109,0.16), rgba(0,232,135,0.04))", border: "1px solid rgba(0,232,135,0.35)" }}>
            <div className="text-4xl" style={{ animation: "jnFloat 4s ease-in-out infinite" }}>🎁</div>
            <h2 className="text-xl font-black">{t("join.gift.title")}</h2>
            <p className="text-[13.5px]" style={{ color: "var(--sub)" }}>{t("join.gift.body")}</p>
            <ul className="text-left space-y-2 max-w-xs mx-auto">
              {perks.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-[13.5px] font-semibold">
                  <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--accent-l)" }} /> {p}
                </li>
              ))}
            </ul>
            <div className="max-w-xs mx-auto pt-1">{cta()}</div>
          </section>
        </Reveal>

        {/* FAQ */}
        <Reveal>
          <section className="space-y-3">
            <h2 className="text-xl font-black text-center">{t("join.faq.title")}</h2>
            {faqs.map((f, idx) => (
              <div key={f.q} style={card} className="overflow-hidden">
                <button onClick={() => setFaqOpen(faqOpen === idx ? null : idx)} className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left">
                  <span className="text-[13.5px] font-bold">{f.q}</span>
                  <ChevronDown className="w-4 h-4 shrink-0 transition-transform" style={{ color: "var(--accent-l)", transform: faqOpen === idx ? "rotate(180deg)" : "none" }} />
                </button>
                <div style={{ maxHeight: faqOpen === idx ? 160 : 0, transition: "max-height .35s ease", overflow: "hidden" }}>
                  <p className="px-4 pb-4 text-[13px] leading-relaxed" style={{ color: "var(--sub)" }}>{f.a}</p>
                </div>
              </div>
            ))}
          </section>
        </Reveal>

        {/* FINAL */}
        <Reveal>
          <section className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 text-[12px] font-bold" style={{ color: "var(--sub)" }}>
              <ShieldCheck className="w-4 h-4" style={{ color: "var(--accent-l)" }} /> {t("join.final.trust")}
            </div>
            <h2 className="text-2xl font-black">{t("join.final.title")}</h2>
            <div className="max-w-sm mx-auto">{cta()}</div>
            <p className="text-[10.5px] leading-relaxed pt-2" style={{ color: "var(--muted)" }}>{t("join.final.disclaimer")}</p>
            <p className="text-[10.5px]" style={{ color: "var(--muted)" }}>
              {t("join.termsPrefix")}{" "}
              <a href="/terms" target="_blank" className="underline" style={{ color: "var(--sub)" }}>{t("join.termsOfUse")}</a>{" "}
              {t("join.and")}{" "}
              <a href="/privacy" target="_blank" className="underline" style={{ color: "var(--sub)" }}>{t("join.privacyPolicy")}</a>.
            </p>
          </section>
        </Reveal>
      </div>

      {/* sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 pt-8 pointer-events-none transition-all duration-300"
           style={{ opacity: stickyOn ? 1 : 0, transform: stickyOn ? "none" : "translateY(24px)", background: "linear-gradient(to top, var(--bg) 40%, transparent)" }}>
        <div className="max-w-sm mx-auto pointer-events-auto">{stickyOn && cta()}</div>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinContent />
    </Suspense>
  );
}
