import { create } from "zustand";
import { persist } from "zustand/middleware";
import { userScopedStorage } from "./userScopedStorage";
import { billingApi } from "./api";
import { posthog } from "../config/posthog";

export type SubscriptionTier = "free" | "premium";

interface SubscriptionStore {
  tier: SubscriptionTier;
  msgCount: number;
  msgWindowStart: string | null;
  trialStartDate: string | null;
  isTrialPremium: boolean;
  trialDaysLeftServer: number;
  // True once fetchStatus() has resolved with a real server answer at least
  // once. Gates any "your trial expired" UI — without this, a brand-new
  // trial user could see trialStartDate get set optimistically (see
  // startTrialIfNeeded below) while `tier` is still its stale/default "free"
  // value, and briefly get told their trial already ended.
  hasFetchedStatus: boolean;
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
      isTrialPremium: false,
      trialDaysLeftServer: 0,
      hasFetchedStatus: false,

      fetchStatus: async () => {
        try {
          const res = await billingApi.getStatus();
          const prevTier = get().tier;
          const newTier = res.data.tier ?? "free";
          if (prevTier !== "premium" && newTier === "premium") {
            posthog.capture("premium_upgrade_completed", { plan: res.data.plan ?? null });
          }
          set({
            tier:                newTier,
            msgCount:            res.data.msg_count  ?? 0,
            msgWindowStart:      res.data.msg_window_start ?? null,
            isTrialPremium:      res.data.is_trial ?? false,
            trialDaysLeftServer: res.data.trial_days_left ?? 0,
            hasFetchedStatus:    true,
            ...(res.data.trial_started_at
              ? { trialStartDate: res.data.trial_started_at }
              : {}),
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
      storage: userScopedStorage,
    }
  )
);

// ─── Trial helpers ────────────────────────────────────────────────────────────
// `tier` is always the server's effective_tier (billing.py get_status) —
// it's already "premium" during an active trial, an active streak/referral
// bonus, or a real paid subscription. Don't reimplement the trial window
// math client-side (a stale local TRIAL_DAYS constant drifted out of sync
// with the backend's _PROMO_DAYS before and caused the premium/free badge
// to disagree with the server).

export function hasPremiumAccess(store: { tier: SubscriptionTier }): boolean {
  return store.tier === "premium";
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
