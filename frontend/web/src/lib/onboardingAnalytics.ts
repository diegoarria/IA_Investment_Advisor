"use client";

// Onboarding funnel events for the 3-4 step redesign (2026-11). Web had zero
// named onboarding/signup events before this (only generic $pageview) — this
// file is the single place those events are fired from, so the funnel stays
// consistent instead of ad-hoc posthog.capture() calls scattered across pages.
// Never pass raw tickers, amounts, phone numbers or any other PII as a
// property — these events are funnel/activation signals only.

import posthog from "posthog-js";
import { useAuthStore, isGuestUser } from "@/lib/store";

export type OnboardingGoal = "portfolio" | "company" | "etf";

export const ONBOARDING_GOAL_STORAGE_KEY = "nuvos_onboarding_goal";
const FIRST_VALUE_DONE_KEY = "nuvos_first_value_done";
const ACTIVATED_FIRED_KEY = "nuvos_onboarding_activated_fired";

// Fires an event (and marks a localStorage flag) at most once per browser —
// "first_X_completed" must mean first, not "every time the page loads."
// Returns whether it actually fired (false = already fired before, or
// storage unavailable and we can't safely dedupe so we skip rather than
// risk re-firing "first_*" on every refresh).
function fireOnce(flagKey: string, fire: () => void): boolean {
  try {
    if (localStorage.getItem(flagKey) === "1") return false;
    localStorage.setItem(flagKey, "1");
  } catch {
    return false;
  }
  fire();
  return true;
}

function isAuthed(): boolean {
  try {
    return useAuthStore.getState().isAuthenticated && !isGuestUser();
  } catch {
    return false;
  }
}

// Session-scoped (not forever, unlike fireOnce's localStorage flags below):
// "onboarding_started" can legitimately fire again on a genuinely new visit
// (another day, another tab) — it just must not double-fire for the SAME
// visit when a user passes through both the Bienvenida and Personalización
// screens, which both call this.
export function captureOnboardingStarted() {
  try {
    if (sessionStorage.getItem("nuvos_onboarding_started_fired") === "1") return;
    sessionStorage.setItem("nuvos_onboarding_started_fired", "1");
  } catch {
    // storage unavailable — fire anyway rather than silently drop the event
  }
  posthog.capture("onboarding_started", { platform: "web" });
}

export function captureOnboardingGoalSelected(goal: OnboardingGoal) {
  posthog.capture("onboarding_goal_selected", { platform: "web", goal });
}

export function captureSignupStarted() {
  posthog.capture("signup_started", { platform: "web" });
}

export function captureSignupCompleted(method: "email" | "google") {
  posthog.capture("signup_completed", { platform: "web", method });
}

export function captureOnboardingSkipped(step: string) {
  posthog.capture("onboarding_skipped", { platform: "web", step });
}

// "First value" events below all share the same shape: fire at most once
// ever (per browser), tag whether this was a guest or a registered user,
// mark the shared first-value flag, and check whether that's enough to
// also fire onboarding_activated (see checkOnboardingActivation).

export function captureFirstRadarCompleted() {
  // No ticker — see file header on not sending identifying data.
  const fired = fireOnce("nuvos_first_radar_fired", () =>
    posthog.capture("first_radar_completed", { platform: "web", guest: !isAuthed() })
  );
  if (fired) markFirstValueDone();
}

export function captureFirstEtfViewed() {
  const fired = fireOnce("nuvos_first_etf_fired", () =>
    posthog.capture("first_etf_viewed", { platform: "web", guest: !isAuthed() })
  );
  if (fired) markFirstValueDone();
}

export function captureFirstPortfolioViewed() {
  const fired = fireOnce("nuvos_first_portfolio_fired", () =>
    posthog.capture("first_portfolio_viewed", { platform: "web", guest: !isAuthed() })
  );
  if (fired) markFirstValueDone();
}

export function captureBrokerConnectionStarted(provider: string) {
  posthog.capture("broker_connection_started", { platform: "web", provider });
}

export function captureBrokerConnectionCompleted(provider: string) {
  posthog.capture("broker_connection_completed", { platform: "web", provider });
}

function markFirstValueDone() {
  try {
    localStorage.setItem(FIRST_VALUE_DONE_KEY, "1");
  } catch {
    // best-effort only
  }
  checkOnboardingActivation();
}

// onboarding_activated = registered account + at least one first-value
// event, in EITHER order: a guest who saw a real Radar result and only
// registered afterward still counts, same as someone who registers first
// and then views their first Distribución. Call this after login/register
// succeeds AND from markFirstValueDone above — whichever side completes
// second is what actually fires it. Fires at most once per browser.
export function checkOnboardingActivation() {
  try {
    if (localStorage.getItem(ACTIVATED_FIRED_KEY) === "1") return;
    if (localStorage.getItem(FIRST_VALUE_DONE_KEY) !== "1") return;
    if (!isAuthed()) return;
    localStorage.setItem(ACTIVATED_FIRED_KEY, "1");
  } catch {
    return;
  }
  posthog.capture("onboarding_activated", { platform: "web", goal: readOnboardingGoal() });
}

export function identifyUser(userId: string) {
  // Web never called identify() before this — every onboarding/signup event
  // above landed as an anonymous PostHog event with no link to the real
  // person once they authenticated. Call once per login/register/OAuth
  // success; posthog.identify is itself idempotent for the same id.
  posthog.identify(userId);
  checkOnboardingActivation();
}

export function saveOnboardingGoal(goal: OnboardingGoal) {
  try {
    localStorage.setItem(ONBOARDING_GOAL_STORAGE_KEY, goal);
  } catch {
    // Safari private mode / storage disabled — the goal just won't
    // personalize post-registration routing; never block on this.
  }
}

export function readOnboardingGoal(): OnboardingGoal | null {
  try {
    const v = localStorage.getItem(ONBOARDING_GOAL_STORAGE_KEY);
    return v === "portfolio" || v === "company" || v === "etf" ? v : null;
  } catch {
    return null;
  }
}

export function clearOnboardingGoal() {
  try {
    localStorage.removeItem(ONBOARDING_GOAL_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// Stage F fix: these dedupe flags are keyed per BROWSER, not per account —
// correct for a guest who hasn't registered yet, wrong once someone logs
// out of a shared device: the NEXT real person's genuine first_radar_
// completed/onboarding_activated would be silently swallowed by the
// previous person's already-set flags, exactly the same class of bug
// posthog.reset() on logout fixes for PostHog's own identity. Call this
// from the same logout path that calls posthog.reset() (useAuthStore's
// clearAuth). Never call this on simple navigation/refresh — only logout.
export function resetOnboardingAnalyticsForLogout() {
  try {
    localStorage.removeItem(ONBOARDING_GOAL_STORAGE_KEY);
    localStorage.removeItem(FIRST_VALUE_DONE_KEY);
    localStorage.removeItem(ACTIVATED_FIRED_KEY);
    localStorage.removeItem("nuvos_first_radar_fired");
    localStorage.removeItem("nuvos_first_etf_fired");
    localStorage.removeItem("nuvos_first_portfolio_fired");
  } catch {
    // best-effort — worst case the next account's funnel is slightly
    // undercounted, never a crash
  }
}
