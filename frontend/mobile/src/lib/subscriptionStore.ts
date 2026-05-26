import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { billingApi } from "./api";

export type SubscriptionTier = "free" | "premium";

interface SubscriptionStore {
  tier: SubscriptionTier;
  msgCount: number;
  msgWindowStart: string | null;
  // Actions
  fetchStatus: () => Promise<void>;
  setTier: (tier: SubscriptionTier) => void;
  incrementMsgCount: () => void;
}

export const FREE_MSG_LIMIT = 20;
export const FREE_MSG_WINDOW_HOURS = 24;

export const useSubscriptionStore = create<SubscriptionStore>()(
  persist(
    (set, get) => ({
      tier: "free",
      msgCount: 0,
      msgWindowStart: null,

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
    }),
    {
      name: "subscription-status",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// Helpers
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
