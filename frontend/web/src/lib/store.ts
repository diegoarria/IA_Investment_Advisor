import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { UserProfile, ChatMessage, Notification } from "./types";
import { sync as syncApi } from "./api";

// All user-specific data is stored under per-user keys so switching accounts
// never leaks one user's watchlist, profile, or history to another.
const userStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    const uid = useAuthStore.getState().userId ?? "guest";
    return localStorage.getItem(`${name}__${uid}`);
  },
  setItem: (name: string, value: string) => {
    const uid = useAuthStore.getState().userId ?? "guest";
    localStorage.setItem(`${name}__${uid}`, value);
  },
  removeItem: (name: string) => {
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

function todayStr() { return new Date().toISOString().split("T")[0]; }
function yesterdayStr() { return new Date(Date.now() - 86400000).toISOString().split("T")[0]; }

export const STREAK_MILESTONES = [
  { days: 15, reward: "Modo Experto desbloqueado 🧠", bonus: "+5 mensajes/día" },
  { days: 30, reward: "+5 mensajes diarios activados 🎁", bonus: "Acceso a escenarios imposibles" },
  { days: 60, reward: "Insignia Inversor Consistente 🏅", bonus: "1 semana Premium gratis" },
  { days: 90, reward: "Hall of Fame — Top Inversor 🏆", bonus: "Mención especial" },
];

export const STREAK_MILESTONES_PREMIUM = [
  { days: 15, reward: "Insignia Estratega 🎖️", bonus: "Análisis macro semanal exclusivo" },
  { days: 30, reward: "Badge Inversor Élite ⭐", bonus: "Debates sin límite de rondas" },
  { days: 60, reward: "Avatar Halcón de Mercado 🦅", bonus: "Escenarios históricos secretos desbloqueados" },
  { days: 90, reward: "Leyenda del Hall of Fame 👑", bonus: "Top 1% — mención permanente en el perfil" },
];

export function getMilestoneForStreak(streak: number, premium = false) {
  const milestones = premium ? STREAK_MILESTONES_PREMIUM : STREAK_MILESTONES;
  return [...milestones].reverse().find((m) => streak >= m.days) ?? null;
}

export function getNextMilestone(streak: number, premium = false) {
  const milestones = premium ? STREAK_MILESTONES_PREMIUM : STREAK_MILESTONES;
  return milestones.find((m) => streak < m.days) ?? null;
}

export type SubscriptionTier = "free" | "premium";
export const FREE_MSG_LIMIT = 20;
export const FREE_MSG_WINDOW_HOURS = 24;

interface AuthState {
  token: string | null;
  userId: string | null;
  isAuthenticated: boolean;
  setAuth: (token: string, userId: string) => void;
  clearAuth: () => void;
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
      setAuth: (token, userId) => {
        localStorage.setItem("access_token", token);
        set({ token, userId, isAuthenticated: true });
      },
      clearAuth: () => {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        set({ token: null, userId: null, isAuthenticated: false });
      },
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
          if (get().sessions.length > 0) return;
          const { chat } = await import("./api");
          const res = await chat.getHistory();
          const raw: ChatMessage[] = res.data?.messages ?? [];
          const msgs = [...raw].reverse();
          if (msgs.length === 0) return;
          const id = makeSessionId();
          set({
            sessions: [{
              id,
              title: makeSessionTitle(msgs),
              messages: msgs,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }],
            currentId: id,
            messages: msgs,
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
        // On a new device with no local sessions, fetch history from the server.
        if (!state?.sessions?.length) {
          setTimeout(() => useChatStore.getState().loadFromServer(), 200);
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
      fetchStatus: async () => {
        try {
          const { billing } = await import("./api");
          const res = await billing.getStatus();
          set({
            tier:           res.data.tier ?? "free",
            trialStartedAt: res.data.trial_started_at ?? get().trialStartedAt ?? null,
            isTrialPremium: res.data.is_trial ?? false,
            trialDaysLeft:  res.data.trial_days_left ?? 0,
            msgCount:       res.data.msg_count ?? 0,
            msgWindowStart: res.data.msg_window_start ?? null,
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

export function msgsRemaining(store: { tier: SubscriptionTier; msgCount: number; msgWindowStart: string | null }): number {
  if (store.tier === "premium") return Infinity;
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

// ─── Learn store ─────────────────────────────────────────────────────────────

interface LearnState {
  streak: number;
  lastLearnDate: string | null;
  totalCompleted: number;
  completedToday: boolean;
  markTopicCompleted: () => void;
  initStreak: () => void;
}

export const useLearnStore = create<LearnState>()(
  persist(
    (set, get) => ({
      streak: 0,
      lastLearnDate: null,
      totalCompleted: 0,
      completedToday: false,

      initStreak: () => {
        const { lastLearnDate, streak } = get();
        const today = todayStr();
        const yesterday = yesterdayStr();
        if (lastLearnDate === today) {
          set({ completedToday: true });
        } else if (lastLearnDate && lastLearnDate < yesterday) {
          set({ streak: 0, completedToday: false });
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
      },
    }),
    { name: "learn-store", storage: userStorage }
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
}

export const useWatchlistStore = create<WatchlistState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (ticker, name) => {
        const t = ticker.toUpperCase();
        if (get().items.find((i) => i.ticker === t)) return;
        set((s) => ({ items: [...s.items, { ticker: t, name, addedAt: Date.now() }] }));
      },
      remove: (ticker) => {
        const t = ticker.toUpperCase();
        set((s) => ({ items: s.items.filter((i) => i.ticker !== t) }));
      },
      has: (ticker) => !!get().items.find((i) => i.ticker === ticker.toUpperCase()),
    }),
    { name: "watchlist", storage: userStorage }
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
