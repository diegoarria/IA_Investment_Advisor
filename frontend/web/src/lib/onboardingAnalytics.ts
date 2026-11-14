"use client";

// Onboarding funnel events for the 3-4 step redesign (2026-11). Web had zero
// named onboarding/signup events before this (only generic $pageview) — this
// file is the single place those events are fired from, so the funnel stays
// consistent instead of ad-hoc posthog.capture() calls scattered across pages.
// Never pass raw tickers, amounts, phone numbers or any other PII as a
// property — these events are funnel/activation signals only.

import posthog from "posthog-js";

export type OnboardingGoal = "portfolio" | "company" | "etf";

export const ONBOARDING_GOAL_STORAGE_KEY = "nuvos_onboarding_goal";

export function captureOnboardingStarted() {
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

export function captureFirstRadarCompleted(ticker?: string) {
  // ticker omitted on purpose — see file header on not sending identifying data
  posthog.capture("first_radar_completed", { platform: "web" });
}

export function captureFirstEtfViewed() {
  posthog.capture("first_etf_viewed", { platform: "web" });
}

export function captureFirstPortfolioViewed() {
  posthog.capture("first_portfolio_viewed", { platform: "web" });
}

export function captureBrokerConnectionStarted(provider: string) {
  posthog.capture("broker_connection_started", { platform: "web", provider });
}

export function captureBrokerConnectionCompleted(provider: string) {
  posthog.capture("broker_connection_completed", { platform: "web", provider });
}

export function captureOnboardingActivated(goal: OnboardingGoal | null) {
  posthog.capture("onboarding_activated", { platform: "web", goal });
}

export function identifyUser(userId: string) {
  // Web never called identify() before this — every onboarding/signup event
  // above landed as an anonymous PostHog event with no link to the real
  // person once they authenticated. Call once per login/register/OAuth
  // success; posthog.identify is itself idempotent for the same id.
  posthog.identify(userId);
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
