import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { UserProfile, ChatMessage, Notification } from "./types";
import { sync as syncApi } from "./api";
import { DEFAULT_DETAIL_LEVEL, isValidDetailLevel, type DetailLevel } from "./detailLevel";
import {
  isValidDiscountRateMethod, resolveDashboardSectionOrder, sanitizeFavoriteMetrics,
  DEFAULT_DASHBOARD_SECTION_ORDER, type DiscountRateMethod, type ReorderableSection, type FavoriteMetricKey,
} from "./personalization";

// All user-specific data is stored under per-user keys so switching accounts
// never leaks one user's watchlist, profile, or history to another.
//
// Every method is wrapped in try/catch: Safari (ITP purging, and especially
// Private Browsing, where localStorage.setItem throws synchronously) can
// make a plain localStorage call throw. Uncaught, that exception happens
// inside zustand's persist middleware and can abort the whole store's
// hydration/write — which is how a subscription/trial status store ends up
// stuck showing "free" specifically on Safari, never recovering even after
// a successful server fetch, because the write of that fetch's result back
// to storage is what threw.
const userStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    if (typeof window === "undefined") return null;
    try {
      const uid = useAuthStore.getState().userId ?? "guest";
      return localStorage.getItem(`${name}__${uid}`);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    if (typeof window === "undefined") return;
    try {
      const uid = useAuthStore.getState().userId ?? "guest";
      localStorage.setItem(`${name}__${uid}`, value);
    } catch {
      // Safari Private Browsing / storage quota — the store still works
      // in-memory for this session, it just won't persist across reloads.
    }
  },
  removeItem: (name: string) => {
    if (typeof window === "undefined") return;
    try {
      const uid = useAuthStore.getState().userId ?? "guest";
      localStorage.removeItem(`${name}__${uid}`);
    } catch {}
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

/** i18n-aware label for a behavioral risk score — call with the `t` from useTranslation(). */
export function behavioralRiskLabel(score: number, t: (key: string) => string): string {
  if (score < 20) return t("common.riskScale.veryConservative");
  if (score < 35) return t("common.riskScale.conservative");
  if (score < 55) return t("common.riskScale.moderate");
  if (score < 68) return t("common.riskScale.growth");
  if (score < 82) return t("common.riskScale.aggressive");
  return t("common.riskScale.speculative");
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

// Maps each raw signal key (as stored in MaturityEvent.signals, matching
// MATURITY_DELTAS above) to its i18n key under profile.maturitySignals.* —
// these used to be rendered as the raw Spanish key with underscores
// replaced by spaces, showing "análisis racional" etc. even in English.
const MATURITY_SIGNAL_I18N_KEYS: Record<string, string> = {
  "análisis_racional": "analisisRacional",
  "tolera_volatilidad": "toleraVolatilidad",
  "largo_plazo": "largoPlazo",
  "diversificación_consciente": "diversificacionConsciente",
  "compra_en_caídas": "compraEnCaidas",
  "decisión_por_fundamentos": "decisionPorFundamentos",
  "acepta_pérdida_educada": "aceptaPerdidaEducada",
  "pánico_venta": "panicoVenta",
  "busca_garantías": "buscaGarantias",
  "fomo": "fomo",
  "especulación": "especulacion",
  "decisión_por_precio": "decisionPorPrecio",
  "horizonte_corto": "horizonteCorto",
};

export function maturitySignalI18nKey(signal: string): string {
  const key = MATURITY_SIGNAL_I18N_KEYS[signal];
  return key ? `profile.maturitySignals.${key}` : "";
}

export function maturityLabel(score: number, t: (key: string) => string): { label: string; color: string } {
  if (score < 30) return { label: t("profile.maturityLevels.apprentice"),  color: "#ef4444" };
  if (score < 50) return { label: t("profile.maturityLevels.beginner"),    color: "#f97316" };
  if (score < 65) return { label: t("profile.maturityLevels.developing"), color: "#f59e0b" };
  if (score < 80) return { label: t("profile.maturityLevels.mature"),     color: "#22c55e" };
  return                 { label: t("profile.maturityLevels.expert"),     color: "#16a34a" };
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
  sessionExpired: boolean;
  setAuth: (token: string, userId: string) => void;
  clearAuth: () => Promise<void>;
  setAuthRestoring: (v: boolean) => void;
  setSessionExpired: (v: boolean) => void;
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

function _newChatTitle(): string {
  // Plain store module (no React context) — reads the language store
  // directly rather than via useTranslation(), same as other cross-store
  // reads in this file (e.g. useChatStore.getState() elsewhere).
  return useLanguageStore.getState().language === "en" ? "New chat" : "Nuevo chat";
}

function makeSessionTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return _newChatTitle();
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

// A chat "session" stays the active conversation across app opens/tab visits —
// only actually starts a new one once this much time has passed since the last
// message, matching the daily message-quota window used elsewhere in the app.
const CHAT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface ChatState {
  sessions: ChatSession[];
  currentId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  // Session ids the user has deleted — persisted so a deleted chat never
  // resurfaces on this device again, even before the server confirms the
  // delete (a concurrent loadFromServer/poll can't re-merge it back in
  // while its id sits here) and even if the delete request itself fails
  // (loadFromServer retries any id here the server hasn't confirmed yet).
  deletedIds: string[];
  createSession: () => string;
  resumeOrCreateSession: () => string;
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
      sessionExpired: false,
      setAuth: (token, userId) => {
        set({ token, userId, isAuthenticated: true, authRestoring: false, sessionExpired: false });
      },
      clearAuth: async () => {
        // Never tear down the session while a portfolio save is still in
        // flight — the fetch has keepalive so it can survive navigation, but
        // NOT a token that's already been invalidated. Waiting here (with a
        // safety cap so a dead network can't hang the logout button forever)
        // is what guarantees the last edit before switching accounts is never
        // silently lost.
        try {
          const { usePortfolioStore } = await import("./portfolioStore");
          await Promise.race([
            usePortfolioStore.getState().flushPendingSync(),
            new Promise((resolve) => setTimeout(resolve, 5000)),
          ]);
        } catch {}
        try {
          const { auth } = await import("./api");
          await auth.logout();
        } catch {}
        // "guest mode" positions/watchlist data is stored under a shared,
        // un-namespaced "guest" bucket (see userStorage below) — clear the
        // flag so a real account logged into next doesn't inherit it.
        try { localStorage.removeItem("nuvos_guest"); } catch {}
        // Let the next login (even in this same tab) re-apply the user's
        // preferred start screen once — see home/page.tsx's one-shot guard.
        try { sessionStorage.removeItem("nuvos_start_screen_redirected"); } catch {}
        set({ token: null, userId: null, isAuthenticated: false, authRestoring: false });
        // Supabase's own session (persisted under its own localStorage key,
        // separate from our access_token) must go too — otherwise logging
        // into a DIFFERENT account on the same device can silently
        // re-authenticate as the old one via the OAuth callback or the
        // 401-retry fallback, both of which trust an existing Supabase
        // session if one is present. Done last, after the flush above, so it
        // can never race with — and invalidate — an in-flight save.
        try { const { getSupabaseClient } = await import("./supabase"); await getSupabaseClient().auth.signOut(); } catch {}
      },
      setAuthRestoring: (v) => set({ authRestoring: v }),
      setSessionExpired: (v) => set({ sessionExpired: v }),
    }),
    {
      name: "auth-store",
      partialize: (s) => ({ userId: s.userId, isAuthenticated: s.isAuthenticated }),
    }
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
      deletedIds: [],

      createSession: () => {
        const id = makeSessionId();
        set((s) => ({
          sessions: [
            { id, title: _newChatTitle(), messages: [], createdAt: Date.now(), updatedAt: Date.now() },
            ...s.sessions,
          ],
          currentId: id,
          messages: [],
        }));
        return id;
      },

      resumeOrCreateSession: () => {
        const { sessions, currentId } = get();
        const latest = sessions[0];
        // No `messages.length > 0` requirement here on purpose — a brand-new
        // empty session (just created via "+ Nuevo") IS the latest session
        // and is well within the TTL the instant it's created, so it must
        // resume too. Requiring messages used to make every resume check
        // after that (mount, tab visibility change, the periodic
        // loadFromServer retries) treat it as "nothing to resume" and snap
        // back to whatever the previous real conversation was instead.
        if (latest && Date.now() - latest.updatedAt < CHAT_SESSION_TTL_MS) {
          if (currentId !== latest.id) set({ currentId: latest.id, messages: latest.messages });
          return latest.id;
        }
        return get().createSession();
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
          return {
            sessions: remaining,
            currentId: newCurrentId,
            messages: newMessages,
            // Recorded (and persisted) BEFORE the server call resolves —
            // this is what stops a loadFromServer/poll that fires in the
            // exact same instant from re-merging the session back in while
            // the delete is still in flight.
            deletedIds: s.deletedIds.includes(id) ? s.deletedIds : [...s.deletedIds, id],
          };
        });
        // Removing it from local state alone used to be the whole
        // implementation — the messages stayed in chat_history server-side,
        // so the next loadFromServer() (on mount, or the periodic retries in
        // chat/page.tsx) silently rebuilt and re-inserted the "deleted"
        // session. Deleting server-side too is what makes it stick — retried
        // with backoff so a transient failure doesn't leave it un-deleted on
        // the server forever (loadFromServer also retries any id still in
        // deletedIds that the server hasn't confirmed yet, so even a delete
        // that fails here entirely — e.g. offline — completes later).
        (async () => {
          const { chat } = await import("./api");
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await chat.deleteHistory(id);
              return;
            } catch (e) {
              if (attempt === 2) console.error("Failed to delete chat history on server:", e);
              else await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            }
          }
        })();
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
        // A poll response can carry a message for a session that was just
        // deleted (it raced the delete server-side, or was purged there but
        // this cursor still returned a cached page) — never let it recreate
        // the session client-side.
        if (get().deletedIds.includes(sessionId)) return;
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
          const serverDeletedIds: string[] = res.data?.deleted_session_ids ?? [];

          // Union of what THIS device knows it deleted with what the server
          // confirms is deleted — a session tombstoned on another device
          // must be pruned from this device's own persisted cache too, or
          // it keeps re-surfacing here forever via the "unsynced local
          // session" fallback below.
          const allDeleted = new Set([...get().deletedIds, ...serverDeletedIds]);
          set({ deletedIds: [...allDeleted] });

          // Any id this device still thinks is deleted but the server
          // hasn't confirmed yet (an earlier delete that failed outright —
          // e.g. offline — or is still retrying) gets one more push here,
          // so the deletion still eventually sticks without the user having
          // to do anything.
          const serverDeletedSet = new Set(serverDeletedIds);
          for (const id of get().deletedIds) {
            if (!serverDeletedSet.has(id)) chat.deleteHistory(id).catch(() => {});
          }

          if (raw.length === 0) {
            // Nothing on the server (or everything left was tombstoned) —
            // still prune any locally cached session that's now deleted.
            if (allDeleted.size > 0) {
              set((s) => {
                const sessions = s.sessions.filter((sess) => !allDeleted.has(sess.id));
                const currentId = s.currentId && sessions.find((sess) => sess.id === s.currentId) ? s.currentId : sessions[0]?.id ?? null;
                return { sessions, currentId, messages: sessions.find((sess) => sess.id === currentId)?.messages ?? [] };
              });
            }
            return;
          }

          // Group by session_id — each unique id becomes a separate chat session
          const sessionMap = new Map<string, typeof raw>();
          for (const msg of raw) {
            const sid = (msg.session_id as string) ?? "legacy";
            if (!sessionMap.has(sid)) sessionMap.set(sid, []);
            sessionMap.get(sid)!.push(msg);
          }

          const serverSessions: ChatSession[] = [...sessionMap.entries()]
            .filter(([sid]) => !allDeleted.has(sid))
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

          // Keep local sessions that aren't on the server yet: either they
          // have unsent messages, or — just as important — it's the session
          // the user is actively sitting on right now (e.g. a brand-new,
          // still-empty "+ Nuevo" chat). Without that second condition, this
          // merge dropped a just-created empty session on every refresh
          // (mount, tab focus, the periodic retries below) and fell back to
          // whatever the most recent REAL conversation was — "+ Nuevo" would
          // open a new chat that then silently snapped back to the old one.
          const { currentId: activeId } = get();
          const serverIds = new Set(serverSessions.map((s) => s.id));
          const localOnly = get().sessions.filter((s) =>
            !serverIds.has(s.id) && !allDeleted.has(s.id) && (s.messages.length > 0 || s.id === activeId)
          );
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
      partialize: (state) => ({ sessions: state.sessions, currentId: state.currentId, deletedIds: state.deletedIds }),
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
  /** True once a fetchStatus() call has actually completed (success OR
   * failure) at least once this session. A trial/premium user's very
   * first paint before this flips true is the persisted (possibly stale
   * "free") value — components that gate premium content can check this
   * to tell "genuinely free" apart from "haven't heard back yet". */
  hasFetchedStatus: boolean;
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
      hasFetchedStatus: false,
      fetchStatus: async () => {
        const { billing } = await import("./api");
        // A single transient blip (cold API start, a dropped request, a
        // flaky mobile network) must never be the reason a real trial/
        // premium user gets stuck looking free for the rest of the
        // session — retry a few times with backoff before giving up.
        // 401/403 are the one exception: a logged-out/guest visitor gets
        // one of these on every single page load, and it will never
        // succeed no matter how many times we retry — burning through 3
        // attempts for a guaranteed failure only wastes the shared rate
        // limit (which then 429s this same call on the NEXT page) and
        // spams the console with a misleading "error".
        const ATTEMPTS = 3;
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
          try {
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
              hasFetchedStatus:  true,
            });
            return;
          } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            const authFailure = status === 401 || status === 403;
            if (attempt === ATTEMPTS || authFailure) {
              if (!authFailure) {
                console.error("useSubscriptionStore.fetchStatus: giving up after", attempt, "attempts", err);
              }
              set({ hasFetchedStatus: true });
              return;
            }
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        }
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
    {
      name: "subscription-status",
      storage: userStorage,
      // hasFetchedStatus must never be persisted — every fresh page load
      // (new tab, reload) should start from "haven't heard from the
      // server yet" and re-verify, never trust a flag left over from a
      // previous session.
      partialize: (state) => {
        const { hasFetchedStatus: _hasFetchedStatus, ...rest } = state;
        return rest;
      },
    }
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
          // Server is authoritative for cross-device sync — always apply it,
          // regardless of what's currently cached locally. The previous
          // "only apply if still on default es" guard meant a tab that had
          // ever been on "en" would never pick up a later change to "es"
          // made elsewhere (e.g. on mobile), silently diverging forever.
          const res = await syncApi.getAll();
          const serverLanguage: "es" | "en" | undefined = res.data?.language;
          if ((serverLanguage === "es" || serverLanguage === "en") && serverLanguage !== get().language) {
            get().setLanguage(serverLanguage);
          }
        } catch {}
      },
    }),
    { name: "language-store" }
  )
);

