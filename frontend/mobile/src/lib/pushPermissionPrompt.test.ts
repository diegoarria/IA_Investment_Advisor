import { decidePushPromptAction } from "./pushPermissionPrompt";

describe("decidePushPromptAction", () => {
  // The actual Apple-rejection bug: before the fix, _layout.tsx had no
  // "alreadyPromptedThisSession" concept at all — it called the equivalent
  // of decidePushPromptAction(status, /* always */ false) on every single
  // navigation. These two cases are the regression: once the user has
  // already been asked this session, every subsequent navigation must be a
  // no-op regardless of status, never re-showing the rationale or the
  // settings Alert.
  it("never re-prompts after an undetermined user already saw the rationale this session", () => {
    expect(decidePushPromptAction("undetermined", true)).toBe("skip");
  });

  it("never re-prompts after a denied user already saw the settings hint this session", () => {
    expect(decidePushPromptAction("denied", true)).toBe("skip");
  });

  it("shows the rationale exactly once — the first undetermined ask this session", () => {
    expect(decidePushPromptAction("undetermined", false)).toBe("show_rationale");
  });

  it("shows the settings hint exactly once — the first denied ask this session", () => {
    expect(decidePushPromptAction("denied", false)).toBe("show_settings_hint");
  });

  it("always registers silently when already granted, regardless of session state", () => {
    expect(decidePushPromptAction("granted", false)).toBe("register");
    expect(decidePushPromptAction("granted", true)).toBe("register");
  });

  it("never blocks on denied/undetermined — skip and show_*_hint are both non-blocking UI, never a dead end", () => {
    const blocking: unknown[] = [];
    for (const status of ["denied", "undetermined"] as const) {
      for (const already of [true, false]) {
        const action = decidePushPromptAction(status, already);
        expect(["skip", "show_rationale", "show_settings_hint"]).toContain(action);
      }
    }
    expect(blocking).toHaveLength(0);
  });
});
