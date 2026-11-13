import { create } from "zustand";

// iOS doesn't handle two native <Modal> presentations stacked at once well —
// dismissing one while another is still presenting leaves the remaining one
// (or the screen underneath) with a broken touch-handling state, frozen and
// unresponsive (confirmed 2026-10-29: TrialExpiredModal, mounted globally in
// app/_layout.tsx, could flip itself visible while PricingModal/PaywallModal
// was already open on whatever screen the user was on — it's used in ~19
// screens). Every full-screen paywall-type Modal claims/releases this count
// around its own `visible` prop; TrialExpiredModal defers itself while the
// count is > 0 and only resumes nagging once everything else has closed.
type PaywallModalGuardState = {
  openCount: number;
  claim: () => void;
  release: () => void;
};

export const usePaywallModalGuard = create<PaywallModalGuardState>((set) => ({
  openCount: 0,
  claim: () => set((s) => ({ openCount: s.openCount + 1 })),
  release: () => set((s) => ({ openCount: Math.max(0, s.openCount - 1) })),
}));
