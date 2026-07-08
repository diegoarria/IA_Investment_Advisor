import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { UserProfile, ChatMessage, Notification } from "./types";
import { sync as syncApi } from "./api";

// All user-specific data is stored under per-user keys so switching accounts
// never leaks one user's watchlist, profile, or history to another.
const userStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    if (typeof window === "undefined") return null;
    const uid = useAuthStore.getState().userId ?? "guest";
    return localStorage.getItem(`${name}__${uid}`);
  },
  setItem: (name: string, value: string) => {
    if (typeof window === "undefined") return;
    const uid = useAuthStore.getState().userId ?? "guest";
    localStorage.setItem(`${name}__${uid}`, value);
  },
  removeItem: (name: string) => {
    if (typeof window === "undefined") return;
    const uid = useAuthStore.getState().userId ?? "guest";
    localStorage.removeItem(`${name}__${uid}`);
  },
}));
// Alias kept for backward compat with the chat store reference below.
const userScopedChatStorage = userStorage;

// ─── Behavioral risk helpers ────────────────────────────────────────────────

// Map onboarding risk_tolerance label → approximate 0-100 score baseline
const RISK_TOLERANCE_TO_SCORE: Record<string, number> = {
  conservative:           15,
  conservative_moderate:  25,
  moderate:               45,
  moderate_growth:        57,
  growth:                 65,
  aggressive:             73,
  aggressive_speculative: 85,
  speculative:            95,
};

export function behavioralRiskColor(score: number): string {
  if (score < 20) return "#3b82f6";
  if (score < 35) return "#00d47e";
  if (score < 55) return "#8bd44e";
  if (score < 68) return "#f5c842";
  if (score < 82) return "#f5973a";
  return "#ff2d3b";
}

export function behavioralRiskLabel(score: number): string {
  if (score < 20) return "Muy conservador";
  if (score < 35) return "Conservador";
  if (score < 55) return "Moderado";
  if (score < 68) return "Crecimiento";
  if (score < 82) return "Agresivo";
  return "Especulativo";
}

// ─── Maturity helpers ───────────────────────────────────────────────────────

export interface MaturityEvent {
  timestamp: number;
  delta: number;
  signals: string[];
  newScore: number;
}

const MATURITY_DELTAS: Record<string, number> = {
  "análisis_racional": 4,
  "tolera_volatilidad": 4,
  "largo_plazo": 3,
  "diversificación_consciente": 3,
  "compra_en_caídas": 5,
  "decisión_por_fundamentos": 4,
  "acepta_pérdida_educada": 3,
  "pánico_venta": -5,
  "busca_garantías": -3,
  "fomo": -4,
  "especulación": -3,
  "decisión_por_precio": -3,
  "horizonte_corto": -2,
};

export function computeMaturityDelta(signals: string[]): number {
  return signals.reduce((acc, sig) => acc + (MATURITY_DELTAS[sig] ?? 0), 0);
}

export function maturityLabel(score: number): { label: string; color: string } {
  if (score < 30) return { label: "Aprendiz",      color: "#ef4444" };
  if (score < 50) return { label: "Principiante",  color: "#f97316" };
  if (score < 65) return { label: "En Desarrollo", color: "#f59e0b" };
  if (score < 80) return { label: "Maduro",        color: "#22c55e" };
  return                 { label: "Experto",        color: "#16a34a" };
}

