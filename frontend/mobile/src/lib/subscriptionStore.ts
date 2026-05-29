import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { billingApi } from "./api";

export type SubscriptionTier = "free" | "premium";

export const TRIAL_DAYS = 7;

interface SubscriptionStore {
  tier: SubscriptionTier;
  msgCount: number;
  msgWindowStart: string | null;
  trialStartDate: string | null;
  // Actions
  fetchStatus: () => Promise<void>;
  setTier: (tier: SubscriptionTier) => void;
  incrementMsgCount: () => void;
  startTrialIfNeeded: () => void;
}

export const FREE_MSG_LIMIT = 20;
export const FREE_MSG_WINDOW_HOURS = 24;

export const useSubscriptionStore = create<SubscriptionStore>()(
  persist(
    (set, get) => ({
      tier: "free",
      msgCount: 0,
      msgWindowStart: null,
      trialStartDate: null,

      fetchStatus: async () => {
        try {
          const res = await billingApi.getStatus();
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

      startTrialIfNeeded: () => {
        const { tier, trialStartDate } = get();
        if (tier === "premium" || trialStartDate !== null) return;
        // Set locally immediately so UI reacts without waiting for the network
        set({ trialStartDate: new Date().toISOString() });
        // Persist to backend (idempotent — server won't overwrite an existing date)
        import("./api").then(({ syncApi }) => {
          syncApi.startTrial()
            .then((res) => {
              // If server already had a date, adopt it (authoritative source)
              const serverDate = res.data?.trial_started_at;
              if (serverDate) set({ trialStartDate: serverDate });
            })
            .catch(() => {});
        });
      },
    }),
    {
      name: "subscription-status",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// ─── Trial helpers ────────────────────────────────────────────────────────────

export function trialDaysLeft(trialStartDate: string | null): number {
  if (!trialStartDate) return 0;
  const elapsed = (Date.now() - new Date(trialStartDate).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(TRIAL_DAYS - elapsed));
}

export function isTrialActive(store: { tier: SubscriptionTier; trialStartDate: string | null }): boolean {
  if (store.tier === "premium") return false;
  return trialDaysLeft(store.trialStartDate) > 0;
}

export function hasPremiumAccess(store: { tier: SubscriptionTier; trialStartDate: string | null }): boolean {
  return store.tier === "premium" || isTrialActive(store);
}

// ─── Message helpers ──────────────────────────────────────────────────────────

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

export function resetMinutes(msgWindowStart: string | null): number {
  if (!msgWindowStart) return 0;
  const windowStart = new Date(msgWindowStart);
  const resetAt = new Date(windowStart.getTime() + FREE_MSG_WINDOW_HOURS * 3600 * 1000);
  return Math.max(0, Math.ceil((resetAt.getTime() - Date.now()) / 60000));
}
