"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { learn as learnApi } from "@/lib/api";
import {
  useAuthStore, useNotificationStore, useThemeStore, useSubscriptionStore,
  useLearnStore, getMilestoneForStreak, getNextMilestone,
  STREAK_MILESTONES, STREAK_MILESTONES_PREMIUM,
} from "@/lib/store";
import PaywallModal from "@/components/PaywallModal";
import {
  TrendingUp, BookOpen, PieChart, BarChart2, Bell, User, Menu, X,
  GraduationCap, Trophy, Sun, Moon, Clock, MessageSquare, Send,
  Loader2, Lock, Flame, Compass,
} from "lucide-react";

const NAV = [
  { href: "/chat",          icon: BookOpen,      label: "Chat" },
  { href: "/portfolio",     icon: PieChart,      label: "Portafolio" },
  { href: "/paper",         icon: BarChart2,     label: "Paper Trading" },
  { href: "/learn",         icon: GraduationCap, label: "Aprendizaje" },
  { href: "/arena",         icon: Trophy,        label: "Arena" },
  { href: "/explore",       icon: Compass,     label: "Explorar" },
  { href: "/notifications", icon: Bell,          label: "Notificaciones" },
  { href: "/profile",       icon: User,          label: "Perfil" },
];

type Difficulty = "principiante" | "intermedio" | "dificil" | "imposible";

const DIFF_CONFIG: Record<Difficulty, { label: string; color: string; desc: string }> = {
  principiante: { label: "Principiante",  color: "#22c55e", desc: "Conceptos claros, contexto amigable" },
  intermedio:   { label: "Intermedio",    color: "#3b82f6", desc: "Escenarios reales de mercado" },
  dificil:      { label: "Difícil",       color: "#f59e0b", desc: "Análisis avanzado, sin pistas" },
  imposible:    { label: "Imposible",     color: "#ef4444", desc: "Nivel institucional. Prepárate." },
};

const PREMIUM_DIFFICULTIES = new Set(["dificil", "imposible"]);
const FREE_SIM_LIMIT   = 5;
const FREE_DEBATE_LIMIT = 2;
const FREE_MAX_ROUNDS   = 5;

interface Scenario {
  id: string; title: string; date: string;
  context: string; question: string; options: Record<string, string>;
  difficulty: string;
}

interface ScenarioResult {
  outcome: string; user_choice: string; optimal: string;
  lesson: string; return_pct: number; is_optimal: boolean;
  all_returns: Record<string, number>; xp_earned: number;
}