// ─── Streak helpers ─────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function yesterdayStr() {
  const d = new Date(Date.now() - 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type StreakMilestone = {
  days: number;
  emoji: string;
  title: string;
  reward: string;
  description: string;
  premiumBonus?: number;
  msgReset?: boolean;
};

export const STREAK_MILESTONES: StreakMilestone[] = [
  { days: 3,  emoji: "🔥", title: "Arranque",            reward: "Badge Arranque",          description: "¡Llevas 3 días aprendiendo seguidos! Tu mentor tiene un mensaje especial para ti." },
  { days: 7,  emoji: "⚡", title: "Primera Semana",      reward: "Día de mensajes gratis",   description: "Una semana completa. Tu límite de mensajes de hoy se ha reiniciado.", msgReset: true },
  { days: 14, emoji: "🎯", title: "Dos Semanas",         reward: "Badge Estratega",          description: "14 días consecutivos. Estás construyendo un hábito real de inversión." },
  { days: 30, emoji: "🎁", title: "Mes Completo",        reward: "3 días Premium gratis",    description: "¡Un mes entero! Hemos agregado 3 días de Premium a tu cuenta.", premiumBonus: 3 },
  { days: 60, emoji: "🏅", title: "Inversor Consistente",reward: "7 días Premium gratis",    description: "60 días sin parar. Disciplina de nivel élite. Tienes 7 días de Premium.", premiumBonus: 7 },
  { days: 90, emoji: "👑", title: "Hall of Fame",        reward: "1 mes Premium gratis",     description: "90 días consecutivos. Top 1% de inversores en Nuvos. Disfruta 1 mes de Premium.", premiumBonus: 30 },
];

export function getMilestoneForStreak(streak: number): StreakMilestone | null {
  return [...STREAK_MILESTONES].reverse().find((m) => streak >= m.days) ?? null;
}

export function getNextMilestone(streak: number): StreakMilestone | null {
  return STREAK_MILESTONES.find((m) => streak < m.days) ?? null;
}

export function getUnclaimedMilestones(streak: number, claimed: number[]): StreakMilestone[] {
  return STREAK_MILESTONES.filter((m) => streak >= m.days && !claimed.includes(m.days));
}

export type SubscriptionTier = "free" | "premium";
export const FREE_MSG_LIMIT = 15;
export const FREE_MSG_WINDOW_HOURS = 24;

interface AuthState {
  token: string | null;
  userId: string | null;
  isAuthenticated: boolean;
  authRestoring: boolean;
  setAuth: (token: string, userId: string) => void;
  clearAuth: () => void;
  setAuthRestoring: (v: boolean) => void;
}

interface ProfileState {
  profile: UserProfile | null;
  maturityScore: number;
  maturityHistory: MaturityEvent[];
  behavioralRiskScore: number | null;
  setProfile: (profile: UserProfile | null) => void;
  updateMaturity: (signals: string[]) => void;
  updateBehavioralRisk: (score: number, conf: string) => void;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

function makeSessionId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeSessionTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "Nuevo chat";
  return first.content.length > 36
    ? first.content.slice(0, 36).trimEnd() + "…"
    : first.content;
}

function syncSession(sessions: ChatSession[], currentId: string | null, messages: ChatMessage[]): ChatSession[] {
  if (!currentId) return sessions;
  return sessions.map((s) =>
    s.id === currentId
      ? { ...s, messages, title: makeSessionTitle(messages), updatedAt: Date.now() }
      : s
  );
}

interface ChatState {
  sessions: ChatSession[];
  currentId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  createSession: () => string;
  loadSession: (id: string) => void;
  deleteSession: (id: string) => void;
  addMessage: (msg: ChatMessage) => void;
  appendToLastAssistant: (chunk: string) => void;
  setStreaming: (v: boolean) => void;
  startAssistantMessage: () => void;
  removeLastMessage: () => void;
  clearMessages: () => void;
  setMessages: (msgs: ChatMessage[]) => void;
  loadFromServer: () => Promise<void>;
  syncSessionMessages: (sessionId: string, msgs: ChatMessage[]) => void;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  setNotifications: (ns: Notification[], unread: number) => void;
  markRead: (id: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      isAuthenticated: false,
      authRestoring: true,
      setAuth: (token, userId) => {
        localStorage.setItem("access_token", token);
        set({ token, userId, isAuthenticated: true, authRestoring: false });
      },
      clearAuth: () => {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        set({ token: null, userId: null, isAuthenticated: false, authRestoring: false });
      },
      setAuthRestoring: (v) => set({ authRestoring: v }),
    }),
    { name: "auth-store" }
  )
);

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      profile: null,
      maturityScore: 0,
      maturityHistory: [],
      behavioralRiskScore: null,
      setProfile: (profile) => set({ profile }),
      updateMaturity: (signals) => {
        const delta = computeMaturityDelta(signals);
        if (delta === 0) return;
        const { maturityScore, maturityHistory } = get();
        const newScore = Math.min(100, Math.max(0, maturityScore + delta));
        const event: MaturityEvent = { timestamp: Date.now(), delta, signals, newScore };
        const newHistory = [...maturityHistory.slice(-99), event];
        set({ maturityScore: newScore, maturityHistory: newHistory });
        syncApi.pushMaturity(newScore, newHistory).catch(() => {});
      },
      updateBehavioralRisk: (incoming: number, conf: string) => {
        const alpha = conf === "high" ? 0.35 : conf === "medium" ? 0.2 : 0.08;
        const state = get();
        const current = state.behavioralRiskScore ??
          (state.profile ? (RISK_TOLERANCE_TO_SCORE[state.profile.risk_tolerance] ?? 50) : 50);
        const next = Math.round((1 - alpha) * current + alpha * incoming);
        const newScore = Math.min(100, Math.max(0, next));
        set({ behavioralRiskScore: newScore });
        syncApi.pushBehavioralRisk(newScore).catch(() => {});
      },
    }),
    {
      name: "profile-store",
      storage: userStorage,
      partialize: (s) => ({
        profile: s.profile,
        maturityScore: s.maturityScore,
        maturityHistory: s.maturityHistory,
        behavioralRiskScore: s.behavioralRiskScore,
      }),
    }
  )
);

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentId: null,
      messages: [],
      isStreaming: false,

      createSession: () => {
        const id = makeSessionId();
        set((s) => ({
          sessions: [
            { id, title: "Nuevo chat", messages: [], createdAt: Date.now(), updatedAt: Date.now() },
            ...s.sessions,
          ],
          currentId: id,
          messages: [],
        }));
        return id;
      },

      loadSession: (id) => {
        const { sessions } = get();
        const session = sessions.find((s) => s.id === id);
        set({ currentId: id, messages: session?.messages ?? [] });
      },

      deleteSession: (id) => {
        set((s) => {
          const remaining = s.sessions.filter((session) => session.id !== id);
          const newCurrentId = s.currentId === id ? (remaining[0]?.id ?? null) : s.currentId;
          const newMessages = s.currentId === id ? (remaining[0]?.messages ?? []) : s.messages;
          return { sessions: remaining, currentId: newCurrentId, messages: newMessages };
        });
      },

      addMessage: (msg) => set((s) => {
        const newMsgs = [...s.messages, msg];
        return { messages: newMsgs, sessions: syncSession(s.sessions, s.currentId, newMsgs) };
      }),

      appendToLastAssistant: (chunk) => set((s) => {
        const msgs = [...s.messages];
        const last = msgs[msgs.length - 1];
        if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, content: last.content + chunk };
        return { messages: msgs, sessions: syncSession(s.sessions, s.currentId, msgs) };
      }),

      setStreaming: (v) => set({ isStreaming: v }),

      startAssistantMessage: () => set((s) => {
        const newMsgs = [...s.messages, { role: "assistant" as const, content: "" }];
        return { messages: newMsgs, sessions: syncSession(s.sessions, s.currentId, newMsgs) };
      }),

      removeLastMessage: () => set((s) => {
        const newMsgs = s.messages.slice(0, -1);
        return { messages: newMsgs, sessions: syncSession(s.sessions, s.currentId, newMsgs) };
      }),

      clearMessages: () => set((s) => ({
        messages: [],
        sessions: syncSession(s.sessions, s.currentId, []),
      })),

      setMessages: (msgs) => set((s) => ({
        messages: msgs,
        sessions: syncSession(s.sessions, s.currentId, msgs),
      })),

      syncSessionMessages: (sessionId: string, msgs: ChatMessage[]): void => {
        set((s): Partial<ChatState> => {
          const existing = s.sessions.find((sess) => sess.id === sessionId);
          if (existing) {
            const updatedMsgs = [...existing.messages, ...msgs];
            const updatedSessions = s.sessions.map((sess) =>
              sess.id === sessionId
                ? { ...sess, messages: updatedMsgs, title: makeSessionTitle(updatedMsgs), updatedAt: Date.now() }
                : sess
            );
            return { sessions: updatedSessions, messages: s.currentId === sessionId ? updatedMsgs : s.messages };
          } else {
            const newSession: ChatSession = {
              id: sessionId, title: makeSessionTitle(msgs),
              messages: msgs, createdAt: Date.now(), updatedAt: Date.now(),
            };
            return { sessions: [newSession, ...s.sessions] };
          }
        });
      },

      loadFromServer: (): Promise<void> => {
        const run = async () => {
          const { chat } = await import("./api");
          const res = await chat.getHistory();
          const raw: { role: string; content: string; created_at?: string; session_id?: string | null }[] =
            res.data?.messages ?? [];
          if (raw.length === 0) return;

          // Group by session_id — each unique id becomes a separate chat session
          const sessionMap = new Map<string, typeof raw>();
          for (const msg of raw) {
            const sid = (msg.session_id as string) ?? "legacy";
            if (!sessionMap.has(sid)) sessionMap.set(sid, []);
            sessionMap.get(sid)!.push(msg);
          }

          const serverSessions: ChatSession[] = [...sessionMap.entries()]
            .map(([sid, msgs]) => {
              const chatMsgs: ChatMessage[] = msgs.map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              }));
              return {
                id: sid,
                title: makeSessionTitle(chatMsgs),
                messages: chatMsgs,
                createdAt: new Date(msgs[0].created_at ?? 0).getTime() || Date.now(),
                updatedAt: new Date(msgs[msgs.length - 1].created_at ?? 0).getTime() || Date.now(),
              };
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);

          // Keep local sessions that have messages but are not yet on server (unsent)
          const serverIds = new Set(serverSessions.map((s) => s.id));
          const localOnly = get().sessions.filter((s) => !serverIds.has(s.id) && s.messages.length > 0);
          const merged = [...localOnly, ...serverSessions].sort((a, b) => b.updatedAt - a.updatedAt);

          const { currentId } = get();
          const validCurrentId =
            currentId && merged.find((s) => s.id === currentId)
              ? currentId
              : merged[0]?.id ?? null;

          set({
            sessions: merged,
            currentId: validCurrentId,
            messages: merged.find((s) => s.id === validCurrentId)?.messages ?? [],
          });
        };
        return run().catch(() => {});
      },
    }),
    {
      name: "chat-sessions",
      storage: userScopedChatStorage,
      partialize: (state) => ({ sessions: state.sessions, currentId: state.currentId }),
      onRehydrateStorage: () => (state) => {
        if (state?.currentId) {
          const session = state.sessions.find((s) => s.id === state.currentId);
          if (session) state.messages = session.messages;
        }
      },
    }
  )
);

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  setNotifications: (notifications, unread) =>
    set({ notifications, unreadCount: unread }),
  markRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
      unreadCount: Math.max(0, s.unreadCount - 1),
    })),
}));