// ─── Detail level store (Fase 4, Incremento 1) ────────────────────────────────
// "Nivel de Detalle" (Principiante/Intermedio/Avanzado/Profesional) — see
// src/lib/detailLevel.ts for why this is deliberately separate from
// UserLevel. Same persisted-store + server-sync shape as useThemeStore/
// useLanguageStore above.

interface DetailLevelState {
  detailLevel: DetailLevel;
  setDetailLevel: (level: DetailLevel) => void;
  loadDetailLevelFromServer: () => Promise<void>;
}

export const useDetailLevelStore = create<DetailLevelState>()(
  persist(
    (set, get) => ({
      detailLevel: DEFAULT_DETAIL_LEVEL,
      setDetailLevel: (level) => {
        set({ detailLevel: level });
        syncApi.pushDetailLevel(level).catch(() => {});
      },
      loadDetailLevelFromServer: async () => {
        try {
          const res = await syncApi.getAll();
          const serverLevel: unknown = res.data?.detail_level;
          if (isValidDetailLevel(serverLevel) && serverLevel !== get().detailLevel) {
            set({ detailLevel: serverLevel });
          }
        } catch {}
      },
    }),
    { name: "detail-level-store" }
  )
);

// ─── Personalization store (Fase 4, Incremento 12) ────────────────────────────
// retorno requerido, margen de seguridad mínimo, método de tasa de descuento
// preferido, métricas favoritas, orden de secciones del dashboard — see
// src/lib/personalization.ts for exactly which per-request surface each
// setting actually feeds (never the shared nif_dashboard/quick_analysis
// caches). Same persisted-store + server-sync shape as useDetailLevelStore.

