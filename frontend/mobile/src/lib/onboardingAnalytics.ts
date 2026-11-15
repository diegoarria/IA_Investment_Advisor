import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { posthog } from "../config/posthog";
import { useAppStore } from "./profileStore";

// Mobile port of the web onboarding funnel analytics (frontend/web/src/lib/
// onboardingAnalytics.ts, Stage A-D). Same event names, same dedupe rules,
// same "never send PII" discipline — this file exists so Web and Mobile
// report the identical schema, not two similar-but-drifted ones.
//
// Device-scoped, not per-account-persisted like most of this app's stores
// (profile, portfolio, subscription — see userScopedStorage.ts) — a guest's
// "first_radar_completed" needs to survive into whatever account they
// register next. BUT a permanent per-device key is the wrong SOLE source
// for "did this person activate" across a logout: resetOnboardingAnalytics
// below clears it on logout (called alongside posthog.reset()), so a
// second real account on a shared device gets its own genuine activation
// counted instead of being silently swallowed by the first account's
// already-set flags.

export type OnboardingGoal = "portfolio" | "company" | "etf";

interface OnboardingAnalyticsState {
  goal: OnboardingGoal | null;
  firedFlags: Record<string, boolean>;
  activatedFired: boolean;
  setGoal: (goal: OnboardingGoal | null) => void;
  markFired: (key: string) => void;
  markActivated: () => void;
  resetAll: () => void;
}

const useOnboardingAnalyticsStore = create<OnboardingAnalyticsState>()(
  persist(
    (set) => ({
      goal: null,
      firedFlags: {},
      activatedFired: false,
      setGoal: (goal) => set({ goal }),
      markFired: (key) => set((s) => ({ firedFlags: { ...s.firedFlags, [key]: true } })),
      markActivated: () => set({ activatedFired: true }),
      resetAll: () => set({ goal: null, firedFlags: {}, activatedFired: false }),
    }),
    { name: "nuvos-onboarding-analytics", storage: createJSONStorage(() => AsyncStorage) }
  )
);

// Session-scoped (NOT persisted) — unlike the "first_*" flags above, which
// must mean first-ever, "onboarding_started" can fire again on a genuinely
// new app open; it just must not double-fire if the same visit passes
// through both the Bienvenida and Personalización screens.
let startedFiredThisSession = false;

function isAuthed(): boolean {
  return !!useAppStore.getState().profile;
}

function fireOnce(flagKey: string, fire: () => void): boolean {
  const state = useOnboardingAnalyticsStore.getState();
  if (state.firedFlags[flagKey]) return false;
  state.markFired(flagKey);
  fire();
  return true;
}

export function captureOnboardingStarted() {
  if (startedFiredThisSession) return;
  startedFiredThisSession = true;
  posthog.capture("onboarding_started", { platform: "mobile" });
}

export function captureOnboardingGoalSelected(goal: OnboardingGoal) {
  posthog.capture("onboarding_goal_selected", { platform: "mobile", goal });
}

export function captureSignupStarted() {
  posthog.capture("signup_started", { platform: "mobile" });
}

// Mobile already had its own "user_signed_up" event (app/index.tsx) before
// this file existed — kept as-is, not removed. This is the same-named
// event web's funnel uses (signup_completed), added alongside it so the
// two platforms report the identical schema for cross-platform funnels.
export function captureSignupCompleted(method: "email" | "google" | "biometric") {
  posthog.capture("signup_completed", { platform: "mobile", method });
}

export function captureOnboardingSkipped(step: string) {
  posthog.capture("onboarding_skipped", { platform: "mobile", step });
}

export function captureFirstRadarCompleted() {
  // No ticker in the payload — see file header on never sending identifying data.
  if (fireOnce("first_radar_completed", () =>
    posthog.capture("first_radar_completed", { platform: "mobile", guest: !isAuthed() })
  )) checkOnboardingActivation();
}

export function captureFirstEtfViewed() {
  if (fireOnce("first_etf_viewed", () =>
    posthog.capture("first_etf_viewed", { platform: "mobile", guest: !isAuthed() })
  )) checkOnboardingActivation();
}

export function captureFirstPortfolioViewed() {
  if (fireOnce("first_portfolio_viewed", () =>
    posthog.capture("first_portfolio_viewed", { platform: "mobile", guest: !isAuthed() })
  )) checkOnboardingActivation();
}

export function captureBrokerConnectionStarted(provider: string) {
  posthog.capture("broker_connection_started", { platform: "mobile", provider });
}

export function captureBrokerConnectionCompleted(provider: string) {
  posthog.capture("broker_connection_completed", { platform: "mobile", provider });
}

// onboarding_activated = a registered account + at least one real
// first-value event, in EITHER order — a guest who saw a real Radar result
// before registering still counts, same as someone who registers first and
// views Distribución afterward. Call after login/register succeeds AND
// from each first-value capture above; whichever side completes second is
// what actually fires it. Fires at most once ever, on this device.
export function checkOnboardingActivation() {
  const state = useOnboardingAnalyticsStore.getState();
  if (state.activatedFired) return;
  const anyFirstValue = Object.keys(state.firedFlags).some((k) =>
    k === "first_radar_completed" || k === "first_etf_viewed" || k === "first_portfolio_viewed"
  );
  if (!anyFirstValue || !isAuthed()) return;
  state.markActivated();
  posthog.capture("onboarding_activated", { platform: "mobile", goal: state.goal });
}

export function saveOnboardingGoal(goal: OnboardingGoal) {
  useOnboardingAnalyticsStore.getState().setGoal(goal);
}

export function readOnboardingGoal(): OnboardingGoal | null {
  return useOnboardingAnalyticsStore.getState().goal;
}

export function clearOnboardingGoal() {
  useOnboardingAnalyticsStore.getState().setGoal(null);
}

// Call from the same logout path that calls posthog.reset() (app/(tabs)/
// profile.tsx's handleLogout and Sidebar.tsx's useLogout) — never on
// simple navigation/refresh. See the store's own comment above for why.
export function resetOnboardingAnalytics() {
  useOnboardingAnalyticsStore.getState().resetAll();
}

// Not persisted across app opens by design (AsyncStorage flag below, see
// WELCOME_SEEN_KEY usage in app/index.tsx) — this store only tracks the
// funnel signals, not the "have they seen Bienvenida" gate itself, to keep
// this file symmetric with the web module it mirrors.
export { useOnboardingAnalyticsStore };
