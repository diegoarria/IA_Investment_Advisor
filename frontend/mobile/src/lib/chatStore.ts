import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

interface ChatStore {
  sessions: ChatSession[];
  currentId: string | null;

  // Derived: messages of the current session
  currentMessages: () => Message[];

  createSession: () => string;
  loadSession: (id: string) => void;
  setMessages: (msgs: Message[]) => void;
  deleteSession: (id: string) => void;
  clearAll: () => void;
}

function makeId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "Chat sin título";
  return first.content.length > 36
    ? first.content.slice(0, 36).trimEnd() + "…"
    : first.content;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentId: null,

      currentMessages: () => {
        const { sessions, currentId } = get();
        return sessions.find((s) => s.id === currentId)?.messages ?? [];
      },

      createSession: () => {
        const id = makeId();
        set((s) => ({
          sessions: [
            { id, title: "Nuevo chat", messages: [], createdAt: Date.now(), updatedAt: Date.now() },
            ...s.sessions,
          ],
          currentId: id,
        }));
        return id;
      },

      loadSession: (id) => set({ currentId: id }),

      setMessages: (msgs) => {
        set((s) => ({
          sessions: s.sessions.map((session) =>
            session.id === s.currentId
              ? { ...session, messages: msgs, title: makeTitle(msgs), updatedAt: Date.now() }
              : session
          ),
        }));
      },

      deleteSession: (id) =>
        set((s) => {
          const remaining = s.sessions.filter((session) => session.id !== id);
          return {
            sessions: remaining,
            currentId: s.currentId === id ? (remaining[0]?.id ?? null) : s.currentId,
          };
        }),

      clearAll: () => set({ sessions: [], currentId: null }),
    }),
    {
      name: "chat-sessions",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
