import { create } from "zustand";
import api from "./api";

export type UpsellOffer = "family_plan" | "session";

interface UpsellState {
  activeOffer: UpsellOffer | null;
  userTier: "free" | "premium";
  prices: Record<string, number>;
  triggerSource: string | null;
  offeredThisSession: boolean;
  setActiveOffer: (offer: UpsellOffer | null) => void;
  trigger: (source: string) => Promise<void>;
  dismiss: () => Promise<void>;
}

export const useUpsellStore = create<UpsellState>((set, get) => ({
  activeOffer: null,
  userTier: "free",
  prices: {},
  triggerSource: null,
  offeredThisSession: false,

  setActiveOffer: (offer) => set({ activeOffer: offer }),

  trigger: async (source: string) => {
    if (get().offeredThisSession) return;
    try {
      const res = await api.get(`/api/upsells/check?trigger_source=${source}`);
      const { offer, user_tier, prices } = res.data;
      if (offer) {
        set({
          activeOffer: offer,
          userTier: user_tier,
          prices: prices ?? {},
          triggerSource: source,
          offeredThisSession: true,
        });
        api.post("/api/upsells/events", {
          event_type: "upsell_viewed",
          offer_type: offer,
          user_tier,
          trigger_source: source,
        }).catch(() => {});
      }
    } catch {}
  },

  dismiss: async () => {
    const { activeOffer, userTier, triggerSource } = get();
    if (!activeOffer) return;
    try {
      await api.post("/api/upsells/dismiss", {
        offer_type: activeOffer,
        user_tier: userTier,
        trigger_source: triggerSource,
      });
    } catch {}
    set({ activeOffer: null, triggerSource: null });
  },
}));
