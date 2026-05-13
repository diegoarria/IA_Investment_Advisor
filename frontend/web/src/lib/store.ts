import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserProfile, ChatMessage, Notification } from "./types";

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