interface SubscriptionState {
  tier: SubscriptionTier;
  trialStartedAt: string | null;
  isTrialPremium: boolean;
  trialDaysLeft: number;
  msgCount: number;
  msgWindowStart: string | null;
  duoSetupPending: boolean;
  duoSecondaryEmail: string | null;
  fetchStatus: () => Promise<void>;
  setTier: (tier: SubscriptionTier) => void;
  incrementMsgCount: () => void;
}

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      tier: "free",
      trialStartedAt: null,
      isTrialPremium: false,
      trialDaysLeft: 0,
      msgCount: 0,
      msgWindowStart: null,
      duoSetupPending: false,
      duoSecondaryEmail: null,
      fetchStatus: async () => {
        try {
          const { billing } = await import("./api");
          const res = await billing.getStatus();
          set({
            tier:              res.data.tier ?? "free",
            trialStartedAt:    res.data.trial_started_at ?? get().trialStartedAt ?? null,
            isTrialPremium:    res.data.is_trial ?? false,
            trialDaysLeft:     res.data.trial_days_left ?? 0,
            msgCount:          res.data.msg_count ?? 0,
            msgWindowStart:    res.data.msg_window_start ?? null,
            duoSetupPending:   res.data.duo_setup_pending ?? false,
            duoSecondaryEmail: res.data.duo_secondary_email ?? null,
          });
        } catch {}
      },
      setTier: (tier) => set({ tier }),
      incrementMsgCount: () => {
        const { msgCount, msgWindowStart } = get();
        const now = new Date();
        const windowStart = msgWindowStart ? new Date(msgWindowStart) : null;
        const windowExpired =
          !windowStart ||
          now.getTime() - windowStart.getTime() >= FREE_MSG_WINDOW_HOURS * 3600 * 1000;
        if (windowExpired) {
          set({ msgCount: 1, msgWindowStart: now.toISOString() });
        } else {
          set({ msgCount: msgCount + 1 });
        }
      },
    }),
    { name: "subscription-status", storage: userStorage }
  )
);

