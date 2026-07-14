// Computes the base URL every API/fetch/axios call in the web app should hit.
//
// On our own production domains, this returns "" (relative) so requests go to
// OUR OWN origin (e.g. https://nuvosai.com/api/...), which next.config.ts
// rewrites server-side to the Railway backend. That makes the auth cookie
// first-party (set by nuvosai.com itself) instead of third-party (set by a
// different registrable domain, iainvestmentadvisor-production.up.railway.app).
// Safari's ITP blocks third-party cookies outright, and Chrome increasingly
// does too — regardless of SameSite=None; Secure being set correctly — which
// is exactly what silently broke login/re-login for every web user: the
// Set-Cookie was sent and technically valid, but the browser discarded it
// before ever storing it, so every next request had no cookie at all.
//
// Anywhere NOT on our own domain (local dev, an unlisted preview URL) falls
// back to hitting the API directly via NEXT_PUBLIC_API_URL, unchanged.
const OWN_DOMAINS = new Set(["nuvosai.com", "www.nuvosai.com"]);

export function apiBase(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (OWN_DOMAINS.has(host) || host.endsWith(".vercel.app")) {
      return "";
    }
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}
