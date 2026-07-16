import { create } from "zustand";
import { persist } from "zustand/middleware";
import { userScopedStorage } from "./userScopedStorage";

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
  resumeOrCreateSession: () => string;
  loadSession: (id: string) => void;
  setMessages: (msgs: Message[]) => void;
  setDiagnosis: (d: BehavioralDiagnosis, currentMaturity: number) => void;
  deleteSession: (id: string) => void;
  clearAll: () => void;
  restoreFromServer: () => Promise<void>;
  syncSessionMessages: (sessionId: string, msgs: Message[]) => void;
}

const CHAT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

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

      // A chat "session" stays the active conversation across app opens/foreground
      // returns — only actually starts a new one once CHAT_SESSION_TTL_MS has
      // passed since the last message, matching web's behavior.
      resumeOrCreateSession: () => {
        const { sessions, currentId } = get();
        const latest = sessions[0];
        if (latest && latest.messages.length > 0 && Date.now() - latest.updatedAt < CHAT_SESSION_TTL_MS) {
          if (currentId !== latest.id) set({ currentId: latest.id });
          return latest.id;
        }
        return get().createSession();
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

      deleteSession: (id) => {
        set((s) => {
          const remaining = s.sessions.filter((session) => session.id !== id);
          return {
            sessions: remaining,
            currentId: s.currentId === id ? (remaining[0]?.id ?? null) : s.currentId,
          };
        });
        // Local-only removal used to be the whole implementation — the
        // messages stayed in chat_history server-side, so the next history
        // sync silently rebuilt and re-inserted the "deleted" session.
        (async () => {
          try {
            const { chatApi } = await import("./api");
            await chatApi.deleteHistory(id);
          } catch (e) {
            console.error("Failed to delete chat history on server:", e);
          }
        })();
      },

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
              const chatMsgs: Message[] = msgs.map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              }));
              return {
                id: sid,
                title: makeTitle(chatMsgs),
                messages: chatMsgs,
                createdAt: new Date(msgs[0].created_at ?? 0).getTime() || Date.now(),
                updatedAt: new Date(msgs[msgs.length - 1].created_at ?? 0).getTime() || Date.now(),
                diagnosis: null,
              };
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);

          // Keep local sessions that have messages but are not on server yet (unsent)
          const serverIds = new Set(serverSessions.map((s) => s.id));
          const localOnly = get().sessions.filter((s) => !serverIds.has(s.id) && s.messages.length > 0);
          const merged = [...localOnly, ...serverSessions].sort((a, b) => b.updatedAt - a.updatedAt);

          const { currentId } = get();
          const validCurrentId =
            currentId && merged.find((s) => s.id === currentId)
              ? currentId
              : merged[0]?.id ?? null;

          set({ sessions: merged, currentId: validCurrentId });
        } catch {}
      },
    }),
    {
      name: "chat-sessions",
      storage: userScopedStorage,
    }
  )
);