export function msgsRemaining(store: { tier: SubscriptionTier; isTrialPremium?: boolean; msgCount: number; msgWindowStart: string | null }): number {
  if (store.tier === "premium" || store.isTrialPremium) return Infinity;
  const { msgCount, msgWindowStart } = store;
  const now = new Date();
  const windowStart = msgWindowStart ? new Date(msgWindowStart) : null;
  const windowExpired =
    !windowStart ||
    now.getTime() - windowStart.getTime() >= FREE_MSG_WINDOW_HOURS * 3600 * 1000;
  if (windowExpired) return FREE_MSG_LIMIT;
  return Math.max(0, FREE_MSG_LIMIT - msgCount);
}

interface ThemeState {
  theme: "dark" | "light";
  toggleTheme: () => void;
  setTheme: (t: "dark" | "light") => void;
  loadThemeFromServer: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      toggleTheme: () => {
        const next = get().theme === "dark" ? "light" : "dark";
        if (typeof document !== "undefined") {
          document.documentElement.setAttribute("data-theme", next);
        }
        set({ theme: next });
        syncApi.pushTheme(next).catch(() => {});
      },
      setTheme: (t) => {
        if (typeof document !== "undefined") {
          document.documentElement.setAttribute("data-theme", t);
        }
        set({ theme: t });
      },
      loadThemeFromServer: async () => {
        try {
          // Never override a user-selected light theme — only apply server value if still on default dark
          if (get().theme === "light") return;
          const res = await syncApi.getAll();
          const serverTheme: "dark" | "light" | undefined = res.data?.theme;
          if (serverTheme === "dark" || serverTheme === "light") {
            get().setTheme(serverTheme);
          }
        } catch {}
      },
    }),
    { name: "theme-store" }
  )
);

