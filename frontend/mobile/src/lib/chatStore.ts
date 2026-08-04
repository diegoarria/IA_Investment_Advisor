import { create } from "zustand";
import { persist } from "zustand/middleware";
import { userScopedStorage } from "./userScopedStorage";
import i18n from "../i18n";

function _newChatTitle(): string {
  return i18n.language === "en" ? "New chat" : "Nuevo chat";
}

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
  // Session ids the user has deleted — persisted so a deleted chat never
  // resurfaces on this device again, even before the server confirms the
  // delete and even if the delete request itself fails (restoreFromServer
  // retries any id here the server hasn't confirmed yet).
  deletedIds: string[];

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
      deletedIds: [],

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
            { id, title: _newChatTitle(), messages: [], createdAt: Date.now(), updatedAt: Date.now(), diagnosis: null },
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
            // Recorded (and persisted) BEFORE the server call resolves —
            // this is what stops a restoreFromServer/poll that fires in the
            // exact same instant from re-merging the session back in while
            // the delete is still in flight.
            deletedIds: s.deletedIds.includes(id) ? s.deletedIds : [...s.deletedIds, id],
          };
        });
        // Local-only removal used to be the whole implementation — the
        // messages stayed in chat_history server-side, so the next history
        // sync silently rebuilt and re-inserted the "deleted" session.
        // Retried with backoff so a transient failure doesn't leave it
        // un-deleted on the server forever (restoreFromServer also retries
        // any id still in deletedIds that the server hasn't confirmed yet).
        (async () => {
          const { chatApi } = await import("./api");
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await chatApi.deleteHistory(id);
              return;
            } catch (e) {
              if (attempt === 2) console.error("Failed to delete chat history on server:", e);
              else await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            }
          }
        })();
      },

      clearAll: () => set({ sessions: [], currentId: null, behavioralTimeline: [] }),

      syncSessionMessages: (sessionId: string, msgs: Message[]): void => {
        // A poll response can carry a message for a session that was just
        // deleted (it raced the delete server-side, or was purged there but
        // this cursor still returned a cached page) — never let it recreate
        // the session client-side.
        if (get().deletedIds.includes(sessionId)) return;
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
            if (!serverDeletedSet.has(id)) chatApi.deleteHistory(id).catch(() => {});
          }

          if (raw.length === 0) {
            if (allDeleted.size > 0) {
              set((s) => {
                const sessions = s.sessions.filter((sess) => !allDeleted.has(sess.id));
                const currentId = s.currentId && sessions.find((sess) => sess.id === s.currentId) ? s.currentId : sessions[0]?.id ?? null;
                return { sessions, currentId };
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
          const localOnly = get().sessions.filter((s) => !serverIds.has(s.id) && s.messages.length > 0 && !allDeleted.has(s.id));
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
