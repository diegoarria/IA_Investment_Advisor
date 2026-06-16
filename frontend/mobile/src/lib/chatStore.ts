import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// Each user gets their own chat storage key so accounts don't share history.
const userScopedStorage = createJSONStorage(() => ({
  getItem: async (name: string) => {
    const uid = (await SecureStore.getItemAsync("user_id")) ?? "guest";
    return AsyncStorage.getItem(`${name}__${uid}`);
  },
  setItem: async (name: string, value: string) => {
    const uid = (await SecureStore.getItemAsync("user_id")) ?? "guest";
    return AsyncStorage.setItem(`${name}__${uid}`, value);
  },
  removeItem: async (name: string) => {
    const uid = (await SecureStore.getItemAsync("user_id")) ?? "guest";
    return AsyncStorage.removeItem(`${name}__${uid}`);
  },
}));

export interface Message {
  role: "user" | "assistant";
  content: string;
  images?: Array<{ uri: string }>;
  timestamp?: number;
}

export interface BehavioralDiagnosis {
  score: number;          // 0–100
  profile: string;        // conservative | moderate | aggressive
  signals: string[];      // detected behavioral tags
  confidence: string;     // low | medium | high
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  diagnosis: BehavioralDiagnosis | null;
}

export interface BehavioralSnapshot {
  timestamp: number;
  score: number;       // BSCORE 0-100
  profile: string;     // conservative|moderate|aggressive
  signals: string[];
  maturity: number;    // maturityScore at that moment
}

interface ChatStore {
  sessions: ChatSession[];
  currentId: string | null;
  behavioralTimeline: BehavioralSnapshot[];

  currentMessages: () => Message[];
  currentDiagnosis: () => BehavioralDiagnosis | null;

  createSession: () => string;
  loadSession: (id: string) => void;
  setMessages: (msgs: Message[]) => void;
  setDiagnosis: (d: BehavioralDiagnosis, currentMaturity: number) => void;
  deleteSession: (id: string) => void;
  clearAll: () => void;
  restoreFromServer: () => Promise<void>;
  syncSessionMessages: (sessionId: string, msgs: Message[]) => void;
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
      behavioralTimeline: [],

      currentMessages: () => {
        const { sessions, currentId } = get();
        return sessions.find((s) => s.id === currentId)?.messages ?? [];
      },

      currentDiagnosis: () => {
        const { sessions, currentId } = get();
        return sessions.find((s) => s.id === currentId)?.diagnosis ?? null;
      },

      createSession: () => {
        const id = makeId();
        set((s) => ({
          sessions: [
            { id, title: "Nuevo chat", messages: [], createdAt: Date.now(), updatedAt: Date.now(), diagnosis: null },
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

      setDiagnosis: (d, currentMaturity) => {
        const snapshot: BehavioralSnapshot = {
          timestamp: Date.now(),
          score: d.score,
          profile: d.profile,
          signals: d.signals,
          maturity: currentMaturity,
        };
        set((s) => ({
          sessions: s.sessions.map((session) =>
            session.id === s.currentId
              ? { ...session, diagnosis: d }
              : session
          ),
          behavioralTimeline: [...s.behavioralTimeline.slice(-199), snapshot],
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

      clearAll: () => set({ sessions: [], currentId: null, behavioralTimeline: [] }),

      syncSessionMessages: (sessionId: string, msgs: Message[]): void => {
        set((s): Partial<ChatStore> => {
          const existing = s.sessions.find((sess) => sess.id === sessionId);
          if (existing) {
            const updatedMsgs = [...existing.messages, ...msgs];
            return {
              sessions: s.sessions.map((sess) =>
                sess.id === sessionId
                  ? { ...sess, messages: updatedMsgs, title: makeTitle(updatedMsgs), updatedAt: Date.now() }
                  : sess
              ),
            };
          } else {
            const newSession: ChatSession = {
              id: sessionId, title: makeTitle(msgs),
              messages: msgs, createdAt: Date.now(), updatedAt: Date.now(), diagnosis: null,
            };
            return { sessions: [newSession, ...s.sessions] };
          }
        });
      },

      restoreFromServer: async () => {
        try {
          const { chatApi } = await import("./api");
          const res = await chatApi.getHistory();
          const messages: Message[] = (res.data?.messages ?? []).map(
            (m: { role: string; content: string }) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })
          );
          if (messages.length === 0) return;
          // Keep any local sessions that have messages not yet saved to the server,
          // but always create/update the "server" session with the authoritative history.
          const serverId = "server-history";
          const existing = get().sessions;
          const serverSession = {
            id: serverId,
            title: makeTitle(messages),
            messages,
            createdAt: existing.find((s) => s.id === serverId)?.createdAt ?? Date.now(),
            updatedAt: Date.now(),
            diagnosis: null,
          };
          const otherSessions = existing.filter((s) => s.id !== serverId);
          set({
            sessions: [serverSession, ...otherSessions],
            currentId: get().currentId ?? serverId,
          });
        } catch {}
      },
    }),
    {
      name: "chat-sessions",
      storage: userScopedStorage,
    }
  )
);
