// Shared "apply a pending referral code" logic — called from every place a
// session can first come into existence (email/password register in
// page.tsx, Google OAuth in auth/callback/page.tsx, and a global safety-net
// mount in layout.tsx) so a referral isn't dropped just because one of those
// paths forgets to check for it.
//
// The code is stored in localStorage (not sessionStorage — a referral link
// is shared precisely through channels, like an in-app browser's "open in
// Safari/Chrome", that don't preserve sessionStorage across the new
// browsing context) under "nuvos_ref", written once by /join on first visit.
const REF_STORAGE_KEY = "nuvos_ref";

export function setPendingReferralCode(code: string): void {
  try { localStorage.setItem(REF_STORAGE_KEY, code.toUpperCase()); } catch { /* ignore */ }
}

export function getPendingReferralCode(): string | null {
  try { return localStorage.getItem(REF_STORAGE_KEY); } catch { return null; }
}

export async function applyPendingReferralIfAny(): Promise<void> {
  if (typeof window === "undefined") return;
  const code = getPendingReferralCode();
  if (!code) return;
  try {
    const { referral } = await import("./api");
    await referral.applyCode(code);
    try { localStorage.removeItem(REF_STORAGE_KEY); } catch { /* ignore */ }
  } catch (err: unknown) {
    // 400 (bad code), 404 (unknown code), and 409 (this account already has
    // a referrer — includes self-referral and "already applied") are all
    // definitive outcomes: retrying can never succeed, so stop trying.
    // Anything else (network hiccup, a 401 fired before the new session
    // cookie has propagated, a transient 5xx) is worth another attempt
    // later, so the code stays in storage.
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 400 || status === 404 || status === 409) {
      try { localStorage.removeItem(REF_STORAGE_KEY); } catch { /* ignore */ }
    }
  }
}