interface PersonalizationState {
  requiredReturnPct: number | null;
  minMarginOfSafetyPct: number | null;
  preferredDiscountRateMethod: DiscountRateMethod;
  favoriteMetrics: FavoriteMetricKey[];
  dashboardSectionOrder: ReorderableSection[];
  setPersonalization: (patch: Partial<{
    requiredReturnPct: number | null; minMarginOfSafetyPct: number | null;
    preferredDiscountRateMethod: DiscountRateMethod; favoriteMetrics: FavoriteMetricKey[];
    dashboardSectionOrder: ReorderableSection[];
  }>) => void;
  loadPersonalizationFromServer: () => Promise<void>;
}

export const usePersonalizationStore = create<PersonalizationState>()(
  persist(
    (set, get) => ({
      requiredReturnPct: null,
      minMarginOfSafetyPct: null,
      preferredDiscountRateMethod: "wacc",
      favoriteMetrics: [],
      dashboardSectionOrder: DEFAULT_DASHBOARD_SECTION_ORDER,
      setPersonalization: (patch) => {
        set(patch);
        syncApi.pushPersonalization({
          required_return_pct: "requiredReturnPct" in patch ? patch.requiredReturnPct : undefined,
          min_margin_of_safety_pct: "minMarginOfSafetyPct" in patch ? patch.minMarginOfSafetyPct : undefined,
          preferred_discount_rate_method: patch.preferredDiscountRateMethod,
          favorite_metrics: patch.favoriteMetrics,
          dashboard_section_order: patch.dashboardSectionOrder,
        }).catch(() => {});
      },
      loadPersonalizationFromServer: async () => {
        try {
          const res = await syncApi.getAll();
          const data = res.data ?? {};
          set({
            requiredReturnPct: typeof data.required_return_pct === "number" ? data.required_return_pct : null,
            minMarginOfSafetyPct: typeof data.min_margin_of_safety_pct === "number" ? data.min_margin_of_safety_pct : null,
            preferredDiscountRateMethod: isValidDiscountRateMethod(data.preferred_discount_rate_method)
              ? data.preferred_discount_rate_method : "wacc",
            favoriteMetrics: sanitizeFavoriteMetrics(data.favorite_metrics),
            dashboardSectionOrder: resolveDashboardSectionOrder(data.dashboard_section_order),
          });
        } catch {}
      },
    }),
    { name: "personalization-store" }
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

// ─── Balance visibility (the "eye" toggle) ─────────────────────────────────────
// One shared preference for Home/Patrimonio/Portfolio — toggling it on any one
// of those screens hides/shows the invested amount on all of them, same as a
// banking app's balance-privacy toggle. A device preference, not per-account
// data, so it's fine in plain (non-user-scoped) localStorage like theme/tutorial.

interface BalanceVisibilityState {
  hidden: boolean;
  toggle: () => void;
}

export const useBalanceVisibilityStore = create<BalanceVisibilityState>()(
  persist(
    (set, get) => ({
      hidden: false,
      toggle: () => set({ hidden: !get().hidden }),
    }),
    { name: "balance-visibility-store" }
  )
);

// ─── Guest signup nag ───────────────────────────────────────────────────────
// Diego: guests browse completely freely (no action is ever blocked) —
// instead, the signup flashcard surfaces on its own every 2 minutes of
// being in the app. Accept it and it's done (they're headed to signup).
// Reject/dismiss it and it comes back 2 minutes later, up to 5 times in one
// calendar day; reject the 5th and it goes quiet until a different day.
// `promptsShownToday`/`lastPromptDate` are persisted (survives a reload)
// — `flashcardOpen` is deliberately NOT, so a reload never reopens the
// modal on its own; the mount effect in GuestSignupFlashcard restarts its
// own 2-minute countdown for that fresh session instead.
export const GUEST_PROMPT_INTERVAL_MS = 2 * 60 * 1000;
const GUEST_PROMPT_DAILY_LIMIT = 5;

function localDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface GuestGateState {
  promptsShownToday: number;
  lastPromptDate: string;
  flashcardOpen: boolean;
  // Called by the 2-minute timer. No-ops once today's 5-prompt cap is hit.
  showFlashcard: () => void;
  // User rejected/closed it — counts toward today's cap, and if still under
  // the cap, schedules the next attempt 2 minutes from now.
  dismissFlashcard: () => void;
  // User accepted (clicked through to signup) — just closes, no reschedule
  // and doesn't count toward the cap (there's no "again" if they said yes).
  acceptFlashcard: () => void;
  // Unconditional open — for a deliberate manual trigger (e.g.
  // SessionExpiredBanner's click), not the 2-minute guest nag loop, so it
  // skips both the guest-only check and the 5/day cap those exist for.
  forceShowFlashcard: () => void;
}

export const useGuestGateStore = create<GuestGateState>()(
  persist(
    (set, get) => ({
      promptsShownToday: 0,
      lastPromptDate: "",
      flashcardOpen: false,
      showFlashcard: () => {
        // Guards here too, not just at the call site — a reschedule timer
        // from a prior dismissFlashcard() can still be pending in the
        // background if the guest logs in before it fires; it must not
        // pop this open for what's now a real authenticated user.
        try { if (localStorage.getItem("nuvos_guest") !== "1") return; } catch { return; }
        const today = localDateStr();
        const s = get();
        const promptsToday = s.lastPromptDate === today ? s.promptsShownToday : 0;
        if (promptsToday >= GUEST_PROMPT_DAILY_LIMIT) return;
        set({ flashcardOpen: true });
      },
      dismissFlashcard: () => {
        const today = localDateStr();
        const s = get();
        const promptsToday = (s.lastPromptDate === today ? s.promptsShownToday : 0) + 1;
        set({ flashcardOpen: false, lastPromptDate: today, promptsShownToday: promptsToday });
        if (promptsToday < GUEST_PROMPT_DAILY_LIMIT) {
          setTimeout(() => get().showFlashcard(), GUEST_PROMPT_INTERVAL_MS);
        }
      },
      acceptFlashcard: () => set({ flashcardOpen: false }),
      forceShowFlashcard: () => set({ flashcardOpen: true }),
    }),
    {
      name: "guest-gate-store",
      partialize: (state) => ({ promptsShownToday: state.promptsShownToday, lastPromptDate: state.lastPromptDate }),
    }
  )
);

export function isGuestUser(): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem("nuvos_guest") === "1"; } catch { return false; }
}

