import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserProfile, ChatMessage, Notification } from "./types";

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
  setProfile: (profile: UserProfile | null) => void;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  addMessage: (msg: ChatMessage) => void;
  appendToLastAssistant: (chunk: string) => void;
  setStreaming: (v: boolean) => void;
  startAssistantMessage: () => void;
  clearMessages: () => void;
  setMessages: (msgs: ChatMessage[]) => void;
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
        set({ token: null, userId: null, isAuthenticated: false });
      },
    }),
    { name: "auth-store" }
  )
);

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  setProfile: (profile) => set({ profile }),
}));

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  appendToLastAssistant: (chunk) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, content: last.content + chunk };
      }
      return { messages: msgs };
    }),
  setStreaming: (v) => set({ isStreaming: v }),
  startAssistantMessage: () =>
    set((s) => ({
      messages: [...s.messages, { role: "assistant", content: "" }],
    })),
  clearMessages: () => set({ messages: [] }),
  setMessages: (msgs) => set({ messages: msgs }),
}));

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
      msgCount: 0,
      msgWindowStart: null,
      fetchStatus: async () => {
        try {
          const { billing } = await import("./api");
          const res = await billing.getStatus();
          set({
            tier: res.data.tier ?? "free",
            msgCount: res.data.msg_count ?? 0,
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
    { name: "subscription-status" }
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
      },
    }),
    { name: "theme-store" }
  )
);
