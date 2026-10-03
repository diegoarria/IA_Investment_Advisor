import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://nyxcqjzeiyptyipigsaz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55eGNxanplaXlwdHlpcGlnc2F6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NDYwOTIsImV4cCI6MjA5NTEyMjA5Mn0.zrOA6106uiBblb95PHc-jEvtBkFfB8jIHjxC_qZrlwg";

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    // The app's own auth (every real API call) runs entirely on a separate,
    // httpOnly cookie the backend sets — this Supabase client's own session
    // is only used for the Google OAuth exchange and the 401-interceptor's
    // multi-tab refresh fallback (see api.ts). Left at Supabase's default,
    // it persists that session in localStorage in plaintext; a future XSS
    // bug anywhere on the site could read it and, since /api/auth/set-session
    // trusts a client-supplied Supabase access_token after validating it,
    // use it to mint fresh httpOnly cookies too — a full account-takeover
    // path, not just a stolen short-lived token. sessionStorage narrows that
    // window to the current tab instead of surviving indefinitely on disk.
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: typeof window !== "undefined" ? window.sessionStorage : undefined,
        persistSession: true,
        // Diego, 2026-10-02: "deja la sesión iniciada siempre". The backend's
        // httpOnly cookie is THE session; this client must never rotate the
        // same refresh token on its own. With autoRefreshToken on, after a
        // Google sign-in both this SDK and /api/auth/refresh rotated one
        // shared token family — whichever ran second presented an already-
        // used token, and Supabase's reuse detection can revoke the whole
        // session, logging the user out on every device. The OAuth session
        // is handed to the backend once (auth/callback) and then forgotten
        // locally (forgetLocalSupabaseSession).
        autoRefreshToken: false,
        // supabase-js v2 defaults detectSessionInUrl to true, which makes the
        // SDK itself silently start exchanging the one-time PKCE `?code=`
        // param the instant this client is constructed on /auth/callback —
        // racing app/auth/callback/page.tsx's own explicit
        // exchangeCodeForSession(code) call for the SAME single-use code.
        // Whichever call loses gets "invalid grant," and since nothing in
        // the app listens for the SDK's own SIGNED_IN event when ITS
        // exchange wins instead, the session is silently dropped and the
        // user bounces back to "/" with no auth state — then retries,
        // repeating the same race. Confirmed 2026-09-15: this was the
        // Google-OAuth guest<->login<->Google loop reported for new
        // signups. Disabling this makes the callback page's own explicit
        // exchange the only consumer of the code.
        detectSessionInUrl: false,
      },
    });
  }
  return _client;
}

/** Drops this tab's copy of the Supabase session WITHOUT calling signOut
 *  (signOut would revoke the very session the backend cookie now holds).
 *  Called once the session has been handed to the backend cookie, so only
 *  one place ever refreshes it. */
export function forgetLocalSupabaseSession(): void {
  if (typeof window === "undefined") return;
  try {
    for (const store of [window.sessionStorage, window.localStorage]) {
      for (let i = store.length - 1; i >= 0; i--) {
        const key = store.key(i);
        if (key && key.startsWith("sb-") && key.includes("auth-token")) store.removeItem(key);
      }
    }
  } catch { /* storage unavailable */ }
}
