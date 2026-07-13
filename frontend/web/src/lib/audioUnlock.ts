// iOS Safari (and to a lesser extent desktop Safari) blocks any
// programmatic `audio.play()` that isn't called synchronously inside a real
// user-gesture's call stack — even a click a moment earlier doesn't count
// once an `await` (network call, WebSocket round-trip, etc.) has happened in
// between. Playing a near-silent clip on the SAME <audio> element, still
// inside the gesture handler, "unlocks" that element for the rest of the
// page's lifetime — later programmatic .play() calls on it (from async
// code, WebSocket message handlers, etc.) are then allowed.
//
// Used by: the chat mic-recording button (voice message replies) and the
// "start voice call" button (every sentence the Mentor speaks during a
// call) — both trigger audio playback from code paths several `await`s
// removed from the click that started them.

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

let unlockedAudio: HTMLAudioElement | null = null;

/** Call synchronously inside a click/tap handler, before any `await`. */
export function unlockAudioPlayback(): void {
  if (typeof window === "undefined") return;
  if (!unlockedAudio) unlockedAudio = new Audio();
  unlockedAudio.src = SILENT_WAV;
  unlockedAudio.play().catch(() => {});
}

/** The same element `unlockAudioPlayback` played on — reuse it for real
 * playback later so the unlock actually applies. Falls back to creating one
 * (unlocked or not) if playback is attempted without ever unlocking first. */
export function getUnlockedAudioElement(): HTMLAudioElement {
  if (!unlockedAudio) unlockedAudio = new Audio();
  return unlockedAudio;
}
