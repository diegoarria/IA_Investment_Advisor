// Pure decision logic for app/_layout.tsx's registerPushToken(), pulled out
// so it can be unit-tested without mounting the native navigation tree (no
// react-native-testing-library in this repo, and this bug doesn't need one).
//
// Apple rejection (Guideline 4.5.4, build 46, 2026-11-14): the app was
// judged to "require" push notifications because registerPushToken() ran
// on every screen navigation (a useEffect keyed on pathname) with no memory
// of having already asked — so a user who tapped "Ahora no" (status stays
// "undetermined") or had already denied it in OS Settings (status "denied")
// got the rationale/settings Alert again on the very next screen, and the
// next, and the next. This function is the single place that decides
// whether to show anything at all, given whether this session already did.

export type PushPermissionStatus = "granted" | "denied" | "undetermined";

export type PushPromptAction =
  | "register"           // granted — silently fetch/send the Expo push token, no UI
  | "show_rationale"      // undetermined, first ask this session — show the custom pre-prompt
  | "show_settings_hint"  // denied, first ask this session — point at device Settings
  | "skip";                // already asked this session and user hasn't granted — do nothing

export function decidePushPromptAction(
  status: PushPermissionStatus,
  alreadyPromptedThisSession: boolean,
): PushPromptAction {
  if (status === "granted") return "register";
  if (alreadyPromptedThisSession) return "skip";
  return status === "undetermined" ? "show_rationale" : "show_settings_hint";
}