interface LanguageState {
  language: "es" | "en";
  setLanguage: (l: "es" | "en") => void;
  loadLanguageFromServer: () => Promise<void>;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set, get) => ({
      language: "es",
      setLanguage: (l) => {
        set({ language: l });
        if (typeof window !== "undefined") {
          import("@/i18n").then(({ default: i18n }) => i18n.changeLanguage(l));
        }
        syncApi.pushLanguage(l).catch(() => {});
      },
      loadLanguageFromServer: async () => {
        try {
          // Never override a user-selected English preference — only apply
          // the server value if still on the default "es".
          if (get().language === "en") return;
          const res = await syncApi.getAll();
          const serverLanguage: "es" | "en" | undefined = res.data?.language;
          if (serverLanguage === "es" || serverLanguage === "en") {
            get().setLanguage(serverLanguage);
          }
        } catch {}
      },
    }),
    { name: "language-store" }
  )
);

// ─── Learn store ─────────────────────────────────────────────────────────────

interface LearnState {
  streak: number;
  lastLearnDate: string | null;
  totalCompleted: number;
  completedToday: boolean;
  claimedMilestones: number[];
  completedTopicIds: string[];
  markTopicCompleted: () => void;
  markTopicId: (id: string) => void;
  setCompletedTopicIds: (ids: string[]) => void;
  initStreak: () => void;
  restoreFromServer: () => Promise<void>;
  setClaimedMilestones: (milestones: number[]) => void;
  markMilestoneClaimed: (days: number) => void;
}

export const useLearnStore = create<LearnState>()(
  persist(
    (set, get) => ({
      streak: 0,
      lastLearnDate: null,
      totalCompleted: 0,
      completedToday: false,
      claimedMilestones: [],
      completedTopicIds: [],

      setCompletedTopicIds: (ids) =>
        set((s) => ({ completedTopicIds: [...new Set([...s.completedTopicIds, ...ids])] })),

      markTopicId: (id) => {
        const current = get().completedTopicIds;
        if (current.includes(id)) return;
        const updated = [...current, id];
        set({ completedTopicIds: updated });
        const { streak, lastLearnDate } = get();
        import("./api").then(({ learn }) => {
          learn.syncStreak(streak, lastLearnDate ?? "", updated).catch(() => {});
        });
      },

      setClaimedMilestones: (milestones) => set({ claimedMilestones: milestones }),
      markMilestoneClaimed: (days) =>
        set((s) => ({
          claimedMilestones: s.claimedMilestones.includes(days)
            ? s.claimedMilestones
            : [...s.claimedMilestones, days],
        })),

      initStreak: () => {
        const { lastLearnDate, streak } = get();
        const today = todayStr();
        const yesterday = yesterdayStr();
        if (lastLearnDate === today) {
          set({ completedToday: true });
        } else if (lastLearnDate && lastLearnDate < yesterday) {
          set({ streak: 0, completedToday: false });
          import("./api").then(({ learn }) => {
            learn.syncStreak(0, "").catch(() => {});
          });
        } else {
          set({ completedToday: false });
        }
        void streak;
      },

      markTopicCompleted: () => {
        const { lastLearnDate, streak, totalCompleted } = get();
        const today = todayStr();
        const yesterday = yesterdayStr();
        if (lastLearnDate === today) {
          set({ totalCompleted: totalCompleted + 1 });
          return;
        }
        const newStreak = lastLearnDate === yesterday ? streak + 1 : 1;
        set({ streak: newStreak, lastLearnDate: today, totalCompleted: totalCompleted + 1, completedToday: true });
        import("./api").then(({ learn }) => {
          learn.syncStreak(newStreak, today).catch(() => {});
        });
      },

      restoreFromServer: async () => {
        try {
          const res = await syncApi.getAll();
          const serverStreak = res.data?.streak;
          if (serverStreak && typeof serverStreak.count === "number" && serverStreak.count > 0) {
            const current = get();
            if (serverStreak.count >= current.streak) {
              set({
                streak: serverStreak.count,
                lastLearnDate: serverStreak.last_learn_date ?? current.lastLearnDate,
              });
            }
          }
          // Merge server-completed topics with local (union across devices)
          const serverIds: string[] = res.data?.completed_topic_ids ?? [];
          if (serverIds.length > 0) get().setCompletedTopicIds(serverIds);
        } catch {}
        // Sync claimed milestones from billing status
        try {
          const { billing } = await import("./api");
          const res = await billing.getStatus();
          const claimed: number[] = res.data?.claimed_streak_milestones ?? [];
          set({ claimedMilestones: claimed });
        } catch {}
        // Re-derive completedToday from lastLearnDate (whether from server or cache)
        get().initStreak();
      },
    }),
    {
      name: "learn-store",
      storage: userStorage,
      onRehydrateStorage: () => () => {
        setTimeout(() => useLearnStore.getState().restoreFromServer(), 600);
      },
    }
  )
);

