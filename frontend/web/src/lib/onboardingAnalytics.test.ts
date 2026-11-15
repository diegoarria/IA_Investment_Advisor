import { describe, it, expect, beforeEach, vi } from "vitest";

const { captureMock, identifyMock, authStateBox, guestStateBox } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  identifyMock: vi.fn(),
  authStateBox: { value: { isAuthenticated: false } },
  guestStateBox: { value: false },
}));

vi.mock("posthog-js", () => ({
  default: { capture: captureMock, identify: identifyMock },
}));

vi.mock("@/lib/store", () => ({
  useAuthStore: { getState: () => authStateBox.value },
  isGuestUser: () => guestStateBox.value,
}));

// Imported after the mocks above are registered — vitest hoists vi.mock
// calls, but importing dynamically here keeps the intent explicit.
import {
  captureOnboardingStarted,
  captureFirstRadarCompleted,
  captureFirstEtfViewed,
  captureFirstPortfolioViewed,
  checkOnboardingActivation,
  identifyUser,
  saveOnboardingGoal,
  readOnboardingGoal,
  clearOnboardingGoal,
  resetOnboardingAnalyticsForLogout,
} from "./onboardingAnalytics";

function resetAll() {
  localStorage.clear();
  sessionStorage.clear();
  captureMock.mockClear();
  identifyMock.mockClear();
  authStateBox.value = { isAuthenticated: false };
  guestStateBox.value = false;
}

describe("onboarding goal persistence", () => {
  beforeEach(resetAll);

  it("round-trips through localStorage", () => {
    expect(readOnboardingGoal()).toBeNull();
    saveOnboardingGoal("company");
    expect(readOnboardingGoal()).toBe("company");
    clearOnboardingGoal();
    expect(readOnboardingGoal()).toBeNull();
  });

  it("rejects a garbage stored value instead of returning it", () => {
    localStorage.setItem("nuvos_onboarding_goal", "not-a-real-goal");
    expect(readOnboardingGoal()).toBeNull();
  });
});

describe("captureOnboardingStarted", () => {
  beforeEach(resetAll);

  it("fires once per session even if called from two different screens", () => {
    captureOnboardingStarted(); // e.g. Bienvenida mounts
    captureOnboardingStarted(); // e.g. Personalización mounts right after
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith("onboarding_started", { platform: "web" });
  });

  it("fires again in a new session (sessionStorage cleared)", () => {
    captureOnboardingStarted();
    sessionStorage.clear();
    captureOnboardingStarted();
    expect(captureMock).toHaveBeenCalledTimes(2);
  });
});

describe("first-value events — fire at most once ever, tag guest status", () => {
  beforeEach(resetAll);

  it("first_radar_completed fires once and never again on a second call", () => {
    guestStateBox.value = true;
    captureFirstRadarCompleted();
    captureFirstRadarCompleted();
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith("first_radar_completed", { platform: "web", guest: true });
  });

  it("tags guest:false for an authenticated user", () => {
    authStateBox.value = { isAuthenticated: true };
    guestStateBox.value = false;
    captureFirstEtfViewed();
    expect(captureMock).toHaveBeenCalledWith("first_etf_viewed", { platform: "web", guest: false });
  });

  it("first_portfolio_viewed is independent of the other two flags", () => {
    captureFirstRadarCompleted();
    captureFirstEtfViewed();
    captureFirstPortfolioViewed();
    expect(captureMock).toHaveBeenCalledTimes(3);
  });
});

describe("onboarding_activated — real activation, not a simple click", () => {
  beforeEach(resetAll);

  it("never fires for a guest who saw real value but never registered", () => {
    guestStateBox.value = true;
    captureFirstRadarCompleted();
    expect(captureMock).not.toHaveBeenCalledWith("onboarding_activated", expect.anything());
  });

  it("never fires for a registered account with no first-value event yet", () => {
    authStateBox.value = { isAuthenticated: true };
    identifyUser("user-123");
    expect(captureMock).not.toHaveBeenCalledWith("onboarding_activated", expect.anything());
  });

  it("fires when a guest's first-value event is later followed by registration", () => {
    guestStateBox.value = true;
    captureFirstRadarCompleted(); // first value as a guest
    authStateBox.value = { isAuthenticated: true };
    guestStateBox.value = false;
    identifyUser("user-123"); // registers afterward
    expect(captureMock).toHaveBeenCalledWith("onboarding_activated", { platform: "web", goal: null });
  });

  it("fires when registration happens first and first-value comes after", () => {
    authStateBox.value = { isAuthenticated: true };
    identifyUser("user-123");
    saveOnboardingGoal("etf");
    captureFirstEtfViewed();
    expect(captureMock).toHaveBeenCalledWith("onboarding_activated", { platform: "web", goal: "etf" });
  });

  it("never fires twice for the same browser", () => {
    authStateBox.value = { isAuthenticated: true };
    saveOnboardingGoal("company");
    captureFirstRadarCompleted();
    checkOnboardingActivation();
    checkOnboardingActivation();
    const activatedCalls = captureMock.mock.calls.filter((c) => c[0] === "onboarding_activated");
    expect(activatedCalls.length).toBe(1);
  });

  it("fires again for a second real account on the same shared device after logout resets the flags", () => {
    // Account A activates.
    authStateBox.value = { isAuthenticated: true };
    saveOnboardingGoal("company");
    captureFirstRadarCompleted();
    expect(captureMock).toHaveBeenCalledWith("onboarding_activated", { platform: "web", goal: "company" });
    captureMock.mockClear();

    // Logout: without resetOnboardingAnalyticsForLogout, account B's own
    // genuine activation would be silently swallowed by A's leftover flags.
    resetOnboardingAnalyticsForLogout();
    authStateBox.value = { isAuthenticated: false };

    // Account B signs up and activates independently.
    guestStateBox.value = true;
    captureFirstEtfViewed();
    expect(captureMock).not.toHaveBeenCalledWith("onboarding_activated", expect.anything());
    authStateBox.value = { isAuthenticated: true };
    guestStateBox.value = false;
    saveOnboardingGoal("etf");
    checkOnboardingActivation();
    expect(captureMock).toHaveBeenCalledWith("onboarding_activated", { platform: "web", goal: "etf" });
  });
});