// Stable, anonymous per-browser id — never a real identity, never tied to
// an account even if the guest later registers. Backs the free-tier
// weekly search counter on /quick-analysis/public (Oportunidades), which
// has no user_profiles row to key a counter on the way the authenticated
// route does. Generated once and reused for as long as this localStorage
// entry survives.
export function getGuestId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem("nuvos_guest_id");
    if (!id) {
      id = (crypto as { randomUUID?: () => string }).randomUUID?.() ?? `g-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("nuvos_guest_id", id);
    }
    return id;
  } catch {
    return "";
  }
}

// The one real entry point into guest mode — both "Explorar sin cuenta" and
// the automatic redirect on "/" for anyone without a session call this
// instead of just setting the nuvos_guest flag directly.
//
// Portfolio/watchlist persist under `${key}__${uid}`, uid = the current
// userId or else the literal string "guest" (see userStorage above) —
// setting the guest flag alone left that uid resolution untouched, so
// clicking "Explorar sin cuenta" *while still holding a real session*
// (Diego testing it himself, or anyone on a device where he stayed logged
// in) rendered his actual portfolio and watchlist straight from
// localStorage, no server call involved (Diego: "ese es mío, no quiero que
// nadie pueda verlo o tener acceso"). clearAuth() forces uid back to
// "guest" (and ends the real session server-side — correct, since you
// can't genuinely be "browsing without an account" while still holding a
// valid one), and the two stores are wiped to their pristine empty shape
// on top of that as a second guarantee, independent of whatever a past
// "guest" bucket might already contain.
export async function enterGuestMode(): Promise<void> {
  await useAuthStore.getState().clearAuth();
  try {
    localStorage.setItem("nuvos_ob", "1");
    localStorage.setItem("nuvos_guest", "1");
  } catch { /* ignore */ }
  useWatchlistStore.setState({ items: [] });
  try {
    const { usePortfolioStore } = await import("./portfolioStore");
    usePortfolioStore.getState().resetForGuest();
  } catch { /* ignore */ }
}
