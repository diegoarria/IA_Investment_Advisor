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
        // A single transient failure (cold API start, a flaky mobile
        // network) must never be the reason a real trial/premium user gets
        // stuck looking free for the rest of the session — retry a few
        // times with backoff before giving up.
        const ATTEMPTS = 3;
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
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
            return;
          } catch (err) {
            if (attempt === ATTEMPTS) {
              console.error("useSubscriptionStore.fetchStatus: giving up after", ATTEMPTS, "attempts", err);
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

      startTrialIfNeeded: () => {
        const { tier, trialStartDate } = get();
        if (tier === "premium" || trialStartDate !== null) return;
        // Set locally immediately so UI reacts without waiting for the network
        const optimisticDate = new Date().toISOString();
        set({ trialStartDate: optimisticDate });
        // Persist to backend (idempotent — server won't overwrite an existing date)
        import("./api").then(({ syncApi }) => {
          syncApi.startTrial()
            .then((res) => {
              // If the server refused (e.g. no profile row yet — onboarding
              // not finished) there is no server-side trial to back this
              // date up. Leaving the optimistic device-clock date in place
              // would strand it forever with nothing to reconcile against,
              // and — combined with the trial-expired check in
              // app/_layout.tsx, which only looks at whether
              // trialStartDate is set — could show "your trial expired"
              // for a trial that, server-side, never started. Roll it back
              // instead so the check stays a no-op until a real trial exists.
              if (res.data?.ok === false) {
                if (get().trialStartDate === optimisticDate) set({ trialStartDate: null });
                return;
              }
              // If server already had a date, adopt it (authoritative source)
              const serverDate = res.data?.trial_started_at;
              if (serverDate) set({ trialStartDate: serverDate });
            })
            .catch(() => {
              // Network/server error — same reasoning: don't strand an
              // unverified device-clock date.
              if (get().trialStartDate === optimisticDate) set({ trialStartDate: null });
            });
        });
      },
    }),
    {
      name: "subscription-status",
      storage: userScopedStorage,
      // hasFetchedStatus must never survive a cold start — persisting it
      // as `true` from the last session is exactly what let the
      // trial-expired guard in app/_layout.tsx pass on stale data and show
      // "Tu prueba Premium terminó" to a user still mid-trial, before this
      // run's fetchStatus() had even resolved.
      partialize: (state) => {
        const { hasFetchedStatus: _hasFetchedStatus, ...rest } = state;
        return rest;
      },
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