export default function ArenaPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useAuthStore();
  const { notifications } = useNotificationStore();
  const { theme, toggleTheme } = useThemeStore();
  const subStore = useSubscriptionStore();
  const { streak, completedToday, markTopicCompleted, initStreak } = useLearnStore();
  const isPremium = subStore.tier === "premium";
  const unreadCount = notifications.filter((n) => !n.read).length;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("intermedio");
  const [hallOfFame, setHallOfFame] = useState<{ name: string; streak: number }[]>([]);
  const [simUsedToday, setSimUsedToday] = useState(0);
  const [debateUsedToday, setDebateUsedToday] = useState(0);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallReason, setPaywallReason] = useState("");
  const [milestonesOpen, setMilestonesOpen] = useState(false);

  // Simulator
  const [simOpen, setSimOpen] = useState(false);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simChoice, setSimChoice] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<ScenarioResult | null>(null);

  // Debate
  const [debateOpen, setDebateOpen] = useState(false);
  const [debateThesis, setDebateThesis] = useState("");
  const [debateMessages, setDebateMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [debateLoading, setDebateLoading] = useState(false);
  const [debateRound, setDebateRound] = useState(1);
  const [debateInput, setDebateInput] = useState("");
  const debateScrollRef = useRef<HTMLDivElement>(null);

  const openPaywall = (reason: string) => { setPaywallReason(reason); setPaywallOpen(true); };
  const activeMilestones = isPremium ? STREAK_MILESTONES_PREMIUM : STREAK_MILESTONES;
  const currentMilestone = getMilestoneForStreak(streak, isPremium);
  const nextMilestone = getNextMilestone(streak, isPremium);
  const diffCfg = DIFF_CONFIG[difficulty];
  const returnColor = (pct: number) => pct > 0 ? "#22c55e" : pct < 0 ? "#ef4444" : "var(--muted)";

  useEffect(() => {
    if (!isAuthenticated) { router.push("/"); return; }
    initStreak();
    learnApi.getHallOfFame().then((r) => setHallOfFame(r.data.leaderboard ?? [])).catch(() => {});
  }, [isAuthenticated]);

  // Simulator
  const openSimulator = async () => {
    if (!isPremium && PREMIUM_DIFFICULTIES.has(difficulty))
      return openPaywall("Los niveles Difícil e Imposible son exclusivos de Premium.");
    if (!isPremium && simUsedToday >= FREE_SIM_LIMIT)
      return openPaywall(`Alcanzaste el límite de ${FREE_SIM_LIMIT} simulaciones diarias.`);
    setSimOpen(true); setSimLoading(true);
    setScenario(null); setSimChoice(null); setSimResult(null);
    try { const r = await learnApi.getScenario(difficulty); setScenario(r.data); } catch {}
    setSimLoading(false);
  };

  const submitSimChoice = async (choice: string) => {
    if (!scenario || simResult) return;
    setSimChoice(choice); setSimLoading(true);
    try {
      const r = await learnApi.submitScenarioResult(scenario.id, choice, difficulty);
      setSimResult(r.data);
      markTopicCompleted();
      if (!isPremium) setSimUsedToday((v) => v + 1);
    } catch {}
    setSimLoading(false);
  };

  // Debate
  const openDebate = () => {
    if (!isPremium && PREMIUM_DIFFICULTIES.has(difficulty))
      return openPaywall("Los niveles Difícil e Imposible son exclusivos de Premium.");
    if (!isPremium && debateUsedToday >= FREE_DEBATE_LIMIT)
      return openPaywall(`Alcanzaste el límite de ${FREE_DEBATE_LIMIT} debates diarios.`);
    setDebateOpen(true); setDebateThesis(""); setDebateMessages([]);
    setDebateRound(1); setDebateInput("");
  };

  const submitDebateThesis = async () => {
    if (!debateThesis.trim()) return;
    setDebateLoading(true);
    setDebateMessages([{ role: "user", text: debateThesis }]);
    try {
      const r = await learnApi.startDebate(debateThesis, difficulty);
      setDebateMessages([{ role: "user", text: debateThesis }, { role: "ai", text: r.data.response }]);
      setDebateRound(2);
      markTopicCompleted();
      if (!isPremium) setDebateUsedToday((v) => v + 1);
    } catch {}
    setDebateLoading(false);
    setTimeout(() => debateScrollRef.current?.scrollTo({ top: 9999, behavior: "smooth" }), 300);
  };

  const sendDebateReply = async () => {
    if (!debateInput.trim() || debateLoading) return;
    if (!isPremium && debateRound > FREE_MAX_ROUNDS)
      return openPaywall(`Los usuarios free tienen hasta ${FREE_MAX_ROUNDS} rondas por debate.`);
    const reply = debateInput.trim();
    setDebateInput("");
    const lastAI = [...debateMessages].reverse().find((m) => m.role === "ai")?.text ?? "";
    const updated = [...debateMessages, { role: "user" as const, text: reply }];
    setDebateMessages(updated);
    setDebateLoading(true);
    try {
      const r = await learnApi.replyDebate(debateThesis, lastAI, reply, debateRound, difficulty);
      setDebateMessages([...updated, { role: "ai", text: r.data.response }]);
      setDebateRound((v) => v + 1);
    } catch {}
    setDebateLoading(false);
    setTimeout(() => debateScrollRef.current?.scrollTo({ top: 9999, behavior: "smooth" }), 300);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="border-b flex items-center justify-between px-4 py-2 shrink-0"
           style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1 rounded-lg" style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
              <TrendingUp className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </div>
        </div>
        <span className="font-semibold text-sm" style={{ color: "var(--sub)" }}>Arena</span>
        <div className="flex items-center gap-1">
          <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-white/5" style={{ color: "var(--muted)" }}>
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? "flex" : "hidden"} lg:flex w-60 border-r flex-col py-4 absolute lg:relative z-20 h-full`}
               style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <nav className="flex-1 px-2 space-y-0.5">
            {NAV.map(({ href, icon: Icon, label }) => {
              const active = pathname === href;
              const badge = href === "/notifications" && unreadCount > 0;
              return (
                <button key={href} onClick={() => { router.push(href); setSidebarOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
                        style={{ background: active ? "rgba(0,168,94,0.12)" : "transparent", color: active ? "var(--accent-l)" : "var(--muted)" }}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                  {badge && <span className="ml-auto w-4 h-4 rounded-full text-white text-[10px] flex items-center justify-center font-bold" style={{ background: "var(--accent)" }}>{unreadCount}</span>}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto scrollbar-thin p-4">
          <div className="max-w-2xl mx-auto space-y-4 pb-8">

            {/* Streak card */}
            <button onClick={() => setMilestonesOpen(true)} className="w-full text-left rounded-2xl border p-4 hover:opacity-90 transition-opacity"
                    style={{ background: "var(--card)", borderColor: completedToday ? "rgba(245,158,11,0.4)" : "var(--border)" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{completedToday ? "🔥" : "🌑"}</span>
                  <div>
                    <div className="text-xl font-black" style={{ color: completedToday ? "#f59e0b" : "var(--muted)" }}>
                      {streak} {streak === 1 ? "día" : "días"}
                    </div>
                    <div className="text-xs" style={{ color: "var(--dim)" }}>
                      {completedToday ? "Racha activa" : "Aprende algo hoy"}
                    </div>
                  </div>
                </div>
                {currentMilestone && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full border"
                        style={{ background: "rgba(245,158,11,0.15)", borderColor: "rgba(245,158,11,0.4)", color: "#f59e0b" }}>
                    {currentMilestone.reward.split(" ").slice(-1)[0]}
                  </span>
                )}
              </div>
              {nextMilestone && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span style={{ color: "var(--muted)" }}>Próximo: {nextMilestone.reward}</span>
                    <span style={{ color: "var(--dim)" }}>{streak}/{nextMilestone.days}</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.min((streak / nextMilestone.days) * 100, 100)}%`, background: "#f59e0b" }} />
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                {activeMilestones.map((m) => (
                  <span key={m.days} className="text-[10px] font-bold px-2 py-1 rounded-full"
                        style={{ background: streak >= m.days ? "rgba(245,158,11,0.15)" : "var(--border)", color: streak >= m.days ? "#f59e0b" : "var(--dim)" }}>
                    {streak >= m.days ? "✓ " : ""}{m.days}d
                  </span>
                ))}
              </div>
            </button>

            {/* Difficulty selector */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Nivel de dificultad</p>
              <div className="grid grid-cols-4 gap-2">
                {(Object.keys(DIFF_CONFIG) as Difficulty[]).map((d) => {
                  const cfg = DIFF_CONFIG[d];
                  const active = difficulty === d;
                  const locked = !isPremium && PREMIUM_DIFFICULTIES.has(d);
                  return (
                    <button key={d}
                            onClick={() => locked ? openPaywall("Los niveles Difícil e Imposible son exclusivos de Premium.") : setDifficulty(d)}
                            className="flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 transition-colors"
                            style={{
                              borderColor: active ? cfg.color : "var(--border)",
                              background: active ? cfg.color + "15" : "var(--card)",
                              opacity: locked ? 0.55 : 1,
                            }}>
                      {locked ? <Lock className="w-4 h-4" style={{ color: "var(--dim)" }} />
                               : <Flame className="w-4 h-4" style={{ color: active ? cfg.color : "var(--muted)" }} />}
                      <span className="text-[10px] font-bold" style={{ color: active ? cfg.color : locked ? "var(--dim)" : "var(--muted)" }}>
                        {cfg.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs mt-1.5 ml-0.5" style={{ color: "var(--dim)" }}>{diffCfg.desc}</p>
            </div>

            {/* Game cards */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>Juegos</p>
              <div className="grid grid-cols-2 gap-3">
                {/* Simulator */}
                <button onClick={openSimulator} className="rounded-2xl border-2 p-4 text-center hover:opacity-90 transition-opacity"
                        style={{ background: "var(--card)", borderColor: "rgba(139,92,246,0.4)" }}>
                  <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                       style={{ background: "rgba(139,92,246,0.15)" }}>
                    <Clock className="w-6 h-6" style={{ color: "#8b5cf6" }} />
                  </div>
                  <div className="font-bold text-sm mb-1" style={{ color: "var(--text)" }}>Simulador</div>
                  <div className="text-xs leading-snug mb-2" style={{ color: "var(--muted)" }}>
                    Toma decisiones en escenarios históricos reales
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: diffCfg.color + "18", color: diffCfg.color }}>
                    {diffCfg.label}
                  </span>
                  {!isPremium && (
                    <div className="text-[10px] mt-2 font-semibold"
                         style={{ color: simUsedToday >= FREE_SIM_LIMIT ? "#ef4444" : "var(--dim)" }}>
                      {simUsedToday >= FREE_SIM_LIMIT ? "Límite diario alcanzado" : `${FREE_SIM_LIMIT - simUsedToday}/${FREE_SIM_LIMIT} restantes`}
                    </div>
                  )}
                </button>

                {/* Debate */}
                <button onClick={openDebate} className="rounded-2xl border-2 p-4 text-center hover:opacity-90 transition-opacity"
                        style={{ background: "var(--card)", borderColor: "rgba(14,165,233,0.4)" }}>
                  <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                       style={{ background: "rgba(14,165,233,0.15)" }}>
                    <MessageSquare className="w-6 h-6" style={{ color: "#0ea5e9" }} />
                  </div>
                  <div className="font-bold text-sm mb-1" style={{ color: "var(--text)" }}>Debate</div>
                  <div className="text-xs leading-snug mb-2" style={{ color: "var(--muted)" }}>
                    Presenta una tesis y defiéndela contra la IA
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: diffCfg.color + "18", color: diffCfg.color }}>
                    {diffCfg.label}
                  </span>
                  {!isPremium && (
                    <div className="text-[10px] mt-2 font-semibold"
                         style={{ color: debateUsedToday >= FREE_DEBATE_LIMIT ? "#ef4444" : "var(--dim)" }}>
                      {debateUsedToday >= FREE_DEBATE_LIMIT ? "Límite diario alcanzado" : `${FREE_DEBATE_LIMIT - debateUsedToday}/${FREE_DEBATE_LIMIT} restantes`}
                    </div>
                  )}
                </button>
              </div>
            </div>

            {/* Hall of Fame */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>🏆 Hall of Fame</p>
              <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                {hallOfFame.length === 0 ? (
                  <div className="flex flex-col items-center py-8 gap-2">
                    <span className="text-3xl">🏆</span>
                    <p className="text-sm text-center" style={{ color: "var(--muted)" }}>
                      Sé el primero en aparecer aquí.{"\n"}Mantén una racha de 10+ días.
                    </p>
                  </div>
                ) : (
                  hallOfFame.map((entry, i) => (
                    <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t" : ""}`}
                         style={{ borderColor: "var(--border)" }}>
                      <span className="text-lg w-8">
                        {i < 3 ? ["🥇","🥈","🥉"][i] : <span className="text-sm font-bold" style={{ color: "var(--dim)" }}>{i + 1}.</span>}
                      </span>
                      <span className="flex-1 font-semibold text-sm" style={{ color: "var(--text)" }}>{entry.name}</span>
                      <div className="flex items-center gap-1">
                        <span>🔥</span>
                        <span className="font-bold" style={{ color: "#f59e0b" }}>{entry.streak}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Simulator Modal */}
      {simOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
             style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-3xl md:rounded-3xl border"
               style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setSimOpen(false)} style={{ color: "var(--muted)" }}><X className="w-5 h-5" /></button>
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>
                ⏳ Simulador · <span style={{ color: diffCfg.color }}>{diffCfg.label}</span>
              </span>
              <div className="w-5" />
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
              {simLoading && !scenario ? (
                <div className="flex flex-col items-center py-12 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#8b5cf6" }} />
                  <p style={{ color: "var(--muted)" }}>Cargando escenario...</p>
                </div>
              ) : scenario ? (
                <>
                  <div className="rounded-2xl border p-4" style={{ background: "rgba(139,92,246,0.06)", borderColor: "rgba(139,92,246,0.3)" }}>
                    <p className="text-[10px] font-bold tracking-wider mb-2" style={{ color: "#8b5cf6" }}>{scenario.date.toUpperCase()}</p>
                    <p className="text-base font-black mb-2" style={{ color: "var(--text)" }}>{scenario.title}</p>
                    <p className="text-sm leading-relaxed" style={{ color: "var(--sub)" }}>{scenario.context}</p>
                  </div>
                  <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{scenario.question}</p>

                  {!simResult ? (
                    <div className="space-y-2">
                      {Object.entries(scenario.options).map(([key, label]) => {
                        const active = simChoice === key;
                        return (
                          <button key={key} disabled={!!simChoice}
                                  onClick={() => submitSimChoice(key)}
                                  className="w-full flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-colors"
                                  style={{ borderColor: active ? "#8b5cf6" : "var(--border)", background: active ? "rgba(139,92,246,0.1)" : "var(--card)", opacity: simChoice && !active ? 0.4 : 1 }}>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center font-black text-sm"
                                 style={{ background: active ? "#8b5cf6" : "var(--border)", color: active ? "white" : "var(--sub)" }}>
                              {key}
                            </div>
                            <span className="flex-1 text-sm" style={{ color: "var(--text)" }}>{label}</span>
                          </button>
                        );
                      })}
                      {simLoading && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "#8b5cf6" }} /></div>}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-2xl border p-4"
                           style={{ background: simResult.is_optimal ? "rgba(34,197,94,0.08)" : "rgba(245,158,11,0.08)", borderColor: simResult.is_optimal ? "rgba(34,197,94,0.4)" : "rgba(245,158,11,0.4)" }}>
                        <p className="font-bold mb-2" style={{ color: simResult.is_optimal ? "#22c55e" : "#f59e0b" }}>
                          {simResult.is_optimal ? "✅ ¡Decisión óptima!" : "📊 Lo que pasó realmente"}
                        </p>
                        <p className="text-sm leading-relaxed" style={{ color: "var(--sub)" }}>{simResult.outcome}</p>
                      </div>
                      <div className="rounded-2xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
                          Tu elección ({simResult.user_choice}) · {difficulty.toUpperCase()}
                        </p>
                        <p className="text-3xl font-black" style={{ color: returnColor(simResult.return_pct) }}>
                          {simResult.return_pct > 0 ? "+" : ""}{simResult.return_pct}%
                        </p>
                        <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--sub)" }}>{simResult.lesson}</p>
                        <span className="inline-block mt-2 text-xs font-bold px-2.5 py-1 rounded-full border"
                              style={{ background: "rgba(245,158,11,0.1)", borderColor: "rgba(245,158,11,0.4)", color: "#f59e0b" }}>
                          +{simResult.xp_earned} XP
                        </span>
                      </div>
                      <div className="flex gap-2">
                        {Object.entries(simResult.all_returns).map(([k, v]) => (
                          <div key={k} className="flex-1 rounded-xl border p-2 text-center"
                               style={{ background: "var(--card)", borderColor: k === simResult.optimal ? "rgba(34,197,94,0.4)" : "var(--border)" }}>
                            <p className="text-xs font-bold" style={{ color: k === simResult.optimal ? "#22c55e" : "var(--muted)" }}>{k}</p>
                            <p className="text-sm font-black" style={{ color: returnColor(v as number) }}>
                              {(v as number) > 0 ? "+" : ""}{v}%
                            </p>
                          </div>
                        ))}
                      </div>
                      <button onClick={openSimulator} className="w-full py-3 rounded-xl font-bold text-white"
                              style={{ background: "#8b5cf6" }}>
                        Otro escenario
                      </button>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Milestones Modal */}
      {milestonesOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
             style={{ background: "rgba(0,0,0,0.7)" }}
             onClick={() => setMilestonesOpen(false)}>
          <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-t-3xl md:rounded-3xl border"
               style={{ background: "var(--bg)", borderColor: "var(--border)" }}
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setMilestonesOpen(false)} style={{ color: "var(--muted)" }}><X className="w-5 h-5" /></button>
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>🔥 Recompensas por Racha</span>
              <div className="w-5" />
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-3">
              <div className="flex flex-col items-center py-4 rounded-2xl border"
                   style={{ background: completedToday ? "rgba(245,158,11,0.08)" : "var(--card)", borderColor: completedToday ? "rgba(245,158,11,0.4)" : "var(--border)" }}>
                <span className="text-4xl mb-1">{completedToday ? "🔥" : "🌑"}</span>
                <span className="text-3xl font-black" style={{ color: completedToday ? "#f59e0b" : "var(--muted)" }}>
                  {streak} {streak === 1 ? "día" : "días"}
                </span>
                <span className="text-xs mt-1" style={{ color: "var(--dim)" }}>
                  {completedToday ? "¡Racha activa hoy!" : "Aprende algo hoy para mantener tu racha"}
                </span>
              </div>
              {activeMilestones.map((m, i) => {
                const achieved = streak >= m.days;
                const isNext = !achieved && (i === 0 || streak >= activeMilestones[i - 1].days);
                return (
                  <div key={m.days} className="rounded-2xl border p-4"
                       style={{ background: achieved ? "rgba(245,158,11,0.08)" : "var(--card)", borderColor: achieved ? "rgba(245,158,11,0.4)" : isNext ? "rgba(245,158,11,0.2)" : "var(--border)" }}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{achieved ? "✅" : isNext ? "🎯" : "🔒"}</span>
                      <div className="flex-1">
                        <p className="font-bold" style={{ color: achieved ? "#f59e0b" : "var(--text)" }}>{m.days} días seguidos</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                          {achieved ? "¡Conseguido!" : isNext ? `Te faltan ${m.days - streak} días` : `${m.days - streak} días restantes`}
                        </p>
                      </div>
                    </div>
                    {!achieved && (
                      <div className="h-1 rounded-full overflow-hidden mb-3" style={{ background: "var(--border)" }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min((streak / m.days) * 100, 100)}%`, background: "#f59e0b" }} />
                      </div>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>RECOMPENSA</span>
                      <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>{m.reward}</span>
                    </div>
                    <div className="flex gap-2 flex-wrap mt-1.5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(139,92,246,0.15)", color: "#8b5cf6" }}>BONUS</span>
                      <span className="text-xs" style={{ color: "var(--sub)" }}>{m.bonus}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Debate Modal */}
      {debateOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
             style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="w-full max-w-lg h-[90vh] flex flex-col rounded-t-3xl md:rounded-3xl border"
               style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setDebateOpen(false)} style={{ color: "var(--muted)" }}><X className="w-5 h-5" /></button>
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>
                💬 Debate · <span style={{ color: diffCfg.color }}>{diffCfg.label}</span>
              </span>
              <div className="w-5" />
            </div>

            {debateMessages.length === 0 ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div className="rounded-2xl border p-4" style={{ background: "rgba(14,165,233,0.08)", borderColor: "rgba(14,165,233,0.3)" }}>
                  <p className="text-xs font-bold mb-1" style={{ color: "#0ea5e9" }}>Modo {diffCfg.label}</p>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--sub)" }}>
                    {diffCfg.desc} — La IA debatirá en tu contra con datos reales.
                  </p>
                </div>
                <p className="font-bold text-sm" style={{ color: "var(--text)" }}>Tu tesis de inversión:</p>
                <textarea
                  value={debateThesis} onChange={(e) => setDebateThesis(e.target.value)}
                  placeholder={"Ej: 'NVIDIA seguirá subiendo por la demanda de IA'\n'Los bonos son mejor opción que acciones ahora'"}
                  rows={4}
                  className="w-full rounded-xl border p-3 text-sm resize-none outline-none"
                  style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }}
                />
                <button onClick={submitDebateThesis}
                        disabled={debateThesis.trim().length < 10 || debateLoading}
                        className="w-full py-3 rounded-xl font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
                        style={{ background: "#0ea5e9" }}>
                  {debateLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Iniciar debate
                </button>
              </div>
            ) : (
              <>
                <div ref={debateScrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
                  {debateMessages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-[88%] rounded-2xl p-3"
                           style={msg.role === "user"
                             ? { background: "#0ea5e9", color: "white" }
                             : { background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}>
                        {msg.role === "ai" && (
                          <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: diffCfg.color }}>
                            IA · {diffCfg.label.toUpperCase()}
                          </p>
                        )}
                        <p className="text-sm leading-relaxed">{msg.text}</p>
                      </div>
                    </div>
                  ))}
                  {debateLoading && (
                    <div className="flex justify-start">
                      <div className="rounded-2xl p-3 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                        <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#0ea5e9" }} />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 p-4 border-t" style={{ borderColor: "var(--border)" }}>
                  <textarea value={debateInput} onChange={(e) => setDebateInput(e.target.value)}
                            placeholder="Defiende tu tesis..."
                            rows={1}
                            className="flex-1 rounded-xl border px-3 py-2 text-sm resize-none outline-none"
                            style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendDebateReply(); } }}
                  />
                  <button onClick={sendDebateReply} disabled={!debateInput.trim() || debateLoading}
                          className="w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-40 shrink-0"
                          style={{ background: "#0ea5e9" }}>
                    <Send className="w-4 h-4 text-white" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={paywallReason} />
    </div>
  );
}
