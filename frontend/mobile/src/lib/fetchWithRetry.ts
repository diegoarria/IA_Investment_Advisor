/**
 * Retries a request a few times with backoff before giving up — same
 * discipline as useSubscriptionStore.fetchStatus: a single transient blip
 * (cold API start, a dropped request, a flaky mobile network) must never
 * be the reason cash/dividend totals silently drop out of a portfolio
 * total for the rest of the session. Returns undefined (instead of
 * throwing) once attempts are exhausted, so callers can just no-op on a
 * real, logged failure instead of swallowing it silently.
 *
 * 401/403 skip retries — a logged-out/guest call will never succeed no
 * matter how many attempts, so retrying just burns the shared rate limit.
 */
export async function fetchWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T | undefined> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const authFailure = status === 401 || status === 403;
      if (attempt === attempts || authFailure) {
        if (!authFailure) {
          console.error("fetchWithRetry: giving up after", attempt, "attempts", err);
        }
        return undefined;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return undefined;
}