// ─── Watchlist store ──────────────────────────────────────────────────────────

export interface WatchItem {
  ticker: string;
  name: string;
  addedAt: number;
}

interface WatchlistState {
  items: WatchItem[];
  add: (ticker: string, name: string) => void;
  remove: (ticker: string) => void;
  has: (ticker: string) => boolean;
  loadFromServer: () => Promise<void>;
}

export const useWatchlistStore = create<WatchlistState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (ticker, name) => {
        const t = ticker.toUpperCase();
        if (get().items.find((i) => i.ticker === t)) return;
        set((s) => ({ items: [...s.items, { ticker: t, name, addedAt: Date.now() }] }));
        import("./api").then(({ watchlist }) => {
          watchlist.add(t, name).catch(() => {});
        });
      },
      remove: (ticker) => {
        const t = ticker.toUpperCase();
        set((s) => ({ items: s.items.filter((i) => i.ticker !== t) }));
        import("./api").then(({ watchlist }) => {
          watchlist.remove(t).catch(() => {});
        });
      },
      has: (ticker) => !!get().items.find((i) => i.ticker === ticker.toUpperCase()),
      loadFromServer: async () => {
        try {
          const { watchlist } = await import("./api");
          const res = await watchlist.get();
          const serverItems: WatchItem[] = (res.data ?? []).map((i: any) => ({
            ticker: i.ticker,
            name: i.name || i.ticker,
            addedAt: i.added_at ? new Date(i.added_at).getTime() : Date.now(),
          }));
          const localItems = get().items;
          if (serverItems.length > 0) {
            set({ items: serverItems });
          } else if (localItems.length > 0) {
            // Server returned empty but local has data — push local up
            const { watchlist: wl } = await import("./api");
            localItems.forEach((i) => wl.add(i.ticker, i.name).catch(() => {}));
          }
        } catch {}
      },
    }),
    {
      name: "watchlist",
      storage: userStorage,
      onRehydrateStorage: () => () => {
        setTimeout(() => useWatchlistStore.getState().loadFromServer(), 500);
      },
    }
  )
);

// ─── Tutorial store ───────────────────────────────────────────────────────────

interface TutorialState {
  hasSeenTutorial: boolean;
  tutorialOpen: boolean;
  openTutorial: () => void;
  closeTutorial: () => void;
  markSeen: () => void;
}

export const useTutorialStore = create<TutorialState>()(
  persist(
    (set) => ({
      hasSeenTutorial: false,
      tutorialOpen: false,
      openTutorial: () => set({ tutorialOpen: true }),
      closeTutorial: () => set({ tutorialOpen: false }),
      markSeen: () => set({ hasSeenTutorial: true, tutorialOpen: false }),
    }),
    { name: "tutorial-store", partialize: (s) => ({ hasSeenTutorial: s.hasSeenTutorial }) }
  )
);
